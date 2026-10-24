"""Contact sheet: per set, the photo and the painting, each tiled 3x3; plus a seam check.

usage: contact.py <orig_dir> <manifest.orig.json> <out_dir> <contact.jpg>
Seam check: on a 2x2 tiling, the mean step across the tile edge over the mean step
across interior 16 px block edges (WebP's own block steps); about 1 is seamless.
"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw

orig, man, out, dest = sys.argv[1:5]
m, f = json.load(open(man)), json.load(open(f"{out}/manifest.json"))
sets = sorted({k.split("/")[1] for k in f})
T, L = 128, 24
W = 3 * T
sheet = Image.new("RGB", (4 * W + 3 * 8, ((len(sets) + 1) // 2) * (W + L)), (24, 24, 24))
d = ImageDraw.Draw(sheet)


def seam(a):
    a = a.astype(np.float32)
    t = np.concatenate([a, a], 1)
    n = a.shape[1]
    edge = np.abs(t[:, n] - t[:, n - 1]).mean()
    cols = np.arange(16, n, 16)
    inner = np.abs(a[:, cols] - a[:, cols - 1]).mean()
    tv = np.concatenate([a, a], 0)
    edge_v = np.abs(tv[n] - tv[n - 1]).mean()
    inner_v = np.abs(a[cols] - a[cols - 1]).mean()
    return edge / inner, edge_v / inner_v, edge


for i, s in enumerate(sets):
    x0, y0 = (i % 2) * (2 * W + 16 + 8), (i // 2) * (W + L)
    d.text((x0 + 4, y0 + 6), f"{s}: photo | painted", fill=(230, 230, 230))
    for j, src in enumerate([f"{orig}/{m[f'tex/{s}/albedo']['file']}", f"{out}/{f[f'tex/{s}/albedo']['file']}"]):
        im = Image.open(src).convert("RGB")
        if j:
            for kind in ("albedo", "normal", "arm"):
                a = np.asarray(Image.open(f"{out}/{f[f'tex/{s}/{kind}']['file']}").convert("RGB"))
                print(s, kind, a.shape[:2], "seam x/y %.2f %.2f (step %.2f levels)" % seam(a), "mean", a.reshape(-1, 3).mean(0).round(1))
        t = im.resize((T, T), Image.LANCZOS)
        for k in range(9):
            sheet.paste(t, (x0 + j * (W + 4) + (k % 3) * T, y0 + L + (k // 3) * T))
sheet.save(dest, quality=90)
