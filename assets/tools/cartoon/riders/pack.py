"""Content-address work/riders_lod{0,1}.glb into <out_dir>/<sha256>.glb and merge model/riders/lod{0,1} into the game's
manifest, with the rig the renderer animates; record the recipe.

usage: pack.py <manifest.json> <recipes.json> <out_dir>      (after build.py)"""
import glob, hashlib, json, os, shutil, struct, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
TOOLS = os.path.abspath(os.path.join(HERE, "..", ".."))
manifest_path, recipes_path, out = sys.argv[1:4]

sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()


def glb_json(p):
    b = open(p, "rb").read()
    return json.loads(b[20:20 + struct.unpack_from("<I", b, 12)[0]])


rec = json.load(open(f"{ROOT}/work/riders.json"))
scripts = {os.path.relpath(p, TOOLS): sha(p) for p in sorted(glob.glob(f"{HERE}/*.py")) + [f"{ROOT}/flagman/toon.py", f"{ROOT}/flagman/figure.py", f"{ROOT}/flagman/gltf_io.py", f"{ROOT}/flagman/mats.py"]}
os.makedirs(out, exist_ok=True)
m = json.load(open(manifest_path))
ids = [f"model/riders/lod{r['lod']}" for r in rec["lods"]]
rig = {"driver": rec["driver"], "seats_m": rec["seats"], "nodes": rec["nodes"],
       "frame": "the car's glTF frame (Y up, metres, nose on +Z): parent the root nodes to the car's chassis",
       "flutter": "each node with flutter_axis turns about that local axis by up to flutter_rad, about its origin (the pivot)"}
for r, key in zip(rec["lods"], ids):
    src = f"{ROOT}/{r['path']}"
    h = sha(src)
    shutil.copyfile(src, f"{out}/{h}.glb")
    g = glb_json(src)
    m[key] = {"file": f"{h}.glb", "sha256": h, "bytes": os.path.getsize(src), "kind": "model", "license": "CC0",
              "lods": ids, "tris": r["tris"], "bounds_m": r["bounds_m"], "materials": [x["name"] for x in g["materials"]],
              "nodes": [n["name"] for n in g["nodes"]], "rig": rig,
              "note": "the hero car's two Ghibli riders: the girl driving from the left seat (auburn bob and long locks, red "
                      "ribbon, yellow dress with a round white collar, both hands on the wheel) and the boy riding beside her "
                      "(messy dark hair, blue jacket with a turned-up collar, red neckerchief, his outer arm on the door, waving at a moment); big low-set eyes, brows, "
                      "a button nose, a small mouth, rosy cheeks",
              "vertex_colors": "COLOR_0 (VEC3 float): baked ambient occlusion, a multiplier of baseColor",
              "source": {"procedural": {"script": "cartoon/riders/build.py", "scripts_sha256": scripts}}}
    print(key, r["tris"], h[:12])
open(manifest_path, "w").write(json.dumps(m, indent=1) + "\n")
recipes = json.load(open(recipes_path))
recipes["riders"] = {"scripts": sorted(scripts), "scripts_sha256": scripts,
                     "source": "SDF figures (cartoon/riders/figures.py) meshed by the flagman's toon pipeline: marching cubes, "
                               "QEM, projection, material cuts, baked AO"}
open(recipes_path, "w").write(json.dumps(recipes, indent=1) + "\n")
