"""Views of built models: front, 3/4, close-up, LODs side by side, baked AO only (unlit white x COLOR_0), false colour.

usage: look.py <name> [...]          -> work/look/<name>_<view>.png and work/look/<name>.jpg
       look.py --out <dir> <name>... (with URL and bounds from out/manifest.json, for evidence.py)"""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
import ev

ROOT = ev.ROOT
STAGE = {"boulder-granite": "alpine-peaks", "rock-a": "ancient-ruins", "rock-b": "ancient-ruins", "rock-desert-a": "desert-canyons",
         "rock-desert-b": "desert-canyons", "rock-desert-c": "desert-canyons", "cactus": "desert-canyons", "column": "ancient-ruins",
         "power-pole": "desert-canyons"}
VIEWS = ("front", "34", "close", "lods", "ao", "false")


def views(name, urls, bounds, materials, out):
    """urls: [lod0, lod1, lod2]; -> (jobs, pngs)."""
    st = STAGE[name]
    lo, hi = bounds
    size = max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
    tall = hi[1] > 1.5 * max(hi[0] - lo[0], hi[2] - lo[2])
    W, H = 960, 640
    g = 30 * size
    w = max(hi[0] - lo[0], hi[2] - lo[2])
    cams = {"front": {"alpha": 90, "beta": 84, "dist": 1.75 if tall else 1.25},
            "34": {"alpha": 35, "beta": 72, "dist": 1.75 if tall else 1.3},
            "close": ({"pos": [0.55 * w + 0.6, 0.97 * hi[1], 0.55 * w + 0.9], "target": [0, 0.86 * hi[1], 0], "fov": 40} if tall else
                      {"alpha": 140, "beta": 55, "dist": 0.62})}
    jobs, outs = [], []
    for k, c in cams.items():
        jobs.append(ev.job(urls[0], f"{out}_{k}.png", st, camera=c, width=W, height=H, ground_size=g)); outs.append(f"{out}_{k}.png")
    step = max(hi[0] - lo[0], hi[2] - lo[2]) * 1.25
    models = [{"url": u, "pos": [(i - 1) * step, 0, 0]} for i, u in enumerate(urls)]
    jobs.append(ev.job(None, f"{out}_lods.png", st, camera={"alpha": 90, "beta": 80, "dist": 1.5 if tall else 0.95}, models=models, width=W, height=H,
                       ground_size=g)); outs.append(f"{out}_lods.png")
    jobs.append(ev.job(urls[0], f"{out}_ao.png", st, camera=cams["34"], width=W, height=H, ground_size=g, aoOnly=True))
    outs.append(f"{out}_ao.png")
    jobs.append(ev.job(urls[0], f"{out}_false.png", st, camera={"alpha": -55, "beta": 70, "dist": cams["34"]["dist"]},
                       false=ev.false_colors(materials), width=W, height=H, ground_size=g)); outs.append(f"{out}_false.png")
    return jobs, outs


if __name__ == "__main__":
    os.makedirs(f"{ROOT}/work/look", exist_ok=True)
    jobs, rows = [], []
    for name in sys.argv[1:]:
        rec = json.load(open(f"{ROOT}/work/build/{name}.json"))
        r0 = rec["lods"][0]
        j, o = views(name, [f"/work/build/{name}_lod{l}.glb" for l in (0, 1, 2)], r0["bounds_m"], r0["materials"], f"{ROOT}/work/look/{name}")
        jobs += j; rows.append((name, o))
    ev.render(jobs, "look")
    for name, o in rows:
        subprocess.run([sys.executable, f"{ROOT}/scripts/grid.py", f"{ROOT}/work/look/{name}.jpg", "3"] + o, check=True,
                       env={**os.environ, "CW": "640"})
        print(f"work/look/{name}.jpg")
