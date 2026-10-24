"""Cartoon rocks: chunky convex facets with rounded edges (log-sum-exp of planes), stacked blocks for ledges, a V-groove
crack where a rock wants one. Sizes follow the shipped models they replace (the game scales each to its kind's height)."""
import numpy as np
import toon
from build import Model, Part
from mats import pbr, srgb

LOD_TRIS = (3000, 800, 200)


def crack(c, n, y0, tan_a, k):
    """A V-groove split (toon.wedge) carved with fillet k."""
    return toon.wedge(c, n, y0, tan_a, 0.6 * k), k


def carve(f, cracks):
    def h(P):
        v = f(P)
        for g, k in cracks:
            v = toon.smax(v, -g(P), k)
        return v
    return h


def paint_up(H, lo=0.92, tint=(1, 1, 1)):
    """Painted light: darker toward the ground, full colour on top; tint multiplies the lower part only."""
    t = np.asarray(tint, float)

    def p(V):
        s = np.clip(V[:, 1] / H, 0, 1)
        s = s * s * (3 - 2 * s)
        k = lo + (1 - lo) * s
        return k[:, None] * (t + (1 - t) * s[:, None])
    return p


def block(f, half, h, mat, splits=(), centre=(0, 0)):
    """A Part searched for in a box of half extents `half` about (centre x, z), standing on the ground."""
    c = np.array([centre[0], 0, centre[1]])
    lo, hi = c - 2.0 * np.asarray(half, float), c + 2.0 * np.asarray(half, float)
    lo[1], hi[1] = -0.5 * half[1], 3.0 * half[1]
    return Part(f=f, box=(lo, hi), h=h, mat=mat, splits=list(splits), refine=max(half) / 9)


def rock(blocks, h, mats, note, paint, splits=(), budget=LOD_TRIS):
    """blocks: [(field, half extents, (centre x, z))]; each block is its own closed shell, overlapping its neighbours
    (crisp intersection lines, no meshed concave crease)."""
    return Model(parts=[block(f, half, h, mats[0]["name"], splits, c) for f, half, c in blocks], materials=mats,
                 budget=budget, note=note, paint=paint)


GRANITE = [pbr("granite", srgb("#93a1b1"), 0.0, 0.88)]
LIMESTONE = [pbr("stone", srgb("#b5a891"), 0.0, 0.9)]
SLATE = [pbr("stone", srgb("#9a938a"), 0.0, 0.88)]
SANDSTONE = [pbr("sandstone", srgb("#e07e45"), 0.0, 0.9), pbr("sandstone_band", srgb("#f4c38a"), 0.0, 0.9)]
DESERT_PAINT = (0.97, 0.93, 0.93)


def band(y0, y1):
    """Material splits for a horizontal cream stratum y0 < y < y1 (two planar cuts, so the band edges are straight)."""
    return [(lambda P: P[:, 1] - y0, None, "sandstone_band", {"sandstone"}),
            (lambda P: P[:, 1] - y1, None, "sandstone", {"sandstone_band"})]


def boulder_granite():
    """1.27 x 1.0 x 1.83 m: a big granite block with a broad sloping top facet, a smaller block fused at its foot, a split
    across the top."""
    a, _ = toon.chunk(7, (0.46, 0.55, 0.8), 9, 0.012, (0, 0.45, 0), jitter=0.12, flat_top=12, yaw=0.3)
    b, _ = toon.chunk(19, (0.3, 0.28, 0.38), 8, 0.01, (0.24, 0.17, 0.58), jitter=0.1, flat_top=-20, yaw=-0.5)
    a = carve(a, [crack((0.0, 0.9, 0.12), (0.15, 0.0, 1.0), 0.78, 0.22, 0.02)])
    return rock([(a, (0.55, 0.5, 0.9), (0, 0)), (b, (0.35, 0.3, 0.42), (0.24, 0.58))], 0.009, GRANITE,
               "granite boulder, 1.0 m: chunky planar facets with rounded edges, a sloping top facet, a smaller block "
               "fused at its foot, a V-groove split across the top; material granite (grey-blue)", paint_up(1.0, 0.92, (0.95, 0.97, 1.02)))


def rock_a():
    """0.17 x 0.14 x 0.32 m (scaled up in game): a loaf-like block, flat top, one chipped corner."""
    a, _ = toon.chunk(3, (0.085, 0.09, 0.16), 11, 0.0025, (0, 0.055, 0), jitter=0.1, flat_top=6, yaw=0.1)
    chip = toon.polytope([[0.6, 0.55, 0.6]], [0.11], 0.002, (0, 0.05, 0.04))
    f = lambda P: toon.smax(a(P), chip(P), 0.004)
    return rock([(f, (0.1, 0.075, 0.17), (0, 0))], 0.0018, LIMESTONE,
               "stone block, 0.15 m (scaled in game): a loaf of large planar facets, rounded edges, a flat top and a chipped "
               "corner; material stone (warm grey limestone)", paint_up(0.15))


def rock_b():
    """0.074 x 0.033 x 0.145 m: a flat slab with a smaller plate lying on one end, so a ledge steps across the top."""
    a = toon.slab(5, 0.042, 0.082, 6, -0.01, 0.021, 0.0008, batter=12, tilt=(4, -2), chamfer=0.007, nch=1, yaw=0.52, jitter=0.15)
    b = toon.slab(8, 0.03, 0.036, 5, 0.012, 0.033, 0.0008, centre=(0.0, 0.03), batter=14, tilt=(-5, 4), chamfer=0.0,
                  nch=0, yaw=0.5)
    return rock([(a, (0.05, 0.02, 0.1), (0, 0)), (b, (0.032, 0.02, 0.045), (0.002, 0.03))], 0.0006, SLATE,
                "flat slab, 33 mm (scaled in game): a six-sided plate with near-vertical planar sides, chamfered and rounded "
                "edges, a smaller plate lying on one end so a ledge steps across the top; material stone (grey-brown)",
                paint_up(0.033))


def rock_desert_a():
    """2.53 x 0.88 x 1.23 m: a tumble of three sandstone blocks, the middle one tallest, a cream stratum through each."""
    a = toon.slab(11, 0.55, 0.52, 6, -0.2, 0.88, 0.014, centre=(0.05, 0.0), batter=7, tilt=(4, -3), chamfer=0.12, nch=3)
    b = toon.slab(13, 0.45, 0.48, 5, -0.2, 0.56, 0.012, centre=(-0.82, 0.1), batter=9, tilt=(-12, 4), chamfer=0.1, nch=2,
                  yaw=0.5)
    c = toon.slab(17, 0.42, 0.42, 5, -0.2, 0.5, 0.012, centre=(0.9, -0.12), batter=9, tilt=(14, -5), chamfer=0.1, nch=2,
                  yaw=1.1)
    return rock([(a, (0.62, 0.45, 0.6), (0.05, 0)), (b, (0.5, 0.3, 0.52), (-0.82, 0.1)), (c, (0.47, 0.3, 0.47), (0.9, -0.12))],
                0.01, SANDSTONE,
               "sandstone tumble, 0.88 m: three blocks with battered planar sides, chamfered and rounded edges, tilted flat "
               "tops, the middle one tallest, a cream stratum across all three; materials sandstone (red-orange), "
               "sandstone_band (cream)", paint_up(0.88, 0.9, DESERT_PAINT), splits=band(0.3, 0.42))


def rock_desert_b():
    """2.52 x 1.9 x 2.5 m: a squat sandstone tower of three strata, each stepping back at a ledge, two cream bands."""
    a = toon.slab(21, 1.2, 1.15, 7, -0.2, 0.82, 0.016, batter=10, tilt=(2, 1), chamfer=0.12, nch=3)
    b = toon.slab(23, 0.98, 0.92, 6, 0.8, 1.38, 0.015, centre=(0.12, -0.1), batter=6, tilt=(-3, 2), chamfer=0.1, nch=3,
                  yaw=0.4)
    c = toon.slab(29, 0.7, 0.62, 6, 1.36, 1.9, 0.014, centre=(-0.22, 0.18), batter=9, tilt=(7, -5), chamfer=0.16, nch=4,
                  yaw=0.9)
    return rock([(a, (1.3, 0.45, 1.3), (0, 0)), (b, (1.1, 0.7, 1.05), (0.12, -0.1)), (c, (0.85, 0.95, 0.8), (-0.22, 0.18))],
                0.012, SANDSTONE,
                "sandstone stack, 1.9 m: three strata with battered planar sides, chamfered and rounded edges, each stepping "
                "back at a flat ledge, a tilted cap block, cream bands through the lower two; materials sandstone "
                "(red-orange), sandstone_band (cream)", paint_up(1.9, 0.9, DESERT_PAINT),
                splits=band(0.5, 0.62) + band(1.02, 1.14))


def rock_desert_c():
    """1.36 x 0.54 x 0.75 m: a low flat-topped slab with a lower block stepping down one end."""
    a = toon.slab(31, 0.6, 0.36, 6, -0.1, 0.54, 0.008, centre=(0.08, 0.0), batter=12, tilt=(3, 2), chamfer=0.07, nch=2)
    b = toon.slab(37, 0.34, 0.32, 5, -0.1, 0.3, 0.007, centre=(-0.5, 0.04), batter=12, tilt=(-8, 0), chamfer=0.05, nch=2,
                  yaw=0.6)
    return rock([(a, (0.68, 0.28, 0.42), (0.08, 0)), (b, (0.4, 0.16, 0.37), (-0.5, 0.04))], 0.006, SANDSTONE,
               "sandstone slab, 0.54 m: a flat-topped block with battered planar sides, chamfered and rounded edges, a lower "
               "block stepping down one end, a cream stratum low on its flanks; materials sandstone (red-orange), "
               "sandstone_band (cream)", paint_up(0.54, 0.9, DESERT_PAINT), splits=band(0.12, 0.2))


MODELS = {"boulder-granite": boulder_granite, "rock-a": rock_a, "rock-b": rock_b, "rock-desert-a": rock_desert_a,
          "rock-desert-b": rock_desert_b, "rock-desert-c": rock_desert_c}
