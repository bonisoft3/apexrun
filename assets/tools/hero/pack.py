"""Content-address the picked hero-car LODs into out/<sha256>.glb and write out/manifest.json and out/recipes.json.

usage: pack.py <candidate>
"""
import glob, hashlib, json, os, shutil, sys
sys.path.insert(0, os.path.dirname(__file__))
import hero, wheel
from materials import materials
from specs import SPECS

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PACK = ROOT


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


cand = sys.argv[1]
build = json.load(open(f"{ROOT}/work/build/{cand}.json"))
align = json.load(open(f"{ROOT}/work/align/{cand}.json"))
hy = json.load(open(f"{ROOT}/work/hy/{cand}.json"))
ref_name = os.path.basename(hy["ref"])[:-4]               # hero-rear_s2
job = ref_name.rsplit("_s", 1)[0]
sdxl = json.load(open(f"{ROOT}/work/sdxl/{job}.json"))
seed_ref = int(ref_name.rsplit("_s", 1)[1])

os.makedirs(f"{ROOT}/out", exist_ok=True)
manifest = {}
ids = [f"model/car-hero/lod{r['lod']}" for r in build["lods"]]
for r in build["lods"]:
    src = f"{ROOT}/{r['path']}"
    h = sha(src)
    dst = f"{ROOT}/out/{h}.glb"
    shutil.copyfile(src, dst)
    manifest[f"model/car-hero/lod{r['lod']}"] = {
        "file": f"{h}.glb", "sha256": h, "bytes": os.path.getsize(dst), "kind": "model", "license": "CC0",
        "source": {"generated": {
            "model": hy["model"], "model_revision": hy["model_revision"],
            "prompt": sdxl["prompt"], "negative": sdxl["negative"], "seed": hy["seed"], "steps": hy["params"]["num_inference_steps"],
            "params": {
                "hunyuan": hy["params"], "hunyuan_code": hy["code_commit"], "hunyuan_subfolder": hy["subfolder"],
                "reference": {"model": sdxl["model"], "model_revision": sdxl["model_revision"], "vae": sdxl["vae"],
                              "vae_revision": sdxl["vae_revision"], "scheduler": sdxl["scheduler"], "seed": seed_ref,
                              "steps": sdxl["steps"], "guidance": sdxl["guidance"], "width": sdxl["width"], "height": sdxl["height"],
                              "cutout": "rembg 2.0.62 u2net, hard alpha"},
                "align": {k: align[k] for k in ("end", "seen_side", "iou", "yaw", "pitch", "mirror_yaw_deg", "scale", "raw_dims")},
                "body": "mirror-symmetrised (seen half kept), scaled to 4.40 x 1.95 x 1.15 m, wheel blobs flattened into dark backdrops, "
                        "badge and cowl ridge refilled biharmonically, quadric-decimated, materials by geometric regions",
                "wheels": "procedural: 5-spoke machined alloy (16 in), grooved low-profile tyre",
                "lod_body_tris": r["body_tris"], "lod_wheel_tris": r["wheel_tris"], "face_labels": r["labels"],
            }}},
        "lods": ids, "tris": r["tris"], "bounds_m": r["bounds_m"], "forward": "+Z",
        "wheels": [{"name": w["name"], "hub": [round(c, 5) for c in w["hub"]], "radius": w["radius"], "width": w["width"]} for w in build["wheels"]],
        "materials": [m["name"] for m in materials()],
        "note": "Y up, metres, origin on the ground midway between the axles; +X is the car's left (wheel_FL/RL at +X). "
                "Each wheel node is pivoted at its hub (spin about local X, steer about Y). Recolour `paint` albedo per character; "
                "drive brake lights with `taillight` emissiveStrength. Babylon's glTF loader (left-handed scene) puts +Z forward at Babylon -Z.",
    }
json.dump(manifest, open(f"{ROOT}/out/manifest.json", "w"), indent=1, sort_keys=True)
stale = [f for f in os.listdir(f"{ROOT}/out") if f.endswith(".glb") and f not in {m["file"] for m in manifest.values()}]
for f in stale:
    os.remove(f"{ROOT}/out/{f}")

web = json.load(open(f"{ROOT}/web/package.json"))
cands = {os.path.basename(p)[:-5]: json.load(open(p)) for p in sorted(glob.glob(f"{ROOT}/work/hy/*.json"))}
aligns = {os.path.basename(p)[:-5]: json.load(open(p)) for p in sorted(glob.glob(f"{ROOT}/work/align/*.json"))}
recipes = {
    "toolchain": {
        "python": "3.12.8, the tools venv (pyproject.toml + uv.lock)", "uv_lock_sha256": sha(f"{PACK}/uv.lock"),
        "node": os.popen("node --version").read().strip(), "npm_pins": web["dependencies"],
        "pnpm_lock_sha256": sha(f"{ROOT}/web/pnpm-lock.yaml"),
        "hunyuan3d_2_code": {"repo": "https://github.com/Tencent-Hunyuan/Hunyuan3D-2", "commit": hy["code_commit"]},
        "weights": [{"repo": hy["model"], "revision": hy["model_revision"], "subfolder": hy["subfolder"]},
                    {"repo": sdxl["model"], "revision": sdxl["model_revision"]}, {"repo": sdxl["vae"], "revision": sdxl["vae_revision"]},
                    {"repo": "rembg u2net", "revision": "rembg 2.0.62 default"}],
        "machine": "Apple M2 Ultra 64 GB, macOS, torch 2.6.0 MPS",
    },
    "sdxl_jobs": json.load(open(f"{ROOT}/scripts/jobs_refs.json")),
    "references_cut": ["hero-front_s2", "hero-rear_s2", "hero-rear_s6"],
    "hunyuan_candidates": cands,
    "aligned_candidates": aligns,
    "pick": cand,
    "build_spec": SPECS[cand],
    "lod_budgets": hero.LODS,
    "wheel_lods": wheel.LODS,
    "materials": materials(),
    "steps": [
        "PY=.venv/bin/python   # the tools venv (uv sync); web/node_modules is its pnpm install",
        "$PY scripts/sdxl.py scripts/jobs_refs.json",
        "$PY scripts/cutout.py rembg work/sdxl/hero-rear_s2.png work/cut/hero-rear_s2.png   (also hero-front_s2, hero-rear_s6)",
        "PYTORCH_ENABLE_MPS_FALLBACK=1 $PY scripts/hy_shape.py rear2_s1234:work/cut/hero-rear_s2.png:1234 front2_s1234:work/cut/hero-front_s2.png:1234 "
        "rear2_s7:work/cut/hero-rear_s2.png:7 rear6_s1234:work/cut/hero-rear_s6.png:1234 front2_s7:work/cut/hero-front_s2.png:7",
        "PYTORCH_ENABLE_MPS_FALLBACK=1 $PY scripts/hy_shape.py rear2_s42:work/cut/hero-rear_s2.png:42 rear2_s2024:work/cut/hero-rear_s2.png:2024",
        "$PY scripts/align.py rear2_s1234 work/cut/hero-rear_s2.png rear left   (each candidate: <name> <ref> <front|rear> <left|right>)",
        "$PY scripts/preview.py <candidates...>; $PY scripts/elev.py /work/preview/<c>.glb work/elev/<c>",
        f"$PY scripts/hero.py {cand}",
        f"$PY scripts/pack.py {cand}",
        "$PY scripts/validate.py",
        f"$PY scripts/evidence.py {cand}",
    ],
}
json.dump(recipes, open(f"{ROOT}/out/recipes.json", "w"), indent=1, default=str)
print(json.dumps({k: {"file": v["file"], "tris": v["tris"], "bytes": v["bytes"]} for k, v in manifest.items()}, indent=1))
