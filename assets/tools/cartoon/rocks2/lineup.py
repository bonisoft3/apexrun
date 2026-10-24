"""Each set lined up on its stage ground, toon-lit as in the game: from the sun's side and against it.

usage: lineup.py [set ...]          builds in work/build -> work/look/set_<set>.jpg
       (library) jobs(set, urls, bounds, out) for evidence.py"""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
import ev, look, rocks2

ROOT = ev.ROOT
LIT = {"alpha": -80, "beta": 77, "dist": 0.72}
BACK = {"alpha": 100, "beta": 80, "dist": 0.72}


def place(bounds, gap=0.7):
    """x offsets laying the models side by side, footprints gap metres apart, centred on the origin."""
    xs, x = [], 0.0
    for lo, hi in bounds:
        x += -lo[0]
        xs.append(x)
        x += hi[0] + gap
    mid = (x - gap) / 2
    return [v - mid for v in xs]


def jobs(name, urls, bounds, out):
    stage = look.SET_STAGE[name]
    xs = place(bounds)
    models = [{"url": u, "pos": [x, 0, 0]} for u, x in zip(urls, xs)]
    W, H = 1600, 640
    js = [ev.job(None, f"{out}_lit.png", stage, camera=LIT, models=models, width=W, height=H, ground_size=200),
          ev.job(None, f"{out}_back.png", stage, camera=BACK, models=models, width=W, height=H, ground_size=200)]
    return js, [f"{out}_lit.png", f"{out}_back.png"]


if __name__ == "__main__":
    os.makedirs(f"{ROOT}/work/look", exist_ok=True)
    alljobs, rows = [], []
    for s in sys.argv[1:] or list(rocks2.SETS):
        ids = rocks2.SETS[s]
        recs = [json.load(open(f"{ROOT}/work/build/{n}.json"))["lods"][0] for n in ids]
        j, o = jobs(s, [f"/work/build/{n}_lod0.glb" for n in ids], [r["bounds_m"] for r in recs], f"{ROOT}/work/look/set_{s}")
        alljobs += j
        rows.append((s, o))
    ev.render(alljobs, "lineup")
    for s, o in rows:
        subprocess.run([sys.executable, f"{ROOT}/scripts/grid.py", f"{ROOT}/work/look/set_{s}.jpg", "1"] + o, check=True,
                       env={**os.environ, "CW": "1600"})
        print(f"work/look/set_{s}.jpg")
