"""Evidence views of a hero-car GLB under coconut-beach (its .env, sky dome and extracted sun), on the pack's asphalt.

usage: views.py <glb url> <out prefix> [false] [steer]   -> <prefix>_{chase,rear34,side,front34,hood}.png
Babylon's glTF loader negates Z, so the car's rear (glTF -Z) is at Babylon +Z: cameras below are in Babylon space."""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
from materials import FALSE

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PACK = json.load(open(f"{ROOT}/../assets-pack/out/manifest.json"))
env = json.load(open(f"{ROOT}/work/env.json"))
GROUND = {"size": 400, "tile": 100, "tex": {k: "/web/pack/" + PACK[f"tex/asphalt/{k}"]["file"] for k in ("albedo", "normal", "arm")}}
VIEWS = {
    "chase": {"pos": [0.0, 2.0, 6.0], "target": [0, 0.75, 0], "fov": 50},          # game chase cam: 2 m up, 6 m behind
    "rear34": {"pos": [3.3, 1.9, 5.2], "target": [0, 0.55, 0], "fov": 40},
    "side": {"pos": [-7.5, 0.9, 0.0], "target": [0, 0.55, 0], "fov": 38},
    "front34": {"pos": [-3.6, 1.5, -5.0], "target": [0, 0.5, 0], "fov": 40},
    "hood": {"pos": [0.0, 2.3, 0.1], "target": [0, 0.7, -1.4], "fov": 55},        # above the windscreen, looking down the bonnet
    "top": {"pos": [0.0, 9.0, 0.001], "target": [0, 0, 0], "fov": 34},
    "cockpit": {"pos": [1.6, 2.2, 3.0], "target": [0, 0.7, 0.2], "fov": 40},
}


def jobs(url, prefix, false=False, steer=0, views=None, extra=None):
    out = []
    for k, cam in VIEWS.items():
        if views and k not in views:
            continue
        j = dict(out=os.path.abspath(f"{prefix}_{k}.png"), **env, ground=GROUND, models=[{"url": url, "steer": steer}], camera=cam,
                 width=1280, height=800)
        if false:
            j["falseColor"] = FALSE
        if extra:
            j.update(extra)
        out.append(j)
    return out


def render(js, name):
    path = f"{ROOT}/work/{name}_jobs.json"
    json.dump(js, open(path, "w"), indent=1)
    subprocess.run(["node", "render.mjs", path], cwd=f"{ROOT}/web", check=True, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    url, prefix = sys.argv[1], sys.argv[2]
    render(jobs(url, prefix, "false" in sys.argv[3:], 25 if "steer" in sys.argv[3:] else 0), os.path.basename(prefix))
