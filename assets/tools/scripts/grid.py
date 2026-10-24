"""Contact grid: grid.py out.jpg cols cell_px file... (labels are file stems)."""
import os, sys
from PIL import Image, ImageDraw
out, cols, cell = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
fs = sys.argv[4:]
rows = (len(fs) + cols - 1) // cols
g = Image.new("RGB", (cols * cell, rows * (cell + 16)), "white")
for i, f in enumerate(fs):
    im = Image.open(f).convert("RGB"); im.thumbnail((cell, cell))
    x, y = (i % cols) * cell, (i // cols) * (cell + 16)
    g.paste(im, (x, y + 16)); ImageDraw.Draw(g).text((x + 3, y + 2), os.path.basename(f).rsplit(".", 1)[0], fill="black")
g.save(out, quality=88)
