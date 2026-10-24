"""Content-address work/flagman_lod0.glb into out/<sha256>.glb; write out/manifest.json (assets-pack shape) and out/recipes.json.

usage: pack.py      (after build.py and probe.py)"""
import glob, hashlib, json, os, platform, shutil, struct, sys
sys.path.insert(0, os.path.dirname(__file__))
import build, figure

ROOT = build.ROOT
PACK = os.path.join(ROOT, "..", "assets-pack")


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def glb_json(p):
    b = open(p, "rb").read()
    jl = struct.unpack_from("<I", b, 12)[0]
    return json.loads(b[20:20 + jl])


scripts = {os.path.basename(p): sha(p) for p in sorted(glob.glob(f"{ROOT}/scripts/*.py"))}
rec = json.load(open(f"{ROOT}/work/flagman.json"))
probe = json.load(open(f"{ROOT}/work/probe.json"))
src = f"{ROOT}/{rec['path']}"
h = sha(src)
os.makedirs(f"{ROOT}/out", exist_ok=True)
for f in glob.glob(f"{ROOT}/out/*.glb"):
    os.remove(f)
shutil.copyfile(src, f"{ROOT}/out/{h}.glb")
g = glb_json(src)
grip = lambda a: probe[a]["flag:0,0,0"]
manifest = {"model/flagman/lod0": {
    "file": f"{h}.glb", "sha256": h, "bytes": os.path.getsize(src), "kind": "model", "license": "CC0",
    "source": {"procedural": {"script": "scripts/figure.py", "script_sha256": scripts["figure.py"], "builder": "body, arm, pole, cloth",
                              "params": {"pipeline": "scripts/build.py", "pipeline_sha256": scripts["build.py"],
                                         "sdf": "scripts/toon.py", "sdf_sha256": scripts["toon.py"]}}},
    "lods": ["model/flagman/lod0"], "tris": rec["tris"], "bounds_m": rec["bounds_m"],
    "materials": [m["name"] for m in g["materials"]], "emissive": [], "nodes": [n["name"] for n in g["nodes"]],
    "stages": ["coconut-beach"],
    "vertex_colors": "COLOR_0 (VEC3 float): baked ambient occlusion on body and arm, the chequer on the flag cloth; a multiplier of baseColor",
    "rig": {
        "tree": "flagman (body, left hand on the hip) > arm_R (right arm) > flag (pole + cloth)",
        "arm_R": {"pivot_m": figure.SHOULDER.tolist(), "pivot_frame": "flagman (glTF node translation)",
                  "rest": "hanging straight down along local -Y",
                  "raise_axis": "local Z", "raise_sign": -1,
                  "raise": "arm_R.rotation.z < 0 swings the arm out to his right side and up in his frontal plane; -pi/2 horizontal, "
                           "-pi straight up; +z swings it across his body (wrong way)",
                  "measured_babylon": {"api": "rotationQuaternion = null; rotation.set(0, 0, z) (Babylon 9.31 glTF loader)",
                                       "grip_world_m": {"z=0": grip("+0.0000"), "z=-pi/2": grip("-1.5708"), "z=-pi": grip("-3.1416"),
                                                        "z=+pi/2": grip("+1.5708")},
                                       "note": "Babylon world: his front (glTF +Z) is world -Z, his right is world -X"}},
        "flag": {"pivot_m": figure.GRIP.tolist(), "pivot_frame": "arm_R (the grip, centre of the fist)",
                 "pole": "along local Y, top +0.07, tip -0.72 (down at rest, up when raised)",
                 "cloth": {"material": "flag", "size_m": [figure.CLOTH_FLY, round(figure.CLOTH_Y[0] - figure.CLOTH_Y[1], 3)],
                           "hoist_y_m": list(figure.CLOTH_Y), "fly": "toward flag-local -X (over his head when raised)",
                           "grid_quads": [figure.CHEQUER[0] * figure.SUB, figure.CHEQUER[1] * figure.SUB],
                           "double_sided": "one layer, material doubleSided", "uv": "TEXCOORD_0: u 0 at the pole -> 1 at the free edge, v along the hoist",
                           "chequer": f"{figure.CHEQUER[0]} x {figure.CHEQUER[1]} squares in COLOR_0, each square its own vertices"},
                 "spin": "flag.rotation.y turns the cloth about the pole"}},
    "note": "1980s race marshal, cartoon proportions, %.2f m tall; Y up, metres, origin on the ground between the feet, faces +Z" % rec["height_m"]}}
json.dump(manifest, open(f"{ROOT}/out/manifest.json", "w"), indent=1, sort_keys=True)

import numpy, pymeshlab, scipy, skimage
recipes = {
    "toolchain": {"python": platform.python_version() + ", the assets-pack venv (../assets-pack/pyproject.toml + uv.lock)",
                  "uv_lock_sha256": sha(f"{PACK}/uv.lock"),
                  "packages": {"numpy": numpy.__version__, "scipy": scipy.__version__, "scikit-image": skimage.__version__,
                               "pymeshlab": "2023.12.post3"},
                  "renderer": "Babylon 9.31.0 (assets-pack web/node_modules), WebGPU headless Chromium, for evidence and the rig probe only",
                  "scripts_sha256": scripts},
    "builds": {"flagman": rec},
    "probe": probe,
    "steps": ["python scripts/build.py      # -> work/flagman_lod0.glb, work/flagman.json",
              "python scripts/probe.py /work/flagman_lod0.glb   # Babylon: grip position per arm_R z -> work/probe.json",
              "python scripts/pack.py       # -> out/<sha256>.glb, out/manifest.json, out/recipes.json",
              "python scripts/evidence.py   # -> renders/*.png, evidence.jpg"],
}
json.dump(recipes, open(f"{ROOT}/out/recipes.json", "w"), indent=1, default=str)
print(h, rec["tris"], os.path.getsize(src))
