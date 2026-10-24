"""Small flat-shaded tileable textures for the stylised props (PNG bytes). Tone variation is per block, never per pixel
noise, so a cel post-process sees clean areas."""
import io
import numpy as np
from PIL import Image


def _png(a):
    b = io.BytesIO()
    Image.fromarray((np.clip(a, 0, 1) ** (1 / 2.2) * 255 + 0.5).astype(np.uint8)).save(b, "PNG", optimize=True)
    return b.getvalue()


def masonry(base, rows, cols, seed, size=512, mortar=0.035, tone=0.12, mortar_dark=0.55, stagger=0.5):
    """Running-bond blocks: `rows` courses and `cols` blocks per course over one tile; base is linear RGB.
    -> PNG bytes. One tile covers (cols * block width) x (rows * course height) in the caller's UV units."""
    rng = np.random.default_rng(seed)
    n = size
    img = np.zeros((n, n, 3), np.float32)
    ch = n / rows
    cw = n / cols
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    r = (yy // ch).astype(int)
    off = (r % 2) * stagger * cw
    c = (((xx + off) % n) // cw).astype(int)
    k = rng.normal(0, tone, (rows, cols + 1))
    hue = rng.normal(0, tone * 0.25, (rows, cols + 1, 3))
    f = 1 + k[r, c][..., None] + hue[r, c]
    img[:] = np.asarray(base, np.float32) * f
    m = mortar * min(ch, cw)
    fy = yy - r * ch
    fx = (xx + off) % cw
    joint = (fy < m) | (fx < m)
    img[joint] = np.asarray(base, np.float32) * mortar_dark
    return _png(img)


def boards(base, n_boards, seed, size=256, tone=0.08, gap_dark=0.5):
    """Horizontal weatherboards: n_boards per tile with a dark shadow line under each."""
    rng = np.random.default_rng(seed)
    img = np.zeros((size, size, 3), np.float32)
    h = size / n_boards
    for i in range(n_boards):
        y0, y1 = int(i * h), int((i + 1) * h)
        img[y0:y1] = np.asarray(base) * (1 + rng.normal(0, tone))
        img[y0:y0 + max(1, int(h * 0.12))] = np.asarray(base) * gap_dark
    return _png(img)


def corrugated(base, n_ribs, size=256, depth=0.25):
    """Vertical corrugation shading baked as soft stripes (n_ribs per tile)."""
    x = np.arange(size) / size * n_ribs * 2 * np.pi
    s = 1 - depth * 0.5 * (1 + np.cos(x))
    img = np.asarray(base, np.float32)[None, None] * s[None, :, None] * np.ones((size, 1, 1), np.float32)
    return _png(img)
