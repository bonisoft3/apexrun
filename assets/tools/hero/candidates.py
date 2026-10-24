"""renders/candidates.png: the SDXL picks and every Hunyuan candidate as clay (rear 3/4, front 3/4, side) with fit metrics."""
import glob, json, os
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 16)
cands = sorted(os.path.basename(p)[:-5] for p in glob.glob(f"{ROOT}/work/align/*.json"))
cw, ch, pad = 400, 250, 24
refs = ["hero-rear_s2", "hero-front_s2", "hero-rear_s6"]
W = 4 * cw
sheet = Image.new("RGB", (W, (len(cands) + 1) * (ch + pad)), (18, 18, 20))
d = ImageDraw.Draw(sheet)
for i, r in enumerate(refs):
    im = Image.open(f"{ROOT}/work/sdxl/{r}.png").convert("RGB").resize((ch, ch))
    sheet.paste(im, (i * cw + (cw - ch) // 2, pad))
    d.text((i * cw + 6, 4), f"SDXL reference {r}", fill=(235, 235, 235), font=font)
for k, c in enumerate(cands):
    a = json.load(open(f"{ROOT}/work/align/{c}.json"))
    h = json.load(open(f"{ROOT}/work/hy/{c}.json"))
    y = (k + 1) * (ch + pad)
    d.text((6, y + 4), f"{c}: ref {os.path.basename(a['ref'])[:-4]}, seed {h['seed']}, silhouette IoU {a['iou']:.3f}, "
           f"mirror rms {a['mirror_rms_m_raw'] * 1000:.1f} (x1e-3 raw units), {h['faces']:,} raw faces, {h['gen_seconds']:.0f} s",
           fill=(235, 235, 235), font=font)
    for j, v in enumerate(["rear34", "front34", "side", "top"]):
        p = f"{ROOT}/work/preview/{c}_{v}.png"
        sheet.paste(Image.open(p).convert("RGB").resize((cw, ch)), (j * cw, y + pad))
sheet.save(f"{ROOT}/renders/candidates.png", optimize=True)
print(sheet.size)
