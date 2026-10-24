"""Cartoon vegetation kit: smooth sweeps, revolved tiers, implicit-blob canopies, leaf ribbons, per-vertex colour
(gradient x baked ambient occlusion) and GLB output.

Frame: Y up, metres, origin on the ground. Every part is welded and smooth-shaded; COLOR_0 is a linear RGB multiplier
of its material's baseColorFactor."""
import numpy as np
import pymeshlab
from scipy.spatial import ConvexHull
from gltf_io import Prim, write_glb


class Part:
    """One welded surface of a material. col: per-vertex RGB multiplier before AO."""

    def __init__(self, mat, V, F, col=None, ao=True):
        V, F = np.asarray(V, float), np.asarray(F, np.int64)
        col = np.ones((len(V), 3)) if col is None else np.asarray(col(V) if callable(col) else col, float)
        V, F, keep = weld(V, F)
        self.mat, self.V, self.F, self.col = mat, V, F, col[keep]
        self.ao = ao


def weld(V, F, eps=1e-6):
    key = np.round(V / eps).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    F = inv.ravel()[F]
    F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
    used = np.unique(F)
    remap = np.full(len(first), -1); remap[used] = np.arange(len(used))
    return V[first][used], remap[F], first[used]


def normals(V, F):
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    N = np.zeros_like(V)
    for k in range(3):
        np.add.at(N, F[:, k], n)
    return N / np.maximum(np.linalg.norm(N, axis=1), 1e-20)[:, None]


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def ramp(stops):
    """[(t, rgb), ...] -> f(t) piecewise-linear RGB."""
    ts = np.array([s[0] for s in stops]); cs = np.array([s[1] for s in stops], float)
    return lambda t: np.stack([np.interp(t, ts, cs[:, k]) for k in range(3)], -1)


# ---------------------------------------------------------------- curves

def bezier(P, t):
    P = np.asarray(P, float); t = np.asarray(t, float)[:, None]
    n = len(P) - 1
    from math import comb
    return sum(comb(n, i) * (1 - t) ** (n - i) * t ** i * P[i] for i in range(n + 1))


def rmf(C):
    """Rotation-minimising frames (T, N, B) along a polyline."""
    T = np.gradient(C, axis=0); T /= np.linalg.norm(T, axis=1, keepdims=True)
    N = np.zeros_like(T)
    ref = np.array([1.0, 0, 0]) if abs(T[0, 0]) < 0.9 else np.array([0, 0, 1.0])
    N[0] = np.cross(ref, T[0]); N[0] /= np.linalg.norm(N[0])
    for i in range(1, len(C)):
        n = N[i - 1] - T[i] * (N[i - 1] @ T[i])
        N[i] = n / np.linalg.norm(n)
    return T, N, np.cross(T, N)


def chaikin(P, it=3, closed=False):
    P = np.asarray(P, float)
    for _ in range(it):
        Q = [P[0]] if not closed else []
        R = np.roll(P, -1, 0) if closed else P[1:]
        L = P if closed else P[:-1]
        for a, b in zip(L, R):
            Q += [0.75 * a + 0.25 * b, 0.25 * a + 0.75 * b]
        if not closed:
            Q.append(P[-1])
        P = np.array(Q)
    return P


def resample(P, n):
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    u = np.linspace(0, s[-1], n)
    return np.stack([np.interp(u, s, P[:, k]) for k in range(P.shape[1])], -1)


# ---------------------------------------------------------------- surfaces

def tube(C, r, segs, cap0="flat", cap1="dome", ground=True):
    """Closed sweep of circles of radius r[i] along centreline C. Caps: 'flat' (fan), 'dome' (rounded to a point)."""
    C = np.asarray(C, float); r = np.asarray(r, float)
    T, N, B = rmf(C)
    a = np.linspace(0, 2 * np.pi, segs, endpoint=False)
    rings = [C[i] + r[i] * (np.cos(a)[:, None] * N[i] + np.sin(a)[:, None] * B[i]) for i in range(len(C))]
    V = list(np.vstack(rings))
    F = []
    n = len(C)
    for i in range(n - 1):
        for j in range(segs):
            p, q = i * segs + j, i * segs + (j + 1) % segs
            F += [[p, q + segs, q], [p, p + segs, q + segs]]

    def cap(i, end, kind):
        nonlocal V
        sign = 1 if end else -1
        ring0 = i * segs
        if kind == "dome":
            k = 3
            prev = ring0
            for s in range(1, k + 1):
                th = s / (k + 1) * np.pi / 2
                ring = C[i] + sign * T[i] * r[i] * np.sin(th) * 0.8 + r[i] * np.cos(th) * (np.cos(a)[:, None] * N[i] + np.sin(a)[:, None] * B[i])
                base = len(V); V += list(ring)
                for j in range(segs):
                    p, q = prev + j, prev + (j + 1) % segs
                    pp, qq = base + j, base + (j + 1) % segs
                    F.extend([[p, qq, q], [p, pp, qq]] if end else [[p, q, qq], [p, qq, pp]])
                prev = base
            tip = len(V); V.append(C[i] + sign * T[i] * r[i] * 0.8)
        else:
            prev = ring0
            tip = len(V); V.append(C[i])
        for j in range(segs):
            p, q = prev + j, prev + (j + 1) % segs
            F.append([p, tip, q] if end else [p, q, tip])

    cap(0, False, cap0)
    cap(n - 1, True, cap1)
    V = np.array(V)
    if ground:
        V[:, 1] = np.maximum(V[:, 1], 0.0)
    return V, np.array(F)[:, ::-1]


def revolve(profile, segs, mod=None):
    """Closed surface of revolution about +Y. profile: (m,2) of (r, y) from the bottom pole (r=0) to the top pole (r=0).
    mod(theta, s, r, y) -> (r', y') perturbs each point (s in [0,1] along the profile)."""
    P = np.asarray(profile, float)
    m = len(P)
    s = np.linspace(0, 1, m)
    th = np.linspace(0, 2 * np.pi, segs, endpoint=False)
    V = [[0, P[0, 1], 0]]
    for i in range(1, m - 1):
        r, y = np.full(segs, P[i, 0]), np.full(segs, P[i, 1])
        if mod is not None:
            r, y = mod(th, s[i], r, y)
        V += list(np.stack([r * np.sin(th), y, r * np.cos(th)], 1))
    V.append([0, P[-1, 1], 0])
    V = np.array(V, float)
    F = []
    top = len(V) - 1
    for j in range(segs):
        F.append([0, 1 + (j + 1) % segs, 1 + j])
    for i in range(m - 3):
        for j in range(segs):
            a, b = 1 + i * segs + j, 1 + i * segs + (j + 1) % segs
            F += [[a, b, b + segs], [a, b + segs, a + segs]]
    last = 1 + (m - 3) * segs
    for j in range(segs):
        F.append([last + j, last + (j + 1) % segs, top])
    return V, np.array(F)


def fib_sphere(n):
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n); th = np.pi * (1 + 5 ** 0.5) * i
    D = np.stack([np.cos(th) * np.sin(phi), np.cos(phi), np.sin(th) * np.sin(phi)], 1)
    F = ConvexHull(D).simplices
    c = D[F].mean(1)
    nrm = np.cross(D[F[:, 1]] - D[F[:, 0]], D[F[:, 2]] - D[F[:, 0]])
    flip = (nrm * c).sum(1) < 0
    F[flip] = F[flip][:, ::-1]
    return D, F


def smin(d, k):
    """Polynomial smooth minimum over axis 0."""
    out = d[0]
    for x in d[1:]:
        h = np.clip(0.5 + 0.5 * (x - out) / k, 0, 1)
        out = x * (1 - h) + out * h - k * h * (1 - h)
    return out


def lobes_sdf(lobes, k, floor=None):
    """Smooth union of spheres [(centre, radius)]; floor: clip to y >= floor with a rounded edge."""
    C = np.array([l[0] for l in lobes], float); R = np.array([l[1] for l in lobes], float)

    def f(p):
        d = np.linalg.norm(p[None] - C[:, None], axis=2) - R[:, None]
        v = smin(d, k)
        if floor is not None:
            g = floor - p[:, 1]
            h = np.clip(0.5 - 0.5 * (g - v) / (k * 0.5), 0, 1)
            v = g * (1 - h) + v * h + k * 0.5 * h * (1 - h)
        return v
    return f


def blob(sdf, centre, n, relax=6):
    """Closed genus-0 surface of the zero set of sdf, wrapped from a Fibonacci sphere of n vertices around centre (the
    outermost crossing along each ray), then relaxed tangentially and re-projected."""
    D, F = fib_sphere(n)
    c = np.asarray(centre, float)
    ts = np.linspace(0, 30, 1501)
    V = np.zeros_like(D)
    for i in range(0, n, 256):
        d = D[i:i + 256]
        P = c[None, None] + d[:, None] * ts[None, :, None]
        val = sdf(P.reshape(-1, 3)).reshape(len(d), len(ts))
        inside = val < 0
        last = len(ts) - 1 - np.argmax(inside[:, ::-1], axis=1)
        lo, hi = ts[last], ts[np.minimum(last + 1, len(ts) - 1)]
        for _ in range(30):
            mid = (lo + hi) / 2
            m = sdf(c + d * mid[:, None]) < 0
            lo, hi = np.where(m, mid, lo), np.where(m, hi, mid)
        V[i:i + 256] = c + d * lo[:, None]
    nb = [[] for _ in range(n)]
    for a, b in np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]):
        nb[a].append(b)
    nb = [np.array(x) for x in nb]
    for _ in range(relax):
        L = np.array([V[x].mean(0) for x in nb]) - V
        Nv = normals(V, F)
        L -= Nv * (L * Nv).sum(1, keepdims=True)
        V = V + 0.6 * L
        for _ in range(3):
            e = 1e-4
            g = np.stack([(sdf(V + e * np.eye(3)[k]) - sdf(V - e * np.eye(3)[k])) / (2 * e) for k in range(3)], 1)
            V = V - (sdf(V) / np.maximum((g * g).sum(1), 1e-9))[:, None] * g
    return V, F


def ribbon(C, up, width, cols, fold=0.0, serr=None, twist=None, slant=0.0):
    """Thin leaf/blade along centreline C (n,3): `up` the leaf's face normal hint, width(t) the half-width, cols in
    [-1, 1] across, fold lifts the sides into a V (fraction of the half-width), serr(t, side) scales edge columns
    (leaflet notches); slant moves full-width edge vertices toward the tip by that fraction of a row, so the notches
    read as leaflets pointing forward. Returns V, F, t (per vertex, 0 at the base) and across (per vertex)."""
    C = np.asarray(C, float)
    n = len(C)
    t = np.linspace(0, 1, n)
    T = np.gradient(C, axis=0); T /= np.linalg.norm(T, axis=1, keepdims=True)
    V, tv, av = [], [], []
    for i in range(n):
        side = np.cross(T[i], up); side /= np.linalg.norm(side)
        if twist is not None:
            a = twist * t[i]
            side = side * np.cos(a) + np.cross(T[i], side) * np.sin(a)
        nrm = np.cross(side, T[i]); nrm /= np.linalg.norm(nrm)
        w = width(t[i])
        step = np.linalg.norm(C[min(i + 1, n - 1)] - C[max(i - 1, 0)]) / 2
        for k in cols:
            s = 1.0 if serr is None or abs(k) < 0.99 else serr(t[i], i)
            fwd = T[i] * slant * step * abs(k) if (s >= 1.0 and serr is not None and 0 < i < n - 1) else 0
            V.append(C[i] + side * k * w * s + nrm * fold * w * abs(k) + fwd)
            tv.append(t[i]); av.append(k)
    A = len(cols)
    F = []
    for i in range(n - 1):
        for j in range(A - 1):
            a0, a1, b0, b1 = i * A + j, i * A + j + 1, (i + 1) * A + j, (i + 1) * A + j + 1
            F += [[a0, a1, b1], [a0, b1, b0]]
    return np.array(V), np.array(F), np.array(tv), np.array(av)


# ---------------------------------------------------------------- shading and output

def bake_ao(parts, rays=256, ground=True, lo=0.5, gamma=0.6):
    """Per-vertex ambient occlusion of all parts together (plus a ground plane) via pymeshlab, mapped to a multiplier in
    [lo, 1] and folded into each part's colour."""
    Vs, Fs, base = [], [], 0
    for p in parts:
        Vs.append(p.V); Fs.append(p.F + base); base += len(p.V)
    allV = np.vstack(Vs)
    if ground:
        ext = np.abs(allV[:, [0, 2]]).max() * 4 + 5
        Vs.append(np.array([[-ext, 0, -ext], [ext, 0, -ext], [ext, 0, ext], [-ext, 0, ext]]) - [0, 0.002, 0])
        Fs.append(np.array([[0, 2, 1], [0, 3, 2]]) + base)
    ms = pymeshlab.MeshSet()
    ms.add_mesh(pymeshlab.Mesh(np.vstack(Vs), np.vstack(Fs)))
    ms.compute_scalar_ambient_occlusion(rays=rays)
    q = ms.current_mesh().vertex_scalar_array()
    ref = pymeshlab.MeshSet()
    ref.create_sphere(subdiv=3)
    ref.compute_scalar_ambient_occlusion(rays=rays)
    free = np.median(ref.current_mesh().vertex_scalar_array())
    ao = np.clip(q / free, 0, 1)
    k = 0
    for p in parts:
        a = ao[k:k + len(p.V)]; k += len(p.V)
        if p.ao:
            p.col = p.col * (lo + (1 - lo) * a ** gamma)[:, None]


def write(path, name, parts, materials, ao=True, ao_lo=0.5):
    """materials: glTF dicts; parts sharing a material become one primitive."""
    if ao:
        bake_ao(parts, lo=ao_lo)
    names = [m["name"] for m in materials]
    used = [m for m in names if any(p.mat == m for p in parts)]
    mats = [m for m in materials if m["name"] in used]
    prims = []
    for mi, mn in enumerate(used):
        ps = [p for p in parts if p.mat == mn]
        Vs, Ns, Cs, Fs, base = [], [], [], [], 0
        for p in ps:
            Vs.append(p.V); Ns.append(normals(p.V, p.F)); Cs.append(np.clip(p.col, 0, 1)); Fs.append(p.F + base); base += len(p.V)
        pr = Prim(mi, np.vstack(Vs), np.vstack(Ns), None, np.vstack(Fs))
        pr.color = np.vstack(Cs)
        prims.append(pr)
    size = write_glb(path, [(name, prims)], mats, [], generator="apex-outrun-cartoon-plants")
    V = np.vstack([p.V for p in parts])
    return size, sum(len(p.F) for p in parts), [V.min(0).tolist(), V.max(0).tolist()]
