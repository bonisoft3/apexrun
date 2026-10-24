"""Contact grid of images with labels. usage: grid.py <out.jpg> <cols> <img>..."""
import os, sys
from PIL import Image, ImageDraw
out, cols, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
cw = int(os.environ.get("CW", 384))
ims = [Image.open(f).convert("RGB") for f in files]
ch = int(cw * ims[0].height / ims[0].width)
rows = (len(ims) + cols - 1) // cols
g = Image.new("RGB", (cols * cw, rows * (ch + 18)), "white")
d = ImageDraw.Draw(g)
for i, (f, im) in enumerate(zip(files, ims)):
    x, y = i % cols * cw, i // cols * (ch + 18)
    g.paste(im.resize((cw, ch), Image.LANCZOS), (x, y + 18))
    d.text((x + 4, y + 3), os.path.basename(f), fill="black")
g.save(out, quality=90)
