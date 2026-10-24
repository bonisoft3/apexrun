"""Views of built landforms: front, side, back, close-up, from below without ground, false colour, LODs.
usage: look_land.py <name> [...]   -> work/look/<name>_views.jpg"""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
import ev

ROOT = ev.ROOT


def stage(name):
    return "desert-canyons" if name.startswith("mesa") else "wilderness-run"


def views(name, url, lod_urls, out):
    """-> (jobs, outs) for one model; url is LOD0."""
    st = stage(name)
    rec = json.load(open(f"{ROOT}/work/build/{name}.json"))["lods"][0]
    (lo, hi), mats = rec["bounds_m"], rec["materials"]
    h = hi[1]
    cams = {"front": {"alpha": -90, "beta": 80, "dist": 1.25}, "side": {"alpha": 0, "beta": 80, "dist": 1.25},
            "back": {"alpha": 90, "beta": 80, "dist": 1.25},
            "close": {"pos": [hi[0] * 0.55, h * 0.12 + 1.6, lo[2] * 1.25 - 6], "target": [0, h * 0.62, 0], "fov": 55},
            "edge": {"pos": [hi[0] * 0.9, h * 1.08, lo[2] * 0.95], "target": [0, h * 0.82, 0], "fov": 50}}
    jobs, outs = [], []
    for k, c in cams.items():
        jobs.append(ev.job(url, f"{out}_{k}.png", st, camera=c, width=960, height=640)); outs.append(f"{out}_{k}.png")
    jobs.append(ev.job(url, f"{out}_below.png", st, camera={"alpha": -50, "beta": 118, "dist": 1.3}, width=960, height=640, ground=None))
    outs.append(f"{out}_below.png")
    jobs.append(ev.job(url, f"{out}_false.png", st, camera={"alpha": -60, "beta": 72, "dist": 1.3}, false=ev.false_colors(mats),
                       width=960, height=640)); outs.append(f"{out}_false.png")
    size = max(hi[0] - lo[0], hi[2] - lo[2])
    models = [{"url": u, "pos": [(i - 1) * size * 1.2, 0, 0]} for i, u in enumerate(lod_urls)]
    jobs.append(ev.job(None, f"{out}_lods.png", st, camera={"alpha": -90, "beta": 78, "dist": 0.9}, models=models, width=960, height=640))
    outs.append(f"{out}_lods.png")
    return jobs, outs


if __name__ == "__main__":
    os.makedirs(f"{ROOT}/work/look", exist_ok=True)
    for name in sys.argv[1:]:
        j, o = views(name, f"/work/build/{name}_lod0.glb", [f"/work/build/{name}_lod{l}.glb" for l in (0, 1, 2)], f"{ROOT}/work/look/{name}")
        ev.render(j, f"look_{name}")
        subprocess.run([sys.executable, f"{ROOT}/scripts/grid.py", f"{ROOT}/work/look/{name}_views.jpg", "4"] + o, check=True,
                       env={**os.environ, "CW": "640"})
        print(f"work/look/{name}_views.jpg")
