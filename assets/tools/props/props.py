"""Procedural stylised props: street-lamp, hangar, lighthouse, sailboat (more in props_b.py).

usage: props.py [name ...]   -> work/build/<name>_lod{0,1,2}.glb + work/build/<name>.json
Each builder takes a LOD (0 full, 1 about a quarter, 2 about 6 %) and returns (nodes, materials, images, note).
Frame: Y up, metres, origin on the ground at the centre of the footprint (what stands on the ground)."""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import geo
import texgen
from mats import pbr, srgb

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


# ---------------------------------------------------------------- street lamp

def street_lamp(lod):
    """Modern single-arm street light, 8 m: plinth, tapered pole, swept arm, flat LED head whose underside is `lamp`."""
    m = geo.Mesh()
    seg = (16, 10, 6)[lod]
    V, F, UV = geo.lathe([(0, 0), (0.24, 0), (0.24, 0.45), (0.2, 0.55), (0.13, 0.6), (0, 0.6)], seg)
    m.add("metal", V, F, UV, crease=40)
    V, F, UV = geo.cylinder([0, 0.6, 0], [0, 7.75, 0], 0.11, 0.07, segs=seg, caps=False)
    m.add("metal", V, F, UV, crease=50)
    if lod == 0:
        V, F, UV = geo.box([0, 1.2, 0.105], [0.12, 0.45, 0.02])          # service hatch
        m.add("trim", V, F, UV)
    # arm: quadratic Bezier from the pole top over to the head, as a chain of tubes
    p0, p1, p2 = np.array([0, 7.6, 0]), np.array([0.05, 8.25, 0]), np.array([1.75, 8.15, 0])
    n = (8, 4, 2)[lod]
    pts = [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2 for t in np.linspace(0, 1, n + 1)]
    for a, b in zip(pts[:-1], pts[1:]):
        V, F, UV = geo.cylinder(a, b, 0.055, segs=(10, 6, 4)[lod], caps=False)
        m.add("metal", V, F, UV, crease=60)
    V, F, UV = geo.ellipsoid([0, 7.7, 0], [0.075, 0.12, 0.075], segs=(10, 6, 4)[lod], rings=(6, 4, 2)[lod])
    m.add("metal", V, F, UV, crease=60)
    # head: a slim rounded slab tilted 5 degrees up, lamp panel on its underside
    R = geo.rot_z(np.radians(5))
    c = np.array([2.15, 8.12, 0])
    if lod < 2:
        prof = [(-0.42, 0.0), (-0.4, 0.05), (0.32, 0.07), (0.42, 0.03), (0.44, 0.0)]  # (x, top height)
        V, F, UV = geo.box([0, 0, 0], [0.86, 0.1, 0.34])
        V = V.copy()
        V[:, 1] += np.where(V[:, 1] > 0, np.interp(V[:, 0], [p[0] for p in prof], [p[1] for p in prof]), 0)
        m.add("metal", V @ R.T + c, F, UV, crease=35)
    else:
        V, F, UV = geo.box([0, 0.03, 0], [0.86, 0.16, 0.34])
        m.add("metal", V @ R.T + c, F, UV)
    V, F, UV = geo.box([0.02, -0.055, 0], [0.62, 0.012, 0.24], faces="y")
    m.add("lamp", V @ R.T + c, F, UV)
    mats = [pbr("metal", srgb("#3a3f45"), 0.55, 0.42), pbr("trim", srgb("#202326"), 0.3, 0.5),
            pbr("lamp", (1.0, 0.92, 0.78), 0.0, 0.3, emissive=(1.0, 0.86, 0.66), strength=12.0)]
    return [("street-lamp", m, None)], mats, [], ("pole axis at the origin; the arm and head overhang +X (lamp centre at x 2.15 m, "
                                                  "8.06 m up): yaw the lamp so +X points over the road")


# ---------------------------------------------------------------- hangar

def hangar(lod):
    """Arched-roof aircraft hangar: 40 m wide, 20 m tall, 50 m deep; hangar doors on the +Z end."""
    m = geo.Mesh()
    W, Hh, L, wall = 40.0, 20.0, 50.0, 3.0
    a, b = W / 2, Hh - wall
    n = (40, 20, 10)[lod]
    th = np.linspace(0, np.pi, n + 1)
    arc = np.stack([a * np.cos(th), wall + b * np.sin(th)], 1)            # x, y from +X over the top to -X
    # roof: one strip per arc segment along Z; UV u = metres along the arc, v = metres along Z
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(arc, axis=0), axis=1))])
    V = np.concatenate([np.column_stack([arc[:, 0], arc[:, 1], np.full(n + 1, z)]) for z in (-L / 2, L / 2)])
    F = np.concatenate([[[i, i + n + 2, i + 1], [i, i + n + 1, i + n + 2]] for i in range(n)])
    UV = np.concatenate([np.column_stack([s, np.full(n + 1, z)]) for z in (-L / 2, L / 2)])
    m.add("roof", V, F[:, ::-1], UV / 4.0, crease=20)
    # side walls (concrete, with a window band on LOD0/1)
    for sx in (1, -1):
        V, F, UV = geo.box([sx * (a - 0.15), wall / 2, 0], [0.3, wall, L], faces="X" if sx > 0 else "x")
        m.add("wall", V, F, UV)
        if lod < 2:
            for k, z in enumerate(np.linspace(-L / 2 + 4, L / 2 - 4, 7)):
                V, F, UV = geo.box([sx * (a + 0.01), 1.9, z], [0.02, 0.8, 4.0], faces="X" if sx > 0 else "x")
                m.add("glass", V, F, UV)
    # end walls: arch-shaped, fan-triangulated from the base centre
    for sz in (1, -1):
        P = np.vstack([[[a, 0]], arc, [[-a, 0]]])
        V = np.column_stack([P[:, 0], P[:, 1], np.full(len(P), sz * L / 2)])
        V = np.vstack([V, [[0, 0, sz * L / 2]]])
        c = len(V) - 1
        F = np.array([[c, i, i + 1] for i in range(len(P) - 1)])
        if sz < 0:
            F = F[:, ::-1]
        m.add("wall", V, F, V[:, [0, 1]] / 4.0, crease=10)
    # doors on +Z: six leaves in a steel frame, a clerestory band above
    dw, dh = 36.0, 14.0
    leaves = 6
    for i in range(leaves):
        x = -dw / 2 + (i + 0.5) * dw / leaves
        V, F, UV = geo.box([x, dh / 2, L / 2 + 0.2 + 0.12 * (i % 2)], [dw / leaves - 0.08, dh, 0.25])
        m.add("door", V, F, UV)
        if lod == 0:
            for y in (dh * 0.33, dh * 0.66):
                V, F, UV = geo.box([x, y, L / 2 + 0.35 + 0.12 * (i % 2)], [dw / leaves - 0.4, 0.18, 0.06])
                m.add("trim", V, F, UV)
    V, F, UV = geo.box([0, dh + 0.4, L / 2 + 0.4], [dw + 1.2, 0.8, 0.8])
    m.add("trim", V, F, UV)
    for sx in (1, -1):
        V, F, UV = geo.box([sx * (dw / 2 + 0.4), dh / 2, L / 2 + 0.4], [0.8, dh, 0.8])
        m.add("trim", V, F, UV)
    if lod < 2:
        V, F, UV = geo.box([0, dh + 2.4, L / 2 + 0.01], [24.0, 1.8, 0.02], faces="Z")
        m.add("glass", V, F, UV)
        # personnel door on the back
        V, F, UV = geo.box([8.0, 1.1, -L / 2 - 0.05], [1.1, 2.2, 0.1])
        m.add("door", V, F, UV)
    # external arch ribs
    if lod < 2:
        nr = (11, 6)[lod]
        for z in np.linspace(-L / 2 + 0.3, L / 2 - 0.3, nr):
            for i in range(n):
                p, q = arc[i], arc[i + 1]
                d = q - p
                Lg = np.linalg.norm(d)
                ang = np.arctan2(d[1], d[0])
                nrm = np.array([-d[1], d[0]]) / Lg
                c2 = (p + q) / 2 + nrm * 0.2 * (1 if i < n else 1)
                V, F, UV = geo.box([0, 0, 0], [Lg + 0.05, 0.4, 0.35], faces="yYzZ")
                V = V @ geo.rot_z(ang).T
                # outward is away from the arch centre
                if (c2 - [0, wall]) @ nrm < 0:
                    c2 = (p + q) / 2 - nrm * 0.2
                m.add("trim", V + [c2[0], c2[1], z], F, UV, crease=30)
    roof_tex = texgen.corrugated(srgb("#9aa3a2"), 16)
    mats = [pbr("roof", (1, 1, 1), 0.6, 0.45, tex=0), pbr("wall", srgb("#b8b2a6"), 0.0, 0.85),
            pbr("door", srgb("#5f7a8a"), 0.4, 0.5), pbr("trim", srgb("#3b3f44"), 0.5, 0.5),
            pbr("glass", srgb("#2c3d4c"), 0.2, 0.12)]
    return [("hangar", m, None)], mats, [(roof_tex, "image/png")], "doors face +Z; roof texture tiles every 4 m (corrugation)"


# ---------------------------------------------------------------- lighthouse

def lighthouse(lod):
    """Coastal lighthouse, 25 m: stone plinth, red/white banded tapered tower, gallery, glazed lantern, red dome."""
    m = geo.Mesh()
    seg = (32, 16, 10)[lod]
    V, F, UV = geo.lathe([(0, 0), (4.2, 0), (4.2, 1.2), (3.9, 1.5), (0, 1.5)], (12, 8, 8)[lod])
    m.add("stone", V, F, UV, crease=25)
    r0, r1, y0, y1 = 2.8, 1.85, 1.5, 18.0
    rad = lambda y: r0 + (r1 - r0) * (y - y0) / (y1 - y0)
    bands = np.linspace(y0, y1, 6)
    for i in range(5):
        ya, yb = bands[i], bands[i + 1]
        V, F, UV = geo.lathe([(rad(ya), ya), (rad(yb), yb)], seg, close=True)
        m.add("paint_red" if i % 2 else "paint_white", V, F, UV, crease=50)
    if lod < 2:
        # door and windows: dark recessed panels on the tower surface
        def panel(y, ang, w, h, mat="trim"):
            r = rad(y) + 0.02
            V, F, UV = geo.box([0, 0, 0], [w, h, 0.06])
            Rr = geo.rot_y(ang)
            m.add(mat, V @ Rr.T + Rr @ [0, y, r], F, UV)
        panel(1.5 + 1.15, 0.0, 1.1, 2.3, "door")
        if lod == 0:
            V, F, UV = geo.box([0, 1.5 + 2.45, rad(3.9) + 0.12], [1.5, 0.22, 0.3])
            m.add("stone", V, F, UV)
        for k, y in enumerate((6.0, 9.5, 13.0, 16.0)):
            panel(y, np.pi * 0.5 * k + 0.6, 0.5, 0.9)
    # gallery: corbelled deck, railing
    V, F, UV = geo.lathe([(rad(17.4), 17.4), (2.7, 18.0), (2.75, 18.25), (0, 18.25)], seg)
    m.add("paint_white", V, F, UV, crease=30)
    if lod < 2:
        npost = (24, 12)[lod]
        for k in range(npost):
            a = 2 * np.pi * k / npost
            V, F, UV = geo.box([0, 18.8, 2.6], [0.06, 1.1, 0.06])
            m.add("iron", V @ geo.rot_y(a).T, F, UV)
        for y in ((19.3, 18.8) if lod == 0 else (19.3,)):
            V, F, UV = geo.lathe([(2.56, y - 0.04), (2.64, y - 0.04), (2.64, y + 0.04), (2.56, y + 0.04), (2.56, y - 0.04)], seg)
            m.add("iron", V, F, UV, crease=60)
    # lantern room: low wall, glazing with astragals, lamp, dome
    V, F, UV = geo.lathe([(1.5, 18.25), (1.5, 19.0), (1.45, 19.1)], seg)
    m.add("paint_red", V, F, UV, crease=50)
    V, F, UV = geo.lathe([(1.42, 19.1), (1.42, 21.4)], (16, 10, 8)[lod])
    m.add("glass", V, F, UV, crease=30)
    if lod < 2:
        nm = (10, 6)[lod]
        for k in range(nm):
            a = 2 * np.pi * k / nm
            V, F, UV = geo.box([0, 20.25, 1.44], [0.08, 2.3, 0.06])
            m.add("iron", V @ geo.rot_y(a).T, F, UV)
    V, F, UV = geo.ellipsoid([0, 20.2, 0], [0.55, 0.7, 0.55], segs=(12, 8, 6)[lod], rings=(8, 6, 4)[lod])
    m.add("lamp", V, F, UV, crease=80)
    V, F, UV = geo.lathe([(1.65, 21.4), (1.6, 21.6), (1.3, 22.4), (0.7, 23.0), (0.2, 23.25), (0, 23.3)], seg)
    m.add("paint_red", V, F, UV, crease=60)
    V, F, UV = geo.lathe([(1.42, 21.4), (1.65, 21.4)], seg)
    m.add("paint_red", V[::1], F[:, ::-1], UV, crease=60)
    V, F, UV = geo.ellipsoid([0, 23.5, 0], [0.25, 0.25, 0.25], segs=(10, 6, 4)[lod], rings=(6, 4, 2)[lod])
    m.add("iron", V, F, UV, crease=80)
    V, F, UV = geo.cylinder([0, 23.6, 0], [0, 25.0, 0], 0.035, 0.015, segs=(6, 4, 3)[lod])
    m.add("iron", V, F, UV)
    mats = [pbr("stone", srgb("#8d8a83"), 0.0, 0.9), pbr("paint_white", srgb("#ece9e1"), 0.0, 0.6),
            pbr("paint_red", srgb("#b3221c"), 0.0, 0.55), pbr("door", srgb("#2f4a5c"), 0.0, 0.6),
            pbr("trim", srgb("#1d2328"), 0.0, 0.5), pbr("iron", srgb("#1a1c1e"), 0.6, 0.45),
            pbr("glass", (0.25, 0.32, 0.35), 0.0, 0.05, alpha=0.3),
            pbr("lamp", (1.0, 0.95, 0.8), 0.0, 0.2, emissive=(1.0, 0.9, 0.65), strength=20.0)]
    return [("lighthouse", m, None)], mats, [], "lamp centre at y 20.2 m (sphere `lamp` behind `glass`, alpha 0.3)"


# ---------------------------------------------------------------- sailboat

def hull_section(z, L=10.0):
    """Half-breadth, sheer height and keel depth at station z (bow +Z at 5.0, transom at -4.6)."""
    t = (z + 0.4) / 5.4                        # 0 at max beam (z = -0.4), 1 at the bow
    if t >= 0:
        w = 1.65 * (1 - t ** 1.9) ** 0.75
    else:
        w = 1.65 - 0.55 * (-(z + 0.4) / 4.2) ** 1.6
    sheer = 0.95 + 0.35 * max(0, (z - 0.5) / 4.5) ** 2 + 0.08 * max(0, (-z - 2) / 2.6)
    keel = -0.55 * (1 - max(0, (z - 1.0) / 4.0) ** 1.5) + 0.25 * max(0, (-z - 2.2) / 2.4)
    return max(w, 0.0), sheer, min(keel, sheer - 0.05)


def sailboat(lod):
    """10 m sloop floating on y = 0: white hull with a navy boot stripe and red antifouling, teak deck, cabin trunk,
    13.5 m mast, boom, mainsail and jib (double-sided cloth), stays."""
    m = geo.Mesh()
    nst = (36, 16, 8)[lod]
    zs = np.linspace(-4.6, 5.0, nst + 1)
    # section points from the deck edge to the keel line; rows at y = 0.15 and -0.05 bound the boot stripe
    fr = [1.0, 0.985, 0.95, 0.8, 0.45, 0.0]

    def pts(z):
        w, sh, kl = hull_section(z)
        ys = [sh, 0.15, -0.05, kl * 0.55, kl * 0.88, kl]
        ys = [max(min(y, sh), kl) for y in ys]
        return [(w * f, y) for f, y in zip(fr, ys)]
    grid = np.array([[[x, y, z] for x, y in pts(z)] for z in zs])       # (stations, rows, 3)
    rows = grid.shape[1]
    mats_row = ["hull", "stripe", "antifoul", "antifoul", "antifoul"]
    for side in (1, -1):
        for r in range(rows - 1):
            V = grid[:, r:r + 2].reshape(-1, 3) * [side, 1, 1]
            F = []
            for i in range(nst):
                a, b, c, d = 2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 3
                F += [[a, b, d], [a, d, c]] if side > 0 else [[a, d, b], [a, c, d]]
            m.add(mats_row[r], V, np.array(F), None, crease=40)
    # transom: flat panel at the stern, split at the stripe rows
    st = grid[0]
    for r in range(rows - 1):
        q = [st[r] * [1, 1, 1], st[r + 1], st[r + 1] * [-1, 1, 1], st[r] * [-1, 1, 1]]
        V = np.array(q)
        m.add(mats_row[r], V, np.array([[0, 2, 1], [0, 3, 2]]), None, crease=10)
    # deck: cambered surface over the sheer line
    deck = []
    for z in zs:
        w, sh, _ = hull_section(z)
        deck.append([[-w, sh, z], [0, sh + 0.06 * (w > 0.05), z], [w, sh, z]])
    deck = np.array(deck)
    V = deck.reshape(-1, 3)
    F = []
    for i in range(nst):
        for j in range(2):
            a, b = 3 * i + j, 3 * i + j + 1
            c, d = a + 3, b + 3
            F += [[a, b, d], [a, d, c]]
    m.add("deck", V, np.array(F)[:, ::-1], V[:, [0, 2]] / 2.0, crease=30)
    # toe rail along the sheer (LOD0/1)
    if lod < 2:
        for side in (1, -1):
            for i in range(nst):
                p = grid[i, 0] * [side, 1, 1]; q = grid[i + 1, 0] * [side, 1, 1]
                V, F, UV = geo.cylinder(p + [0, 0.04, 0], q + [0, 0.04, 0], 0.03, segs=4, caps=False)
                m.add("deck", V, F, UV, crease=60)
    # cabin trunk with windows, cockpit coaming
    sh_mid = hull_section(0.0)[1]
    V, F, UV = geo.box([0, sh_mid + 0.28, 0.3], [1.9, 0.5, 3.0], faces="xXzZY")
    m.add("hull", V, F, UV)
    if lod < 2:
        for sx in (1, -1):
            V, F, UV = geo.box([sx * 0.955, sh_mid + 0.33, 0.3], [0.02, 0.16, 2.0], faces="X" if sx > 0 else "x")
            m.add("glass", V, F, UV)
        V, F, UV = geo.box([0, sh_mid + 0.2, -2.4], [1.9, 0.3, 2.2], faces="xXzZ")
        m.add("deck", V, F, UV)
    # keel fin and rudder (below the waterline)
    V, F, UV = geo.box([0, -1.15, 0.0], [0.18, 1.2, 1.3])
    m.add("antifoul", V, F, UV)
    V, F, UV = geo.box([0, -0.5, -3.9], [0.08, 0.9, 0.6])
    m.add("antifoul", V, F, UV)
    # rig: mast, boom, sails, stays
    mz = 1.2
    mast_top = 13.5
    V, F, UV = geo.cylinder([0, sh_mid + 0.5, mz], [0, mast_top, mz], 0.09, 0.06, segs=(10, 6, 4)[lod])
    m.add("spar", V, F, UV, crease=60)
    boom_y = sh_mid + 1.6
    V, F, UV = geo.cylinder([0, boom_y, mz - 0.1], [0, boom_y + 0.1, -3.4], 0.06, segs=(8, 5, 4)[lod])
    m.add("spar", V, F, UV, crease=60)
    # mainsail: luff on the mast, foot on the boom, leech curving; slight camber to +X
    nu, nv = ((6, 10), (3, 5), (1, 2))[lod]
    tack, head, clew = np.array([0, boom_y + 0.1, mz - 0.15]), np.array([0, mast_top - 0.3, mz - 0.1]), np.array([0, boom_y + 0.2, -3.3])
    Vs = []
    for j in range(nv + 1):
        v = j / nv
        lp = tack + (head - tack) * v
        rp = clew + (head - clew) * v
        rp = rp + np.array([0, 0, -0.9 * np.sin(np.pi * v) * (1 - v * 0.3)]) * (1 - v)  # roach
        for i in range(nu + 1):
            u = i / nu
            p = lp + (rp - lp) * u
            p[0] += 0.35 * np.sin(np.pi * u) * (1 - v)
            Vs.append(p)
    Fs = []
    for j in range(nv):
        for i in range(nu):
            a = j * (nu + 1) + i
            b, c, d = a + 1, a + nu + 1, a + nu + 2
            Fs += [[a, b, d], [a, d, c]]
    m.add("sail", np.array(Vs), np.array(Fs), None, crease=60)
    # jib: from the bow fitting to near the masthead, clew aft of the mast
    jt, jh, jc = np.array([0, hull_section(4.8)[1] + 0.1, 4.75]), np.array([0, mast_top - 1.6, mz + 0.12]), np.array([0.55, sh_mid + 0.9, -0.3])
    Vj, Fj = [], []
    nj = (6, 3, 1)[lod]
    for j in range(nj + 1):
        v = j / nj
        Vj += [jt + (jh - jt) * v, jc + (jh - jc) * v + np.array([0.25, 0, 0]) * np.sin(np.pi * v)]
    for j in range(nj):
        a = 2 * j
        Fj += [[a, a + 1, a + 3], [a, a + 3, a + 2]]
    m.add("sail", np.array(Vj), np.array(Fj), None, crease=60)
    if lod < 2:
        bow = np.array([0, hull_section(4.9)[1], 4.9])
        stern = np.array([0, hull_section(-4.5)[1], -4.5])
        for a, b in ((bow, [0, mast_top - 0.2, mz]), (stern, [0, mast_top - 0.2, mz]),
                     ([1.5, sh_mid + 0.05, mz - 0.3], [0, mast_top - 0.6, mz]), ([-1.5, sh_mid + 0.05, mz - 0.3], [0, mast_top - 0.6, mz])):
            V, F, UV = geo.cylinder(a, b, 0.012, segs=3, caps=False)
            m.add("rigging", V, F, UV, crease=80)
    mats = [pbr("hull", srgb("#f2f0ea"), 0.0, 0.35, clearcoat=0.1), pbr("stripe", srgb("#1d3557"), 0.0, 0.35),
            pbr("antifoul", srgb("#8f2a22"), 0.0, 0.8), pbr("deck", srgb("#b0875a"), 0.0, 0.75),
            pbr("glass", srgb("#1a2630"), 0.0, 0.08), pbr("spar", srgb("#c9cdd1"), 0.8, 0.3),
            pbr("sail", srgb("#f4f1e8"), 0.0, 0.7, double=True), pbr("rigging", srgb("#2a2a2a"), 0.5, 0.5)]
    m = m.shifted([0, 0, -0.205])   # centre the hull's length on the origin
    return [("sailboat", m, None)], mats, [], "waterline at y = 0 (keel and rudder below it); bow on +Z; sails are double-sided"


BUILDERS = {"street-lamp": street_lamp, "hangar": hangar, "lighthouse": lighthouse, "sailboat": sailboat}


def build_all(builders, names):
    os.makedirs(f"{ROOT}/work/build", exist_ok=True)
    for name in names:
        rec = {"name": name, "lods": []}
        for lod in (0, 1, 2):
            nodes, mats, images, note = builders[name](lod)
            path = f"{ROOT}/work/build/{name}_lod{lod}.glb"
            size = geo.write(path, nodes, mats, images)
            los, his, tris = [], [], 0
            for nn, mesh, tr in nodes:
                lo, hi = mesh.bounds()
                t = np.zeros(3) if tr is None else np.asarray(tr)
                los.append(lo + t); his.append(hi + t); tris += mesh.tris()
            lo, hi = np.min(los, 0), np.max(his, 0)
            rec["lods"].append(dict(lod=lod, path=os.path.relpath(path, ROOT), tris=int(tris), bytes=size,
                                    bounds_m=[lo.tolist(), hi.tolist()], nodes=[n for n, _, _ in nodes],
                                    materials=[mm["name"] for mm in mats]))
            rec["note"] = note
            print(name, lod, tris, size, np.round(lo, 2).tolist(), np.round(hi, 2).tolist(), flush=True)
        json.dump(rec, open(f"{ROOT}/work/build/{name}.json", "w"), indent=1)


if __name__ == "__main__":
    build_all(BUILDERS, sys.argv[1:] or list(BUILDERS))
