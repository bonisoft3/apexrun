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


def trunk_part(C, r, segs, y_top, mat="bark", ground=True):
    V, F = kit.tube(C, r, segs, cap0="flat", cap1="dome", ground=ground)
    return Part(mat, V, F, height_ramp(0, y_top, BARK_RAMP))


# ---------------------------------------------------------------- conifers

CONIFERS = {
    "tree-fir-a": dict(H=18.9, W=3.0, tiers=7, h0=1.3, trunk_r=0.32, colour="#2f7d48", seed=3, lobes=(9, 8, 8, 7, 7, 6, 5)),
    "tree-fir-b": dict(H=14.05, W=2.7, tiers=6, h0=1.0, trunk_r=0.28, colour="#3a8a4e", seed=5, lobes=(8, 8, 7, 7, 6, 5)),
    "tree-pine-young": dict(H=1.3, W=0.41, tiers=3, h0=0.1, trunk_r=0.035, colour="#6cbb66", seed=7, lobes=(6, 6, 5)),
}
TIER_PROFILE = [(0, 0.3), (0.5, 0.15), (0.86, 0.0), (1.0, 0.05), (0.95, 0.15), (0.62, 0.43), (0.3, 0.76), (0.08, 0.96), (0, 1.0)]


def conifer(name, lod):
    """Stacked rounded cone tiers with a scalloped, overhanging bough skirt on a tapered grounded trunk."""
    p = CONIFERS[name]
    rng = np.random.default_rng(p["seed"])
    H, W, n, h0 = p["H"], p["W"], p["tiers"], p["h0"]
    segs, prof_n = ((38, 15), (18, 9), (11, 7))[lod]
    tiers = list(range(n)) if lod < 2 else [0, n - 1]
    parts = []
    span = (H - h0) * 0.8
    g_ramp = height_ramp(h0, H, CANOPY)
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
        amp = (0.12, 0.08, 0.0)[lod]

        def mod(th, s, r, y, R=R, h=h, k=k, ph=ph, amp=amp):
            w = smoothstep(0.48, 1.0, r / R)
            c = np.cos(k * th + ph) + 0.32 * np.cos(2 * k * th - 0.7 * ph)
            return r * (1 + amp * c * w), y - 0.085 * h * w * (0.5 + 0.5 * c) * (amp > 0)
        V, F = kit.revolve(prof, segs, mod)
        part = Part("foliage", V, F, lambda V, g=g_ramp, yb=yb, h=h: g(V) * (0.76 + 0.24 * smoothstep(yb, yb + 0.52 * h, V[:, 1]))[:, None],
                    dome_centre=[0.0, yb + 0.45 * h, 0.0], dome_radii=[R, 0.65 * h, R], dome_weight=0.35)
        parts.append(leaf_masses(part, p["seed"] + i))
        if lod < 2 and i < n - 1:
            # Overhanging bough fans along the scalloped tier rim
            nbough = k if lod == 0 else max(4, k // 2)
            for jb in range(nbough):
                th_b = (2 * np.pi * jb - ph) / k
                rb = R * 0.86
                cb = np.array([rb * np.sin(th_b), yb + 0.12 * h, rb * np.cos(th_b)])
                nb_dir = np.array([np.sin(th_b) * 0.85, 0.42, np.cos(th_b) * 0.85])
                Vt, Ft = kit.leaf_tuft_shell(cb, nb_dir, R * 0.28, R * 0.22, lobes=5, cup=0.26,
                                             rings=2 if lod == 0 else 1, segs=10 if lod == 0 else 6)
                parts.append(Part("foliage", Vt, Ft, lambda V, g=g_ramp: g(V) * 0.94,
                                  dome_centre=[0.0, yb + 0.45 * h, 0.0], dome_radii=[R, 0.65 * h, R], dome_weight=0.45))
    ty = h0 + span * 0.85
    t = np.linspace(0, 1, (9, 5, 3)[lod])
    C = np.stack([0 * t, -0.06 + t * (ty + 0.06), 0 * t], 1)
    r = p["trunk_r"] * (1 - 0.75 * t) * (1 + 0.6 * np.exp(-t * 12))
    parts.append(trunk_part(C, r, (10, 6, 5)[lod], ty, ground=False))
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
                             r=(0.58, 0.78), k=0.16, trunk=[[0, -0.08, 0], [0.05, 1.0, 0.0], [-0.08, 1.9, 0.05], [0.0, 2.9, 0.0]],
                             branches=[([0, 1.9, 0], [0.9, 2.7, 0.5]), ([0, 2.1, 0], [-0.8, 2.8, -0.6]), ([0, 2.2, 0], [0.2, 3.0, -0.9])]),
    "tree-broadleaf-b": dict(seed=29, colour="#62b043", centre=(0.15, 2.95, 0.75), shell=(1.0, 1.05, 1.45), core=1.15, puffs=16,
                             r=(0.5, 0.68), k=0.15, trunk=[[0, -0.08, 0], [0.0, 0.9, 0.15], [0.12, 1.6, 0.55], [0.15, 2.5, 0.75]],
                             branches=[([0.08, 1.5, 0.45], [0.75, 2.3, 0.9]), ([0.1, 1.6, 0.5], [-0.5, 2.4, 1.5])]),
}
LEAFY = [(0.0, (0.40, 0.56, 0.70)), (0.48, (0.76, 0.88, 0.84)), (1.0, (1.08, 1.04, 0.78))]


def broadleaf(name, lod):
    """A cloud of puffy lobes wrapped in layered 3D gouache leaf-cluster tufts with transferred dome normals, on a curved trunk."""
    p = BROADLEAF[name]
    rng = np.random.default_rng(p["seed"])
    centre = np.array(p["centre"], float)
    shell = np.array(p["shell"], float)
    lobes = cloud_lobes(rng, centre, shell, p["core"], p["puffs"], p["r"])
    sdf = kit.lobes_sdf(lobes, p["k"] * (1, 1.4, 2.6)[lod])
    V, F = kit.blob(sdf, centre, (1450, 420, 120)[lod], relax=(6, 6, 4)[lod])
    y0, y1 = V[:, 1].min(), V[:, 1].max()
    core_ramp = height_ramp(y0, y1, LEAFY)
    # Interior canopy volume darkened slightly so pockets between outer leaf-cluster tufts hold rich shade
    core_part = Part("foliage", V, F, lambda V: core_ramp(V) * 0.86,
                     dome_centre=centre, dome_radii=shell * 1.35, dome_weight=0.55)
    parts = [leaf_masses(core_part, p["seed"])]

    # Outer sculpted 3D gouache leaf-cluster tufts arranged on a Fibonacci dome around the canopy
    ntufts = (34, 14, 0)[lod]
    if ntufts > 0:
        Dt, _ = kit.fib_sphere(ntufts)
        for jt, d in enumerate(Dt):
            if d[1] < -0.58:
                continue
            ray_d = d / np.linalg.norm(d)
            # Project onto the outer canopy surface along ray_d
            ts = np.linspace(0.4, 3.2, 48)
            pts_ray = centre[None, :] + ray_d[None, :] * ts[:, None]
            inside = sdf(pts_ray) < 0.0
            t_surf = ts[len(ts) - 1 - np.argmax(inside[::-1])] if np.any(inside) else 1.25
            c_tuft = centre + ray_d * (t_surf * 0.96)
            n_tuft = ray_d + np.array([rng.normal(0, 0.12), 0.18, rng.normal(0, 0.12)])
            rx = rng.uniform(0.42, 0.56) * (1.0 - 0.15 * max(0.0, -d[1]))
            ry = rx * rng.uniform(0.78, 0.94)
            Vt, Ft = kit.leaf_tuft_shell(c_tuft, n_tuft, rx, ry, lobes=5, cup=0.25,
                                         rings=2 if lod == 0 else 1, segs=10 if lod == 0 else 6)
            shade_t = 0.92 + 0.12 * smoothstep(-0.3, 0.8, d[1])
            parts.append(Part("foliage", Vt, Ft, lambda V, s=shade_t: core_ramp(V) * s,
                              dome_centre=centre, dome_radii=shell * 1.4, dome_weight=0.62))

    t = np.linspace(0, 1, (10, 5, 3)[lod])
    C = kit.bezier(p["trunk"], t)
    r = 0.21 * (1 - 0.5 * t) * (1 + 0.62 * np.exp(-t * 10))
    parts.append(trunk_part(C, r, (10, 6, 5)[lod], y1, ground=False))
    if lod < 2:
        for a, b in p["branches"]:
            a, b = np.array(a, float), np.array(b, float)
            tb = np.linspace(0, 1, (5, 3)[lod])
            Cb = kit.bezier([a, a + (b - a) * 0.4 + [0, 0.25, 0], b], tb)
            parts.append(trunk_part(Cb, 0.095 * (1 - 0.5 * tb), (7, 5)[lod], y1, ground=False))
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
    """Grounded interior core mound wrapped in overlapping 3D gouache leaf-cluster tufts with transferred dome normals."""
    p = SHRUBS[name]
    rng = np.random.default_rng(p["seed"])
    centre = np.array(p["centre"], float)
    lobes = [(centre, p["core"])]
    for count, R, y, r in p["rings"]:
        a0 = rng.uniform(0, 2 * np.pi)
        for k in range(count):
            a = a0 + 2 * np.pi * k / count + rng.normal(0, 0.12)
            lobes.append((np.array([R * np.cos(a), y + rng.normal(0, 0.03) * r, R * np.sin(a)]), r * rng.uniform(0.92, 1.08)))
    foot = p["rings"][0][1] + 0.34 * p["rings"][0][3]
    lobes.append((np.array([0, 0.26 * foot, 0]), foot))
    sdf = kit.lobes_sdf(lobes, p["k"] * (1, 1.4, 2.6)[lod], floor=0.0)
    n = (p["n"], p["n"] * 2 // 7, 56)[lod]
    V, F = kit.blob(sdf, centre, n, relax=(6, 6, 4)[lod])
    V[:, 1] = np.maximum(V[:, 1], 0.0)
    y1 = V[:, 1].max()
    sh_ramp = height_ramp(0, y1, LEAFY)
    dome_r = np.array([foot * 1.15, y1 * 0.75, foot * 1.15])
    mound = leaf_masses(Part("foliage", V, F, lambda V: sh_ramp(V) * 0.84,
                             dome_centre=centre, dome_radii=dome_r, dome_weight=0.60), p["seed"])
    # Flare the lower hemisphere outward and pull the bottom into a grounded root skirt (-0.08 * y1) so it never floats on slopes
    ym = mound.V[:, 1].copy()
    rel_y = np.clip(ym / (0.36 * y1), 0.0, 1.0)
    flare = 1.0 + 0.28 * ((1.0 - rel_y) ** 1.5)
    mound.V[:, 0] *= flare
    mound.V[:, 2] *= flare
    skirt_t = np.clip(1.0 - ym / (0.16 * y1), 0.0, 1.0)
    mound.V[:, 1] = ym - (0.08 * y1) * (skirt_t ** 1.35)
    parts = [mound]

    # Layered 3D gouache leaf-cluster tufts rooted into the mound surface (zero floating leaves)
    ntufts = (28, 12, 0)[lod] if name != "shrub-desert" else (24, 10, 0)[lod]
    if ntufts > 0:
        Dt, _ = kit.fib_sphere(ntufts)
        for jt, d in enumerate(Dt):
            if d[1] < -0.25:
                continue
            ray_d = d / np.linalg.norm(d)
            ts = np.linspace(0.1, 1.8, 40)
            pts_ray = centre[None, :] + ray_d[None, :] * ts[:, None]
            inside = sdf(pts_ray) < 0.0
            t_surf = ts[len(ts) - 1 - np.argmax(inside[::-1])] if np.any(inside) else foot * 0.75
            c_tuft = centre + ray_d * (t_surf * 0.94)
            c_tuft[1] = max(c_tuft[1], 0.14 * y1)
            n_tuft = ray_d + np.array([0.0, 0.24, 0.0])
            scale_t = 0.22 * y1 if name != "shrub-desert" else 0.26 * y1
            rx = scale_t * rng.uniform(0.85, 1.15)
            ry = rx * rng.uniform(0.78, 0.95)
            Vt, Ft = kit.leaf_tuft_shell(c_tuft, n_tuft, rx, ry, lobes=5, cup=0.24,
                                         rings=2 if lod == 0 else 1, segs=10 if lod == 0 else 6)
            Vt[:, 1] = np.maximum(Vt[:, 1], -0.02)
            shade_t = 0.92 + 0.14 * smoothstep(0.0, 0.85, d[1])
            parts.append(Part("foliage", Vt, Ft, lambda V, s=shade_t: sh_ramp(V) * s,
                              dome_centre=centre, dome_radii=dome_r, dome_weight=0.65))

    mats = [foliage(p["colour"])]
    if name == "shrub-tropical" and lod < 2:
        rows = (15, 7)[lod]
        cols = [-1.0, -0.45, 0.0, 0.45, 1.0] if lod == 0 else [-1.0, 0.0, 1.0]
        for j in range(10 if lod == 0 else 8):
            az = j * 2 * np.pi / (10 if lod == 0 else 8) + rng.normal(0, 0.12)
            d = np.array([np.cos(az), 0, np.sin(az)])
            tall = j % 2 == 0
            L = rng.uniform(0.68, 0.82) if tall else rng.uniform(0.78, 0.92)
            rise = rng.uniform(0.95, 1.12) if tall else rng.uniform(0.68, 0.82)
            # Root petiole deep inside the grounded bush core at y = -0.05m so leaves never float
            base = d * 0.05 + np.array([0.0, -0.05, 0.0])
            C = kit.bezier([base,
                            base + d * (L * 0.18) + UP * (rise * 0.58),
                            base + d * (L * 0.68) + UP * (rise * 0.92),
                            base + d * L + UP * (rise * 0.48)], np.linspace(0, 1, rows))
            # 3D petiole stem along lower 65% of the leaf
            if lod == 0:
                Vp, Fp = kit.tube(C[:10], 0.028 * (1.0 - 0.65 * np.linspace(0, 1, 10)), 5, cap0="flat", cap1="dome", ground=False)
                parts.append(Part("leaf", Vp, Fp, np.full((len(Vp), 3), 0.58)))
            serr = (lambda t, i: 1.0 if (i % 3 != 0 or t < 0.22) else 0.58) if lod == 0 else None
            Vl, Fl, tv, av = kit.ribbon(C, UP, lambda t: 0.18 * np.sin(np.pi * np.clip(t, 0, 1) ** 0.58) + 0.012,
                                        cols, fold=0.32, serr=serr, slant=0.65, droop_edge=0.18)
            parts.append(Part("leaf", Vl, Fl, ramp([(0, (0.45, 0.58, 0.60)), (1, (1.02, 1.0, 0.86))])(tv) * (0.86 + 0.14 * np.abs(av))[:, None],
                              dome_centre=centre, dome_radii=dome_r * 1.2, dome_weight=0.38))
        mats.append(foliage("#3fb055", 0.7, double=True, name="leaf"))
    note = {"shrub-b": "temperate shrub", "shrub-tropical": "tropical shrub, lobed mound under eight broad arching leaves "
            "(LOD2: mound only)", "shrub-desert": "low sage-green desert scrub"}[name]
    return parts, mats, note + ", closed blob mound, painted leaf masses"


# ---------------------------------------------------------------- fern and grass

def fern(name, lod):
    """Arching solid fronds with deeply separated pinnae radiating from a grounded basal crown."""
    rng = np.random.default_rng(61)
    count, rows, cols = ((11, 37, [-1, -0.45, 0, 0.45, 1]), (9, 11, [-1, 0, 1]), (6, 4, [-1, 0, 1]))[lod]
    parts = []
    # Grounded basal root crown so fronds emerge from soil
    crown_prof = np.array([(np.sin(a) * 0.14, -0.04 + 0.08 * np.sin(a * 0.5)) for a in np.linspace(0, np.pi, 5)])
    Vc, Fc = kit.revolve(crown_prof, (10, 6, 5)[lod])
    parts.append(Part("frond", Vc, Fc, np.full((len(Vc), 3), 0.44)))
    for j in range(count):
        az = j * 2 * np.pi / count + rng.normal(0, 0.11)
        d = np.array([np.cos(az), 0, np.sin(az)])
        inner = j % 3 == 0
        L = rng.uniform(0.54, 0.62) * (0.78 if inner else 1.0)
        rise = 0.52 if inner else 0.40
        base = d * 0.025 + np.array([0.0, -0.035, 0.0])
        C = kit.bezier([base, base + d * L * 0.24 + UP * rise * 0.88, base + d * L * 0.74 + UP * rise * 1.02,
                        base + d * L * 1.02 + UP * rise * 0.22], np.linspace(0, 1, rows))
        width = lambda t: 0.13 * np.sin(np.pi * np.clip(t, 0, 1) ** 0.58) ** 0.78 * (1 - 0.28 * t) + 0.005
        serr = (lambda t, i: 1.0 if (i % 2 or t < 0.08) else 0.18) if lod < 2 else None
        Vl, Fl, tv, av = kit.ribbon(C, UP, width, cols, fold=0.28, serr=serr, slant=1.15, droop_edge=0.20)
        col = ramp([(0, (0.42, 0.54, 0.56)), (0.6, (0.86, 0.92, 0.84)), (1, (1.02, 1.0, 0.86))])(tv) * (0.82 + 0.18 * np.abs(av))[:, None]
        parts.append(Part("frond", Vl, Fl, col, dome_centre=[0.0, 0.22, 0.0], dome_radii=[0.5, 0.35, 0.5], dome_weight=0.35))
    mats = [foliage("#5cb43e", 0.75, double=True, name="frond")]
    return parts, mats, "fern: arching solid fronds (double-sided `frond`), serrated at LOD0"


GRASS = {
    "grass-tuft": dict(seed=71, colour="#78bb46", blades=(15, 9, 4), h=(0.26, 0.36), lean=(0.08, 0.2), spread=0.06, w=0.042, ax=(1, 1)),
    "grass-beach": dict(seed=73, colour="#a9b95e", blades=(13, 8, 4), h=(0.13, 0.2), lean=(0.1, 0.17), spread=0.05, w=0.028, ax=(1, 0.45)),
}


def grass(name, lod):
    """A handful of chunky curved blades, V-folded, tapering to a point from a grounded basal crown."""
    p = GRASS[name]
    rng = np.random.default_rng(p["seed"])
    n = p["blades"][lod]
    rows, cols = ((7, [-1, 0, 1]), (4, [-1, 0, 1]), (3, [-1, 1]))[lod]
    parts = []
    crown_prof = np.array([(np.sin(a) * 0.075, -0.035 + 0.06 * np.sin(a * 0.5)) for a in np.linspace(0, np.pi, 5)])
    Vc, Fc = kit.revolve(crown_prof, (8, 6, 4)[lod])
    parts.append(Part("grass", Vc, Fc, np.full((len(Vc), 3), 0.48)))
    for j in range(n):
        az = j * 2.399 + rng.normal(0, 0.2)
        d = np.array([np.cos(az) * p["ax"][0], 0, np.sin(az) * p["ax"][1]])
        dn = d / np.linalg.norm(d)
        base = d * rng.uniform(0.2, 1.0) * p["spread"] + np.array([0.0, -0.03, 0.0])
        h = rng.uniform(*p["h"]) * (1.0 if j < max(3, n // 2) else 0.85)
        lean = rng.uniform(*p["lean"])
        C = kit.bezier([base, base + UP * h * 0.5 + dn * lean * 0.1, base + dn * lean * 0.55 + UP * h * 1.0, base + dn * lean * 1.25 + UP * h * 0.8],
                       np.linspace(0, 1, rows))
        C[1:, 1] = np.maximum(C[1:, 1], 0.0)
        width = lambda t: p["w"] * (1 - t) ** 0.8 * (1 + 0.25 * np.sin(np.pi * t))
        Vl, Fl, tv, av = kit.ribbon(C, UP if abs(dn[1]) < 0.9 else [1, 0, 0], width, cols, fold=0.35, droop_edge=0.12)
        col = ramp([(0, (0.44, 0.54, 0.54)), (1, (1.02, 1.0, 0.85))])(tv)
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
    """Coconut palm: banded tapered trunk with grounded root foot, 3D rachis midribs, deeply separated V-cupped pinnae
    fronds with transferred crown-dome normals, a crown bulb and coconuts."""
    v = PALMS[name]
    rng = np.random.default_rng(v["seed"])
    H = v["height"]
    yaw = rng.uniform(0, 2 * np.pi)  # palm.py's first draw: the same lean direction
    d = np.array([np.cos(yaw), 0, np.sin(yaw)])
    P = [np.array([0, -0.08, 0]), np.array([0, H * 0.33, 0]) + d * (v["bow"] * 0.2),
         np.array([0, H * 0.66, 0]) + d * (v["lean"] * 0.55 + v["bow"]), np.array([0, H, 0]) + d * v["lean"]]
    rings = (72, 26, 7)[lod]
    t = np.linspace(0, 1, rings)
    C = kit.bezier(P, t)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(C, axis=0), axis=1))])
    period = s[-1] / round(s[-1] / 0.52)
    u = (s / period) % 1.0
    band = np.sin(np.pi * u ** 1.5) ** 2
    r = (0.17 + 0.14 * np.exp(-t * 10)) * (1 + (0.14 * band if lod == 0 else (0.06 * band if lod == 1 else 0)))
    top, T = C[-1], kit.rmf(C)[0][-1]
    Vt, Ft = kit.tube(C, r, (12, 8, 5)[lod], cap0="flat", cap1="dome", ground=False)
    near = np.argmin(np.linalg.norm(Vt[:, None] - C[None], axis=2), axis=1)
    shade = (0.68 + 0.32 * band[near]) if lod < 2 else np.ones(len(Vt))
    grad = 0.76 + 0.24 * smoothstep(0, H * 0.7, Vt[:, 1])
    parts = [Part("bark", Vt, Ft, np.stack([shade * grad] * 3, 1))]
    # crown bulb (fibrous crownshaft)
    rb = r[-1] * 1.75
    bulb = np.array([(np.sin(a) * rb, -np.cos(a) * rb * 1.25) for a in np.linspace(0, np.pi, (8, 5, 4)[lod])])
    Vb, Fb = kit.revolve(bulb, (12, 7, 5)[lod])
    R = _align(UP, T)
    Vb = Vb @ R.T + top - T * rb * 0.28
    parts.append(Part("bark", Vb, Fb, np.full((len(Vb), 3), 0.72)))
    # fronds: 45 rows on LOD0 for ~15 distinct separated pinnae pairs per frond + 3D curved rachis tube
    rows, cols = ((45, [-1.0, -0.48, 0.0, 0.48, 1.0]), (19, [-1.0, 0.0, 1.0]), (6, [-1.0, 0.0, 1.0]))[lod]
    golden = np.pi * (3 - np.sqrt(5))
    spears = 4 if lod == 0 else (2 if lod == 1 else 0)
    nf = (v["fronds"] if lod < 2 else 8) + spears
    total = nf + (v["dead"] if lod < 2 else 0)
    crown_dome = top + np.array([0.0, 0.85, 0.0])
    crown_radii = np.array([3.6, 2.6, 3.6])
    for f in range(total):
        dead = f >= nf
        spear = (not dead) and (f >= nf - spears)
        az = f * golden * (1 if not dead else 1.3) + rng.normal(0, 0.09)
        if spear:
            elev = rng.uniform(0.82, 1.18)
            L = rng.uniform(3.2, 3.9)
            droop = rng.uniform(0.35, 0.55)
        elif not dead:
            elev = rng.uniform(0.28, 0.78)
            L = rng.uniform(4.4, 5.1)
            droop = rng.uniform(0.75, 1.22)
        else:
            elev = rng.uniform(-1.1, -0.8)
            L = rng.uniform(2.2, 2.7)
            droop = 0.15
        o = np.array([np.cos(az) * np.cos(elev), np.sin(elev), np.sin(az) * np.cos(elev)])
        oh = np.array([o[0], 0, o[2]]); oh /= np.linalg.norm(oh)
        base = top + o * r[-1] * 0.48
        if not dead:
            Cf = kit.bezier([base, base + o * L * 0.42 + UP * L * 0.28, base + oh * L * 0.82 + UP * L * (0.22 - 0.22 * droop),
                             base + oh * L * 1.02 - UP * L * (0.04 + 0.28 * droop)], np.linspace(0, 1, rows))
        else:
            Cf = kit.bezier([base, base + o * L * 0.45, base + o * L * 0.8 + oh * 0.3, base + o * L + oh * 0.25 - UP * 0.2],
                            np.linspace(0, 1, rows))
        # 3D tapered rachis midrib stem along the frond spine
        if lod < 2 and not dead:
            n_rach = 14 if lod == 0 else 7
            C_rach = kit.bezier([Cf[0], Cf[len(Cf) // 3], Cf[2 * len(Cf) // 3], Cf[-1]], np.linspace(0, 1, n_rach))
            r_rach = 0.048 * (1.0 - 0.82 * np.linspace(0, 1, n_rach)) ** 0.85
            Vr, Fr = kit.tube(C_rach, r_rach, 5 if lod == 0 else 4, cap0="flat", cap1="dome", ground=False)
            parts.append(Part("frond", Vr, Fr, np.full((len(Vr), 3), 0.62),
                              dome_centre=crown_dome, dome_radii=crown_radii, dome_weight=0.35))
        Wmax = rng.uniform(0.68, 0.80) * (0.78 if spear else (1.0 if not dead else 0.42))
        width = lambda t, Wmax=Wmax: Wmax * (0.10 + 0.90 * smoothstep(0.0, 0.20, t)) * (1 - t) ** 0.66 + 0.012
        # Deep feather-palm pinnae notches (cutting down to 0.08 of width between leaflets!)
        if lod == 0 and not dead:
            serr = lambda t, i: 1.0 if (i % 3 != 0 and 0.06 < t < 0.96) else 0.08
        elif lod == 1 and not dead:
            serr = lambda t, i: 1.0 if (i % 2 != 0 and 0.08 < t < 0.95) else 0.14
        else:
            serr = None
        Vf, Ff, tv, av = kit.ribbon(Cf, UP, width, cols, fold=0.36, serr=serr,
                                    twist=0.0 if dead else rng.normal(0, 0.18), slant=1.35, droop_edge=0.28 if not dead else 0.08)
        Vf[:, 1] = np.maximum(Vf[:, 1], 0.02)
        col = ramp([(0, (0.40, 0.54, 0.60)), (0.32, (0.78, 0.90, 0.84)), (1, (1.08, 1.04, 0.80))])(tv) * (0.82 + 0.18 * np.abs(av))[:, None]
        parts.append(Part("frond_dry" if dead else "frond", Vf, Ff, col,
                          dome_centre=crown_dome, dome_radii=crown_radii, dome_weight=0.45))
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
