"""Content-address the picked builds into out/<sha256>.glb and write out/manifest.json (assets-pack shape) and out/recipes.json.

usage: pack.py      reads work/build/*.json and scripts/picks.py"""
import glob, hashlib, importlib.metadata, json, os, shutil, struct, sys
sys.path.insert(0, os.path.dirname(__file__))
from picks import PICKS
import numpy, pymeshlab, scipy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PACK = os.path.join(ROOT, "..", "..", "assets-pack")


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def glb_json(p):
    b = open(p, "rb").read()
    jl = struct.unpack_from("<I", b, 12)[0]
    return json.loads(b[20:20 + jl])


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
             "materials": [m["name"] for m in g["materials"]], "emissive": [],
             "nodes": [n["name"] for n in g["nodes"]], "note": pick["note"]}
        e.update(pick.get("extra", {}))
        manifest[f"model/{name}/lod{r['lod']}"] = e
json.dump(manifest, open(f"{ROOT}/out/manifest.json", "w"), indent=1, sort_keys=True)
keep = {m["file"] for m in manifest.values()}
for f in os.listdir(f"{ROOT}/out"):
    if f.endswith(".glb") and f not in keep:
        os.remove(f"{ROOT}/out/{f}")

recipes = {
    "toolchain": {
        "python": "3.12, the assets-pack venv (../../assets-pack/pyproject.toml + uv.lock)", "uv_lock_sha256": sha(f"{PACK}/uv.lock"),
        "numpy": numpy.__version__, "scipy": scipy.__version__, "pymeshlab": importlib.metadata.version("pymeshlab"),
        "scripts_sha256": {os.path.basename(p): sha(p) for p in sorted(glob.glob(f"{ROOT}/scripts/*.py"))},
    },
    "builds": {os.path.basename(p)[:-5]: json.load(open(p)) for p in sorted(glob.glob(f"{ROOT}/work/build/*.json"))},
    "picks": PICKS,
    "steps": json.load(open(f"{ROOT}/scripts/steps.json")),
}
json.dump(recipes, open(f"{ROOT}/out/recipes.json", "w"), indent=1, default=str)
for k, v in sorted(manifest.items()):
    print(k, v["tris"], v["bytes"], v["file"][:12])
