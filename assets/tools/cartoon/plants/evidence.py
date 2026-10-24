"""Evidence renders of every model in out/manifest.json and the sheet evidence.jpg.

usage: evidence.py [id ...]   -> renders/<id>_{front,q34,close,lods}.png and evidence.jpg (all ids)
Babylon 9.31.0 WebGPU, ACES, the stage's pack .env + sky dome + sun, pack ground textures."""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(__file__))
import ev
from picks import IDS

ROOT = ev.ROOT
R = f"{ROOT}/renders"
os.makedirs(R, exist_ok=True)
m = json.load(open(f"{ROOT}/out/manifest.json"))
STAGE = {"tree-fir-a": "alpine-peaks", "tree-fir-b": "alpine-peaks", "tree-pine-young": "alpine-peaks",
         "shrub-tropical": "coconut-beach", "grass-beach": "coconut-beach", "palm-a": "coconut-beach", "palm-b": "coconut-beach",
         "palm-c": "coconut-beach", "shrub-desert": "desert-canyons"}
CELLS = ["front", "q34", "close", "lods"]
url = lambda n, l: f"/out/{m[f'model/{n}/lod{l}']['file']}"
only = sys.argv[1:] or IDS
jobs = []
for n in only:
    stage = STAGE.get(n, "wilderness-run")
    (lo, hi) = m[f"model/{n}/lod0"]["bounds_m"]
    size = max(hi[0] - lo[0], hi[2] - lo[2])
    W, H = 900, 600
    diag = sum((b - a) ** 2 for a, b in zip(lo, hi)) ** 0.5
    fit = max(1.0, 1.75 * (hi[1] - lo[1]) / diag)
    c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
    k = 0.42 * max(hi[1] - lo[1], size)
    ty = (0.86 if n.startswith("palm") else 0.7) * hi[1]
    rad = 0.5 * size + 0.35 * max(hi[1] - lo[1], size)
    close = {"pos": [c[0] - 0.5 * rad, ty + 0.15 * rad, c[2] - 0.87 * rad], "target": [c[0], ty, c[2]], "fov": 40}
    jobs.append(ev.job(url(n, 0), f"{R}/{n}_front.png", stage, camera={"alpha": -90, "beta": 86, "dist": 1.05 * fit}, width=W, height=H))
    jobs.append(ev.job(url(n, 0), f"{R}/{n}_q34.png", stage, camera={"alpha": -45, "beta": 66, "dist": 1.1 * fit}, width=W, height=H))
    jobs.append(ev.job(url(n, 0), f"{R}/{n}_close.png", stage, camera=close, width=W, height=H))
    step = size * 1.2
    models = [{"url": url(n, l), "pos": [(l - 1) * step, 0, 0]} for l in range(3)]
    jobs.append(ev.job(None, f"{R}/{n}_lods.png", stage, camera={"alpha": -90, "beta": 80, "dist": 0.95}, models=models,
                       ground_size=max(600, 6 * size), width=W, height=H))
ev.render(jobs, "evidence")

try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 16)
    big = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 22)
except OSError:
    font = big = ImageFont.load_default()
cw, ch, lab = 450, 300, 24
names = [n for n in IDS if all(os.path.exists(f"{R}/{n}_{c}.png") for c in CELLS)]
head = 50
sheet = Image.new("RGB", (len(CELLS) * cw, head + len(names) * (ch + lab)), (18, 18, 20))
d = ImageDraw.Draw(sheet)
d.text((10, 12), "cartoon plants: LOD0 front | LOD0 3/4 | LOD0 close-up | LOD0, LOD1, LOD2  -  Babylon 9.31.0 WebGPU ACES, stage .env + sun",
       fill=(240, 240, 240), font=big)
for i, n in enumerate(names):
    y = head + i * (ch + lab)
    e = [m[f"model/{n}/lod{l}"] for l in range(3)]
    (lo, hi) = e[0]["bounds_m"]
    txt = (f"{n}   {hi[0] - lo[0]:.2f} x {hi[1] - lo[1]:.2f} x {hi[2] - lo[2]:.2f} m   tris " + " / ".join(f"{x['tris']:,}" for x in e) +
           f"   {sum(x['bytes'] for x in e) / 1e3:.0f} kB   materials: {', '.join(e[0]['materials'])}")
    d.text((8, y + 3), txt, fill=(235, 235, 235), font=font)
    for j, c in enumerate(CELLS):
        im = Image.open(f"{R}/{n}_{c}.png").convert("RGB").resize((cw, ch), Image.LANCZOS)
        sheet.paste(im, (j * cw, y + lab))
sheet.save(f"{ROOT}/evidence.jpg", quality=88)
print("evidence.jpg", sheet.size)
