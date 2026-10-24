"""Stylised rocks, three sets: rounded masses (ellipsoids, pillow blocks) under low-frequency noise, sliced by a few crisp
fracture planes of differing orientation, the whole bent by a smooth domain warp so no facet is dead flat or parallel to
another; sandstone and limestone carry strata, granite lichen. Native sizes vary within a set (0.6 to 3 m tall)."""
import numpy as np
import toon
from build import Model, Part
from mats import pbr, srgb

ROCK = (3000, 840, 210)
CLUSTER = (4500, 1260, 315)

SANDSTONE = [pbr("sandstone", srgb("#cf6a3c"), 0.0, 0.9), pbr("sandstone_band", srgb("#f0c994"), 0.0, 0.9)]
GRANITE = [pbr("granite", srgb("#8e99a6"), 0.0, 0.88), pbr("lichen", srgb("#a3a77f"), 0.0, 0.95)]
LIMESTONE = [pbr("limestone", srgb("#e2d2b2"), 0.0, 0.9)]


# ---------------------------------------------------------------- solids

def rot(yaw=0.0, tx=0.0, tz=0.0):
    """Local-to-world rotation: tilt about x then z (degrees), then yaw (radians) about y."""
    return toon.rot_y(yaw) @ toon.rot_z(np.radians(tz)) @ toon.rot_x(np.radians(tx))


def ellipsoid(c, r, R=np.eye(3)):
    c, r = np.asarray(c, float), np.asarray(r, float)

    def f(P):
        q = (P - c) @ R
        k0 = np.linalg.norm(q / r, axis=1)
        k1 = np.linalg.norm(q / (r * r), axis=1)
        return k0 * (k0 - 1) / np.maximum(k1, 1e-9)
    return f


def blob(c, half, p=2.0, R=np.eye(3)):
    """Superellipsoid: p = 2 an ellipsoid, toward 3-4 a block whose faces bulge and whose edges stay round."""
    c, r = np.asarray(c, float), np.asarray(half, float)
    s = r.min()

    def f(P):
        q = np.abs((P - c) @ R) / r
        return ((q ** p).sum(1) ** (1 / p) - 1) * s
    return f


def support(n, half, R):
    """Extent of an ellipsoid of half-axes `half` (rotated by R) along unit n."""
    m = R.T @ n
    return float(np.sqrt(((m * np.asarray(half, float)) ** 2).sum()))


def fractures(seed, c, half, count, depth=(0.12, 0.28), elev=(-8, 55), R=np.eye(3), az0=None):
    """`count` cutting planes spread round the solid (azimuths a full turn apart plus jitter, elevations drawn from
    `elev` degrees), each taking `depth` (fraction of the support) off: no two planes parallel. -> [(n, point)]."""
    g = np.random.default_rng(seed)
    a0 = g.uniform(0, 2 * np.pi) if az0 is None else az0
    out = []
    for i in range(count):
        a = a0 + 2 * np.pi * (i + g.uniform(-0.18, 0.18)) / count
        e = np.radians(g.uniform(*elev))
        n = np.array([np.cos(e) * np.cos(a), np.sin(e), np.cos(e) * np.sin(a)])
        out.append((n, np.asarray(c, float) + n * support(n, half, R) * (1 - g.uniform(*depth))))
    return out


def plane(n, p, k=None):
    n = np.asarray(n, float) / np.linalg.norm(n)
    return (n, np.asarray(p, float)) if k is None else (n, np.asarray(p, float), k)


def cut(f, planes, k, wobble=0.0, seed=0):
    """f sliced by planes [(n, point) or (n, point, k)], each chamfered over about its k (default k); wobble (m) bends
    each plane gently, so it reads hewn, not machined."""
    def h(P):
        v = f(P)
        for i, pl in enumerate(planes):
            n, q = pl[0], pl[1]
            d = (P - q) @ n
            if wobble:
                d = d + wobble * toon.perlin(P * 0.9, seed + 13 * i)
            v = toon.smax(v, d, pl[2] if len(pl) > 2 else k)
        return v
    return h


def chunk(seed, c, half, p=2.4, R=np.eye(3), cuts=5, depth=(0.08, 0.3), elev=(-10, 55), k=(0.02, 0.08), lump=(0.0, 1.0),
          wobble=None):
    """A rock mass: a lumpy superellipsoid broken by `cuts` fracture planes of mixed depth and orientation, each with
    its own chamfer drawn from k (fraction of the smallest half extent): some crisp, some worn."""
    g = np.random.default_rng(seed + 1000)
    m = float(np.min(half))
    f = blob(c, half, p, R)
    if lump[0]:
        f = lumpy(f, lump[0], lump[1], 2, seed)
    pl = [(n, q, m * g.uniform(*k)) for n, q in fractures(seed, c, half, cuts, depth, elev, R)]
    return cut(f, pl, 0.0, 0.03 * m if wobble is None else wobble, seed)


def lean(f, lx, lz, taper, H):
    """f sheared so its top moves (lx, lz) metres per metre of height, and narrowed by `taper` (fraction) at height H."""
    def g(P):
        y = P[:, 1]
        s = 1 - taper * np.clip(y / H, 0, 1)
        Q = np.stack([(P[:, 0] - lx * y) / s, y, (P[:, 2] - lz * y) / s], 1)
        return f(Q) * s
    return g


def lumpy(f, amp, freq, octaves=2, seed=0):
    return lambda P: f(P) + amp * toon.fbm(P, freq, octaves, seed)


def union(fs, k):
    def h(P):
        v = fs[0](P)
        for g in fs[1:]:
            v = toon.smin(v, g(P), k)
        return v
    return h


def strata(f, layers, dip=(0.0, 0.0), seed=0, patchy=1.0):
    """Erosion along bedding: layers [(y, depth, width)], positive depth a groove, negative a ledge standing proud; the
    bedding dips by dip (dy/dx, dy/dz). patchy > 0 lets each groove fade in and out round the rock, so none reads as a
    ring."""
    def h(P):
        y = P[:, 1] + dip[0] * P[:, 0] + dip[1] * P[:, 2]
        v = f(P)
        for i, (y0, d, w) in enumerate(layers):
            m = np.clip(0.55 + 1.4 * toon.perlin(P * [1.1, 0.3, 1.1], seed + 31 * i), 0, 1) if patchy else 1.0
            v = v + d * np.exp(-((y - y0) / w) ** 2) * (1 - patchy + patchy * m)
        return v
    return h


def moved(f, R, pivot, shift=(0, 0, 0)):
    """f turned by R about pivot, then moved by shift."""
    pivot, shift = np.asarray(pivot, float), np.asarray(shift, float)
    return lambda P: f((P - pivot - shift) @ R + pivot)


def split_halves(f, n, p, gap, crack_amp, crack_freq, seed):
    """Two closed halves of f either side of a jagged crack surface through p (normal n), the gap widening upward
    (gap(y) metres)."""
    n = np.asarray(n, float) / np.linalg.norm(n)
    p = np.asarray(p, float)

    def s(P):
        return (P - p) @ n + crack_amp * toon.fbm(P, crack_freq, 2, seed)
    a = lambda P: toon.smax(f(P), s(P) + gap(P[:, 1]) / 2, 0.02)
    b = lambda P: toon.smax(f(P), -s(P) + gap(P[:, 1]) / 2, 0.02)
    return a, b


# ---------------------------------------------------------------- paint and materials

def paint(H, lo=0.9, streak=0.0, seed=0, tint=(1, 1, 1)):
    """Darker toward the ground, full colour on top; `streak` darkens in soft vertical runs (rain streaks)."""
    t = np.asarray(tint, float)

    def p(V):
        s = np.clip(V[:, 1] / H, 0, 1)
        s = s * s * (3 - 2 * s)
        k = lo + (1 - lo) * s
        if streak:
            r = toon.fbm(V * [3.2, 0.35, 3.2], 1.0, 2, seed)
            k = k * (1 - streak * np.clip(r * 1.6, 0, 1))
        return k[:, None] * (t + (1 - t) * s[:, None])
    return p


def bands(spans, dip=(0.0, 0.0), wave=0.035):
    """Cream strata between (y0, y1) pairs, dipping like the bedding, their edges wandering by about `wave` metres."""
    def g(y0):
        return lambda P: (P[:, 1] + dip[0] * P[:, 0] + dip[1] * P[:, 2] - y0
                          + wave * toon.perlin(P * [1.4, 0.5, 1.4], 77))
    out = []
    for y0, y1 in spans:
        out += [(g(y0), None, "sandstone_band", {"sandstone"}), (g(y1), None, "sandstone", {"sandstone_band"})]
    return out


def lichen(f, seed, cover=0.0):
    """Lichen patches on the upward faces: a noise level set biased by how much the surface faces the sky."""
    def g(P):
        n = toon.grad(f, P, 0.005)
        ny = n[:, 1] / np.maximum(np.linalg.norm(n, axis=1), 1e-9)
        return toon.fbm(P, 1.3, 2, seed) + 0.75 * (ny - 0.6) - 0.25 + cover
    return [(g, None, "lichen", {"granite"})]


def rock(parts, mats, note, paint_fn, budget=ROCK, splits=(), size=None):
    """parts: fields (each a closed solid, cut flat at the ground); splits apply to every part."""
    h = size / 105
    lo, hi = np.array([-3.5, -0.4, -3.5]), np.array([3.5, 4.0, 3.5])
    return Model(parts=[Part(f=f, box=(lo, hi), h=h, mat=mats[0]["name"], splits=list(splits), refine=size / 12)
                        for f in parts], materials=mats, budget=budget, note=note, paint=paint_fn,
                 ao_radius=0.8)


# ---------------------------------------------------------------- desert sandstone

DIP = (0.04, -0.03)


def sand_a():
    """Tall leaning pinnacle, ~3 m: a tapering column leaning well off the vertical, broken by side fractures of mixed
    depth and a two-faced slanted crown, a proud cream ledge and two patchy grooves along its bedding."""
    f = chunk(1, (0, 1.4, 0), (0.66, 1.85, 0.56), 2.3, rot(0.3), 6, (0.04, 0.38), (-15, 30), (0.03, 0.1), (0.08, 0.55))
    f = cut(f, [plane((0.7, 1, -0.3), (0, 2.95, 0), 0.04), plane((-0.8, 1, 0.6), (0, 2.8, 0), 0.05)], 0.05)
    f = lean(f, 0.24, 0.08, 0.48, 3.0)
    f = strata(f, [(0.62, 0.07, 0.07), (1.45, -0.05, 0.08), (2.15, 0.06, 0.07)], DIP, 2)
    f = toon.warp(f, 0.14, 0.3, 3)
    return rock([f], SANDSTONE, "leaning sandstone pinnacle: a tapering column leaning well off the vertical, side "
                "fractures of mixed depth, a two-faced slanted crown, a proud cream ledge and patchy bedding grooves; "
                "materials sandstone (red-orange), sandstone_band (cream)", paint(3.0, 0.88),
                splits=bands([(0.44, 0.52), (1.36, 1.56)], DIP), size=3.0)


def sand_b():
    """Rounded wind-worn boulder, ~1.4 m: three fused lobes, a wind-scooped hollow under one side, one broken face."""
    dip = (0.2, 0.06)
    a = blob((0, 0.5, 0), (1.15, 0.9, 0.82), 2.2, rot(0.4))
    b = blob((0.6, 0.32, 0.5), (0.66, 0.55, 0.58), 2.0, rot(-0.3))
    c = blob((-0.35, 0.95, -0.1), (0.6, 0.42, 0.5), 2.0, rot(1.0))
    f = lumpy(union([a, b, c], 0.3), 0.17, 0.45, 2, 11)
    hollow = blob((-1.0, 0.3, 0.55), (0.5, 0.3, 0.45), 2.0, rot(0.2))
    f = (lambda f: lambda P: toon.smax(f(P), -hollow(P), 0.14))(f)
    f = cut(f, [plane((1, 0.25, -0.35), (0.98, 0.5, -0.2), 0.03)], 0.03, 0.03, 4)
    f = strata(f, [(0.6, 0.04, 0.06)], dip, 13)
    f = toon.warp(f, 0.12, 0.4, 12)
    return rock([f], SANDSTONE, "wind-worn sandstone boulder: three fused lobes, a wind-scooped hollow undercutting one "
                "side, one crisp broken face, steeply dipping bedding with a cream band; materials sandstone, "
                "sandstone_band", paint(1.4, 0.88), splits=bands([(0.62, 0.78)], dip), size=2.5)


def sand_c():
    """Flat-topped ledge with an undercut, ~1.15 m: an irregular caprock overhanging a narrower eroded base, a fallen
    block against one end."""
    R = rot(0.25, 0, 4)
    cap = chunk(21, (0, 0.88, 0), (1.6, 0.34, 0.92), 3.0, R, 5, (0.03, 0.36), (-30, 10), (0.04, 0.12), (0.05, 0.6))
    cap = cut(cap, [plane((0.08, 1, 0.05), (0, 1.13, 0)), plane((0.03, -1, 0.12), (0, 0.66, 0))], 0.04)
    base = chunk(22, (0.15, 0.34, 0.05), (1.25, 0.62, 0.62), 2.2, rot(0.6), 4, (0.08, 0.25), (-5, 30), (0.05, 0.15),
                 (0.08, 0.7))
    talus = chunk(23, (-1.15, 0.16, 0.42), (0.5, 0.36, 0.42), 2.6, rot(1.1, 10, 0), 3, (0.1, 0.3), (0, 50), (0.03, 0.08))
    f = union([union([cap, base], 0.1), talus], 0.08)
    f = strata(f, [(0.36, 0.05, 0.06)], DIP, 26)
    f = toon.warp(f, 0.12, 0.35, 25)
    return rock([f], SANDSTONE, "sandstone ledge: an irregular flat caprock with overhanging cliffed sides over a narrower "
                "eroded base, a fallen block against one end, a cream band through the caprock; materials sandstone, "
                "sandstone_band", paint(1.15, 0.86), splits=bands([(0.8, 0.92)], DIP), size=3.2)


def sand_d():
    """Split block, ~1.8 m: a chunky block cracked through top to bottom, one half leaning away."""
    R = rot(-0.3)
    f = chunk(31, (0, 0.8, 0), (1.0, 1.05, 0.78), 3.0, R, 6, (0.06, 0.26), (-8, 50), (0.03, 0.1), (0.06, 0.7))
    f = lean(f, 0.0, 0.05, 0.15, 1.9)
    f = strata(f, [(0.5, 0.05, 0.06), (1.32, 0.045, 0.05)], DIP)
    a, b = split_halves(f, (1, 0, 0.35), (0.1, 0, 0), lambda y: 0.05 + 0.08 * np.clip(y / 1.8, 0, 1), 0.07, 1.1, 34)
    b = moved(b, toon.rot_z(np.radians(-7)), (1.0, 0, 0), (0.06, 0, 0))
    a, b = toon.warp(a, 0.08, 0.4, 35), toon.warp(b, 0.08, 0.4, 35)
    return rock([a, b], SANDSTONE, "split sandstone block: a chunky block cracked clean through along a jagged plane, the "
                "smaller half leaning away, two cream bands; materials sandstone, sandstone_band", paint(1.8, 0.88),
                splits=bands([(0.84, 0.98), (1.52, 1.6)], DIP), size=2.3)


def sand_e():
    """Squat hoodoo, ~1.7 m: an eroded, waisted pedestal under a wider, tilted, broken caprock."""
    stem = union([blob((0, 0.16, 0), (0.64, 0.46, 0.56), 2.0), blob((0.04, 0.66, 0.02), (0.33, 0.42, 0.3), 2.0, rot(0.5)),
                  blob((0.07, 1.06, 0.04), (0.28, 0.3, 0.25), 2.0)], 0.18)
    stem = strata(lumpy(stem, 0.05, 0.9, 2, 41), [(0.42, 0.05, 0.06), (0.86, 0.04, 0.05)], DIP)
    Rc = rot(0.6, 5, -8)
    cap = chunk(43, (0.12, 1.42, 0.05), (0.84, 0.27, 0.68), 2.6, Rc, 6, (0.06, 0.25), (-20, 35), (0.04, 0.12), (0.04, 0.8))
    f = union([stem, cap], 0.06)
    f = toon.warp(f, 0.06, 0.45, 45)
    return rock([f], SANDSTONE, "sandstone hoodoo: a waisted, wind-eroded pedestal with bedding grooves under a wider, "
                "tilted caprock with broken edges, cream at its base; materials sandstone, sandstone_band", paint(1.7, 0.88),
                splits=bands([(1.2, 1.4)]), size=1.9)


def sand_f():
    """Low tumble of four fused blocks, ~0.85 m: one big, three smaller, each broken and tipped its own way, one resting
    across two."""
    spec = [((-0.25, 0.4, 0.0), (0.75, 0.55, 0.58), rot(0.3, 0, 8)), ((0.85, 0.24, 0.32), (0.46, 0.34, 0.4), rot(-0.4, -12, 0)),
            ((-0.95, 0.18, 0.3), (0.38, 0.28, 0.32), rot(0.9, 0, -15)), ((0.4, 0.6, -0.45), (0.36, 0.26, 0.3), rot(1.6, 18, 10))]
    blocks = [chunk(50 + i, c, hf, 3.6, R, 6, (0.05, 0.35), (-15, 55), (0.03, 0.1), (0.04, 1.0))
              for i, (c, hf, R) in enumerate(spec)]
    f = toon.warp(union(blocks, 0.04), 0.06, 0.5, 51)
    return rock([f], SANDSTONE, "sandstone tumble: one big and three smaller angular blocks fused, each broken and tipped "
                "its own way, one resting across two, a cream band low through all; materials sandstone, sandstone_band",
                paint(0.85, 0.86), splits=bands([(0.26, 0.36)], DIP), size=2.8)


# ---------------------------------------------------------------- granite

def granite_a():
    """Big rounded boulder, ~2 m: a lumpy dome with a side lobe and six chunky fracture planes."""
    R = rot(0.2)
    a = chunk(101, (0, 0.8, 0), (1.42, 1.18, 1.15), 2.0, R, 6, (0.08, 0.36), (-5, 55), (0.03, 0.1), (0.12, 0.45))
    b = chunk(102, (0.75, 0.42, 0.6), (0.78, 0.62, 0.66), 2.0, rot(0.9), 2, (0.15, 0.3), (0, 40), (0.05, 0.1), (0.06, 0.8))
    f = toon.warp(union([a, b], 0.22), 0.12, 0.35, 104)
    return rock([f], GRANITE, "granite boulder: a big lumpy dome with a lower lobe fused on, six chunky fracture planes, "
                "lichen on its top; materials granite (grey-blue), lichen", paint(2.0, 0.88), splits=lichen(f, 105),
                size=3.0)


def granite_b():
    """Split boulder, ~1.5 m: a broken rounded boulder split in two, one half fallen away."""
    R = rot(0.7)
    f = chunk(111, (0, 0.66, 0), (1.12, 0.96, 0.9), 2.4, R, 5, (0.08, 0.35), (5, 50), (0.03, 0.1), (0.1, 0.55))
    a, b = split_halves(f, (1, -0.12, -0.35), (0.18, 0, 0), lambda y: 0.06 + 0.1 * np.clip(y / 1.5, 0, 1), 0.06, 0.9, 114)
    b = moved(b, toon.rot_z(np.radians(-15)) @ toon.rot_y(0.25), (1.1, 0, 0), (0.18, 0, 0.1))
    a = moved(a, toon.rot_z(np.radians(4)), (-1.0, 0, 0))
    a, b = toon.warp(a, 0.08, 0.4, 115), toon.warp(b, 0.08, 0.4, 115)
    return rock([a, b], GRANITE, "split granite boulder: a broken rounded boulder cracked in two along a jagged plane, the "
                "smaller half fallen away, lichen on top; materials granite, lichen", paint(1.5, 0.88),
                splits=lichen(union([a, b], 0.0), 116), size=2.5)


def granite_c():
    """Flat slab, ~0.6 m: a broad slab tipped up at one end, a stepped fracture across its top, broken edges."""
    R = rot(-0.35, 3, 8)
    f = chunk(121, (0, 0.12, 0), (1.42, 0.5, 0.95), 3.0, R, 5, (0.08, 0.2), (-10, 20), (0.04, 0.12), (0.06, 0.6))
    f = cut(f, [plane((-0.25, 1, 0.1), (-0.65, 0.45, 0), 0.03), plane((0.15, 1, -0.05), (0, 0.62, 0), 0.08)], 0.04, 0.02, 122)
    f = toon.warp(f, 0.08, 0.45, 123)
    return rock([f], GRANITE, "granite slab: a broad slab tipped up at one end, a stepped fracture across its top, "
                "broken edges all round, lichen; materials granite, lichen", paint(0.6, 0.86), splits=lichen(f, 124, 0.05),
                size=2.8)


def granite_d():
    """Tor, ~3 m: four broad rounded blocks stacked off-centre, the second overhanging, vertical joint faces."""
    spec = [((0, 0.42, 0), (1.15, 0.55, 0.95), rot(0.1)), ((0.28, 1.28, 0.1), (1.0, 0.36, 0.78), rot(0.45, 0, 6)),
            ((-0.18, 1.92, -0.08), (0.72, 0.34, 0.64), rot(-0.25, 5, -6)), ((0.2, 2.52, 0.18), (0.5, 0.4, 0.38), rot(1.2, -14, 12))]
    blocks = [lumpy(blob(c, hf, 4.0 if i < 3 else 2.6, R), 0.07, 0.6, 2, 130 + i) for i, (c, hf, R) in enumerate(spec)]
    f = union(blocks, 0.06)
    f = cut(f, [plane((1, 0.06, 0.35), (0.98, 0.6, 0), 0.04), plane((-0.4, 0.15, -1), (0, 1.3, -0.62), 0.05),
                plane((-1, 0.4, 0.25), (-0.6, 2.0, 0), 0.04), plane((0.3, 0.1, 1), (0, 0.4, 0.82), 0.06)], 0.05, 0.03, 131)
    f = toon.warp(f, 0.1, 0.35, 132)
    return rock([f], GRANITE, "granite tor: four broad rounded blocks stacked off-centre, each smaller and turned its own "
                "way, the second overhanging, vertical joint faces, lichen on the ledges; materials granite, lichen",
                paint(3.0, 0.88), splits=lichen(f, 133), size=3.0)


def granite_e():
    """Cluster, ~1.6 m: one big broken boulder and three small ones fused at its foot."""
    R = rot(0.3)
    big = chunk(141, (0, 0.66, 0), (1.0, 0.96, 0.88), 2.3, R, 6, (0.08, 0.36), (0, 50), (0.03, 0.1), (0.09, 0.55))
    small = [chunk(160 + i, c, r, 2.8, rot(1.1 * i + 0.4, 6 * i - 5, 4), 4, (0.15, 0.45), (-5, 50), (0.03, 0.08), (0.04, 1.2))
             for i, (c, r) in enumerate([((1.12, 0.2, 0.42), (0.44, 0.38, 0.4)), ((-0.95, 0.12, 0.62), (0.36, 0.3, 0.34)),
                                         ((0.42, 0.18, -1.0), (0.52, 0.44, 0.42))])]
    f = toon.warp(union([big] + small, 0.06), 0.09, 0.4, 144)
    return rock([f], GRANITE, "granite cluster: one big broken boulder and three small broken boulders fused at its foot, "
                "lichen; materials granite, lichen", paint(1.6, 0.88), splits=lichen(f, 145), budget=CLUSTER, size=3.0)


# ---------------------------------------------------------------- limestone

def lime_a():
    """Weathered rounded block, ~1.2 m: a worn, slightly tapering block, a patchy bedding groove, old breaks."""
    R = rot(0.5)
    f = chunk(201, (0, 0.5, 0), (0.92, 0.74, 0.76), 3.2, R, 6, (0.06, 0.34), (-5, 45), (0.03, 0.1), (0.07, 0.7))
    f = lean(f, 0.06, 0.0, 0.18, 1.2)
    f = strata(f, [(0.62, 0.05, 0.05)], (0.0, 0.0), 206)
    f = toon.warp(f, 0.08, 0.45, 204)
    return rock([f], LIMESTONE, "weathered limestone block: a worn, slightly tapering block with a patchy bedding groove "
                "and six old breaks of mixed depth; material limestone (warm pale)", paint(1.2, 0.86, 0.08, 205),
                size=1.9)


def lime_b():
    """Broken slab, ~0.7 m: a bedded slab tipped up, its high end snapped off jagged, a thinner bed lying on it."""
    a = chunk(211, (0, 0.12, 0), (1.2, 0.3, 0.7), 3.2, rot(0.2, 0, 11), 3, (0.08, 0.2), (-15, 10), (0.05, 0.15), (0.04, 0.8))
    b = chunk(212, (-0.25, 0.44, 0.06), (0.72, 0.14, 0.52), 3.2, rot(0.35, 2, 13), 3, (0.08, 0.25), (-10, 20), (0.05, 0.15),
              (0.03, 1.0))
    f = union([a, b], 0.025)
    f = cut(f, [plane((1, 0.3, 0.45), (0.95, 0.3, 0.1)), plane((1, -0.2, -0.6), (0.92, 0.3, -0.2)),
                plane((0.6, 0.8, 0.1), (0.82, 0.45, 0))], 0.025, 0.02, 213)
    f = toon.warp(f, 0.06, 0.5, 214)
    return rock([f], LIMESTONE, "broken limestone slab: a bedded slab tipped up, its high end snapped off in three jagged "
                "faces, a thinner broken bed lying on it; material limestone", paint(0.7, 0.86, 0.08, 215), size=2.5)


def lime_c():
    """Small pile, ~0.65 m: six broken stones of mixed size heaped, the top one perched."""
    spec = [((-0.3, 0.16, 0.05), (0.4, 0.27, 0.32)), ((0.34, 0.14, 0.2), (0.36, 0.23, 0.3)), ((0.05, 0.12, -0.4), (0.32, 0.21, 0.27)),
            ((0.66, 0.1, -0.26), (0.23, 0.16, 0.21)), ((-0.72, 0.09, -0.32), (0.21, 0.14, 0.19)), ((0.0, 0.45, -0.02), (0.31, 0.21, 0.26))]
    stones = [chunk(220 + i, c, r, 3.0, rot(1.3 * i, 9 * ((i % 3) - 1), 7 * ((i % 2) * 2 - 1)), 4, (0.08, 0.4), (-10, 55),
                    (0.03, 0.1), (0.025, 2.0)) for i, (c, r) in enumerate(spec)]
    f = toon.warp(union(stones, 0.03), 0.04, 0.8, 221)
    return rock([f], LIMESTONE, "limestone pile: six broken stones of mixed size heaped, the top one perched; material "
                "limestone", paint(0.65, 0.84, 0.06, 222), budget=CLUSTER, size=1.7)


def lime_d():
    """Cluster, ~1.5 m: a tall weathered block with three smaller blocks fused round its foot."""
    R = rot(-0.4, 0, 3)
    big = chunk(251, (0, 0.66, 0), (0.78, 0.88, 0.64), 3.2, R, 5, (0.08, 0.35), (-5, 45), (0.03, 0.08), (0.06, 0.7))
    big = strata(big, [(0.55, 0.04, 0.05), (1.05, 0.05, 0.05)], (0.0, 0.0), 256)
    small = [chunk(270 + i, c, hf, 3.2, rot(0.9 * i + 0.2, 5 - 6 * i, 6), 4, (0.12, 0.4), (-5, 50), (0.03, 0.08), (0.03, 1.2))
             for i, (c, hf) in enumerate([((0.95, 0.22, 0.32), (0.44, 0.34, 0.38)), ((-0.85, 0.16, 0.46), (0.36, 0.27, 0.31)),
                                          ((0.1, 0.12, -0.88), (0.42, 0.23, 0.31))])]
    f = toon.warp(union([big] + small, 0.045), 0.07, 0.45, 254)
    return rock([f], LIMESTONE, "limestone cluster: a tall weathered block with bedding grooves and broken faces, three "
                "smaller blocks fused round its foot; material limestone", paint(1.5, 0.86, 0.08, 255), budget=CLUSTER,
                size=2.4)


MODELS = {"rock-sand-a": sand_a, "rock-sand-b": sand_b, "rock-sand-c": sand_c, "rock-sand-d": sand_d, "rock-sand-e": sand_e,
          "rock-sand-f": sand_f, "rock-granite-a": granite_a, "rock-granite-b": granite_b, "rock-granite-c": granite_c,
          "rock-granite-d": granite_d, "rock-granite-e": granite_e, "rock-lime-a": lime_a, "rock-lime-b": lime_b,
          "rock-lime-c": lime_c, "rock-lime-d": lime_d}
SETS = {"desert": ["rock-sand-a", "rock-sand-b", "rock-sand-c", "rock-sand-d", "rock-sand-e", "rock-sand-f"],
        "granite": ["rock-granite-a", "rock-granite-b", "rock-granite-c", "rock-granite-d", "rock-granite-e"],
        "limestone": ["rock-lime-a", "rock-lime-b", "rock-lime-c", "rock-lime-d"]}
