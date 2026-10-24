"""Poly Haven PBR sets -> web textures: albedo WebP q85 2k, normal (GL) WebP lossless, ARM (AO/rough/metal) WebP q85 2k."""
import json, os, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from selection import TEXTURES
from items import ROOT, register, polyhaven_source

# Normals dominate bytes losslessly (7 MB at 2k); only the road, seen everywhere and up close, keeps 2k.
NORMAL_RES = {"asphalt": 2048}
fetched = json.load(open(f"{ROOT}/raw/polyhaven/fetched.json"))["assets"]
os.makedirs(f"{ROOT}/work/tex", exist_ok=True)
for name, ph in TEXTURES.items():
    src = f"{ROOT}/raw/polyhaven/{ph}/{ph}"
    urls = fetched[ph]["files"]
    for key, inp, res, kw in [
        ("albedo", f"{src}_diff_2k.jpg", 2048, dict(quality=85, method=6)),
        ("normal", f"{src}_nor_gl_2k.png", NORMAL_RES.get(name, 1024), dict(lossless=True, method=6)),
        ("arm", f"{src}_arm_2k.png", 2048, dict(quality=85, method=6)),
    ]:
        im = Image.open(inp)
        if im.mode == "I;16" or im.mode == "I":
            raise RuntimeError(f"{inp}: 16-bit single channel not expected")
        im = im.convert("RGB")
        if im.size != (2048, 2048):
            raise RuntimeError(f"{inp}: {im.size} is not 2048 square")
        if res != 2048:
            im = im.resize((res, res), Image.LANCZOS)
        out = f"{ROOT}/work/tex/{name}_{key}.webp"
        im.save(out, "WEBP", **kw)
        url = urls[{"albedo": "diff", "normal": "nor_gl", "arm": "arm"}[key]]
        register(f"tex/{name}/{key}", out, "texture", polyhaven_source(ph, "2k", url),
                 encode={"format": "webp", "size": res, **{k: v for k, v in kw.items()}},
                 colorspace="srgb" if key == "albedo" else "linear",
                 channels={"arm": "R=ambient occlusion, G=roughness, B=metallic", "normal": "OpenGL (+Y) tangent-space"}.get(key, "RGB"))
        print(name, key, res, os.path.getsize(out), flush=True)
