"""Renders of the shipped photoscan / Hunyuan props these models replace (palette and proportion reference).
usage: look_orig.py   -> work/orig/<id>.png and work/orig.jpg"""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
import ev

IDS = {"boulder-granite": "alpine-peaks", "rock-a": "ancient-ruins", "rock-b": "ancient-ruins", "rock-desert-a": "desert-canyons",
       "rock-desert-b": "desert-canyons", "rock-desert-c": "desert-canyons", "cactus": "desert-canyons", "column": "ancient-ruins",
       "power-pole": "desert-canyons"}
os.makedirs(f"{ev.ROOT}/work/orig", exist_ok=True)
jobs, outs = [], []
for i, st in IDS.items():
    e = ev.PACK[f"model/{i}/lod0"]
    out = f"{ev.ROOT}/work/orig/{i}.png"
    jobs.append(ev.job(f"/web/pack/{e['file']}", out, st, camera={"alpha": -60, "beta": 72, "dist": 1.3}, width=640, height=480,
                       ground_size=50))
    outs.append(out)
ev.render(jobs, "orig")
subprocess.run([sys.executable, f"{ev.ROOT}/scripts/grid.py", f"{ev.ROOT}/work/orig.jpg", "3"] + outs, check=True, env={**os.environ, "CW": "480"})
