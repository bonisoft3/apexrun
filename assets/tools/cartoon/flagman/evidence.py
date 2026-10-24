"""Evidence sheet of the flagman rig -> renders/<view>.png and evidence.jpg.

usage: evidence.py [glb url]       (default: the packed out/ file from out/manifest.json)
Poses are set the way the game does it: arm_R.rotation = (0, 0, z) with rotationQuaternion cleared. Babylon's glTF
loader puts his front (glTF +Z) on world -Z and keeps his right (glTF -X) on world -X, so the cameras sit at -Z.
Babylon WebGPU, ACES, coconut-beach .env + sky + its low sun, the stage's sand ground."""
import json, math, os, sys
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(__file__))
import ev

ROOT = ev.ROOT
R = f"{ROOT}/renders"
os.makedirs(R, exist_ok=True)
if len(sys.argv) > 1:
    url = sys.argv[1]
else:
    m = json.load(open(f"{ROOT}/out/manifest.json"))
    url = "/out/" + m["model/flagman/lod0"]["file"]
ST = "coconut-beach"
PI = math.pi
FRONT = {"pos": [0, 1.4, -5.6], "target": [0, 1.35, 0], "fov": 35}
F34R = {"pos": [-3.7, 1.7, -4.1], "target": [-0.15, 1.35, 0], "fov": 35}     # from his right front, the flag side
F34L = {"pos": [3.6, 1.6, -4.2], "target": [0, 1.3, 0], "fov": 35}
CLOSE = {"pos": [-0.55, 1.78, -1.05], "target": [-0.04, 1.6, 0], "fov": 34}
HAND = {"pos": [-1.5, 2.3, -2.2], "target": [-0.3, 2.2, 0], "fov": 34}
BACKLIT = {"pos": [-3.3, 1.2, 4.6], "target": [0, 1.45, 0], "fov": 35}
VIEWS = [  # (name, label, camera, arm_R z, flag y, extra)
    ("rest_front", "rest, front", FRONT, 0.0, 0.0, {}),
    ("rest_34", "rest, 3/4 from his left", F34L, 0.0, 0.0, {}),
    ("half_front", "arm_R z = -pi/2, front", FRONT, -PI / 2, 0.0, {}),
    ("raised_front", "raised: arm_R z = -pi, front", FRONT, -PI, 0.0, {}),
    ("raised_34", "raised, 3/4 from his right", F34R, -PI, 0.0, {}),
    ("wave_out_front", "wave: z = -pi - 0.35, front", FRONT, -PI - 0.35, 0.0, {}),
    ("wave_in_front", "wave: z = -pi + 0.35, front", FRONT, -PI + 0.35, 0.0, {}),
    ("wave_34", "wave z = -pi + 0.35, flag y = 0.5, 3/4", F34R, -PI + 0.35, 0.5, {}),
    ("close", "close-up, rest", CLOSE, 0.0, 0.0, {}),
    ("grip", "grip close-up, raised", HAND, -PI, 0.0, {}),
    ("backlit", "into the sun, raised", BACKLIT, -PI, 0.0, {}),
    ("false", "false colour per material, raised 3/4", F34R, -PI, 0.0, {"false": True}),
    ("ao", "baked AO alone (COLOR_0), rest 3/4", F34L, 0.0, 0.0, {"aoOnly": True}),
    ("wrong_way", "z = +pi/2 (the wrong sign: through the body)", FRONT, PI / 2, 0.0, {}),
]
MATS = ["suit", "stripe", "skin", "hair", "shades", "cap", "glove", "boot", "pole", "flag"]
jobs = []
for name, _, cam, z, fy, extra in VIEWS:
    model = {"url": url, "nodeEuler": {"arm_R": [0, 0, z], **({"flag": [0, fy, 0]} if fy else {})}}
    kw = {}
    if extra.get("false"):
        kw["false"] = ev.false_colors(MATS)
    if extra.get("aoOnly"):
        kw["aoOnly"] = True
    jobs.append(ev.job(None, f"{R}/{name}.png", ST, camera=cam, models=[model], width=800, height=800, ground_size=200, **kw))
ev.render(jobs, "evidence")

font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 17)
big = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 22)
cols, cw, lab, head = 5, 440, 24, 70
rows = (len(VIEWS) + cols - 1) // cols
sheet = Image.new("RGB", (cols * cw, head + rows * (cw + lab)), (18, 18, 20))
d = ImageDraw.Draw(sheet)
rec = json.load(open(f"{ROOT}/work/flagman.json"))
lo, hi = rec["bounds_m"]
d.text((10, 8), f"flagman lod0: {rec['tris']:,} tris, {rec['bytes'] / 1e3:.0f} kB, rest bounds "
                f"{hi[0] - lo[0]:.2f} x {hi[1] - lo[1]:.2f} x {hi[2] - lo[2]:.2f} m, height without flag {rec.get('height_m', 0):.2f} m",
       fill=(240, 240, 240), font=big)
d.text((10, 38), "nodes flagman > arm_R (pivot at the right shoulder) > flag (pivot at the grip). Poses: arm_R.rotation.z "
                 "as the game sets it (Euler, quaternion cleared); negative z raises, -pi is overhead. Babylon WebGPU, ACES, coconut-beach.",
       fill=(200, 200, 200), font=font)
for i, (name, label, *_) in enumerate(VIEWS):
    x, y = i % cols * cw, head + i // cols * (cw + lab)
    d.text((x + 6, y + 3), label, fill=(235, 235, 235), font=font)
    sheet.paste(Image.open(f"{R}/{name}.png").convert("RGB").resize((cw, cw), Image.LANCZOS), (x, y + lab))
sheet.save(f"{ROOT}/evidence.jpg", quality=88, optimize=True)
print("evidence.jpg", sheet.size)
