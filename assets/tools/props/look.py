"""Quick look at built props: LOD0 three-quarter beauty + false colour, LOD1, LOD2 under a stage.
usage: look.py <stage> <name> [...]   -> work/look/<name>.jpg"""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
import ev

ROOT = ev.ROOT
stage = sys.argv[1]
os.makedirs(f"{ROOT}/work/look", exist_ok=True)
for name in sys.argv[2:]:
    rec = json.load(open(f"{ROOT}/work/build/{name}.json"))
    mats = rec["lods"][0]["materials"]
    jobs, outs = [], []
    for lod in (0, 1, 2):
        url = f"/work/build/{name}_lod{lod}.glb"
        for fc in ((False, True) if lod == 0 else (False,)):
            o = f"{ROOT}/work/look/{name}_lod{lod}{'_f' if fc else ''}.png"
            jobs.append(ev.job(url, o, stage, camera={"alpha": -60, "beta": 72, "dist": 1.75}, false=ev.false_colors(mats) if fc else None,
                               width=900, height=700, **({"ground": None} if os.environ.get("NOGROUND") else {})))
            outs.append(o)
    ev.render(jobs, f"look_{name}")
    subprocess.run([sys.executable, f"{ROOT}/scripts/grid.py", f"{ROOT}/work/look/{name}.jpg", "2"] + outs, check=True,
                   env={**os.environ, "CW": "560"})
    print(f"work/look/{name}.jpg")
