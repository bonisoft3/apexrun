"""Rows of 2x2-tiled images (384 px a tile), one row per argument group: a,b,c|d,e"""
import sys
from PIL import Image
out, rows = sys.argv[1], [r.split(",") for r in sys.argv[2:]]
T = 384
w = max(len(r) for r in rows)
sheet = Image.new("RGB", (T * 2 * w, T * 2 * len(rows)))
for i, r in enumerate(rows):
    for j, f in enumerate(r):
        im = Image.open(f).convert("RGB").resize((T, T))
        for k in range(4):
            sheet.paste(im, (j * 2 * T + (k % 2) * T, i * 2 * T + (k // 2) * T))
sheet.save(out, quality=88)
