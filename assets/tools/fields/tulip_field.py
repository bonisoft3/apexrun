"""The tulip field as ground: stripes of one colour each, flower rows between soil furrows.

A bulb field reads from a car as long bands of colour running to the horizon, not as beds
on the ground; drawn as the stage's ground texture it covers the whole field at no cost.
One tile is TILE metres square; the stripes run along v (world z, the road's general run).

usage: tulip_field.py <out_dir>   -> <out_dir>/{albedo.webp, normal.webp, arm.webp, recipe.json}
"""
import json, os, sys
import numpy as np
from PIL import Image

N = 2048
TILE = 16.0                       # metres per tile
PX = N / TILE                     # pixels per metre
# The concept paints its rows as soft masses of red, pink and coral between bands of leaf, colour held back from pure
# pigment; a band with no colour is all leaf.
STRIPES = [("red", (0.62, 0.08, 0.07)), ("pink", (0.80, 0.36, 0.46)),
           ("leaf", None), ("coral", (0.82, 0.32, 0.16))]
STRIPE_M, FURROW_M = 4.0, 1.0     # each stripe: STRIPE_M wide, the last FURROW_M of it bare soil
ROW_M, HEAD_M = 0.09, 0.075       # flower rows across a stripe, heads along a row: in bloom the colour all but hides the leaves
HEAD_R = 0.06                     # head radius, metres: heads run together into painted masses
SEED = 5


def blur(a, r):
    """Box blur, wrapping (the tile is periodic)."""
    for axis in (0, 1):
        acc = np.zeros_like(a)
        for k in range(-r, r + 1):
            acc += np.roll(a, k, axis=axis)
        a = acc / (2 * r + 1)
    return a


def noise(rng, scale):
    """Periodic value noise: white noise blurred at `scale` pixels."""
    return blur(rng.random((N, N)), scale)


def main(out):
    rng = np.random.default_rng(SEED)
    # Base: leaves over the flower bands, soil in the furrows.
    u = (np.arange(N) + 0.5) / PX                       # metres across the tile (x)
    in_stripe = (u % STRIPE_M) < (STRIPE_M - FURROW_M)
    leaf = np.array([0.16, 0.32, 0.09]) * (0.75 + 0.5 * noise(rng, 3)[..., None])
    soil = np.array([0.20, 0.12, 0.07]) * (0.7 + 0.6 * noise(rng, 2)[..., None])
    albedo = np.where(in_stripe[None, :, None], leaf, soil)
    height = np.where(in_stripe[None, :], 0.35 + 0.2 * noise(rng, 2), 0.05 * noise(rng, 4))
    rough = np.where(in_stripe[None, :], 0.7, 0.95) * np.ones((N, N))

    # Heads: a shaded cup seen from above, stamped with wrap-around.
    r = int(np.ceil(HEAD_R * PX)) + 1
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1] / PX
    d = np.hypot(xx, yy) / HEAD_R
    cover = np.clip(1.4 - d, 0, 1) ** 0.7               # soft edge
    dome = np.sqrt(np.clip(1 - d * d, 0, 1))
    light = 0.75 + 0.35 * np.clip(-(xx + yy) / HEAD_R, -1, 1) * dome
    for s, (_, colour) in enumerate(STRIPES):
        if colour is None:
            continue
        x0 = s * STRIPE_M
        for rx in np.arange(x0 + 0.12, x0 + STRIPE_M - FURROW_M - 0.08, ROW_M):
            for ry in np.arange(rng.uniform(0, HEAD_M), TILE, HEAD_M):
                cx = int(round((rx + rng.normal(0, 0.012)) * PX)) % N
                cy = int(round((ry + rng.normal(0, 0.015)) * PX)) % N
                col = np.array(colour) * rng.uniform(0.82, 1.08)
                rows = np.arange(cy - r, cy + r + 1) % N
                cols = np.arange(cx - r, cx + r + 1) % N
                a = cover[..., None]
                patch = albedo[np.ix_(rows, cols)]
                albedo[np.ix_(rows, cols)] = patch * (1 - a) + (col * light[..., None]) * a
                h = height[np.ix_(rows, cols)]
                height[np.ix_(rows, cols)] = np.maximum(h, 0.6 + 0.4 * dome)
                rough[np.ix_(rows, cols)] = rough[np.ix_(rows, cols)] * (1 - cover) + 0.5 * cover

    # Painted, not counted: the heads soften into masses of one colour.
    albedo = blur(albedo, 2)

    # Normal from the height field (OpenGL +Y), AO from cavities.
    strength = 3.0
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * strength
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * strength
    nrm = np.stack([-dx, dy, np.ones_like(height)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    ao = np.clip(1 - 1.6 * np.clip(blur(height, 6) - height, 0, 1), 0.35, 1)

    os.makedirs(out, exist_ok=True)
    srgb = lambda a: (np.clip(a, 0, 1) ** (1 / 2.2) * 255 + 0.5).astype(np.uint8)
    lin = lambda a: (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(srgb(albedo)).save(f"{out}/albedo.webp", quality=85, method=6)
    Image.fromarray(lin(nrm * 0.5 + 0.5)).resize((1024, 1024), Image.LANCZOS).save(f"{out}/normal.webp", lossless=True, method=6)
    Image.fromarray(lin(np.stack([ao, rough, np.zeros_like(ao)], -1))).save(f"{out}/arm.webp", quality=85, method=6)
    json.dump({"procedural": {"script": "tools/fields/tulip_field.py", "tile_m": TILE, "seed": SEED,
                              "stripes": [n for n, _ in STRIPES], "stripe_m": STRIPE_M, "furrow_m": FURROW_M}},
              open(f"{out}/recipe.json", "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1])
