"""Content-address the builds into out/<sha256>.glb and write out/manifest.json (assets-pack shape) and out/recipes.json.

usage: pack.py      reads work/build/<id>.json"""
import glob, hashlib, json, os, platform, shutil, struct, sys
sys.path.insert(0, os.path.dirname(__file__))
import build

ROOT = build.ROOT
PACK = os.path.join(ROOT, "..", "..", "assets-pack")
# id -> (script, builder); stages as the shipped manifest lists them (the game's STAGE_ART draws them there)
IDS = {"boulder-granite": ("rocks.py", "boulder_granite", ["alpine-peaks", "gateway-pass", "wilderness-run"]),
       "rock-a": ("rocks.py", "rock_a", ["gateway-pass", "sunset-highway", "ancient-ruins"]),
       "rock-b": ("rocks.py", "rock_b", ["gateway-pass", "sunset-highway", "ancient-ruins"]),
       "rock-desert-a": ("rocks.py", "rock_desert_a", ["desert-canyons", "sunset-highway"]),
       "rock-desert-b": ("rocks.py", "rock_desert_b", ["desert-canyons", "sunset-highway"]),
       "rock-desert-c": ("rocks.py", "rock_desert_c", ["desert-canyons", "ancient-ruins"]),
       "cactus": ("props.py", "cactus", ["desert-canyons", "destination-oasis"]),
       "column": ("props.py", "column", ["ancient-ruins", "destination-colosseum"]),
       "power-pole": ("props.py", "power_pole", ["sunset-highway", "metropolis-night"])}


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def glb_json(p):
    b = open(p, "rb").read()
    jl = struct.unpack_from("<I", b, 12)[0]
    return json.loads(b[20:20 + jl])


scripts = {os.path.basename(p): sha(p) for p in sorted(glob.glob(f"{ROOT}/scripts/*.py"))}
os.makedirs(f"{ROOT}/out", exist_ok=True)
manifest = {}
for name, (script, builder, stages) in IDS.items():
    rec = json.load(open(f"{ROOT}/work/build/{name}.json"))
    ids = [f"model/{name}/lod{r['lod']}" for r in rec["lods"]]
    source = {"procedural": {"script": f"scripts/{script}", "script_sha256": scripts[script], "builder": builder,
                             "params": {"pipeline": "scripts/build.py", "pipeline_sha256": scripts["build.py"],
                                        "sdf": "scripts/toon.py", "sdf_sha256": scripts["toon.py"]}}}
    for r in rec["lods"]:
        src = f"{ROOT}/{r['path']}"
        h = sha(src)
        shutil.copyfile(src, f"{ROOT}/out/{h}.glb")
        g = glb_json(src)
        manifest[f"model/{name}/lod{r['lod']}"] = {
            "file": f"{h}.glb", "sha256": h, "bytes": os.path.getsize(src), "kind": "model", "license": "CC0", "source": source,
            "lods": ids, "tris": r["tris"], "bounds_m": r["bounds_m"], "materials": [m["name"] for m in g["materials"]],
            "emissive": [], "nodes": [n["name"] for n in g["nodes"]], "stages": stages,
            "vertex_colors": "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor",
            "note": rec["note"] + "; Y up, metres, origin on the ground at the footprint centre, +Z forward"}
json.dump(manifest, open(f"{ROOT}/out/manifest.json", "w"), indent=1, sort_keys=True)
keep = {m["file"] for m in manifest.values()}
for f in os.listdir(f"{ROOT}/out"):
    if f.endswith(".glb") and f not in keep:
        os.remove(f"{ROOT}/out/{f}")

import numpy, pymeshlab, scipy, skimage
recipes = {
    "toolchain": {"python": platform.python_version() + ", the assets-pack venv (../../assets-pack/pyproject.toml + uv.lock)",
                  "uv_lock_sha256": sha(f"{PACK}/uv.lock"),
                  "packages": {"numpy": numpy.__version__, "scipy": scipy.__version__, "scikit-image": skimage.__version__,
                               "pymeshlab": "2023.12.post3"},
                  "renderer": "Babylon (assets-pack web/node_modules), WebGPU headless Chromium, for evidence only",
                  "scripts_sha256": scripts},
    "builds": {os.path.basename(p)[:-5]: json.load(open(p)) for p in sorted(glob.glob(f"{ROOT}/work/build/*.json"))},
    "picks": {k: {"script": v[0], "builder": v[1], "lods": [0, 1, 2], "license": "CC0"} for k, v in IDS.items()},
    "steps": json.load(open(f"{ROOT}/scripts/steps.json")),
}
json.dump(recipes, open(f"{ROOT}/out/recipes.json", "w"), indent=1, default=str)
for k, v in sorted(manifest.items()):
    print(k, v["tris"], v["bytes"], v["file"][:12])
