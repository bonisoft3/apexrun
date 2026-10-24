"""Evidence sheet of out/manifest.json -> renders/<id>_<view>.png and evidence.jpg.

Per set: the set lined up on its stage, from the sun's side and against it. Per model: front (against the sun, as the
race camera mostly meets them), 3/4 from the sun's side, close-up, LOD2 | LOD1 | LOD0, baked AO alone (unlit white x
COLOR_0), false colour per material. Babylon WebGPU with the game's toon bands and ink, the stage's .env, sun and ground."""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(__file__))
import ev, lineup, look, rocks2

ROOT = ev.ROOT
R = f"{ROOT}/renders"
os.makedirs(R, exist_ok=True)
m = json.load(open(f"{ROOT}/out/manifest.json"))
jobs, sets, rows = [], [], []
for s, ids in rocks2.SETS.items():
    e0 = [m[f"model/{n}/lod0"] for n in ids]
    j, outs = lineup.jobs(s, [f"/out/{x['file']}" for x in e0], [x["bounds_m"] for x in e0], f"{R}/set_{s}")
    jobs += j
    sets.append((s, outs, e0))
    for n in ids:
        e = [m[f"model/{n}/lod{l}"] for l in range(3)]
        j, outs = look.views(n, [f"/out/{x['file']}" for x in e], e[0]["bounds_m"], e[0]["materials"], f"{R}/{n}")
        jobs += j
        rows.append((n, outs, e))
ev.render(jobs, "evidence")

font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 17)
big = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 22)
cw, ch, lab, head = 420, 280, 26, 64
W = 6 * cw
sw, sh = W // 2, int(W // 2 * 640 / 1600)
H = head + len(sets) * (sh + lab) + len(rows) * (ch + lab)
sheet = Image.new("RGB", (W, H), (18, 18, 20))
d = ImageDraw.Draw(sheet)
d.text((10, 8), "rocks2: each set on its stage (sun side | against the sun), then per model: front (against the sun) | 3/4 "
                "(sun side) | close-up | LOD2 LOD1 LOD0 | baked AO (COLOR_0) | false colour per material", fill=(240, 240, 240), font=big)
d.text((10, 36), "SDF: lumpy superellipsoids cut by fracture planes of mixed depth and chamfer, domain-warped, strata and "
                 "lichen as level-set material splits -> marching cubes -> QEM per LOD; normals = field gradient; AO in "
                 "COLOR_0 (VEC3). Babylon WebGPU, the game's toon bands + depth ink, stage .env + sun + ground.",
       fill=(200, 200, 200), font=font)
y = head
for s, outs, e0 in sets:
    hs = ", ".join(f"{n.split('rock-')[1]} {x['bounds_m'][1][1]:.1f}" for n, x in zip(rocks2.SETS[s], e0))
    d.text((8, y + 4), f"set {s} on {look.SET_STAGE[s]} (left to right: {hs} m tall)   stages: "
                       f"{', '.join(e0[0]['stages'])}", fill=(255, 225, 160), font=font)
    for j, c in enumerate(outs):
        sheet.paste(Image.open(c).convert("RGB").resize((sw, sh), Image.LANCZOS), (j * sw, y + lab))
    y += sh + lab
for n, outs, e in rows:
    lo, hi = e[0]["bounds_m"]
    dims = " x ".join(f"{hi[k] - lo[k]:.2f}" for k in (0, 1, 2))
    txt = (f"{n}   {dims} m (h {hi[1]:.2f})   tris " + " / ".join(f"{x['tris']:,}" for x in e) +
           f"   {sum(x['bytes'] for x in e) / 1e3:.0f} kB   materials: {', '.join(e[0]['materials'])}   stage: {look.STAGE[n]}")
    d.text((8, y + 4), txt, fill=(235, 235, 235), font=font)
    for j, c in enumerate(outs):
        sheet.paste(Image.open(c).convert("RGB").resize((cw, ch), Image.LANCZOS), (j * cw, y + lab))
    y += ch + lab
sheet.save(f"{ROOT}/evidence.jpg", quality=86, optimize=True)
print("evidence.jpg", sheet.size)
