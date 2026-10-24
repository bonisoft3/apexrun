"""Evidence renders of every shipped model in out/manifest.json, plus contact.png.

usage: evidence.py   -> renders/<name>_{beauty,false,lods}.png (+ extras) and contact.png
Babylon 9.31.0 WebGPU, ACES, the stage .env + sky dome + the manifest sun (none at night), pack ground textures."""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(__file__))
import ev
import look_land
from traffic import FALSE as CAR_FALSE

ROOT = ev.ROOT
R = f"{ROOT}/renders"
os.makedirs(R, exist_ok=True)
m = json.load(open(f"{ROOT}/out/manifest.json"))
names = sorted({k.split("/")[1] for k in m})
NIGHT = {"tower-a", "tower-b", "tower-c", "street-lamp"}
url = lambda n, l: f"/out/{m[f'model/{n}/lod{l}']['file']}"
jobs = []
for n in names:
    stage = "metropolis-night" if n in NIGHT else "coconut-beach"
    lod0 = m[f"model/{n}/lod0"]
    lods = [int(x.rsplit("lod", 1)[1]) for x in lod0["lods"]]
    if n.startswith(("mesa-", "cliff-coast-")):
        jobs += look_land.views(n, url(n, 0), [url(n, l) for l in lods], f"{R}/{n}")[0]
        continue
    car = n.startswith("car-")
    fc = CAR_FALSE if car else ev.false_colors(lod0["materials"])
    extra = {"ground": None} if n == "sailboat" else {}
    (lo, hi) = lod0["bounds_m"]
    size = max(hi[0] - lo[0], hi[2] - lo[2])
    if car:
        L = hi[2] - lo[2]
        cams = {"front34": {"pos": [-0.8 * L, 0.35 * L, -1.05 * L], "target": [0, 0.4 * hi[1], 0], "fov": 40},
                "rear34": {"pos": [0.75 * L, 0.4 * L, 1.05 * L], "target": [0, 0.4 * hi[1], 0], "fov": 40}}
        for k, c in cams.items():
            jobs.append(ev.job(url(n, 0), f"{R}/{n}_{k}.png", stage, camera=c))
        jobs.append(ev.job(url(n, 0), f"{R}/{n}_false.png", stage, camera=cams["front34"], false=fc))
        jobs.append(ev.job(url(n, 0), f"{R}/{n}_false_rear.png", stage, camera=cams["rear34"], false=fc))
        jobs.append(ev.job(url(n, 1), f"{R}/{n}_lod1.png", stage, camera=cams["rear34"]))
        jobs.append(ev.job(url(n, 1), f"{R}/{n}_night.png", "metropolis-night", camera=cams["rear34"]))
        continue
    cam = {"alpha": -60, "beta": 78 if n.startswith("tower") or n in ("lighthouse", "street-lamp", "cypress") else 70, "dist": 1.6}
    jobs.append(ev.job(url(n, 0), f"{R}/{n}_beauty.png", stage, camera=cam, **extra))
    jobs.append(ev.job(url(n, 0), f"{R}/{n}_false.png", stage, camera=cam, false=fc, **extra))
    step = size * 1.25
    models = [{"url": url(n, l), "pos": [(i - (len(lods) - 1) / 2) * step, 0, 0]} for i, l in enumerate(lods)]
    jobs.append(ev.job(None, f"{R}/{n}_lods.png", stage, camera={"alpha": -90, "beta": 75, "dist": 1.0}, models=models,
                       ground_size=max(600, 6 * size), **extra))
    if n == "windmill":
        jobs.append(ev.job(None, f"{R}/{n}_sails30.png", stage, camera={"alpha": -110, "beta": 75, "dist": 1.6},
                           models=[{"url": url(n, 0), "nodeRot": {"sails": [0, 0, 30]}}]))
    if n == "street-lamp":
        jobs.append(ev.job(url(n, 0), f"{R}/{n}_head.png", stage, camera={"pos": [-1.5, 5.0, -6.0], "target": [1.6, 7.9, 0], "fov": 35}))
    if n == "lighthouse":
        jobs.append(ev.job(url(n, 0), f"{R}/{n}_lantern.png", "metropolis-night", camera={"pos": [-9, 19, -14], "target": [0, 20.5, 0], "fov": 30}))
    if n == "lighthouse" or n.startswith("tower"):
        jobs.append(ev.job(url(n, 0), f"{R}/{n}_night.png", "metropolis-night", camera=cam))
ev.render(jobs, "evidence")

# contact sheet: one row per model
try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 16)
    big = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 22)
except OSError:
    font = big = ImageFont.load_default()
cw, ch, lab = 420, 262, 22
rows = []
for n in names:
    if n.startswith(("mesa-", "cliff-coast-")):
        cells = [f"{n}_{k}" for k in ("front", "side", "back", "close", "below", "lods")]
    elif n.startswith("car-"):
        cells = [f"{n}_front34", f"{n}_rear34", f"{n}_false", f"{n}_false_rear", f"{n}_lod1", f"{n}_night"]
    else:
        cells = [f"{n}_beauty", f"{n}_false", f"{n}_lods"] + ([f"{n}_sails30"] if n == "windmill" else []) + \
                ([f"{n}_night"] if n == "lighthouse" or n.startswith("tower") else []) + \
                ([f"{n}_head"] if n == "street-lamp" else []) + ([f"{n}_lantern"] if n == "lighthouse" else [])
    rows.append((n, cells))
cols = 6
head = 60
sheet = Image.new("RGB", (cols * cw, head + len(rows) * (ch + lab)), (18, 18, 20))
d = ImageDraw.Draw(sheet)
d.text((10, 14), "props2: LOD0 beauty | false-colour | LODs (cars: front 3/4, rear 3/4, false x2, LOD1, night; landforms: front, side, back, "
                 "close-up, from below without ground, LODs)  -  "
                 "Babylon 9.31.0 WebGPU ACES, pack .env + sun", fill=(240, 240, 240), font=big)
for i, (n, cells) in enumerate(rows):
    y = head + i * (ch + lab)
    e = [m[k] for k in sorted(m) if k.split("/")[1] == n]
    (lo, hi) = e[0]["bounds_m"]
    txt = (f"{n}   h {hi[1] - lo[1]:.1f} m   tris " + " / ".join(f"{x['tris']:,}" for x in e) +
           f"   {sum(x['bytes'] for x in e) / 1e6:.2f} MB   emissive: {', '.join(e[0]['emissive']) or '-'}")
    d.text((8, y + 2), txt, fill=(235, 235, 235), font=font)
    for j, c in enumerate(cells):
        im = Image.open(f"{R}/{c}.png").convert("RGB").resize((cw, ch), Image.LANCZOS)
        sheet.paste(im, (j * cw, y + lab))
sheet.save(f"{ROOT}/contact.png", optimize=True)
print("contact.png", sheet.size)

land = [c for n, cells in rows if n.startswith(("mesa-", "cliff-coast-")) for c in cells]
subprocess.run([sys.executable, f"{ROOT}/scripts/grid.py", f"{R}/landforms.jpg", "6"] + [f"{R}/{c}.png" for c in land], check=True,
               env={**os.environ, "CW": "480"})
print("renders/landforms.jpg")
