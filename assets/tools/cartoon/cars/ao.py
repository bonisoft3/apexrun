"""Per-vertex ambient occlusion by multi-view depth maps: for each of N directions over the sphere the occluders are
rasterised orthographically into a depth buffer seen from that direction, and a point is lit from it when nothing lies
above it. The ground plane y = 0 occludes downward directions with a soft falloff in hit distance."""
import os
os.environ.setdefault("NUMBA_THREADING_LAYER", "workqueue")  # numba's OpenMP layer crashes pymeshlab's afterwards
import numpy as np
from numba import njit, prange


def directions(n):
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n)
    th = np.pi * (1 + 5 ** 0.5) * i
    return np.stack([np.cos(th) * np.sin(phi), np.cos(phi), np.sin(th) * np.sin(phi)], 1)


def basis(d):
    a = np.array([0.0, 1.0, 0.0]) if abs(d[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    u = np.cross(a, d); u /= np.linalg.norm(u)
    return u, np.cross(d, u)


@njit(cache=True)
def raster(P, F, res, lo, px):
    """P: (n, 3) occluder vertices in (u, v, depth) with depth growing toward the viewer; keeps the max depth per pixel."""
    buf = np.full((res, res), -1e9)
    for f in range(F.shape[0]):
        a, b, c = P[F[f, 0]], P[F[f, 1]], P[F[f, 2]]
        ax, ay = (a[0] - lo[0]) / px, (a[1] - lo[1]) / px
        bx, by = (b[0] - lo[0]) / px, (b[1] - lo[1]) / px
        cx, cy = (c[0] - lo[0]) / px, (c[1] - lo[1]) / px
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12:
            continue
        x0 = max(int(np.floor(min(ax, bx, cx))), 0); x1 = min(int(np.ceil(max(ax, bx, cx))), res - 1)
        y0 = max(int(np.floor(min(ay, by, cy))), 0); y1 = min(int(np.ceil(max(ay, by, cy))), res - 1)
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                qx, qy = x + 0.5, y + 0.5
                w0 = ((by - cy) * (qx - cx) + (cx - bx) * (qy - cy)) / den
                w1 = ((cy - ay) * (qx - cx) + (ax - cx) * (qy - cy)) / den
                w2 = 1.0 - w0 - w1
                if w0 < -1e-6 or w1 < -1e-6 or w2 < -1e-6:
                    continue
                z = w0 * a[2] + w1 * b[2] + w2 * c[2]
                if z > buf[y, x]:
                    buf[y, x] = z
    return buf


@njit(parallel=True, cache=True)
def lookup(Q, buf, lo, px, bias):
    """1 where the point is lit from this direction (no occluder above it), 3x3 percentage-closer filtered."""
    n = Q.shape[0]
    res = buf.shape[0]
    out = np.zeros(n)
    for i in prange(n):
        x = int((Q[i, 0] - lo[0]) / px); y = int((Q[i, 1] - lo[1]) / px)
        lit = 0.0
        for dy in range(-1, 2):
            for dx in range(-1, 2):
                xx = min(max(x + dx, 0), res - 1); yy = min(max(y + dy, 0), res - 1)
                if buf[yy, xx] <= Q[i, 2] + bias:
                    lit += 1.0
        out[i] = lit / 9.0
    return out


def bake(points, normals, occ_V, occ_F, n_dirs=256, res=1024, ground_falloff=0.45, offset=0.012, bias=0.015):
    """-> AO in [0, 1] per point (1 = open sky): cosine-weighted visibility over the normal's hemisphere."""
    Pq = points + normals * offset
    ext = occ_V.max(0) - occ_V.min(0)
    span = float(np.linalg.norm(ext)) * 1.02
    vis = np.zeros(len(points)); wsum = np.zeros(len(points))
    occ_F = np.ascontiguousarray(occ_F, np.int64)
    for d in directions(n_dirs):
        w = np.maximum(normals @ d, 0.0)
        if not w.any():
            continue
        u, v = basis(d)
        M = np.stack([u, v, d], 1)
        P = occ_V @ M
        Q = Pq @ M
        lo = np.array([P[:, 0].min() - 0.01, P[:, 1].min() - 0.01])
        px = span / res
        buf = raster(np.ascontiguousarray(P), occ_F, res, lo, px)
        lit = lookup(np.ascontiguousarray(Q), buf, lo, px, bias)
        if d[1] < 0:  # the ground: a hit at distance y/|dy| shades by its closeness
            t = np.maximum(Pq[:, 1], 0.0) / -d[1]
            lit = lit * (1 - np.exp(-t / ground_falloff))
        vis += w * lit; wsum += w
    return vis / np.maximum(wsum, 1e-9)
