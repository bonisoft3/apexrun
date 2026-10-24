"""Cartoon vegetation: conifers, broadleaf trees, shrubs, fern, grass tufts and coconut palms as smooth closed shapes
and solid leaf geometry, coloured per vertex (height gradient x baked AO).

usage: plants.py [id ...]   -> work/build/<id>_lod{0,1,2}.glb + work/build/<id>.json
Each builder takes a LOD (0 full, 1 about a quarter, 2 about 7 %) and returns (parts, materials, note).
Frame: Y up, metres, origin on the ground at the trunk / clump centre."""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import kit
from kit import Part, ramp, smoothstep
from mats import pbr, srgb

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
UP = np.array([0, 1.0, 0])


def foliage(hexc, rough=0.8, double=False, name="foliage"):
    return pbr(name, srgb(hexc), 0.0, rough, double=double)


def vnoise(P, seed):
    """Value noise on 3D points, 0..1, smooth between unit lattice points."""
    i = np.floor(P)
    f = P - i
    f = f * f * (3 - 2 * f)

    def h(c):
        return np.modf(np.sin((i + c) @ np.array([127.1, 311.7, 74.7]) + seed) * 43758.5453)[0] % 1.0

    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                out = out + w * h(np.array([dx, dy, dz], float))
    return out


# Leaf masses (DESIGN.md "Ghibli gouache"): each canopy is pushed out and in
# along its normals by three octaves of noise, masses about a third of its
# size across and LEAF_LUMP of its size high, as a painter blocks foliage.
LEAF_LUMP = 0.055
LEAF_ACROSS = 3.0


def leaf_masses(part, seed):
    """`part` with a skin of painted leaf masses, sized to its own extent."""
    size = (part.V.max(0) - part.V.min(0)).max()
    P = part.V * (LEAF_ACROSS / size)
    n = 0.6 * vnoise(P, seed) + 0.3 * vnoise(P * 2.1, seed + 1) + 0.1 * vnoise(P * 4.3, seed + 2)
    part.V = part.V + kit.normals(part.V, part.F) * (LEAF_LUMP * size * 2 * (n - 0.5))[:, None]
    return part


def height_ramp(y0, y1, stops):
    r = ramp(stops)
    return lambda V: r((V[:, 1] - y0) / (y1 - y0))


CANOPY = [(0.0, (0.42, 0.58, 0.72)), (0.45, (0.74, 0.86, 0.86)), (1.0, (1.08, 1.04, 0.78))]
BARK_RAMP = [(0.0, (0.72, 0.72, 0.75)), (1.0, (1.0, 1.0, 1.0))]


def trunk_part(C, r, segs, y_top, mat="bark"):
    V, F = kit.tube(C, r, segs, cap0="flat", cap1="dome")
    return Part(mat, V, F, height_ramp(0, y_top, BARK_RAMP))


# ---------------------------------------------------------------- conifers

CONIFERS = {
    "tree-fir-a": dict(H=18.9, W=3.0, tiers=7, h0=1.3, trunk_r=0.32, colour="#2f7d48", seed=3, lobes=(9, 8, 8, 7, 7, 6, 5)),
    "tree-fir-b": dict(H=14.05, W=2.7, tiers=6, h0=1.0, trunk_r=0.28, colour="#3a8a4e", seed=5, lobes=(8, 8, 7, 7, 6, 5)),
    "tree-pine-young": dict(H=1.3, W=0.41, tiers=3, h0=0.1, trunk_r=0.035, colour="#6cbb66", seed=7, lobes=(6, 6, 5)),
}
TIER_PROFILE = [(0, 0.3), (0.5, 0.15), (0.86, 0.0), (1.0, 0.05), (0.95, 0.15), (0.62, 0.43), (0.3, 0.76), (0.08, 0.96), (0, 1.0)]


def conifer(name, lod):
    """Stacked rounded cone tiers with a scalloped, slightly drooping skirt on a tapered trunk."""
    p = CONIFERS[name]
    rng = np.random.default_rng(p["seed"])
    H, W, n, h0 = p["H"], p["W"], p["tiers"], p["h0"]
    segs, prof_n = ((34, 13), (16, 8), (11, 7))[lod]
    tiers = list(range(n)) if lod < 2 else [0, n - 1]
    parts = []
    span = (H - h0) * 0.8
    for i in range(n):
        f0 = i / n
        yb = h0 + span * f0
        yt = H if i == n - 1 else yb + span / n * 1.9
        R = W * (1 - 0.72 * f0)
        if lod == 2 and i == 0:
            yt = h0 + span * (n - 1) / n + (H - h0 - span * (n - 1) / n) * 0.25
        if i not in tiers:
            continue
        h = yt - yb
        prof = np.array([(r * R, yb + y * h) for r, y in TIER_PROFILE])
        prof = kit.resample(kit.chaikin(prof, 3), prof_n)
        k = p["lobes"][i] if lod < 2 else 5
        ph = rng.uniform(0, 2 * np.pi)
        amp = (0.08, 0.06, 0.0)[lod]

        def mod(th, s, r, y, R=R, h=h, k=k, ph=ph, amp=amp):
            w = smoothstep(0.55, 1.0, r / R)
            c = np.cos(k * th + ph)
            return r * (1 + amp * c * w), y - 0.06 * h * w * (0.5 + 0.5 * c) * (amp > 0)
        V, F = kit.revolve(prof, segs, mod)
        g = height_ramp(h0, H, CANOPY)
        part = Part("foliage", V, F, lambda V, g=g, yb=yb, h=h: g(V) * (0.8 + 0.2 * smoothstep(yb, yb + 0.5 * h, V[:, 1]))[:, None])
        parts.append(leaf_masses(part, p["seed"] + i))
    ty = h0 + span * 0.85
    t = np.linspace(0, 1, (8, 4, 2)[lod])
    C = np.stack([0 * t, t * ty, 0 * t], 1)
    r = p["trunk_r"] * (1 - 0.75 * t) * (1 + 0.5 * np.exp(-t * 14))
    parts.append(trunk_part(C, r, (10, 6, 5)[lod], ty))
    mats = [foliage(p["colour"]), pbr("bark", srgb("#6e4a30"), 0.0, 0.9)]
    return parts, mats, f"alpine conifer, {n} rounded tiers (LOD2: 2), closed shells, painted leaf masses"


# ---------------------------------------------------------------- broadleaf

def cloud_lobes(rng, centre, shell, core, count, r):
    """A core lobe and `count` puffs spread evenly over an ellipsoid shell."""
    D, _ = kit.fib_sphere(count)
    c = np.asarray(centre, float)
    out = [(c, core)]
    for d in D:
        d = d + rng.normal(0, 0.08, 3)
        d /= np.linalg.norm(d)
        out.append((c + d * shell, rng.uniform(*r)))
    return out


BROADLEAF = {
    "tree-broadleaf-a": dict(seed=21, colour="#72bd3f", centre=(0, 3.2, 0), shell=(1.55, 1.05, 1.55), core=1.45, puffs=18,
                             r=(0.58, 0.78), k=0.16, trunk=[[0, 0, 0], [0.05, 1.0, 0.0], [-0.08, 1.9, 0.05], [0.0, 2.9, 0.0]],
                             branches=[([0, 1.9, 0], [0.9, 2.7, 0.5]), ([0, 2.1, 0], [-0.8, 2.8, -0.6]), ([0, 2.2, 0], [0.2, 3.0, -0.9])]),
    "tree-broadleaf-b": dict(seed=29, colour="#62b043", centre=(0.15, 2.95, 0.75), shell=(1.0, 1.05, 1.45), core=1.15, puffs=16,
                             r=(0.5, 0.68), k=0.15, trunk=[[0, 0, 0], [0.0, 0.9, 0.15], [0.12, 1.6, 0.55], [0.15, 2.5, 0.75]],
                             branches=[([0.08, 1.5, 0.45], [0.75, 2.3, 0.9]), ([0.1, 1.6, 0.5], [-0.5, 2.4, 1.5])]),
}
LEAFY = [(0.0, (0.44, 0.6, 0.72)), (0.5, (0.78, 0.88, 0.84)), (1.0, (1.08, 1.04, 0.78))]


def broadleaf(name, lod):
    """A cloud of puffy lobes, smooth-blended into one closed canopy, on a curved trunk with a few branches."""
    p = BROADLEAF[name]
    rng = np.random.default_rng(p["seed"])
    lobes = cloud_lobes(rng, p["centre"], np.array(p["shell"]), p["core"], p["puffs"], p["r"])
    sdf = kit.lobes_sdf(lobes, p["k"] * (1, 1.4, 2.6)[lod])
    V, F = kit.blob(sdf, p["centre"], (1650, 460, 120)[lod], relax=(6, 6, 4)[lod])
    y0, y1 = V[:, 1].min(), V[:, 1].max()
    parts = [leaf_masses(Part("foliage", V, F, height_ramp(y0, y1, LEAFY)), p["seed"])]
    t = np.linspace(0, 1, (10, 5, 3)[lod])
    C = kit.bezier(p["trunk"], t)
    r = 0.2 * (1 - 0.5 * t) * (1 + 0.55 * np.exp(-t * 10))
    parts.append(trunk_part(C, r, (10, 6, 5)[lod], y1))
    if lod < 2:
        for a, b in p["branches"]:
            a, b = np.array(a, float), np.array(b, float)
            tb = np.linspace(0, 1, (5, 3)[lod])
            Cb = kit.bezier([a, a + (b - a) * 0.4 + [0, 0.25, 0], b], tb)
            parts.append(trunk_part(Cb, 0.09 * (1 - 0.5 * tb), (7, 5)[lod], y1))
    mats = [foliage(p["colour"]), pbr("bark", srgb("#7a5536"), 0.0, 0.9)]
    return parts, mats, "deciduous tree, one closed canopy of smooth-blended puffs (soft crevices carry the AO), painted leaf masses"


# ---------------------------------------------------------------- shrubs

# rings of puffs: (count, ring radius, height, puff radius); core lobe fills the middle
SHRUBS = {
    "shrub-b": dict(seed=41, colour="#62b146", centre=(0, 0.72, 0), core=0.52, k=0.09, n=720,
                    rings=[(6, 0.5, 0.42, 0.38), (4, 0.32, 0.9, 0.37), (1, 0.0, 1.2, 0.46)]),
    "shrub-tropical": dict(seed=43, colour="#3aa852", centre=(0, 0.5, 0), core=0.4, k=0.08, n=480,
                           rings=[(5, 0.38, 0.32, 0.31), (3, 0.2, 0.66, 0.31)]),
    "shrub-desert": dict(seed=47, colour="#a3b072", centre=(0, 0.21, 0), core=0.24, k=0.05, n=720,
                         rings=[(5, 0.21, 0.15, 0.17), (2, 0.1, 0.33, 0.17)]),
}


def shrub(name, lod):
    """A few puffy lobes blended into one closed mound, flattened onto the ground (tropical: plus broad leaves)."""
    p = SHRUBS[name]
    rng = np.random.default_rng(p["seed"])
    lobes = [(np.array(p["centre"], float), p["core"])]
    for count, R, y, r in p["rings"]:
        a0 = rng.uniform(0, 2 * np.pi)
        for k in range(count):
            a = a0 + 2 * np.pi * k / count + rng.normal(0, 0.12)
            lobes.append((np.array([R * np.cos(a), y + rng.normal(0, 0.03) * r, R * np.sin(a)]), r * rng.uniform(0.92, 1.08)))
    foot = p["rings"][0][1] + 0.3 * p["rings"][0][3]
    lobes.append((np.array([0, 0.3 * foot, 0]), foot))  # a broad base the floor flattens
    sdf = kit.lobes_sdf(lobes, p["k"] * (1, 1.4, 2.6)[lod], floor=0.0)
    n = (p["n"], p["n"] * 2 // 7, 56)[lod]
    V, F = kit.blob(sdf, p["centre"], n, relax=(6, 6, 4)[lod])
    V[:, 1] = np.maximum(V[:, 1], 0.0)
    y1 = V[:, 1].max()
    mound = leaf_masses(Part("foliage", V, F, height_ramp(0, y1, LEAFY)), p["seed"])
    mound.V[:, 1] = np.maximum(mound.V[:, 1], 0.0)
    parts = [mound]
    mats = [foliage(p["colour"])]
    if name == "shrub-tropical" and lod < 2:
        rows = (10, 5)[lod]
        for j in range(8):
            az = j * 2 * np.pi / 8 + rng.normal(0, 0.15)
            d = np.array([np.cos(az), 0, np.sin(az)])
            tall = j % 2 == 0
            L, rise = (rng.uniform(0.7, 0.85), 2.25) if tall else (rng.uniform(0.85, 1.0), 1.5)
            base = d * 0.1 + [0, 0.3, 0]
            C = kit.bezier([base, base + d * 0.1 + UP * rise * 0.55, base + d * L * 0.7 + UP * (rise - 0.3) * 0.95,
                            base + d * L + UP * (rise - 0.3) * 0.62], np.linspace(0, 1, rows))
            Vl, Fl, tv, av = kit.ribbon(C, UP, lambda t: 0.17 * np.sin(np.pi * np.clip(t, 0, 1) ** 0.6) + 0.008, [-1, 0, 1], fold=0.3)
            parts.append(Part("leaf", Vl, Fl, ramp([(0, (0.5, 0.6, 0.62)), (1, (1.0, 1.0, 0.88))])(tv) * (0.88 + 0.12 * np.abs(av))[:, None]))
        mats.append(foliage("#3fb055", 0.7, double=True, name="leaf"))
    note = {"shrub-b": "temperate shrub", "shrub-tropical": "tropical shrub, lobed mound under eight broad arching leaves "
            "(LOD2: mound only)", "shrub-desert": "low sage-green desert scrub"}[name]
    return parts, mats, note + ", closed blob mound, painted leaf masses"


# ---------------------------------------------------------------- fern and grass

def fern(name, lod):
    """Arching solid fronds radiating from a crown; serrated edges read as pinnae."""
    rng = np.random.default_rng(61)
    count, rows, cols = ((9, 31, [-1, 0, 1]), (9, 8, [-1, 0, 1]), (6, 4, [-1, 0, 1]))[lod]
    parts = []
    for j in range(count):
        az = j * 2 * np.pi / count + rng.normal(0, 0.12)
        d = np.array([np.cos(az), 0, np.sin(az)])
        inner = j % 3 == 0
        L = rng.uniform(0.52, 0.6) * (0.8 if inner else 1.0)
        rise = 0.5 if inner else 0.4
        base = d * 0.03
        C = kit.bezier([base, base + d * L * 0.25 + UP * rise * 0.85, base + d * L * 0.75 + UP * rise * 1.0,
                        base + d * L * 1.02 + UP * rise * 0.25], np.linspace(0, 1, rows))
        width = lambda t: 0.12 * np.sin(np.pi * np.clip(t, 0, 1) ** 0.6) ** 0.8 * (1 - 0.3 * t) + 0.004
        serr = (lambda t, i: 1.0 if (i % 2 or t < 0.08) else 0.35) if lod == 0 else None
        Vl, Fl, tv, av = kit.ribbon(C, UP, width, cols, fold=0.25, serr=serr, slant=1.0)
        col = ramp([(0, (0.45, 0.55, 0.58)), (0.6, (0.86, 0.92, 0.84)), (1, (1.0, 1.0, 0.86))])(tv) * (0.84 + 0.16 * np.abs(av))[:, None]
        parts.append(Part("frond", Vl, Fl, col))
    mats = [foliage("#5cb43e", 0.75, double=True, name="frond")]
    return parts, mats, "fern: arching solid fronds (double-sided `frond`), serrated at LOD0"


GRASS = {
    "grass-tuft": dict(seed=71, colour="#78bb46", blades=(13, 8, 4), h=(0.26, 0.36), lean=(0.08, 0.2), spread=0.06, w=0.04, ax=(1, 1)),
    "grass-beach": dict(seed=73, colour="#a9b95e", blades=(11, 7, 4), h=(0.13, 0.2), lean=(0.1, 0.17), spread=0.05, w=0.026, ax=(1, 0.45)),
}


def grass(name, lod):
    """A handful of chunky curved blades, V-folded, tapering to a point."""
    p = GRASS[name]
    rng = np.random.default_rng(p["seed"])
    n = p["blades"][lod]
    rows, cols = ((6, [-1, 0, 1]), (3, [-1, 0, 1]), (3, [-1, 1]))[lod]
    parts = []
    for j in range(n):
        az = j * 2.399 + rng.normal(0, 0.2)
        d = np.array([np.cos(az) * p["ax"][0], 0, np.sin(az) * p["ax"][1]])
        dn = d / np.linalg.norm(d)
        base = d * rng.uniform(0.2, 1.0) * p["spread"]
        h = rng.uniform(*p["h"]) * (1.0 if j < max(3, n // 2) else 0.85)
        lean = rng.uniform(*p["lean"])
        C = kit.bezier([base, base + UP * h * 0.5 + dn * lean * 0.1, base + dn * lean * 0.55 + UP * h * 1.0, base + dn * lean * 1.25 + UP * h * 0.8],
                       np.linspace(0, 1, rows))
        C[:, 1] = np.maximum(C[:, 1], 0)
        width = lambda t: p["w"] * (1 - t) ** 0.8 * (1 + 0.25 * np.sin(np.pi * t))
        Vl, Fl, tv, av = kit.ribbon(C, UP if abs(dn[1]) < 0.9 else [1, 0, 0], width, cols, fold=0.35)
        col = ramp([(0, (0.45, 0.55, 0.55)), (1, (1.0, 1.0, 0.85))])(tv)
        parts.append(Part("grass", Vl, Fl, col))
    mats = [foliage(p["colour"], 0.8, double=True, name="grass")]
    return parts, mats, "grass tuft: chunky V-folded blades (double-sided `grass`)"


# ---------------------------------------------------------------- palms

PALMS = {  # trunk height, lean and bow (m) and seed as apps/apexrun/assets/tools/scripts/palm.py
    "palm-a": dict(height=13.0, lean=1.6, bow=0.7, fronds=13, dead=2, nuts=4, seed=11),
    "palm-b": dict(height=15.0, lean=2.4, bow=1.1, fronds=12, dead=2, nuts=3, seed=23),
    "palm-c": dict(height=11.0, lean=0.9, bow=0.4, fronds=13, dead=2, nuts=5, seed=37),
}


def palm(name, lod):
    """Coconut palm: banded tapered trunk swept along palm.py's leaning bow, solid notched fronds, a crown bulb and
    coconuts."""
    v = PALMS[name]
    rng = np.random.default_rng(v["seed"])
    H = v["height"]
    yaw = rng.uniform(0, 2 * np.pi)  # palm.py's first draw: the same lean direction
    d = np.array([np.cos(yaw), 0, np.sin(yaw)])
    P = [np.zeros(3), np.array([0, H * 0.33, 0]) + d * (v["bow"] * 0.2),
         np.array([0, H * 0.66, 0]) + d * (v["lean"] * 0.55 + v["bow"]), np.array([0, H, 0]) + d * v["lean"]]
    rings = (72, 26, 7)[lod]
    t = np.linspace(0, 1, rings)
    C = kit.bezier(P, t)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(C, axis=0), axis=1))])
    period = s[-1] / round(s[-1] / 0.55)
    u = (s / period) % 1.0
    band = np.sin(np.pi * u ** 1.5) ** 2
    r = (0.17 + 0.11 * np.exp(-t * 9)) * (1 + (0.12 * band if lod == 0 else 0))
    top, T = C[-1], kit.rmf(C)[0][-1]
    Vt, Ft = kit.tube(C, r, (11, 7, 5)[lod], cap0="flat", cap1="dome")
    # per-vertex band shade: nearest centreline sample
    near = np.argmin(np.linalg.norm(Vt[:, None] - C[None], axis=2), axis=1)
    shade = (0.7 + 0.3 * band[near]) if lod == 0 else np.ones(len(Vt))
    grad = 0.78 + 0.22 * smoothstep(0, H * 0.7, Vt[:, 1])
    parts = [Part("bark", Vt, Ft, np.stack([shade * grad] * 3, 1))]
    # crown bulb
    rb = r[-1] * 1.7
    bulb = np.array([(np.sin(a) * rb, -np.cos(a) * rb * 1.2) for a in np.linspace(0, np.pi, (8, 5, 4)[lod])])
    Vb, Fb = kit.revolve(bulb, (12, 7, 5)[lod])
    R = _align(UP, T)
    Vb = Vb @ R.T + top - T * rb * 0.3
    parts.append(Part("bark", Vb, Fb, np.full((len(Vb), 3), 0.72)))
    # fronds
    rows, cols = ((17, [-1, -0.5, 0, 0.5, 1]), (9, [-1, 0, 1]), (5, [-1, 0, 1]))[lod]
    golden = np.pi * (3 - np.sqrt(5))
    total = v["fronds"] + (v["dead"] if lod < 2 else 0)
    nf = v["fronds"] if lod < 2 else 8
    for f in range(nf + (total - v["fronds"])):
        dead = f >= nf
        az = f * golden * (1 if not dead else 1.3) + rng.normal(0, 0.1)
        elev = rng.uniform(0.3, 0.8) if not dead else rng.uniform(-1.1, -0.8)
        o = np.array([np.cos(az) * np.cos(elev), np.sin(elev), np.sin(az) * np.cos(elev)])
        oh = np.array([o[0], 0, o[2]]); oh /= np.linalg.norm(oh)
        L = rng.uniform(4.6, 5.6) if not dead else rng.uniform(2.2, 2.7)
        droop = rng.uniform(0.75, 1.25) if not dead else 0.15
        base = top + o * r[-1] * 0.5
        if not dead:
            Cf = kit.bezier([base, base + o * L * 0.42 + UP * L * 0.26, base + oh * L * 0.82 + UP * L * (0.2 - 0.22 * droop),
                             base + oh * L * 1.02 - UP * L * (0.04 + 0.3 * droop)], np.linspace(0, 1, rows))
        else:
            Cf = kit.bezier([base, base + o * L * 0.45, base + o * L * 0.8 + oh * 0.3, base + o * L + oh * 0.25 - UP * 0.2],
                            np.linspace(0, 1, rows))
        Wmax = rng.uniform(0.62, 0.72) * (1 if not dead else 0.4)
        width = lambda t, Wmax=Wmax: Wmax * (0.12 + 0.88 * smoothstep(0.0, 0.22, t)) * (1 - t) ** 0.7 + 0.01
        serr = (lambda t, i: 1.0 if (i % 2 or t < 0.12) else 0.45) if lod == 0 and not dead else None
        Vf, Ff, tv, av = kit.ribbon(Cf, UP, width, cols, fold=0.32, serr=serr, twist=0.0 if dead else rng.normal(0, 0.2), slant=0.9)
        Vf[:, 1] = np.maximum(Vf[:, 1], 0.02)
        col = ramp([(0, (0.42, 0.56, 0.62)), (0.35, (0.8, 0.9, 0.84)), (1, (1.08, 1.04, 0.8))])(tv) * (0.86 + 0.14 * np.abs(av))[:, None]
        parts.append(Part("frond_dry" if dead else "frond", Vf, Ff, col))
    if lod < 2:
        for k in range(v["nuts"] if lod == 0 else 3):
            a = k * 2.4 + rng.normal(0, 0.2)
            rn = rng.uniform(0.15, 0.18)
            cpos = top - T * rng.uniform(0.25, 0.45) + np.array([np.cos(a), 0, np.sin(a)]) * (r[-1] + rn * 0.8)
            prof = np.array([(np.sin(q) * rn, -np.cos(q) * rn * 1.12) for q in np.linspace(0, np.pi, (7, 5)[lod])])
            Vn, Fn = kit.revolve(prof, (10, 6)[lod])
            parts.append(Part("coconut", Vn + cpos, Fn))
    mats = [pbr("bark", srgb("#a8784c"), 0.0, 0.9), foliage("#3f9a3a", 0.7, double=True, name="frond"),
            foliage("#a48a4e", 0.85, double=True, name="frond_dry"), pbr("coconut", srgb("#6e4b2a"), 0.0, 0.6)]
    return parts, mats, (f"coconut palm (palm.py's trunk curve: height {H} m, lean {v['lean']} m, bow {v['bow']} m); origin at the "
                         "trunk foot; double-sided `frond` / `frond_dry` (LOD2: 8 fronds, no coconuts or dry fronds)")


def _align(a, b):
    """Rotation taking unit a to unit b."""
    a, b = a / np.linalg.norm(a), b / np.linalg.norm(b)
    v = np.cross(a, b); c = a @ b
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3)
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K / (1 + c)


BUILDERS = {**{k: conifer for k in CONIFERS}, **{k: broadleaf for k in BROADLEAF}, **{k: shrub for k in SHRUBS},
            "fern": fern, **{k: grass for k in GRASS}, **{k: palm for k in PALMS}}


# Clumps whose LOD0 footprint is centred on the origin (the trees and palms stand on their trunk foot).
CENTRED = set(SHRUBS) | set(GRASS) | {"fern"}


def build_all(names):
    os.makedirs(f"{ROOT}/work/build", exist_ok=True)
    for name in names:
        rec = {"name": name, "lods": []}
        shift = None
        for lod in (0, 1, 2):
            parts, mats, note = BUILDERS[name](name, lod)
            if name in CENTRED:
                if shift is None:
                    V = np.vstack([p.V for p in parts])
                    shift = -(V.min(0) + V.max(0)) / 2 * [1, 0, 1]
                for p in parts:
                    p.V = p.V + shift
            path = f"{ROOT}/work/build/{name}_lod{lod}.glb"
            size, tris, bounds = kit.write(path, name, parts, mats)
            used = [m["name"] for m in mats if any(p.mat == m["name"] for p in parts)]
            rec["lods"].append(dict(lod=lod, path=os.path.relpath(path, ROOT), tris=int(tris), bytes=size, bounds_m=bounds,
                                    nodes=[name], materials=used))
            rec["note"] = note
            print(name, lod, tris, size, np.round(bounds, 2).tolist(), flush=True)
        json.dump(rec, open(f"{ROOT}/work/build/{name}.json", "w"), indent=1)


if __name__ == "__main__":
    build_all(sys.argv[1:] or list(BUILDERS))
