"""Content-address the picked builds into out/<sha256>.glb and write out/manifest.json (assets-pack shape) and out/recipes.json.

usage: pack.py      reads work/build/*.json and scripts/picks.py"""
import glob, hashlib, json, os, shutil, struct, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
from picks import PICKS

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PACK = os.path.join(ROOT, "..", "assets-pack")


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def glb_json(p):
    b = open(p, "rb").read()
    jl = struct.unpack_from("<I", b, 12)[0]
    return json.loads(b[20:20 + jl])


def emissive(g):
    return sorted(m["name"] for m in g["materials"] if any(c > 0 for c in m.get("emissiveFactor", [0, 0, 0])))


os.makedirs(f"{ROOT}/out", exist_ok=True)
manifest = {}
for name, pick in PICKS.items():
    rec = json.load(open(f"{ROOT}/work/build/{pick['build']}.json"))
    lods = [r for r in rec["lods"] if r["lod"] in pick["lods"]]
    ids = [f"model/{name}/lod{r['lod']}" for r in lods]
    for r in lods:
        src = f"{ROOT}/{r['path']}"
        h = sha(src)
        shutil.copyfile(src, f"{ROOT}/out/{h}.glb")
        g = glb_json(src)
        e = {"file": f"{h}.glb", "sha256": h, "bytes": os.path.getsize(src), "kind": "model", "license": pick["license"],
             "source": pick["source"], "lods": ids, "tris": r["tris"], "bounds_m": r["bounds_m"],
             "materials": [m["name"] for m in g["materials"]], "emissive": emissive(g),
             "nodes": [n["name"] for n in g["nodes"]], "note": pick["note"]}
        e.update(pick.get("extra", {}))
        if "wheels" in rec:
            e["wheels"] = [{k: (([round(c, 5) for c in v]) if k == "hub" else v) for k, v in w.items()} for w in rec["wheels"]]
            e["forward"] = "+Z"
        nodes_tr = {n["name"]: n["translation"] for n in g["nodes"] if "translation" in n}
        if nodes_tr and "wheels" not in rec:
            e["pivots"] = nodes_tr
        manifest[f"model/{name}/lod{r['lod']}"] = e
json.dump(manifest, open(f"{ROOT}/out/manifest.json", "w"), indent=1, sort_keys=True)
keep = {m["file"] for m in manifest.values()}
for f in os.listdir(f"{ROOT}/out"):
    if f.endswith(".glb") and f not in keep:
        os.remove(f"{ROOT}/out/{f}")

web = json.load(open(f"{ROOT}/web/package.json"))
recipes = {
    "toolchain": {
        "python": "3.12.8, the assets-pack venv (../assets-pack/pyproject.toml + uv.lock)", "uv_lock_sha256": sha(f"{PACK}/uv.lock"),
        "node": subprocess.run(["node", "--version"], capture_output=True, text=True, check=True).stdout.strip(),
        "npm_pins": web["dependencies"], "pnpm_lock_sha256": sha(f"{ROOT}/web/pnpm-lock.yaml"),
        "hunyuan3d_2_code": {"repo": "https://github.com/Tencent-Hunyuan/Hunyuan3D-2", "commit": "f8db63096c8282cb27354314d896feba5ba6ff8a"},
        "weights": [{"repo": "tencent/Hunyuan3D-2", "revision": "9cd649ba6913f7a852e3286bad86bfa9a2d83dcf", "subfolder": "hunyuan3d-dit-v2-0"},
                    {"repo": "stabilityai/stable-diffusion-xl-base-1.0", "revision": "462165984030d82259a11f4367a4eed129e94a7b"},
                    {"repo": "madebyollin/sdxl-vae-fp16-fix", "revision": "207b116dae70ace3637169f1ddd2434b91b3a8cd"},
                    {"repo": "rembg u2net", "revision": "rembg 2.0.62 default"}],
        "machine": "Apple M2 Ultra 64 GB, macOS, torch 2.6.0 MPS",
        "scripts_sha256": {os.path.basename(p): sha(p) for p in sorted(glob.glob(f"{ROOT}/scripts/*.py")) + sorted(glob.glob(f"{ROOT}/scripts/*.sh"))},
    },
    "sdxl_jobs": {os.path.basename(p)[:-5]: json.load(open(p)) for p in sorted(glob.glob(f"{ROOT}/work/sdxl/*.json"))},
    "hunyuan_candidates": {os.path.basename(p)[:-5]: json.load(open(p)) for p in sorted(glob.glob(f"{ROOT}/work/hy/*.json"))},
    "aligned": {os.path.basename(p)[:-5]: json.load(open(p)) for p in sorted(glob.glob(f"{ROOT}/work/align/*.json"))},
    "builds": {os.path.basename(p)[:-5]: json.load(open(p)) for p in sorted(glob.glob(f"{ROOT}/work/build/*.json"))},
    "picks": PICKS,
    "steps": json.load(open(f"{ROOT}/scripts/steps.json")),
}
json.dump(recipes, open(f"{ROOT}/out/recipes.json", "w"), indent=1, default=str)
for k, v in sorted(manifest.items()):
    print(k, v["tris"], v["bytes"], v["file"][:12])
