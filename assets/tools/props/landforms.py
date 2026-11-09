"""Closed stylised landforms: painted desert buttes, grassy sea stacks.

usage: landforms.py [name ...]   -> work/build/<name>_lod{0,1,2}.glb + work/build/<name>.json (contract of props.py)
Each model is one solid of stacked rings, closed by a pole under the skirt and a pole on the summit, so every LOD is watertight
by construction. A ring is a rounded polygon (straight sides = planar facets, filleted corners = bevels) offset along its
normals, at a height; rings share one column layout per LOD, so any ring connects to any other. Each ring carries the LODs
it appears in and the material of the band above it; band edges are rings, so strata read as clean lines."""
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import geo
from mats import pbr, srgb
from props import build_all

SKIRT = -2.0
COLS = ((10, 6), (3, 1), (1, 0))  # per LOD: segments per corner fillet, interior points per straight side


class Outline:
    """Rounded star polygon around the origin: points and outward normals in (x, z), plus arc-length fraction s."""

    def __init__(self, V, Rx, Rv, lod):
        nf, ne = COLS[lod]
        V = np.asarray(V, float)
        N = len(V)
        area = 0.5 * np.sum(V[:, 0] * np.roll(V[:, 1], -1) - np.roll(V[:, 0], -1) * V[:, 1])
        o = np.sign(area)
        perp = lambda e: o * np.stack([e[..., 1], -e[..., 0]], -1)
        E = np.roll(V, -1, 0) - V
        L = np.linalg.norm(E, axis=1)
        U = E / L[:, None]
        Ne = perp(U)
        pts, nrm = [], []
        T1, T2, arcs = [], [], []
        for i in range(N):
            u1, u2, n1 = U[i - 1], U[i], Ne[i - 1]
            turn = np.arctan2(u1[0] * u2[1] - u1[1] * u2[0], u1 @ u2)
            convex = np.sign(turn) == o
            R = Rx if convex else Rv
            t = min(R * np.tan(abs(turn) / 2), 0.45 * min(L[i - 1], L[i]))
            R = t / max(np.tan(abs(turn) / 2), 1e-9)
            c = V[i] - u1 * t + (-n1 if convex else n1) * R
            a0 = np.arctan2(n1[1], n1[0])
            ang = a0 + turn * np.arange(nf + 1) / nf
            n = np.stack([np.cos(ang), np.sin(ang)], -1)
            arcs.append((c + (R if convex else -R) * n, n))
        for i in range(N):
            p, n = arcs[i]
            pts.append(p); nrm.append(n)
            q = arcs[(i + 1) % N][0][0]
            f = np.arange(1, ne + 1)[:, None] / (ne + 1)
            pts.append(p[-1] + (q - p[-1]) * f); nrm.append(np.repeat(Ne[i][None], ne, 0))
        self.p, self.n = np.vstack(pts), np.vstack(nrm)
        seg = np.linalg.norm(np.roll(self.p, -1, 0) - self.p, axis=1)
        self.s = np.concatenate([[0], np.cumsum(seg)[:-1]]) / seg.sum()

    def at(self, d=0.0, scale=1.0):
        return (self.p + np.asarray(d)[..., None] * self.n) * scale


def star(n, a, b, seed, jitter, dents=(), squash=0.78, turn=0.0):
    """n vertices at jittered angles on an ellipse (x half-axis a, z half-axis b), radii jittered; dents pull vertices in."""
    g = np.random.default_rng(seed)
    t = turn + 2 * np.pi * (np.arange(n) + g.uniform(-0.18, 0.18, n)) / n
    r = a * b / np.sqrt((b * np.sin(t)) ** 2 + (a * np.cos(t)) ** 2) * (1 + g.uniform(-jitter, jitter, n))
    r[list(dents)] *= squash
    return np.stack([r * np.sin(t), r * np.cos(t)], -1)


def bumps(s, seed, n, amp, width):
    """A few smooth lumps along the perimeter fraction s (periodic)."""
    g = np.random.default_rng(seed)
    c, a = g.uniform(0, 1, n), amp * g.uniform(0.4, 1.0, n) * g.choice([-1, 1], n, p=[0.3, 0.7])
    dist = np.abs((s[:, None] - c[None] + 0.5) % 1 - 0.5)
    return (a[None] * np.exp(-(dist / width) ** 2)).sum(1)


def solid(rings, lod):
    """rings: [(xz (C, 2), y (C,) or scalar, material above)] bottom to top -> (V, F, per-face material)."""
    C = len(rings[0][0])
    P = np.stack([np.column_stack([xz[:, 0], np.broadcast_to(y, (C,)), xz[:, 1]]) for xz, y, _ in rings])
    Y, Rr = P[..., 1], np.linalg.norm(P[..., [0, 2]], axis=-1)
    if np.any((np.diff(Y, axis=0) < -1e-9) & (np.diff(Rr, axis=0) >= 0)):
        raise ValueError("each column must rise or move inward (a simple profile curve)")
    for xz, _, _ in rings:
        a = np.unwrap(np.arctan2(xz[:, 0], xz[:, 1]))
        if np.any(np.diff(a) * np.sign(a[-1] - a[0]) <= 0):
            raise ValueError("ring is not star-shaped about the axis")
    R = len(rings)
    V = np.vstack([P.reshape(-1, 3), [[0, Y[0].min(), 0], [0, Y[-1].mean() + rings.rise, 0]]])
    pb, pt = R * C, R * C + 1
    j = np.arange(C)
    F, M = [np.column_stack([np.full(C, pb), (j + 1) % C, j])], [rings[0][2]] * C
    for i in range(R - 1):
        a, b = i * C + j, i * C + (j + 1) % C
        F += [np.column_stack([a, b, b + C]), np.column_stack([a, b + C, a + C])]
        M += [rings[i][2]] * (2 * C)
    a, b = (R - 1) * C + j, (R - 1) * C + (j + 1) % C
    F.append(np.column_stack([a, b, np.full(C, pt)]))
    M += [rings[-1][2]] * C
    F = np.vstack(F)
    vol = np.einsum("ij,ij->i", V[F[:, 0]], np.cross(V[F[:, 1]], V[F[:, 2]])).sum() / 6
    if vol < 0:
        F = F[:, ::-1]
    return V, F, np.array(M)


class Rings(list):
    """Ring list; rise is the summit pole's height above the last ring."""
    rise = 0.0


def landform(make, lod, mats, note, crease=60.0):
    """make(lod) -> Rings. The footprint centre is taken from LOD0 so every LOD shares one origin."""
    V0, F0, _ = solid(make(0), 0)
    lo, hi = V0[np.unique(F0)].min(0), V0[np.unique(F0)].max(0)
    V, F, M = solid(make(lod), lod)
    V = V - [(lo[0] + hi[0]) / 2, 0, (lo[2] + hi[2]) / 2]
    m = geo.Mesh()
    for name in dict.fromkeys(M):
        m.add(name, V, F[M == name], np.zeros((len(V), 2)), crease=crease)
    return [(None, m, None)], mats, [], note


def cap_rings(out, ring_xz, y, mat, dome, fs):
    """Top surface: the outline scaled toward the axis, gently domed; the pole sits at y + dome."""
    for f in fs:
        out.append((ring_xz * f, y + dome * (1 - f * f), mat))
    out.rise = dome * fs[-1] ** 2
    return out


def step(d0, d1, y, b, lod):
    """Profile (d, dy) of a wall at offset d0 stepping to d1 (d1 < d0 steps back) at height y, bevelled by b; LOD2 keeps the
    bare corners."""
    if d0 == d1:
        return [(d0, y)]
    if lod == 2:
        return [(d0, y), (d1, y)]
    if d0 - d1 <= 2 * b:
        return [(d0, y - b), (d1, y + b)]
    return [(d0, y - b), (d0 - b, y), (d1 + b, y), (d1, y + b)]


# ---------------------------------------------------------------- desert buttes (Ghibli gouache)

DESERT = [pbr("talus", srgb("#cf7f4a"), 0.0, 0.95), pbr("rock_red", srgb("#b8442a"), 0.0, 0.92),
          pbr("caprock", srgb("#c4553a"), 0.0, 0.92)]


def flutes(s, k, depth, seed):
    """Vertical fluting along the perimeter fraction s: k primary grooves + secondary fracture harmonics."""
    g = np.random.default_rng(seed)
    phase = (s * k + 0.16 * np.sin(2 * np.pi * 3 * s + seed)) % 1
    d = depth * g.uniform(0.55, 1.05, k)[np.floor((s * k) % k).astype(int)]
    primary = -d * (0.5 - 0.5 * np.cos(2 * np.pi * phase)) ** 1.55
    sec_phase = (s * (2 * k + 3) + 0.22 * np.cos(2 * np.pi * 5 * s - seed)) % 1
    secondary = -0.28 * depth * (0.5 - 0.5 * np.cos(2 * np.pi * sec_phase)) ** 2.0
    return primary + secondary


def inset(P, d):
    """Points P (C, 2) moved toward the axis by d metres (d > 0 inward): angles are kept, so a star-shaped ring stays one."""
    r = np.linalg.norm(P, axis=1)
    return P * (np.maximum(r - d, 0.08 * r) / r)[:, None]


def spire(p, lod):
    """A painted craggy landform spire: lumpy scree apron, optional wave-undercut basal notch, deeply fluted vertical walls
    with stepped horizontal cleavage ledges, overhanging cornice/shoulder, and domed top."""
    O = Outline(star(p["n"], p["a"], p["b"], p["seed"], p["jitter"], p.get("dents", ()), squash=p.get("squash", 0.72)),
                p["Rx"], p["Rv"], lod)
    s = O.s
    T = p["talus_w"] + bumps(s, p["seed"] + 1, 7, 1.4, 0.05)
    h = p["talus_h"] + bumps(s, p["seed"] + 2, 6, 1.0, 0.04)
    k = (p["flutes"], max(6, p["flutes"] // 2), 0)[lod]
    fl = flutes(s, k, p["flute"], p["seed"] + 3) if k else np.zeros_like(s)
    talus, cap = p.get("talus_mat", "talus"), p.get("cap_mat", "caprock")
    out = Rings([(O.at(T + 1.2), SKIRT, talus), (O.at(T), 0.0, talus)])
    for fs in ((0.4, 0.75) if lod < 2 else (0.6,)):
        out.append((O.at(T * (1 - fs) ** 1.3), h * fs, talus))
    H, R = p["H"], p["shoulder"]
    ys = H - R
    h0 = h.max() + 0.5
    bands = [b for b in p["bands"] if h0 < b[0] < ys]
    mat_at = lambda y: next((m for yb, m in reversed(bands) if y >= yb - 1e-6), p["base"])
    wall = O.at(0.0)
    out.append((inset(wall, -fl), h, p["base"]))

    # Optional wave-undercut basal sea notch just above the scree foot (coastal sea stacks)
    notch = p.get("undercut", 0.0)
    if notch > 0.0 and lod < 2:
        y_notch = h0 + 1.1
        y_over = h0 + 2.6
        if y_over < ys - 1.5:
            out.append((inset(wall, notch - fl * 0.85), y_notch, p["base"]))
            out.append((inset(wall, -0.35 * notch - fl * 1.05), y_over, p["base"]))
            h0 = y_over + 0.4

    # Stepped horizontal geological cleavage ledges along the main rock wall
    ledges = p.get("ledges", (0.38, 0.68))
    rows = sorted({*[y for y, _ in bands], *np.linspace(h0, ys, (8, 5, 2)[lod])})
    step_accum = np.zeros_like(s)
    for idx_r, y in enumerate(rows):
        f = (y - h0) / max(ys - h0, 1e-6)
        # Add asymmetric horizontal ledge step-backs at cleavage fractions
        ledge_d = 0.0
        for lf in ledges:
            if f >= lf:
                ledge_d += p.get("ledge_step", 0.55) * (0.7 + 0.3 * np.sin(2 * np.pi * s + lf * 7.0))
        d_in = p["batter"] * f * (H / 10) + ledge_d - fl * (1 - 0.42 * f)
        out.append((inset(wall, d_in), y, mat_at(y)))

    d_s = p["batter"] * (H / 10) + len(ledges) * p.get("ledge_step", 0.55) * 0.7
    # Optional overhanging turf/caprock cornice rim before rounding into the summit dome
    cornice = p.get("cornice", 0.0)
    if cornice > 0.0 and lod < 2:
        out.append((inset(wall, d_s - cornice - fl * 0.45), ys + 0.18 * R, cap))
    th_all = (0.38, 0.78, 1.18, 1.48) if lod < 2 else (0.8, 1.4)
    for th in th_all:
        out.append((inset(wall, d_s + R * (1 - np.cos(th)) - fl * 0.45 * (1 - th / 1.6)), ys + R * np.sin(th), cap))
    return cap_rings(out, inset(wall, d_s + R * (1 - np.cos(th_all[-1]))), H, cap, p["dome"], (0.6, 0.3) if lod < 2 else (0.5,))


def cluster(spires, lod, note, mats=None, crease=44.0):
    """Several buttes as one model: each a closed solid, offset in the footprint; the footprint centre is LOD0's."""
    parts = [(solid(spire(sp, lod), lod), sp.get("at", (0, 0))) for sp in spires]
    parts0 = [(solid(spire(sp, 0), 0), sp.get("at", (0, 0))) for sp in spires]
    pts0 = np.vstack([V[np.unique(F)] + [x, 0, z] for (V, F, _), (x, z) in parts0])
    lo, hi = pts0.min(0), pts0.max(0)
    centre = [(lo[0] + hi[0]) / 2, 0, (lo[2] + hi[2]) / 2]
    m = geo.Mesh()
    for (V, F, M), (x, z) in parts:
        V = V + [x, 0, z] - centre
        for name in dict.fromkeys(M):
            m.add(name, V, F[M == name], np.zeros((len(V), 2)), crease=crease)
    return [(None, m, None)], mats or DESERT, [], note


# The concept's buttes are one warm red rock from scree to shoulder, lit warm and shaded cool by the light alone: horizontal
# cream and orange bands made banded drums of them.
BANDS = []
MESA = {
    "mesa-a": dict(spires=[
        dict(at=(0, 0), n=6, a=7.0, b=5.2, seed=11, jitter=0.20, Rx=1.2, Rv=3.0, talus_w=5.0,
             talus_h=5.0, batter=0.11, flutes=26, flute=2.15, ledge_step=0.62, cornice=0.35, H=58.0, shoulder=4.5, dome=0.8,
             base="rock_red", bands=BANDS),
        dict(at=(10.5, -4.0), n=5, a=5.2, b=4.0, seed=13, jitter=0.20, Rx=1.0, Rv=2.6, talus_w=4.0,
             talus_h=4.0, batter=0.11, flutes=18, flute=1.75, ledge_step=0.48, cornice=0.28, H=44.0, shoulder=3.6, dome=0.6,
             base="rock_red", bands=BANDS),
        dict(at=(-9.0, 3.5), n=6, a=4.4, b=3.6, seed=17, jitter=0.20, Rx=1.0, Rv=2.4, talus_w=3.5,
             talus_h=3.5, batter=0.11, flutes=16, flute=1.5, ledge_step=0.42, cornice=0.24, H=33.0, shoulder=3.0, dome=0.5,
             base="rock_red", bands=BANDS)],
        note="three tall painted buttes, 58, 44 and 33 m: lumpy scree aprons to near-vertical faceted walls deeply fluted top "
             "to bottom, one warm red rock without horizontal bands, rounded shoulders and domed tops"),
    "mesa-b": dict(spires=[
        dict(at=(0, 0), n=7, a=16.0, b=10.0, seed=23, jitter=0.18, dents=(1, 4), squash=0.76, Rx=2.0, Rv=5.0, talus_w=5.0,
             talus_h=5.5, batter=0.09, flutes=40, flute=2.25, ledge_step=0.65, cornice=0.38, H=46.0, shoulder=4.0, dome=0.5,
             base="rock_red", bands=BANDS)],
        note="broad painted mesa, 46 m: two alcoves, a lumpy scree apron to a near-vertical faceted wall deeply fluted top "
             "to bottom, one warm red rock without horizontal bands, a rounded shoulder and a gently domed top"),
}


def mesa(name):
    def build(lod):
        p = MESA[name]
        return cluster(p["spires"], lod, p["note"] + "; each butte closed, skirt to y = -2 m, materials talus, rock_red, "
                       "caprock (no textures)", crease=42.0)
    return build


# ---------------------------------------------------------------- sea stacks

COAST = [pbr("rock", srgb("#a0957c"), 0.0, 0.93), pbr("grass", srgb("#5e8c40"), 0.0, 0.95)]

# Asymmetric craggy multi-spire coastal headlands: wave-undercut basal notches, stepped horizontal rock ledges, deep vertical
# fluting, and overhanging turf cornices on primary and flanking sea stacks.
CLIFF = {
    "cliff-coast-a": dict(spires=[
        dict(at=(-1.2, 0.4), n=7, a=8.6, b=7.0, seed=5, jitter=0.18, dents=(1, 4), squash=0.78, Rx=2.0, Rv=3.6, talus_w=2.4,
             talus_h=2.8, batter=0.14, flutes=22, flute=1.55, undercut=0.75, ledge_step=0.48, cornice=0.42, H=24.0,
             shoulder=4.2, dome=1.2, base="rock", bands=[], talus_mat="rock", cap_mat="grass"),
        dict(at=(4.4, -2.0), n=6, a=5.2, b=4.4, seed=19, jitter=0.18, Rx=1.3, Rv=2.6, talus_w=1.8,
             talus_h=2.2, batter=0.13, flutes=14, flute=1.25, undercut=0.55, ledge_step=0.38, cornice=0.32, H=17.6,
             shoulder=3.2, dome=0.9, base="rock", bands=[], talus_mat="rock", cap_mat="grass"),
        dict(at=(-4.5, -2.2), n=5, a=4.5, b=3.8, seed=31, jitter=0.18, Rx=1.1, Rv=2.2, talus_w=1.6,
             talus_h=1.9, batter=0.14, flutes=12, flute=1.05, undercut=0.42, ledge_step=0.30, cornice=0.25, H=12.8,
             shoulder=2.5, dome=0.7, base="rock", bands=[], talus_mat="rock", cap_mat="grass")],
        note="sea stack, 24 m: a rounded, fluted grey rock wall over a scree foot, a rounded shoulder and a domed grass cap"),
    "cliff-coast-b": dict(spires=[
        dict(at=(0.8, 0.3), n=8, a=10.2, b=7.6, seed=9, jitter=0.16, dents=(1, 5), squash=0.78, Rx=2.2, Rv=4.0, talus_w=2.6,
             talus_h=2.8, batter=0.13, flutes=26, flute=1.65, undercut=0.72, ledge_step=0.46, cornice=0.40, H=22.0,
             shoulder=3.8, dome=1.0, base="rock", bands=[], talus_mat="rock", cap_mat="grass"),
        dict(at=(-5.4, -1.8), n=6, a=5.8, b=4.6, seed=27, jitter=0.18, Rx=1.4, Rv=2.7, talus_w=1.9,
             talus_h=2.2, batter=0.13, flutes=16, flute=1.30, undercut=0.52, ledge_step=0.36, cornice=0.30, H=16.4,
             shoulder=3.0, dome=0.8, base="rock", bands=[], talus_mat="rock", cap_mat="grass"),
        dict(at=(5.2, -2.2), n=5, a=4.8, b=4.0, seed=41, jitter=0.18, Rx=1.1, Rv=2.2, talus_w=1.6,
             talus_h=1.8, batter=0.14, flutes=12, flute=1.10, undercut=0.40, ledge_step=0.28, cornice=0.24, H=11.8,
             shoulder=2.3, dome=0.6, base="rock", bands=[], talus_mat="rock", cap_mat="grass")],
        note="elongated headland, 22 m: a rounded, fluted grey rock wall over a scree foot, a rounded shoulder "
             "and a domed grass cap"),
}


def cliff(name):
    def build(lod):
        p = CLIFF[name]
        return cluster(p["spires"], lod, p["note"] + "; closed, skirt to y = -2 m, materials rock, grass (no textures)",
                       COAST, crease=44.0)
    return build


BUILDERS = {**{n: mesa(n) for n in MESA}, **{n: cliff(n) for n in CLIFF}}

if __name__ == "__main__":
    build_all(BUILDERS, sys.argv[1:] or list(BUILDERS))
