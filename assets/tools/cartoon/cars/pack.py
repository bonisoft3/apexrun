"""Copy the built GLBs to out/<sha256>.glb and write out/manifest.json + out/recipes.json entries for the car ids, in the
shape of the shipped manifest (every original field kept; file, sha256, bytes, tris, bounds_m and the build description
updated). Wheel hubs must match the shipped ones exactly, so the game's wheel pivots stay put.
usage: pack.py <shipped manifest.json>"""
import copy, hashlib, json, os, shutil, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import cartoon

ROOT = cartoon.ROOT
CARS = ["hero", "car-sedan", "car-convertible", "car-pickup", "car-boxtruck"]
BODY = ("{prev}; then cartoon pass (cartoon/cars/scripts/cartoon.py): bilateral normal filtering + vertex fit and a screened "
        "bi-Laplacian low-pass with creases held, circular wheel arches carved at the panel's own radius, borders cut along "
        "plane / facing / circle zero sets on each LOD and kept fixed through a border-locked decimation, shading normals "
        "from the faired dense surface, baked per-vertex AO in COLOR_0 (0.6..1.0; body, wheels and ground as occluders)")
shipped = json.load(open(sys.argv[1]))
os.makedirs(f"{ROOT}/out", exist_ok=True)
man, builds = {}, {}
for car in CARS:
    rec = json.load(open(f"{ROOT}/work/build/{car}.json"))
    for L in rec["lods"]:
        lid = L["id"]
        src = f"{ROOT}/{L['path']}"
        sha = hashlib.sha256(open(src, "rb").read()).hexdigest()
        shutil.copyfile(src, f"{ROOT}/out/{sha}.glb")
        e = copy.deepcopy(shipped[lid])
        for w0 in e["wheels"]:
            w1 = next(w for w in rec["wheels"] if w["name"] == w0["name"])
            if not (np.allclose(w0["hub"], w1["hub"], atol=1e-4) and abs(w0["radius"] - w1["radius"]) < 1e-9 and abs(w0["width"] - w1["width"]) < 1e-9):
                raise RuntimeError(f"{lid}: wheel {w0['name']} moved: {w0} -> {w1}")
        lo0, hi0 = np.asarray(e["bounds_m"])
        lo1, hi1 = np.asarray(L["bounds_m"])
        if max(np.abs(lo1 - lo0).max(), np.abs(hi1 - hi0).max()) > 0.03:
            raise RuntimeError(f"{lid}: bounds moved more than 3 cm: {e['bounds_m']} -> {L['bounds_m']}")
        e.update(file=f"{sha}.glb", sha256=sha, bytes=os.path.getsize(src), tris=L["tris"], bounds_m=L["bounds_m"])
        p = e["source"]["generated"]["params"]
        p["body"] = BODY.format(prev=p["body"])
        p["wheels"] = "procedural balloon tyre on the five-spoke alloy (cartoon/cars/scripts/cwheel.py)"
        if "face_labels" in p:
            p["face_labels"] = L["labels"]
        if "lod_body_tris" in p:
            p["lod_body_tris"], p["lod_wheel_tris"] = L["body_tris"], L["wheel_tris"]
        man[lid] = e
        builds[lid] = dict(tris=L["tris"], body_tris=L["body_tris"], wheel_tris=L["wheel_tris"], labels=L["labels"], ao_mean=L["ao_mean"])
json.dump(dict(sorted(man.items())), open(f"{ROOT}/out/manifest.json", "w"), indent=1)
first = json.load(open(f"{ROOT}/work/build/hero.json"))
recipes = {"cartoon_cars": {
    "toolchain": "the assets-pack venv (python 3.12.8; numpy, scipy, trimesh, pymeshlab, numba); Babylon 9.31.0 WebGPU evidence",
    "inputs": {"hero": "hero-car work/align/rear2_s1234.ply (aligned Hunyuan3D-2 body; specs_hero.py)",
               "traffic": "props2 work/align/<car>.ply (aligned Hunyuan3D-2 bodies; specs_traffic.py)"},
    "fair": first["fair"], "lowpass": first["lowpass"], "field_steps": first["field_steps"], "ao_range": first["ao_range"],
    "ao": {"directions": 256, "depth_map_res": 1024, "ground_falloff_m": 0.45},
    "panels": {k: v for k, v in cartoon.PANELS.items()},
    "budgets": {"hero": [60000, 15000], "traffic": [30000, 9000]},
    "wheel_lods": cartoon.cwheel.LODS,
    "builds": builds,
    "steps": ["python scripts/cartoon.py hero car-sedan car-convertible car-pickup car-boxtruck",
              "python scripts/pack.py <apps/apexrun/assets/manifest.json>", "python scripts/validate.py <shipped manifest>",
              "python scripts/evidence.py <shipped manifest>"],
}}
json.dump(recipes, open(f"{ROOT}/out/recipes.json", "w"), indent=1)
print("\n".join(f"{k} {v['tris']} {v['file']}" for k, v in sorted(man.items())))
