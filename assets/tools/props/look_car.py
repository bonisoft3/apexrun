"""Quick look at a built traffic car: beauty (front 3/4, rear 3/4, side) and false colour, coconut-beach.
usage: look_car.py <car> [lod]  -> work/look/<car>_lod<n>.jpg"""
import os, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
import ev
from traffic import FALSE

ROOT = ev.ROOT
car, lod = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "0")
url = f"/work/build/{car}_lod{lod}.glb"
os.makedirs(f"{ROOT}/work/look", exist_ok=True)
L = 7.5 if "box" in car else 5.0
# Babylon negates glTF Z: the nose (+Z) is at Babylon -Z
cams = {"front34": {"pos": [-0.75 * L, 0.35 * L, -L], "target": [0, 0.6, 0], "fov": 40},
        "rear34": {"pos": [0.7 * L, 0.38 * L, L], "target": [0, 0.6, 0], "fov": 40},
        "side": {"pos": [-1.5 * L, 0.18 * L, 0], "target": [0, 0.6, 0], "fov": 40}}
jobs, outs = [], []
for k, c in cams.items():
    for fc in (False, True):
        o = f"{ROOT}/work/look/{car}_lod{lod}_{k}{'_f' if fc else ''}.png"
        jobs.append(ev.job(url, o, "coconut-beach", camera=c, false=FALSE if fc else None, width=900, height=560))
        outs.append(o)
ev.render(jobs, f"look_{car}")
subprocess.run([sys.executable, f"{ROOT}/scripts/grid.py", f"{ROOT}/work/look/{car}_lod{lod}.jpg", "2"] + outs, check=True)
print(f"work/look/{car}_lod{lod}.jpg")
