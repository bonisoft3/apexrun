"""Evidence sheet of every shipped model in out/manifest.json -> renders/<id>_<view>.png and evidence.jpg.

One row per model: front, 3/4, close-up, LOD0 | LOD1 | LOD2 (left to right as +x, so LOD2 sits left from the front),
baked AO alone (unlit white x COLOR_0, sRGB-encoded as on screen), false colour per material (flat, unlit).
Babylon WebGPU, ACES, each model under one of its stages' .env + sky + sun, the pack's ground for that stage."""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(__file__))
import ev
import look

ROOT = ev.ROOT
R = f"{ROOT}/renders"
os.makedirs(R, exist_ok=True)
m = json.load(open(f"{ROOT}/out/manifest.json"))
names = list(look.STAGE)
jobs, rows = [], []
for n in names:
    e = [m[f"model/{n}/lod{l}"] for l in range(3)]
    j, outs = look.views(n, [f"/out/{x['file']}" for x in e], e[0]["bounds_m"], e[0]["materials"], f"{R}/{n}")
    jobs += j
    rows.append((n, outs, e))
ev.render(jobs, "evidence")

font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 17)
big = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 22)
cw, ch, lab, head = 420, 280, 26, 64
sheet = Image.new("RGB", (6 * cw, head + len(rows) * (ch + lab)), (18, 18, 20))
d = ImageDraw.Draw(sheet)
d.text((10, 8), "cartoon rocks and desert props: front | 3/4 | close-up | LOD2 LOD1 LOD0 | baked AO (COLOR_0 alone) | "
                "false colour per material", fill=(240, 240, 240), font=big)
d.text((10, 36), "SDF facets with rounded edges -> marching cubes -> QEM / lathed grids; normals = field gradient; "
                 "AO sphere-traced on the field + ground, x painted light, in COLOR_0 (VEC3). Babylon WebGPU, ACES, stage .env + sun.",
       fill=(200, 200, 200), font=font)
for i, (n, outs, e) in enumerate(rows):
    y = head + i * (ch + lab)
    lo, hi = e[0]["bounds_m"]
    dims = " x ".join(f"{hi[k] - lo[k]:.2f}" for k in (0, 1, 2))
    txt = (f"{n}   {dims} m   tris " + " / ".join(f"{x['tris']:,}" for x in e) +
           f"   {sum(x['bytes'] for x in e) / 1e3:.0f} kB   materials: {', '.join(e[0]['materials'])}   stage: {look.STAGE[n]}")
    d.text((8, y + 4), txt, fill=(235, 235, 235), font=font)
    for j, c in enumerate(outs):
        im = Image.open(c).convert("RGB").resize((cw, ch), Image.LANCZOS)
        sheet.paste(im, (j * cw, y + lab))
sheet.save(f"{ROOT}/evidence.jpg", quality=88, optimize=True)
print("evidence.jpg", sheet.size)
