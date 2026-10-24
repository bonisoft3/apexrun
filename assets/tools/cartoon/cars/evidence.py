"""Before/after evidence sheet: evidence.jpg, one row per car - shipped vs cartoon front 3/4, rear 3/4, wheel arch and tail
lights, cartoon side, LOD1 rear 3/4 and LOD1 at night. Babylon 9.31.0 WebGPU, coconut-beach (.env, sky, sun) and
metropolis-night.
usage: evidence.py <shipped manifest.json>   (the shipped GLBs in before/, the new ones per out/manifest.json)"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(__file__))
import ev
import look

ROOT = ev.ROOT
R = f"{ROOT}/renders"
os.makedirs(R, exist_ok=True)
shipped = json.load(open(sys.argv[1]))
new = json.load(open(f"{ROOT}/out/manifest.json"))
CARS = ["car-hero", "car-sedan", "car-convertible", "car-pickup", "car-boxtruck"]
COLS = [("before", 0, "front34", "coconut-beach"), ("after", 0, "front34", "coconut-beach"),
        ("before", 0, "rear34", "coconut-beach"), ("after", 0, "rear34", "coconut-beach"), ("after", 0, "side", "coconut-beach"),
        ("before", 0, "arch", "coconut-beach"), ("after", 0, "arch", "coconut-beach"),
        ("before", 0, "tail", "coconut-beach"), ("after", 0, "tail", "coconut-beach"),
        ("after", 1, "rear34", "coconut-beach"), ("after", 1, "rear34", "metropolis-night")]
jobs, cells = [], {}
for car in CARS:
    for which, lod, view, stage in COLS:
        e = (shipped if which == "before" else new)[f"model/{car}/lod{lod}"]
        url = f"/{'before' if which == 'before' else 'out'}/{e['file']}"
        out = f"{R}/{car}_{which}_lod{lod}_{view}_{stage}.png"
        cam = look.cams(f"{ROOT}{url}")[view]
        jobs.append(ev.job(url, out, stage, camera=cam, width=720, height=450))
        cells[(car, which, lod, view, stage)] = out
ev.render(jobs, "evidence")

try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 15)
    big = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 22)
except OSError:
    font = big = ImageFont.load_default()
cw, ch, lab, head = 400, 250, 22, 70
sheet = Image.new("RGB", (len(COLS) * cw, head + len(CARS) * (ch + lab)), (18, 18, 20))
d = ImageDraw.Draw(sheet)
d.text((10, 10), "Cartoon cars, before (shipped) vs after: faired bodies, circular arches, borders cut on smooth curves, "
                 "balloon wheels, soft clearcoat, baked vertex AO  -  Babylon 9.31.0 WebGPU ACES, coconut-beach / metropolis-night",
       fill=(240, 240, 240), font=big)
for j, (which, lod, view, stage) in enumerate(COLS):
    d.text((j * cw + 6, 44), f"{which.upper()} LOD{lod} {view}{' night' if 'night' in stage else ''}",
           fill=(255, 200, 90) if which == "after" else (170, 170, 175), font=font)
for i, car in enumerate(CARS):
    y = head + i * (ch + lab)
    t = " / ".join(f"{new[f'model/{car}/lod{l}']['tris']:,}" for l in (0, 1))
    t0 = " / ".join(f"{shipped[f'model/{car}/lod{l}']['tris']:,}" for l in (0, 1))
    d.text((8, y + 3), f"{car}   tris after {t}   (before {t0})", fill=(235, 235, 235), font=font)
    for j, (which, lod, view, stage) in enumerate(COLS):
        im = Image.open(cells[(car, which, lod, view, stage)]).convert("RGB").resize((cw, ch), Image.LANCZOS)
        sheet.paste(im, (j * cw, y + lab))
sheet.save(f"{ROOT}/evidence.jpg", quality=88)
print("evidence.jpg", sheet.size)
