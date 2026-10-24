"""Record which SDXL seed (picked by eye from the contact grid) became each Hunyuan reference."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from items import ROOT
PICKS = {"car-sedan": ("ref-car-sedan", 4, "rembg"), "car-convertible": ("ref-car-convertible", 1, "rembg"),
         "car-pickup": ("ref-car-pickup", 3, "rembg"), "car-boxtruck": ("ref-car-boxtruck", 2, "rembg")}
out = {}
for cid, (job, seed, cut) in PICKS.items():
    p = f"{ROOT}/work/sdxl/{job}.json"
    if seed is None or not os.path.exists(p):
        continue
    j = json.load(open(p))
    out[cid] = {k: j[k] for k in ("model", "model_revision", "vae", "vae_revision", "scheduler", "prompt", "negative", "steps", "guidance", "width", "height")}
    out[cid].update(seed=seed, cutout=cut, candidates=[r["seed"] for r in j["runs"]])
json.dump(out, open(f"{ROOT}/work/cut/refs.json", "w"), indent=1)
print(list(out))
