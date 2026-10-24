"""Background removal for references: rembg u2net (solid objects) or colour key (white-background foliage).
usage: cutout.py <rembg|key> <in.png> <out.png>"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage
mode, src, out = sys.argv[1:4]
img = Image.open(src).convert("RGB")
if mode == "rembg":
    from rembg import remove, new_session
    rgba = np.asarray(remove(img, session=new_session("u2net")))
    a = rgba[..., 3].astype(np.float32) / 255
    a = np.where(a > 0.5, 1.0, 0.0)  # Hunyuan conditions on a hard silhouette
    lab, n = ndimage.label(a > 0)
    if n == 0:
        raise RuntimeError(f"{src}: empty mask")
    keep = lab == (np.bincount(lab.ravel())[1:].argmax() + 1)
    keep = ndimage.binary_fill_holes(keep)
    rgba = np.dstack([np.asarray(img), (keep * 255).astype(np.uint8)])
else:
    rgb = np.asarray(img).astype(np.float32)
    d = 255 - rgb.min(-1)
    chroma = rgb.max(-1) - rgb.min(-1)
    a = np.clip((d - 40) / 40, 0, 1) * np.clip(np.maximum((chroma - 20) / 20, (d - 150) / 40), 0, 1)
    lab, n = ndimage.label(a > 0.5)
    keep = lab == (np.bincount(lab.ravel())[1:].argmax() + 1)
    keep = ndimage.binary_dilation(keep, iterations=2)
    rgba = np.dstack([rgb.astype(np.uint8), (a * keep * 255).astype(np.uint8)])
Image.fromarray(rgba).save(out)
print(out, float((rgba[..., 3] > 127).mean()))
