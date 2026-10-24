"""Evidence renders of the shipped hero car (out/manifest.json) under coconut-beach, plus contact.png.

usage: evidence.py <candidate>   -> renders/*.png, contact.png
Beauty renders recolour `paint` to the game's player red (#D50000, renderer.js charColors.tux) the way the game would."""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(__file__))
import views

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
cand = sys.argv[1]
m = json.load(open(f"{ROOT}/out/manifest.json"))
u0 = "/out/" + m["model/car-hero/lod0"]["file"]
u1 = "/out/" + m["model/car-hero/lod1"]["file"]
R = f"{ROOT}/renders"
os.makedirs(R, exist_ok=True)
RED = "#D50000"
views.VIEWS["hoodcam"] = {"pos": [0.38, 1.3, 0.35], "target": [0.1, 0.8, -1.2], "fov": 55}   # driver's eye over the bonnet
views.VIEWS["topsteer"] = {"pos": [0.0, 7.5, 0.001], "target": [0, 0, 0], "fov": 40}


def J(url, name, cams, false=False, steer=0, paint=RED, **extra):
    js = views.jobs(url, f"{R}/{name}", false, steer, views=cams, extra=extra or None)
    for j in js:
        j["models"][0]["paint"] = paint
    return js


jobs = []
jobs += J(u0, "lod0", ["chase", "rear34", "side", "front34", "hood", "hoodcam", "cockpit"])
jobs += J(u0, "lod0_steer25", ["front34", "topsteer"], steer=25)
jobs += J(u0, "false", ["chase", "rear34", "side", "front34", "top", "cockpit", "hoodcam"], false=True)
jobs += J(u1, "lod1", ["chase", "rear34", "front34"])
# side by side with today's procedural kart (renderer.js _create3DKartMesh port). It faces Babylon +Z; the GLB's +Z
# forward lands on Babylon -Z, so the hero is yawed 180 deg to face the same way. Procedural left, hero right.
cmp_models = [{"url": u0, "pos": [1.6, 0, 0], "yaw": 180, "paint": RED}]
for name, cam in (("compare_chase", {"pos": [0.0, 2.0, -7.5], "target": [0, 0.7, 0], "fov": 50}),
                  ("compare_rear34", {"pos": [-3.0, 2.2, -8.0], "target": [0, 0.55, 0], "fov": 42}),
                  ("compare_front34", {"pos": [3.0, 1.7, 8.0], "target": [0, 0.5, 0], "fov": 42})):
    jobs.append(dict(out=f"{R}/{name}.png", **views.env, ground=views.GROUND, models=cmp_models,
                     procedural=[{"pos": [-1.6, 0, 0]}], camera=cam, width=1280, height=800))
views.render(jobs, "evidence")

# contact sheet
try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 17)
    big = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 24)
except OSError:
    font = big = ImageFont.load_default()
l0, l1 = m["model/car-hero/lod0"], m["model/car-hero/lod1"]
cells = [
    ("lod0_chase", "chase cam (2 m up, 6 m behind)"), ("lod0_rear34", "rear three-quarter"), ("lod0_side", "side"),
    ("lod0_front34", "front three-quarter"), ("lod0_hoodcam", "driver's eye over the bonnet"), ("lod0_hood", "bonnet from above"),
    ("false_chase", "material map: chase"), ("false_rear34", "material map: rear 3/4"), ("false_front34", "material map: front 3/4"),
    ("false_top", "material map: top"), ("false_cockpit", "material map: cockpit"), ("lod0_steer25_front34", "wheel nodes: front pair steered 25 deg"),
    ("lod1_chase", f"LOD1 {l1['tris']:,} tris: chase"), ("lod1_rear34", "LOD1: rear 3/4"), ("lod0_cockpit", "cockpit"),
    ("compare_chase", "procedural (left) vs hero (right): chase"), ("compare_rear34", "procedural vs hero: rear 3/4"),
    ("compare_front34", "procedural vs hero: front 3/4"),
]
cw, ch, pad = 640, 400, 26
cols = 3
rows = (len(cells) + cols - 1) // cols
head = 120
sheet = Image.new("RGB", (cols * cw, head + rows * (ch + pad)), (18, 18, 20))
d = ImageDraw.Draw(sheet)
d.text((12, 10), f"car-hero  LOD0 {l0['tris']:,} tris {l0['bytes'] / 1e6:.2f} MB  |  LOD1 {l1['tris']:,} tris {l1['bytes'] / 1e6:.2f} MB  |  "
       f"Hunyuan3D-2 {cand} from SDXL hero-rear s2  |  coconut-beach IBL + sun, Babylon 9.31.0 WebGPU ACES", fill=(240, 240, 240), font=big)
from materials import FALSE as legend
x = 12
for name, hexc in legend.items():
    d.rectangle([x, 56, x + 18, 74], fill=hexc, outline=(200, 200, 200))
    d.text((x + 24, 55), name, fill=(230, 230, 230), font=font)
    x += 34 + int(d.textlength(name, font=font))
d.text((12, 88), "false colour: flat unlit per material; beauty paint recoloured to the game's #D50000", fill=(170, 170, 170), font=font)
for i, (f, label) in enumerate(cells):
    xx, yy = (i % cols) * cw, head + (i // cols) * (ch + pad)
    im = Image.open(f"{R}/{f}.png").convert("RGB").resize((cw, ch), Image.LANCZOS)
    sheet.paste(im, (xx, yy + pad))
    d.text((xx + 6, yy + 4), label, fill=(235, 235, 235), font=font)
sheet.save(f"{ROOT}/contact.png", optimize=True)
print("contact.png", sheet.size)
