"""Register the per-stage .env (IBL) and LDR sky JPEG as pack items."""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from items import ROOT, register, polyhaven_source

sky = json.load(open(f"{ROOT}/work/sky/sky_ldr.json"))
env = json.load(open(f"{ROOT}/work/env/env.json"))
fetched = json.load(open(f"{ROOT}/raw/polyhaven/fetched.json"))["assets"]
for stage, s in sky.items():
    ph = s["polyhaven"]
    src = polyhaven_source(ph, "2k", fetched[ph]["files"]["hdr"])
    e = env[stage]
    b = open(f"{ROOT}/work/env/{stage}.env", "rb").read()
    hdr = json.loads(b[8:b.index(b"\x00", 8)])
    irr = hdr["irradiance"]
    up = [irr["y"][i] + irr["yy"][i] for i in range(3)]  # spherical polynomial at n = +Y
    lum = 0.2126 * up[0] + 0.7152 * up[1] + 0.0722 * up[2]
    sl = s["sun_illuminance_rgb"]
    # Babylon's PBR lights and its SH irradiance are both pre-divided by pi relative to radiometric illuminance
    sun_int = [c / np.pi for c in sl]
    sun_lum = (0.2126 * sun_int[0] + 0.7152 * sun_int[1] + 0.0722 * sun_int[2]) * max(s["sun_dir_equirect"][1], 0)
    register(f"sky/{stage}.env", f"{ROOT}/work/env/{stage}.env", "hdri-env", src,
             prefilter={"tool": "BABYLON.EnvironmentTextureTools.CreateEnvTextureAsync", "babylon": e["version"],
                        "engine": e["engine"], "cube_size": e["size"], "imageType": "image/png"},
             sun_dir=s["sun_dir_equirect"], sun_peak_ratio=s["sun_peak_ratio"], irradiance_up=up,
             sun_illuminance_rgb=s["sun_illuminance_rgb"], sun_light_rgb=sun_int, sun_clamp=s["clamp"],
             note="sun disc clamped out of the IBL; add it back as a Babylon DirectionalLight: direction -sun_dir, diffuse*intensity = sun_light_rgb",
             object_exposure=1.0 / (lum + sun_lum))  # a white diffuse floor renders at ~1.0 before tone mapping
    register(f"sky/{stage}.jpg", f"{ROOT}/work/sky/{stage}.jpg", "sky", src,
             tonemap={k: s[k] for k in ("tonemap", "exposure", "key", "jpeg_quality")}, size=[2048, 1024], projection="equirectangular")
print(len(sky) * 2, "sky items")
