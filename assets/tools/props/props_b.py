"""Procedural stylised props, part two: castle-tower, windmill (sails on their own node), cypress, colosseum.

usage: props_b.py [name ...]   -> work/build/<name>_lod{0,1,2}.glb + work/build/<name>.json (same contract as props.py)"""
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import geo
import texgen
from mats import pbr, srgb
from props import build_all


def uv_scale(UV, s):
    return np.asarray(UV) / s


# ---------------------------------------------------------------- castle tower

def castle_tower(lod):
    """Round keep, 20 m: battered base, arrow slits, an arched portal, corbelled parapet with 16 merlons."""
    m = geo.Mesh()
    seg = (40, 20, 12)[lod]
    T = 3.6  # masonry tile: 4 blocks x 8 courses of 0.9 x 0.45 m
    V, F, UV = geo.lathe([(0, 0), (5.25, 0), (5.1, 0.5), (4.6, 3.2), (4.5, 16.0)], seg)
    m.add("stone", V, F, uv_scale(UV, T), crease=50)
    # corbels under the parapet
    nc = (24, 16, 0)[lod]
    for k in range(nc):
        R = geo.rot_y(2 * np.pi * (k + 0.5) / nc)
        for (y, d, h) in (((15.75, 0.35, 0.5), (16.3, 0.6, 0.45)) if lod == 0 else ((16.0, 0.6, 1.0),)):
            V, F, UV = geo.box([0, y, 4.5 + d / 2 - 0.05], [0.55, h, d])
            m.add("stone", V @ R.T, F, uv_scale(UV, T))
    if lod == 2:
        V, F, UV = geo.lathe([(4.5, 15.6), (5.1, 16.6)], seg)
        m.add("stone", V, F, uv_scale(UV, T), crease=60)
    # parapet: underside, outer face, wall top, inner face, wall-walk floor
    V, F, UV = geo.lathe([(4.45, 16.6), (5.1, 16.6), (5.1, 18.4), (4.55, 18.4), (4.55, 17.6), (0, 17.6)], seg)
    m.add("stone", V, F, uv_scale(UV, T), crease=50)
    # merlons
    nm = 16
    for k in range(nm):
        R = geo.rot_y(2 * np.pi * k / nm)
        V, F, UV = geo.box([0, 18.4 + 0.7, 4.83], [1.1, 1.4, 0.55], faces="xXzZY")
        m.add("stone", V @ R.T, F, uv_scale(UV, T))
        if lod == 0:
            V, F, UV = geo.box([0, 19.1, 5.11], [0.12, 0.7, 0.02], faces="Z")
            m.add("dark", V @ R.T, F, UV)
    # arrow slits and two small arched windows
    if lod < 2:
        slits = [(5.5, 0.4), (5.5, 2.5), (5.5, 4.6), (9.5, 1.4), (9.5, 3.6), (9.5, 5.6), (13.0, 0.4), (13.0, 2.5), (13.0, 4.6)]
        for y, a in slits[: (9 if lod == 0 else 5)]:
            r = 4.5 + (4.6 - 4.5) * max(0, 3.2 - y) / 3.2
            V, F, UV = geo.box([0, y, r - 0.02], [0.18, 1.3, 0.12], faces="Z")
            m.add("dark", V @ geo.rot_y(a).T, F, UV)
        for y, a in ((11.5, 0.0), (7.5, np.pi)):
            P = [(-0.45, 0)] + [(0.45 * np.cos(t), 1.1 + 0.45 * np.sin(t)) for t in np.linspace(0, np.pi, 7)][::-1][::-1] + [(0.45, 0)]
            P = [(-0.45, 0), (0.45, 0)] + [(0.45 * np.cos(t), 1.1 + 0.45 * np.sin(t)) for t in np.linspace(0, np.pi, 7)]
            Q = np.array(P)
            Vw = np.column_stack([Q[:, 0], Q[:, 1] + y, np.full(len(Q), 4.52)])
            Fw = geo.triangulate(Q)
            nrm = np.cross(Vw[Fw[0, 1]] - Vw[Fw[0, 0]], Vw[Fw[0, 2]] - Vw[Fw[0, 0]])
            if nrm[2] < 0:
                Fw = Fw[:, ::-1]
            m.add("dark", Vw @ geo.rot_y(a).T, Fw, None)
    # portal on +Z: a projecting stone surround with an arched oak door
    V, F, UV = geo.box([0, 1.9, 4.75], [2.6, 3.8, 1.0], faces="xXzZY")
    m.add("stone", V, F, uv_scale(UV, T))
    P = [(-0.7, 0), (0.7, 0)] + [(0.7 * np.cos(t), 2.2 + 0.7 * np.sin(t)) for t in np.linspace(0, np.pi, (9, 5, 3)[lod])]
    Q = np.array(P)
    Vd = np.column_stack([Q[:, 0], Q[:, 1], np.full(len(Q), 5.26)])
    Fd = geo.triangulate(Q)
    if np.cross(Vd[Fd[0, 1]] - Vd[Fd[0, 0]], Vd[Fd[0, 2]] - Vd[Fd[0, 0]])[2] < 0:
        Fd = Fd[:, ::-1]
    m.add("wood", Vd, Fd, Vd[:, [0, 1]])
    if lod == 0:
        for x in (-0.35, 0.0, 0.35):
            V, F, UV = geo.box([x, 1.4, 5.27], [0.03, 2.6, 0.02], faces="Z")
            m.add("dark", V, F, UV)
        for y in (0.6, 2.0):
            V, F, UV = geo.box([0, y, 5.28], [1.3, 0.08, 0.03], faces="ZyY")
            m.add("iron", V, F, UV)
    stone = texgen.masonry(srgb("#9a958a"), rows=8, cols=4, seed=3, mortar=0.06, tone=0.07, mortar_dark=0.62)
    mats = [pbr("stone", (1, 1, 1), 0.0, 0.88, tex=0), pbr("dark", srgb("#14110f"), 0.0, 0.9),
            pbr("wood", srgb("#5a3b22"), 0.0, 0.75), pbr("iron", srgb("#232323"), 0.6, 0.5)]
    return [("castle-tower", m, None)], mats, [(stone, "image/png")], "portal faces +Z; wall walk floor at 17.6 m; masonry texture tiles every 3.6 m"


# ---------------------------------------------------------------- windmill

HUB = (0.0, 14.0, 3.9)


def windmill(lod):
    """Dutch smock mill: brick base, gallery, white weatherboarded octagonal body, boat cap; the four sails are the
    separate node `sails`, translated to the hub, turning about its local +Z."""
    body = geo.Mesh()
    oct8 = 8
    ph = np.pi / 8  # flat faces toward the axes
    def octo(prof, mat, tile, crease=30):
        V, F, UV = geo.lathe(prof, oct8, a0=ph, a1=ph + 2 * np.pi)
        body.add(mat, V, F, uv_scale(UV, tile), crease=crease)
    octo([(0, 0), (4.3, 0), (4.3, 0.3), (4.1, 3.6), (0, 3.6)], "brick", 2.4)
    # gallery deck, posts, rail, struts
    octo([(0, 3.6), (5.4, 3.6), (5.4, 3.85), (0, 3.85)], "wood", 2.0)
    if lod < 2:
        npost = (24, 16)[lod]
        for k in range(npost):
            a = 2 * np.pi * k / npost
            r = 5.25 * np.cos(np.pi / 8) / np.cos((a - ph) % (np.pi / 4) - np.pi / 8)
            V, F, UV = geo.box([0, 4.35, r], [0.1, 1.0, 0.1])
            body.add("wood", V @ geo.rot_y(a).T, F, UV)
        for k in range(8):
            a0, a1 = ph + k * np.pi / 4, ph + (k + 1) * np.pi / 4
            p = np.array([5.25 * np.sin(a0), 4.85, 5.25 * np.cos(a0)]) / np.cos(np.pi / 8) * [1, np.cos(np.pi / 8), 1]
            q = np.array([5.25 * np.sin(a1), 4.85, 5.25 * np.cos(a1)]) / np.cos(np.pi / 8) * [1, np.cos(np.pi / 8), 1]
            V, F, UV = geo.cylinder(p, q, 0.06, segs=4, caps=False)
            body.add("wood", V, F, UV, crease=60)
            if lod == 0:
                mid = (a0 + a1) / 2
                V, F, UV = geo.cylinder([4.15 * np.sin(mid), 1.9, 4.15 * np.cos(mid)], [4.75 * np.sin(mid), 3.6, 4.75 * np.cos(mid)], 0.09, segs=4)
                body.add("wood", V, F, UV, crease=60)
    # smock body and its window and door
    octo([(3.75, 3.6), (2.35, 12.5)], "boards", 2.0)
    if lod < 2:
        for y, a, w, h, mat in ((3.85 + 1.1, 0.0, 1.1, 2.2, "door"), (7.5, np.pi / 2, 0.7, 0.9, "dark"), (7.5, -np.pi / 2, 0.7, 0.9, "dark"),
                                (10.3, 0.0, 0.6, 0.8, "dark"), (10.3, np.pi, 0.6, 0.8, "dark")):
            r = 3.75 + (2.35 - 3.75) * (y - 3.6) / 8.9
            rr = r * np.cos(np.pi / 8)
            V, F, UV = geo.box([0, y, rr + 0.02], [w, h, 0.1])
            tilt = geo.rot_x(-np.arctan(1.4 * np.cos(np.pi / 8) / 8.9))
            body.add(mat, (V - [0, y, rr]) @ tilt.T @ geo.rot_y(a).T + geo.rot_y(a) @ [0, y, rr], F, UV)
    # cap: boat-shaped thatch dome, stretched toward the sails
    seg = (20, 12, 8)[lod]
    V, F, UV = geo.lathe([(2.55, 12.3), (2.6, 12.7), (2.35, 13.6), (1.75, 14.6), (0.9, 15.3), (0, 15.55)], seg)
    V = V * [1, 1, 1.25] + [0, 0, 0.35]
    body.add("cap", V, F, uv_scale(UV, 1.5), crease=50)
    V, F, UV = geo.lathe([(0, 12.3), (2.55, 12.3)], seg)
    body.add("cap", V * [1, 1, 1.25] + [0, 0, 0.35], F[:, ::-1], UV, crease=50)
    # windshaft out of the cap's front to the hub
    V, F, UV = geo.cylinder([HUB[0], HUB[1], 2.5], [HUB[0], HUB[1], HUB[2] - 0.2], 0.3, segs=(12, 8, 6)[lod])
    body.add("wood", V, F, UV, crease=60)
    # ---- sails node (hub at its origin, plane z in [-0.3, 0.3])
    s = geo.Mesh()
    V, F, UV = geo.cylinder([0, 0, -0.25], [0, 0, 0.45], 0.5, 0.42, segs=(12, 8, 6)[lod])
    s.add("sail_frame", V, F, UV, crease=50)
    R_len, r0 = 9.0, 1.6
    for k in range(4):
        Rk = geo.rot_z(np.pi / 4 + k * np.pi / 2)
        parts = []
        parts.append(geo.box([0, R_len / 2, 0.0], [0.3, R_len, 0.3]))                 # whip
        if lod < 2:
            for x in (-0.35, 1.7):
                parts.append(geo.box([x, (r0 + R_len) / 2 + 0.1, -0.12], [0.1, R_len - r0, 0.1]))
            nb = (18, 8)[lod]
            for y in np.linspace(r0 + 0.2, R_len - 0.1, nb):
                parts.append(geo.box([0.68, y, -0.12], [2.15, 0.07, 0.08]))
        for V, F, UV in parts:
            s.add("sail_frame", V @ Rk.T, F, UV)
        V, F, UV = geo.box([0.66, (r0 + R_len) / 2 + 0.15, 0.04], [2.0, R_len - r0 - 0.3, 0.0], faces="Z")
        s.add("sail_cloth", V @ Rk.T, F, UV)
    brick = texgen.masonry(srgb("#8c4a36"), rows=16, cols=8, seed=5, mortar=0.09, tone=0.08, mortar_dark=0.75)
    boards = texgen.boards(srgb("#e8e4da"), 10, seed=6)
    mats = [pbr("brick", (1, 1, 1), 0.0, 0.9, tex=0), pbr("boards", (1, 1, 1), 0.0, 0.7, tex=1),
            pbr("wood", srgb("#4b3626"), 0.0, 0.8), pbr("cap", srgb("#5b4630"), 0.0, 0.95),
            pbr("door", srgb("#2f5d3a"), 0.0, 0.6), pbr("dark", srgb("#1a1d20"), 0.0, 0.5),
            pbr("sail_frame", srgb("#5a3324"), 0.0, 0.8), pbr("sail_cloth", srgb("#efe9dc"), 0.0, 0.85, double=True)]
    return ([("windmill", body, None), ("sails", s, list(HUB))], mats, [(brick, "image/png"), (boards, "image/png")],
            f"node `sails` is translated to the hub {list(HUB)} and turns about its local +Z (the windshaft); sail tips sweep "
            f"a {R_len} m radius (lowest tip 5.0 m, clear of the 4.6 m gallery rail); door faces +Z under the sails")


# ---------------------------------------------------------------- cypress

def cypress(lod, raw=False):
    """Italian cypress, 10 m: a solid flame-shaped crown with low-frequency lobes and clumps (reads cleanly under a cel
    post-process), short visible trunk."""
    rng = np.random.default_rng(17)
    m = geo.Mesh()
    V, F, UV = geo.cylinder([0, 0, 0], [0, 1.4, 0], 0.2, 0.14, segs=(8, 6, 5)[lod], caps=False)
    m.add("bark", V, F, UV, crease=60)
    na, nr = ((28, 36), (14, 16), (8, 8))[lod]
    ys = np.linspace(0.9, 10.0, nr + 1)
    def radius(y):
        t = (y - 0.9) / 9.1
        if t >= 1:
            return 0.0
        return 0.85 * (min(t, 0.22) / 0.22) ** 0.45 * ((1 - t) / 0.78) ** 0.62 if t > 0.22 else 0.85 * (max(t, 0) / 0.22) ** 0.45
    # lobes: sum of a few low-frequency waves in angle and height
    waves = [(rng.integers(3, 7), rng.uniform(0.6, 1.6), rng.uniform(0, 2 * np.pi), rng.uniform(0.07, 0.14)) for _ in range(6)]
    th = np.linspace(0, 2 * np.pi, na, endpoint=False)
    grid = []
    for y in ys:
        r = radius(y)
        d = sum(a * np.sin(k * th + f * y + p) for k, f, p, a in waves)
        rr = r * (1 + (d if lod < 2 else 0 * d))
        grid.append(np.stack([rr * np.sin(th), np.full(na, y), rr * np.cos(th)], 1))
    grid = np.array(grid)
    V = grid.reshape(-1, 3)
    F = []
    for i in range(nr):
        for j in range(na):
            a, b = i * na + j, i * na + (j + 1) % na
            F += [[a, b, b + na], [a, b + na, a + na]]
    V = np.vstack([V, [[0, 0.9, 0]]])
    c = len(V) - 1
    F += [[c, (j + 1) % na, j] for j in range(na)]
    F = np.array(F)
    A = np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1)
    m.add("foliage", V, F[A > 1e-10], None, crease=75)
    if lod < 2:
        nc = (30, 12)[lod]
        for k in range(nc):
            y = rng.uniform(1.4, 8.6)
            a = rng.uniform(0, 2 * np.pi)
            r = radius(y) * 0.8
            sz = 0.18 + 0.2 * radius(y)
            Vc, Fc, UVc = geo.ellipsoid([r * np.sin(a), y, r * np.cos(a)], [sz, sz * 2.0, sz], segs=(9, 6)[lod], rings=(6, 4)[lod])
            m.add("foliage", Vc, Fc, None, crease=75)
    mats = [pbr("foliage", srgb("#2f4a24"), 0.0, 0.85), pbr("bark", srgb("#5b4632"), 0.0, 0.9)]
    if raw:
        return m
    lo, hi = cypress(0, raw=True).bounds()   # every LOD shares LOD0's footprint centre
    m = m.shifted([-(lo[0] + hi[0]) / 2, 0, -(lo[2] + hi[2]) / 2])
    return [("cypress", m, None)], mats, [], "solid stylised crown (no alpha cards)"


# ---------------------------------------------------------------- colosseum

A_OUT, B_OUT = 90.0, 75.0
STOREYS = [0.0, 10.5, 21.0, 31.5]      # arcade storey bases; the attic runs 31.5 -> 45, cornice to 47.5
ATTIC_TOP = 45.0
WALL_T = 2.2


def ell(a, b, phi):
    return np.stack([a * np.cos(phi), np.zeros_like(phi), b * np.sin(phi)], -1)


def arch_panel(m, p0, p1, y0, h, out_n, mat, shade, thick, arch_w, spring, segs, uv_t, u_off, inner=True):
    """A wall bay between p0 and p1 (ground points on the face), y0..y0+h, pierced by a round arch of width arch_w whose
    imposts are at y0+spring; inner face offset by -out_n*thick; the arch soffit in `shade`."""
    d = p1 - p0
    W = np.linalg.norm(d)
    e = d / W
    r = arch_w / 2
    u0, u1 = (W - arch_w) / 2, (W + arch_w) / 2
    arch = [(u0, 0), (u0, spring)] + [(W / 2 - r * np.cos(t), spring + r * np.sin(t)) for t in np.linspace(0, np.pi, segs + 1)[1:-1]] + [(u1, spring), (u1, 0)]
    arch = np.array(arch)
    rect_corners = np.array([(0, 0), (0, h), (W, h), (W, 0)])
    # sample the rect boundary at the arch's arc-length fractions, plus its two top corners
    def cum(P):
        s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
        return s / s[-1]
    fa = cum(arch)
    fr = cum(rect_corners)
    fr_all = np.unique(np.concatenate([fa, fr[1:3]]))
    def at(P, f):
        s = cum(P)
        return np.stack([np.interp(f, s, P[:, 0]), np.interp(f, s, P[:, 1])], 1)
    A2, R2 = at(arch, fr_all), at(rect_corners, fr_all)
    n = len(fr_all)
    for face, off, flip in (("out", 0.0, False), ("in", -thick, True))[: 2 if inner else 1]:
        def to3(P):
            return p0[None] + e[None] * P[:, :1] + np.array([0, 1.0, 0])[None] * (P[:, 1:2] + y0) + out_n[None] * off
        V = np.vstack([to3(R2), to3(A2)])
        F = []
        for i in range(n - 1):
            a, b, c, d2 = i, i + 1, n + i, n + i + 1
            F += [[a, c, d2], [a, d2, b]]
        F = np.array(F)
        nrm = np.cross(V[F[0, 1]] - V[F[0, 0]], V[F[0, 2]] - V[F[0, 0]])
        want = out_n if not flip else -out_n
        if nrm @ want < 0:
            F = F[:, ::-1]
        UV = np.vstack([R2, A2]) + [u_off, y0]
        m.add(mat, V, F, UV / uv_t, crease=30)
    # soffit/reveals
    Vo = p0[None] + e[None] * arch[:, :1] + np.array([0, 1.0, 0])[None] * (arch[:, 1:2] + y0)
    Vi = Vo - out_n[None] * thick
    V = np.vstack([Vo, Vi])
    k = len(arch)
    F = []
    for i in range(k - 1):
        F += [[i, i + 1, k + i + 1], [i, k + i + 1, k + i]]
    F = np.array(F)
    # reveals face into the opening (toward the arch centre)
    ctr = p0 + e * (W / 2) + np.array([0, y0 + spring * 0.6, 0]) - out_n * thick / 2
    fc = V[F].mean(1)
    nrm = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    bad = (nrm * (ctr - fc)).sum(1) < 0
    F[bad] = F[bad][:, ::-1]
    m.add(shade, V, F, None, crease=40)


def solid_panel(m, p0, p1, y0, h, out_n, mat, thick, uv_t, u_off, both=True):
    d = p1 - p0
    W = np.linalg.norm(d)
    for off, want in ((0.0, out_n), (-thick, -out_n)) if both else ((0.0, out_n),):
        V = np.array([p0, p1, p1 + [0, h, 0], p0 + [0, h, 0]]) + [0, y0, 0] + out_n * off
        F = np.array([[0, 1, 2], [0, 2, 3]])
        if np.cross(V[1] - V[0], V[2] - V[0]) @ want < 0:
            F = F[:, ::-1]
        m.add(mat, V, F, np.array([[0, y0], [W, y0], [W, y0 + h], [0, y0 + h]]) / uv_t + [u_off / uv_t, 0], crease=20)


def quad_facing(m, mat, V, want, uv=None, crease=20):
    V = np.asarray(V, float)
    F = np.array([[0, 1, 2], [0, 2, 3]])
    if np.cross(V[1] - V[0], V[2] - V[0]) @ want < 0:
        F = F[:, ::-1]
    m.add(mat, V, F, uv, crease=crease)


def colosseum(lod):
    """Elliptical amphitheatre, 180 x 150 m, 47.5 m tall: three arcaded storeys and an attic on the outer ring, an inner
    arcaded ring, stepped cavea, arena wall and sand floor; the outer ring is broken down on the -Z side."""
    m = geo.Mesh()
    nb = (80, 80, 40)[lod]
    asegs = (8, 3, 2)[lod]
    T = 7.2
    phis = np.linspace(0, 2 * np.pi, nb + 1)
    P = ell(A_OUT, B_OUT, phis)
    Pin = ell(A_OUT - 7.0, B_OUT - 7.0, phis)
    # outer ring height per bay (storeys standing: 4 = full with attic); ruined sector around -Z (phi ~ 270 deg)
    deg = np.degrees((phis[:-1] + phis[1:]) / 2)
    dist = np.abs(((deg - 270) + 180) % 360 - 180)
    stand = np.where(dist < 38, 1, np.where(dist < 44, 2, np.where(dist < 49, 3, 4)))
    tops = np.array([STOREYS[1], STOREYS[2], STOREYS[3], ATTIC_TOP])[stand - 1]
    u = 0.0
    for k in range(nb):
        p0, p1 = P[k], P[k + 1]
        mid = (p0 + p1) / 2
        n_out = np.array([mid[0] / A_OUT ** 2, 0, mid[2] / B_OUT ** 2]); n_out /= np.linalg.norm(n_out)
        W = np.linalg.norm(p1 - p0)
        for s in range(min(stand[k], 3)):
            y0 = STOREYS[s]
            h = 10.5
            ent = 1.7
            if lod == 2:
                solid_panel(m, p0, p1, y0, h, n_out, "stone", WALL_T, T, u, both=False)
                V = [p0 + (p1 - p0) * 0.2 + [0, y0, 0] + n_out * 0.02, p0 + (p1 - p0) * 0.8 + [0, y0, 0] + n_out * 0.02,
                     p0 + (p1 - p0) * 0.8 + [0, y0 + 7.2, 0] + n_out * 0.02, p0 + (p1 - p0) * 0.2 + [0, y0 + 7.2, 0] + n_out * 0.02]
                quad_facing(m, "shade", V, n_out)
            else:
                aw = 0.6 * W
                arch_panel(m, p0, p1, y0, h, n_out, "stone", "shade", WALL_T, aw, h - ent - aw / 2 - 0.6, asegs, T, u, inner=lod == 0)
            # entablature band
            if lod < 2:
                V, F, UV = geo.box([0, 0, 0], [W + 0.25, ent * 0.6, 0.7], faces="yYzZ")
                ang = np.arctan2(*(p1 - p0)[[0, 2]][::-1]) if False else np.arctan2((p1 - p0)[0], (p1 - p0)[2])
                Rr = geo.rot_y(ang - np.pi / 2)
                m.add("stone", V @ Rr.T + mid + [0, y0 + h - ent * 0.3, 0] + n_out * 0.25, F, uv_scale(UV, T))
            if lod == 0:
                for q in (p0,):
                    c = q + n_out * 0.25
                    Vc, Fc, UVc = geo.cylinder(c + [0, y0 + 0.3, 0], c + [0, y0 + h - ent, 0], 0.5, segs=8)
                    m.add("stone", Vc, Fc, uv_scale(UVc, T), crease=50)
        if stand[k] == 4:
            y0, h = STOREYS[3], ATTIC_TOP - STOREYS[3]
            solid_panel(m, p0, p1, y0, h, n_out, "stone", WALL_T, T, u)
            if lod < 2 and k % 2 == 0:
                c = mid + n_out * 0.02
                e = (p1 - p0) / W
                V = [c - e * 0.9 + [0, y0 + 5.5, 0], c + e * 0.9 + [0, y0 + 5.5, 0], c + e * 0.9 + [0, y0 + 7.7, 0], c - e * 0.9 + [0, y0 + 7.7, 0]]
                quad_facing(m, "shade", V, n_out)
            if lod < 2:
                V, F, UV = geo.box([0, 0, 0], [W + 0.3, 2.5, 1.0], faces="yYzZ")
                Rr = geo.rot_y(np.arctan2((p1 - p0)[0], (p1 - p0)[2]) - np.pi / 2)
                m.add("stone", V @ Rr.T + mid + [0, ATTIC_TOP + 1.25, 0] + n_out * 0.2, F, uv_scale(UV, T))
        # wall top cap
        yt = tops[k] if stand[k] < 4 else ATTIC_TOP
        quad_facing(m, "stone", [p0 + [0, yt, 0], p1 + [0, yt, 0], p1 - n_out * WALL_T + [0, yt, 0], p0 - n_out * WALL_T + [0, yt, 0]], [0, 1, 0])
        # end caps where the next bay stands lower or higher
        k2 = (k + 1) % nb
        if tops[k] != tops[k2] and not (stand[k] == 4 and stand[k2] == 4):
            ylo, yhi = sorted((tops[k], tops[k2]))
            want = (P[k + 1] - P[k]) if tops[k] > tops[k2] else (P[k] - P[k + 1])
            q = P[k + 1]
            quad_facing(m, "stone", [q + [0, ylo, 0], q - n_out * WALL_T + [0, ylo, 0], q - n_out * WALL_T + [0, yhi, 0], q + [0, yhi, 0]], want)
        # inner ring: arcaded storeys 1-2, solid third storey; vaults between the rings
        q0, q1 = Pin[k], Pin[k + 1]
        midi = (q0 + q1) / 2
        Wi = np.linalg.norm(q1 - q0)
        for s in range(3):
            y0 = STOREYS[s]
            # solid (the cavea above has no underside), with dark arch-shaped blind openings seen through the outer arcade
            solid_panel(m, q0, q1, y0, 10.5, n_out, "stone", 2.0, T, u, both=False)
            if s < 2 and lod < 2:
                e = (q1 - q0) / Wi
                r = 0.27 * Wi
                c0 = midi + n_out * 0.02 + [0, y0, 0]
                spring = 10.5 - 1.8 - r
                prof = [(-r, 0), (r, 0)] + [(r * np.cos(t), spring + r * np.sin(t)) for t in np.linspace(0, np.pi, asegs + 1)]
                Q = np.array(prof)
                Vb = c0[None] + e[None] * Q[:, :1] + np.array([0, 1.0, 0])[None] * Q[:, 1:2]
                Fb = geo.triangulate(Q)
                if np.cross(Vb[Fb[0, 1]] - Vb[Fb[0, 0]], Vb[Fb[0, 2]] - Vb[Fb[0, 0]]) @ n_out < 0:
                    Fb = Fb[:, ::-1]
                m.add("shade_deep", Vb, Fb, None, crease=10)
        for s, y in enumerate(STOREYS[1:]):
            if tops[k] > y or (y == STOREYS[1] and tops[k] >= y):
                a0, a1 = p0 - n_out * WALL_T, p1 - n_out * WALL_T
                quad_facing(m, "shade", [a0 + [0, y, 0], a1 + [0, y, 0], q1 + [0, y, 0], q0 + [0, y, 0]], [0, -1, 0])
                if tops[k] > y + 0.1 or y == STOREYS[3]:
                    quad_facing(m, "stone", [a0 + [0, y, 0], a1 + [0, y, 0], q1 + [0, y, 0], q0 + [0, y, 0]], [0, 1, 0])
        u += W
    # cavea: steps from the inner ring (y 31.5) down to the arena wall (y 4.5)
    nseg = (160, 64, 40)[lod]
    ph = np.linspace(0, 2 * np.pi, nseg + 1)
    A_AR, B_AR = 44.0, 28.0
    n_steps = (14, 5, 1)[lod]
    a_top, b_top = A_OUT - 9.0, B_OUT - 9.0
    y_top, y_ar = 31.5, 4.5
    for i in range(n_steps):
        t0, t1 = i / n_steps, (i + 1) / n_steps
        a0_, b0_ = a_top + (A_AR - a_top) * t0, b_top + (B_AR - b_top) * t0
        a1_, b1_ = a_top + (A_AR - a_top) * t1, b_top + (B_AR - b_top) * t1
        yA, yB = y_top + (y_ar - y_top) * t0, y_top + (y_ar - y_top) * t1
        if lod == 2:
            R0, R1 = ell(a0_, b0_, ph) + [0, yA, 0], ell(a1_, b1_, ph) + [0, yB, 0]
            rings = [(R0, R1, "seats")]
        else:
            R0 = ell(a0_, b0_, ph) + [0, yA, 0]
            Rm = ell(a0_, b0_, ph) + [0, yB, 0]
            R1 = ell(a1_, b1_, ph) + [0, yB, 0]
            rings = [(R0, Rm, "shade"), (Rm, R1, "seats")]
        for Ra, Rb, mat in rings:
            V = np.vstack([Ra, Rb])
            nn = len(Ra)
            F = np.array([[j, j + 1, nn + j + 1] for j in range(nn - 1)] + [[j, nn + j + 1, nn + j] for j in range(nn - 1)])
            # face inward/up (toward the arena axis and the sky)
            fc = V[F].mean(1)
            nrm = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
            want = -fc * [1, 0, 1] + [0, 40, 0]
            bad = (nrm * want).sum(1) < 0
            F[bad] = F[bad][:, ::-1]
            m.add(mat, V, F, V[:, [0, 2]] / T, crease=20)
    # top walkway between the inner ring and the cavea rim
    Ra, Rb = ell(A_OUT - 9.0, B_OUT - 9.0, ph) + [0, y_top, 0], ell(A_OUT - 7.0, B_OUT - 7.0, ph) + [0, y_top, 0]
    V = np.vstack([Ra, Rb]); nn = len(Ra)
    F = np.array([[j, j + 1, nn + j + 1] for j in range(nn - 1)] + [[j, nn + j + 1, nn + j] for j in range(nn - 1)])
    nrm = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    F[nrm[:, 1] < 0] = F[nrm[:, 1] < 0][:, ::-1]
    m.add("stone", V, F, V[:, [0, 2]] / T, crease=20)
    # arena wall and floor
    Ra, Rb = ell(A_AR, B_AR, ph), ell(A_AR, B_AR, ph) + [0, y_ar, 0]
    V = np.vstack([Ra, Rb]); nn = len(Ra)
    F = np.array([[j, j + 1, nn + j + 1] for j in range(nn - 1)] + [[j, nn + j + 1, nn + j] for j in range(nn - 1)])
    fc = V[F].mean(1); nrm = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    bad = (nrm * (-fc * [1, 0, 1])).sum(1) < 0
    F[bad] = F[bad][:, ::-1]
    m.add("stone", V, F, np.column_stack([np.concatenate([ph, ph]) * 36 / T, V[:, 1] / T]), crease=20)
    if lod < 2:
        for j in range(0, nseg, nseg // 16):
            c = ell(A_AR - 0.03, B_AR - 0.03, np.array([ph[j] + np.pi / nseg]))[0]
            nrm = -np.array([c[0] / A_AR ** 2, 0, c[2] / B_AR ** 2]); nrm /= np.linalg.norm(nrm)
            e = np.cross([0, 1.0, 0], nrm)
            quad_facing(m, "shade", [c - e * 1.2, c + e * 1.2, c + e * 1.2 + [0, 3.0, 0], c - e * 1.2 + [0, 3.0, 0]], nrm)
    Fl = ell(A_AR, B_AR, ph[:-1]) + [0, 0.15, 0]
    V = np.vstack([Fl, [[0, 0.15, 0]]]); c = len(V) - 1
    F = np.array([[c, (j + 1) % nseg, j] for j in range(nseg)])
    if np.cross(V[F[0, 1]] - V[F[0, 0]], V[F[0, 2]] - V[F[0, 0]])[1] < 0:
        F = F[:, ::-1]
    m.add("sand", V, F, V[:, [0, 2]] / 8.0, crease=10)
    stone = texgen.masonry(srgb("#c9b48f"), rows=8, cols=4, seed=9, mortar=0.05, tone=0.06, mortar_dark=0.72)
    mats = [pbr("stone", (1, 1, 1), 0.0, 0.85, tex=0), pbr("shade", srgb("#8a7558"), 0.0, 0.9), pbr("shade_deep", srgb("#3a3026"), 0.0, 0.95),
            pbr("seats", srgb("#b3a27f"), 0.0, 0.9), pbr("sand", srgb("#d8c08f"), 0.0, 0.95)]
    return [("colosseum", m, None)], mats, [(stone, "image/png")], ("outer ring ruined to its first storey around -Z (bays within 38 deg "
                                                                   "of 270 deg), stepped up over 11 deg either side; arena long axis along X")


BUILDERS = {"castle-tower": castle_tower, "windmill": windmill, "cypress": cypress, "colosseum": colosseum}

if __name__ == "__main__":
    build_all(BUILDERS, sys.argv[1:] or list(BUILDERS))
