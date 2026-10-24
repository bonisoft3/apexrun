"""Cartoon props: a saguaro, an Ionic column, a wooden power pole. Same SDF pipeline as the rocks (build.py)."""
import numpy as np
import toon
from build import Model, Part
from mats import pbr, srgb
from rocks import paint_up


def arm(start, out, rise, elbow, r0, r1, n=14):
    """Saguaro arm polyline: from `start` along the horizontal unit `out`, an elbow of radius `elbow` turning up, then
    `rise` metres straight up; radius r0 at the start to r1 at the tip. -> (points, radii)."""
    start, out = np.asarray(start, float), np.asarray(out, float)
    up = np.array([0.0, 1.0, 0.0])
    a = np.linspace(-np.pi / 2, 0, n)
    arc = start + up * elbow + elbow * (np.cos(a)[:, None] * out + np.sin(a)[:, None] * up)
    pts = np.vstack([arc, arc[-1] + up * rise])
    return pts, np.linspace(r0, r1, len(pts))


CACTUS = [pbr("cactus", srgb("#5aa845"), 0.0, 0.75), pbr("cactus_tip", srgb("#a3d25a"), 0.0, 0.75)]


def cactus():
    """2.93 x 4.6 x 1.61 m saguaro: a ribbed trunk with a domed crown, two big arms elbowing out to the sides and up, a
    small arm budding toward the back; arms join the trunk with soft fillets; lighter green crowns."""
    H, R = 4.6, 0.3
    trunk = toon.tube([(0, -0.6, 0), (0, H - R, 0)], [R * 1.04, R * 0.94], ribs=12, depth=0.09, ref=(1, 0, 0), fade=1.4)
    arms = [((0.25, 1.35, 0), (1, 0, 0), 0.95, 0.42, 0.21, 0.19, 1.5),
            ((-0.25, 1.95, 0.02), (-1, 0, 0), 0.85, 0.4, 0.2, 0.18, 1.4),
            ((0.02, 2.75, -0.22), (0, 0, -1), 0.42, 0.26, 0.15, 0.135, 0.7)]
    fields, tips = [trunk], [(0, H, 0, R)]
    for base, out, reach, elbow, r0, r1, rise in arms:
        base, out = np.asarray(base, float), np.asarray(out, float)
        start = base + out * (reach - elbow)
        pts, rad = arm(start, out, rise, elbow, r0, r1)
        pts = np.vstack([base, pts])
        rad = np.concatenate([[r0], rad])
        ref = np.cross(out, [0, 1, 0])
        fields.append(toon.tube(pts, rad, ribs=10, depth=0.09, ref=ref, fade=1.4))
        tip = pts[-1] + np.array([0, rad[-1], 0])
        tips.append((*tip, rad[-1]))

    def f(P):
        v = fields[0](P)
        for g in fields[1:]:
            v = toon.smin(v, g(P), 0.14)
        return v
    T = np.array(tips)

    def crown(P):
        """Positive on a crown: within 1.2 radii of a tip's apex."""
        return (1.2 * T[None, :, 3] - np.linalg.norm(P[:, None, :] - T[None, :, :3], axis=2)).max(1)
    part = Part(f=f, box=((-1.8, -0.2, -1.2), (1.8, 5.0, 1.2)), h=0.012, mat="cactus", tris=(3900, 1080, 280),
                splits=[(crown, None, "cactus_tip", {"cactus"})], refine=0.0)
    return Model(parts=[part], materials=CACTUS, budget=(4000, 1100, 290),
                 note="saguaro, 4.6 m: a ribbed trunk (12 soft grooves) with a domed crown, two arms elbowing out to +-x and "
                      "up, a small arm budding toward -z, filleted joints; materials cactus (green), cactus_tip (light green "
                      "crowns)", paint=paint_up(H, 0.85, (0.95, 0.95, 0.85)), ao_reach=0.9)


def torus(c, R, r):
    """Horizontal torus about the vertical axis through c."""
    c = np.asarray(c, float)

    def f(P):
        q = P - c
        return np.hypot(np.hypot(q[:, 0], q[:, 2]) - R, q[:, 1]) - r
    return f


def chip(corner, n, depth, reach):
    """Removal region for a weathered chip: the part of a ball of radius `reach` about `corner` beyond the plane `depth`
    inside the corner along n. -> SDF of the region to subtract (negative inside)."""
    c = np.asarray(corner, float)
    n = np.asarray(n, float) / np.linalg.norm(n)
    p = c - depth * n
    return lambda P: np.maximum(-(P - p) @ n, np.linalg.norm(P - c, axis=1) - reach)


MARBLE = [pbr("marble", srgb("#efe5cf"), 0.0, 0.55)]


def lathe_part(prof, plan, mat, ground=False, centre=(0.0, 0.0), h=0.01):
    """A Part lathed from an (r, y) profile (bottom to top) about the vertical through (centre x, z): plan[lod] =
    (segments, profile point indices); its field is the revolve of r(y)."""
    p = np.asarray(prof, float)
    ry = lambda y: np.interp(y, p[:, 1], p[:, 0])
    f = toon.revolve(ry, p[0, 1], p[-1, 1], centre)
    off = np.array([centre[0], 0.0, centre[1]])

    def explicit(lod):
        segs, idx = plan[lod]
        q = p[idx]
        th = 2 * np.pi * (np.arange(segs) + 0.5) / segs
        V, F = toon.lathe_grid(np.repeat(q[:, 0:1], segs, 1), q[:, 1], th)
        return V + off, F
    tris = tuple(len(explicit(l)[1]) for l in range(3))
    return Part(f=f, box=None, h=h, mat=mat, tris=tris, explicit=explicit, normal=toon.lathe_normal_fn(p, centre),
                ground=ground)


def lathe_z_part(prof, plan, centre, mat):
    """lathe_part about a horizontal axis along z through centre (x, y): the profile is (r, z), walked from the -z face
    outward, along the drum, then inward over the +z face (z need not be monotonic; the AO field is the bounding drum)."""
    p = np.asarray(prof, float)
    c = np.array([centre[0], centre[1], 0.0])
    R = toon.rot_x(-np.pi / 2)          # world z -> local y
    loc = lambda P: (P - c) @ R.T
    rmax = p[:, 0].max()
    fl = toon.revolve(lambda z: np.full_like(z, rmax), p[:, 1].min(), p[:, 1].max())   # the drum, for AO
    nl = toon.lathe_normal_fn(p)

    def explicit(lod):
        segs, idx = plan[lod]
        q = p[idx]
        th = 2 * np.pi * (np.arange(segs) + 0.5) / segs
        V, F = toon.lathe_grid(np.repeat(q[:, 0:1], segs, 1), q[:, 1], th)
        return V @ R + c, F
    tris = tuple(len(explicit(l)[1]) for l in range(3))
    return Part(f=lambda P: fl(loc(P)), box=None, h=0.006, mat=mat, tris=tris, explicit=explicit,
                normal=lambda P: nl(loc(P)) @ R, ground=False)


def arc(c, r, a0, a1, n):
    """(r, y) points on a circle about c from angle a0 to a1 (radians, 0 = outward, pi/2 = up)."""
    a = np.linspace(a0, a1, n)
    return np.stack([c[0] + r * np.cos(a), c[1] + r * np.sin(a)], 1)


def column():
    """An Ionic column 5.2 m tall: a square plinth, an Attic base (two tori and a scotia), a shaft of 24 flutes with
    entasis, an astragal and echinus, a volute capital (scroll drums front and back), a thin abacus; weathered chips off
    the plinth. The base, shaft, echinus and volutes are lathed grids (clean flutes and rings), the rest SDF shells."""
    H0, H1, F = 0.6, 4.56, 24
    rs = lambda y: 0.46 - 0.06 * np.clip((y - H0) / (H1 - H0), 0, 1) ** 1.5
    fade = lambda y: (lambda e: e * e * (3 - 2 * e))(np.clip(np.minimum(y - H0 - 0.04, H1 - 0.04 - y) / 0.16, 0, 1))
    flute = lambda th: np.clip((np.cos(F * th) + 0.3) / 1.3, 0, 1) ** 0.7
    A = 0.032

    def shaft_f(P):
        y = np.clip(P[:, 1], H0 - 0.04, H1 + 0.04)
        th = np.arctan2(P[:, 0], P[:, 2])
        d = np.hypot(P[:, 0], P[:, 2]) - rs(y) + A * fade(y) * flute(th)
        return np.maximum(d, np.maximum(H0 - 0.04 - P[:, 1], P[:, 1] - H1 - 0.04))
    shaft_rows = {0: [0, 0.08, 0.2, 1.9, 3.76, 3.88, 3.96], 1: [0, 0.2, 3.76, 3.96], 2: [0, 3.96]}
    shaft_segs = {0: 4 * F, 1: F, 2: F // 2}

    def shaft_mesh(lod):
        ys = H0 - 0.04 + np.array(shaft_rows[lod])
        M = shaft_segs[lod]
        th = 2 * np.pi * (np.arange(M) + (0.0 if lod == 0 else 0.5)) / M   # LOD1, LOD2: plain 24- and 12-gons on the ridges
        R = rs(ys)[:, None] - (A * fade(ys)[:, None] * flute(th)[None] if lod == 0 else 0)
        return toon.lathe_grid(np.broadcast_to(R, (len(ys), M)).copy(), ys, th)
    shaft = Part(f=shaft_f, box=None, h=0.01, mat="marble", tris=tuple(len(shaft_mesh(l)[1]) for l in range(3)),
                 explicit=shaft_mesh, ground=False)
    # base: plinth top, lower torus (5 points), scotia, upper torus (3 points), into the shaft
    base_prof = np.vstack([[[0.5, 0.22]], arc((0.55, 0.36), 0.095, -np.pi / 2, np.pi / 2, 5), [[0.475, 0.49]],
                           arc((0.5, 0.56), 0.065, -np.pi / 2, np.pi / 2, 3), [[0.45, 0.64]]])
    base = lathe_part(base_prof, {0: (24, np.arange(11)), 1: (16, [0, 1, 3, 5, 6, 8, 10]), 2: (8, [0, 3, 10])}, "marble")
    # astragal (3 points) then the echinus' ovolo up under the volutes
    top_prof = np.vstack([[[0.38, 4.5]], arc((0.405, H1 + 0.03), 0.04, -np.pi / 2, np.pi / 2, 3),
                          [[0.44, 4.63], [0.52, 4.69], [0.56, 4.76], [0.4, 4.84]]])
    echinus = lathe_part(top_prof, {0: (24, np.arange(8)), 1: (16, [0, 2, 4, 5, 6, 7]), 2: (8, [0, 2, 7])}, "marble")
    # a volute: a drum on a front-back axis whose faces carry a cartoon scroll (an eye, two raised rings, a rim)
    face = [(0.035, 0.0), (0.06, -0.012), (0.085, -0.004), (0.11, -0.028), (0.14, -0.012), (0.175, -0.03), (0.215, -0.012),
            (0.25, -0.02)]
    half = 0.46
    scroll = [(r, -half - dz) for r, dz in face]
    vol_prof = np.vstack([scroll, arc((0.25, -half + 0.03), 0.03, -np.pi / 2, 0, 3)[1:], [[0.28, 0.0]],
                          arc((0.25, half - 0.03), 0.03, 0, np.pi / 2, 3)[:-1], [(r, -z) for r, z in scroll[::-1]]])
    vol_plan = {0: (18, [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 15, 16, 17, 18, 19, 20]), 1: (10, [0, 1, 3, 5, 8, 12, 15, 17, 19, 20]),
                2: (6, [0, 8, 12, 20])}
    volutes = [lathe_z_part(vol_prof, vol_plan, (sx * 0.6, 4.8), "marble") for sx in (-1, 1)]
    channel = toon.rbox((0, 4.93, 0), (0.6, 0.13, 0.42), 0.03)
    plinth_box = toon.rbox((0, 0.13, 0), (0.72, 0.14, 0.72), 0.03)
    pchips = [chip((0.72, 0.27, 0.72), (1, 1.2, 1), 0.07, 0.25), chip((-0.72, 0.27, -0.72), (-1, 0.4, -1), 0.05, 0.2)]

    def plinth(P):
        v = plinth_box(P)
        for ch in pchips:
            v = toon.smax(v, -ch(P), 0.015)
        return v
    parts = [Part(f=plinth, box=((-0.9, -0.1, -0.9), (0.9, 0.4, 0.9)), h=0.008, mat="marble", refine=0.15),
             base, shaft, echinus, *volutes,
             Part(f=channel, box=((-0.8, 4.6, -0.6), (0.8, 5.2, 0.6)), h=0.008, mat="marble", ground=False),
             Part(f=toon.rbox((0, 5.135, 0), (0.66, 0.065, 0.55), 0.02), box=((-0.8, 5.0, -0.7), (0.8, 5.3, 0.7)), h=0.006,
                  mat="marble", ground=False)]
    return Model(parts=parts, materials=MARBLE, budget=(4000, 1100, 320),
                 note="Ionic column, 5.2 m: square plinth, Attic base (two tori, scotia), a lathed shaft of 24 flutes with "
                      "entasis and rounded flute ends, astragal and echinus, a volute capital (two drums whose faces carry "
                      "a cartoon scroll of rings, front and back on +-z, joined by a cushion), thin abacus, weathered chips off "
                      "the plinth; separate closed shells; material marble (cream)", paint=paint_up(5.2, 0.86, (0.94, 0.95, 0.86)), ao_reach=1.0)


WOOD = pbr("wood", srgb("#a07850"), 0.0, 0.85)
POLE = [WOOD, pbr("metal", srgb("#5d6266"), 0.4, 0.55), pbr("glass", srgb("#4fb8a0"), 0.0, 0.25)]


def insulator(x, y, z):
    """A glass pin insulator standing on (x, y, z), 0.15 m tall: a foot, two skirts and a domed crown (lathed)."""
    prof = np.array([[0.026, 0.0], [0.034, 0.012], [0.062, 0.034], [0.05, 0.042], [0.03, 0.05], [0.028, 0.075],
                     [0.05, 0.094], [0.04, 0.104], [0.028, 0.112], [0.024, 0.135], [0.012, 0.148]]) + [0, y]
    plan = {0: (14, np.arange(11)), 1: (8, [0, 2, 4, 6, 8, 10]), 2: (6, [0, 2, 6, 10])}
    return lathe_part(prof, plan, "glass", centre=(x, z), h=0.003)


def power_pole():
    """A wooden utility pole 7.2 m: a tapered round pole with a domed top, a crossarm across +-x on its +z face, two steel
    braces, three glass pin insulators (two on the arm, one on the pole top)."""
    pole = toon.tube([(0, -0.4, 0), (0, 6.98, 0)], [0.145, 0.108])
    arm = toon.rbox((0, 6.55, 0.165), (0.62, 0.055, 0.055), 0.012)
    parts = [Part(f=pole, box=((-0.3, -0.2, -0.3), (0.3, 7.3, 0.3)), h=0.008, mat="wood"),
             Part(f=arm, box=((-0.8, 6.4, 0.0), (0.8, 6.7, 0.32)), h=0.006, mat="wood", ground=False)]
    for sx in (-1, 1):
        a, b = np.array([sx * 0.06, 6.12, 0.13]), np.array([sx * 0.42, 6.5, 0.16])
        c, d = (a + b) / 2, b - a
        L = np.linalg.norm(d)
        ax = d / L
        R = np.column_stack([ax, np.cross([0, 0, 1], ax), [0, 0, 1]])
        parts.append(Part(f=toon.rbox(c, (L / 2 + 0.01, 0.008, 0.022), 0.006, R), box=(c - 0.4, c + 0.4), h=0.003, mat="metal",
                          ground=False))
    parts += [insulator(x, y, z) for x, y, z in ((-0.5, 6.6, 0.165), (0.5, 6.6, 0.165), (0.0, 7.075, 0.0))]
    return Model(parts=parts, materials=POLE, budget=(3000, 820, 220),
                 note="wooden utility pole, 7.2 m: tapered round pole with a domed top, a crossarm across +-x on the pole's "
                      "+z face, two steel braces, three glass pin insulators (two on the arm, one on the pole top); separate "
                      "closed shells per piece; materials wood, metal, glass", paint=paint_up(7.2, 0.9), ao_reach=0.6)


MODELS = {"cactus": cactus, "column": column, "power-pole": power_pole}
