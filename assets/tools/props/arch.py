"""Procedural ruined Roman arch built from individual stone blocks (joints read as ink lines under a cel post-process).

usage: arch.py   -> work/build/broken-arch-proc_lod{0,1,2}.glb + .json
Single round archway (inner radius 2.2 m, springing at 4.7 m) between two piers with engaged half-columns, block
spandrels and an entablature; the top right corner has fallen, and four of its blocks lie on the ground at +X.
The passage runs along Z; both faces are the same."""
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import geo
from mats import pbr, srgb
from props import build_all

GAP = 0.018
W2, D = 4.5, 2.6          # half width, depth
R_IN, R_OUT, Y_SPR = 2.2, 3.1, 4.7
COURSE = 0.55


def hexa(c8):
    """8 corners (bottom 4 then top 4, each CCW from +Y) -> closed box mesh with per-face vertices."""
    c8 = np.asarray(c8, float)
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    V, F = [], []
    ctr = c8.mean(0)
    for q in faces:
        b = len(V)
        V += [c8[i] for i in q]
        f = [[b, b + 1, b + 2], [b, b + 2, b + 3]]
        n = np.cross(c8[q[1]] - c8[q[0]], c8[q[2]] - c8[q[0]])
        if n @ (c8[list(q)].mean(0) - ctr) < 0:
            f = [x[::-1] for x in f]
        F += f
    return np.array(V), np.array(F)


class Mason:
    def __init__(self, lod, seed=5):
        self.m = geo.Mesh()
        self.lod = lod
        self.rng = np.random.default_rng(seed)
        self.blocks = []

    def mat(self):
        return "stone_b" if self.rng.random() < 0.28 else "stone"

    def box(self, lo, hi, broken=None, mat=None):
        lo, hi = np.asarray(lo, float), np.asarray(hi, float)
        c = (lo + hi) / 2
        if broken is not None and broken(c):
            self.blocks.append((lo, hi))
            return
        g = GAP if self.lod < 2 else 0.0
        s = hi - lo - 2 * g
        jit = self.rng.normal(0, 0.008, 3) if self.lod < 2 else np.zeros(3)
        R = geo.rot_y(self.rng.normal(0, 0.006)) if self.lod < 2 else np.eye(3)
        V, F, UV = geo.box([0, 0, 0], s)
        self.m.add(mat or self.mat(), V @ R.T + c + jit, F, UV)

    def wedge(self, a0, a1, r0, r1, z0, z1, mat=None):
        pts = []
        for z in (z0, z1):
            pass
        g = GAP / r1 if self.lod < 2 else 0
        a0, a1 = a0 + g, a1 - g
        p = lambda r, a: [r * np.cos(a), Y_SPR + r * np.sin(a)]
        bot = [p(r0, a0), p(r1, a0), p(r1, a1), p(r0, a1)]
        c8 = [[x, y, z0 + GAP] for x, y in bot] + [[x, y, z1 - GAP] for x, y in bot]
        c8 = np.array(c8)[[0, 1, 2, 3, 4, 5, 6, 7]]
        # reorder into bottom (z0) / top (z1) quads for hexa(); hexa only needs consistent opposite quads
        V, F = hexa(c8)
        self.m.add(mat or self.mat(), V, F, None, crease=20)


def broken_arch(lod, raw=False):
    ms = Mason(lod)
    brk = lambda c: c[0] > 0.6 and c[1] > max(6.2, 8.3 - 0.9 * (c[0] - 0.6)) + 0.25 * np.sin(c[0] * 3.1)
    zs = (-D / 2, D / 2)
    # plinth
    for sx in (-1, 1):
        ms.box([sx * 2.05 if sx < 0 else 2.05, 0, -D / 2 - 0.15], [sx * (W2 + 0.15), 0.5, D / 2 + 0.15]) if False else None
        lo_x, hi_x = sorted((sx * 2.05, sx * (W2 + 0.15)))
        ms.box([lo_x, 0, -D / 2 - 0.15], [hi_x, 0.5, D / 2 + 0.15])
    # piers: courses of two blocks with alternating joints
    y = 0.5
    k = 0
    while y < 4.35:
        y1 = min(y + COURSE, 4.4)
        for sx in (-1, 1):
            xs = [2.2, 3.35 + (0.4 if k % 2 else -0.4), W2]
            for xa, xb in zip(xs[:-1], xs[1:]):
                lo_x, hi_x = sorted((sx * xa, sx * xb))
                ms.box([lo_x, y, -D / 2], [hi_x, y1, D / 2], brk)
        y, k = y1, k + 1
    # impost band
    for sx in (-1, 1):
        lo_x, hi_x = sorted((sx * 2.1, sx * (W2 + 0.1)))
        ms.box([lo_x, 4.4, -D / 2 - 0.1], [hi_x, 4.7, D / 2 + 0.1], brk)
    # voussoirs, keystone proud
    nv = (13, 13, 7)[lod]
    for i in range(nv):
        a0, a1 = np.pi * i / nv, np.pi * (i + 1) / nv
        key = i == nv // 2
        ms.wedge(a0, a1, R_IN, R_OUT + (0.15 if key else 0), -D / 2 - (0.08 if key else 0), D / 2 + (0.08 if key else 0))
    # spandrels: courses from the springing to 7.4 m, cut by the extrados
    y = Y_SPR
    k = 0
    while y < 7.39:
        y1 = min(y + COURSE, 7.4)
        yy = y - Y_SPR
        x_in = np.sqrt(max(R_OUT ** 2 - yy ** 2, 0)) if yy < R_OUT else 0.0
        x_in1 = np.sqrt(max(R_OUT ** 2 - (y1 - Y_SPR) ** 2, 0)) if y1 - Y_SPR < R_OUT else 0.0
        for sx in (-1, 1):
            xs = [x_in, (x_in + W2) / 2 + (0.3 if k % 2 else -0.3), W2] if lod < 2 else [x_in, W2]
            for j, (xa, xb) in enumerate(zip(xs[:-1], xs[1:])):
                lo_x, hi_x = sorted((sx * xa, sx * xb))
                c = np.array([(lo_x + hi_x) / 2, (y + y1) / 2, 0])
                if brk(c):
                    continue
                if j == 0 and x_in > 0:
                    # the block against the arch: its inner face follows the extrados between the course planes
                    xa0, xa1 = sx * x_in, sx * x_in1
                    xo = sx * xs[1]
                    bot = [[xa0, y], [xo, y]]
                    top = [[xa1, y1], [xo, y1]]
                    g = GAP
                    c8 = [[bot[0][0], y + g, -D / 2 + g], [bot[1][0] - sx * g, y + g, -D / 2 + g], [bot[1][0] - sx * g, y + g, D / 2 - g], [bot[0][0], y + g, D / 2 - g],
                          [top[0][0], y1 - g, -D / 2 + g], [top[1][0] - sx * g, y1 - g, -D / 2 + g], [top[1][0] - sx * g, y1 - g, D / 2 - g], [top[0][0], y1 - g, D / 2 - g]]
                    V, F = hexa(c8)
                    ms.m.add(ms.mat(), V, F, None, crease=20)
                else:
                    ms.box([lo_x, y, -D / 2], [hi_x, y1, D / 2], brk)
        y, k = y1, k + 1
    # entablature: architrave (3 blocks) and a projecting cornice (4 blocks)
    for xs, y0, y1, out in (([-W2, -1.4, 1.6, W2], 7.4, 7.85, 0.05), ([-W2 - 0.25, -2.4, 0.2, 2.6, W2 + 0.25], 7.85, 8.3, 0.25)):
        for xa, xb in zip(xs[:-1], xs[1:]):
            ms.box([xa, y0, -D / 2 - out], [xb, y1, D / 2 + out], brk)
    # engaged half-columns on both faces of both piers, with bases and capitals
    if lod < 2:
        for sx in (-1, 1):
            for sz in (-1, 1):
                x, z = sx * 3.35, sz * D / 2
                if brk([x, 4.0, 0]):
                    continue
                V, F, UV = geo.cylinder([x, 0.75, z], [x, 4.15, z], 0.3, 0.27, segs=(12, 8)[lod])
                ms.m.add("stone", V, F, UV, crease=50)
                ms.box([x - 0.42, 0.5, z - 0.42], [x + 0.42, 0.75, z + 0.42], mat="stone")
                ms.box([x - 0.4, 4.15, z - 0.4], [x + 0.4, 4.4, z + 0.4], mat="stone")
    # fallen blocks on the ground at +X
    if lod < 2:
        rng = np.random.default_rng(11)
        for i, (lo, hi) in enumerate(ms.blocks[:5]):
            s = np.minimum(hi - lo, [1.3, 0.55, 1.1])
            c = np.array([(5.5, 0, -0.9), (-5.6, 0, 1.0), (5.4, 0, 1.6), (-5.4, 0, -1.4), (6.2, 0, 0.6)][i])
            R = geo.rot_y(rng.uniform(0, np.pi)) @ geo.rot_x(rng.uniform(-0.15, 0.15))
            V, F, UV = geo.box([0, 0, 0], s - 2 * GAP)
            V = V @ R.T
            V += c - [0, V[:, 1].min(), 0]
            ms.m.add("stone_b", V, F, UV)
    mats = [pbr("stone", srgb("#d2c29f"), 0.0, 0.85), pbr("stone_b", srgb("#bcab88"), 0.0, 0.88)]
    # every LOD shares LOD0's footprint centre (the rubble widens it)
    if raw:
        return ms.m
    lo, hi = broken_arch(0, raw=True).bounds()
    shift = np.array([-(lo[0] + hi[0]) / 2, 0, -(lo[2] + hi[2]) / 2])
    centred = geo.Mesh()
    centred.extend(ms.m, np.eye(3), shift)
    return [("broken-arch", centred, None)], mats, [], "passage along Z; the fallen corner is at +X, five of its blocks lie on the ground either side"


if __name__ == "__main__":
    build_all({"broken-arch-proc": broken_arch}, ["broken-arch-proc"])
