"""Clay previews of aligned candidates: ply -> grey glb -> four views. usage: preview.py <name> ...  -> work/preview/<name>_*.png"""
import json, os, subprocess, sys
import numpy as np
import trimesh
sys.path.insert(0, os.path.dirname(__file__))
from gltf_io import Prim, write_glb
from meshkit import crease_normals

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CAMS = {"rear34": {"alpha": 55, "beta": 70, "dist": 1.2}, "side": {"alpha": 180, "beta": 85, "dist": 1.2},
        "front34": {"alpha": -55, "beta": 70, "dist": 1.2}, "top": {"alpha": 90, "beta": 1, "dist": 1.0}}
env = json.load(open(f"{ROOT}/work/env.json"))
os.makedirs(f"{ROOT}/work/preview", exist_ok=True)
jobs = []
for name in sys.argv[1:]:
    m = trimesh.load(f"{ROOT}/work/align/{name}.ply")
    V, N, F = crease_normals(m.vertices, m.faces, 35)
    clay = {"name": "clay", "pbrMetallicRoughness": {"baseColorFactor": [0.5, 0.5, 0.5, 1], "metallicFactor": 0, "roughnessFactor": 0.45}}
    write_glb(f"{ROOT}/work/preview/{name}.glb", [(name, [Prim(0, V, N, None, F)])], [clay], [])
    for k, c in CAMS.items():
        jobs.append(dict(out=f"../work/preview/{name}_{k}.png", **env, models=[{"url": f"/work/preview/{name}.glb"}], camera=c, width=1024, height=640))
json.dump(jobs, open(f"{ROOT}/work/preview/jobs.json", "w"))
subprocess.run(["node", "render.mjs", "../work/preview/jobs.json"], cwd=f"{ROOT}/web", check=True, stdout=subprocess.DEVNULL)
for name in sys.argv[1:]:
    subprocess.run([sys.executable, f"{ROOT}/scripts/grid.py", f"{ROOT}/work/preview/{name}.jpg", "4"] +
                   [f"{ROOT}/work/preview/{name}_{k}.png" for k in CAMS], check=True)
    print(f"work/preview/{name}.jpg")
