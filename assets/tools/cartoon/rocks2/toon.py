"""Cartoon solids from signed distance fields: marching cubes, surface projection, QEM LODs, level-set material splits,
analytic SDF normals, and per-vertex ambient occlusion baked into COLOR_0.

Frame: Y up, metres, +Z forward, origin on the ground at the footprint centre. An SDF is f(P (n,3)) -> (n,), negative inside."""
import numpy as np
import pymeshlab
from skimage.measure import marching_cubes
from gltf_io import Prim, write_glb

UP = np.array([0.0, 1.0, 0.0])


# ---------------------------------------------------------------- SDF algebra

def lse(ds, r):
    """Smooth max over the first axis: planar where one term dominates, rounded over about 2r where terms meet."""
    m = ds.max(0)
    return m + r * np.log(np.exp((ds - m) / r).sum(0))


def smin(a, b, k):
    """Polynomial smooth min (fillet of radius about k); k = 0 is a sharp union."""
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def polytope(normals, offsets, r, centre=(0, 0, 0)):
    """Convex solid bounded by planes n.p = d (n unit, outward) about centre, edges rounded by r."""
    N = np.asarray(normals, float)
    N = N / np.linalg.norm(N, axis=1, keepdims=True)
    d = np.asarray(offsets, float)
    c = np.asarray(centre, float)
    return lambda P: lse(N @ (P - c).T - d[:, None], r)


def chunk(seed, half, nplanes, r, centre=(0, 0, 0), jitter=0.08, tilt=0.0, flat_top=None, yaw=0.0, cut_bottom=True):
    """A chunky rock: nplanes facets whose normals spread over the sphere (Fibonacci + jitter), offset to the support of
    an ellipsoid of half-axes `half`, so a few large faces dominate. flat_top: (normal tilt deg) adds a near-horizontal top
    facet; cut_bottom adds a downward plane (hidden under ground)."""
    g = np.random.default_rng(seed)
    k = np.arange(nplanes) + 0.5
    phi = np.arccos(1 - 2 * k / nplanes)
    th = np.pi * (1 + 5 ** 0.5) * k + g.uniform(0, 2 * np.pi)
    N = np.stack([np.sin(phi) * np.cos(th), np.cos(phi), np.sin(phi) * np.sin(th)], 1)
    N += g.normal(0, 0.22, N.shape)
    if flat_top is not None:
        a = np.radians(flat_top)
        N = np.vstack([N, [np.sin(a), np.cos(a), 0.0]])
    if cut_bottom:
        N = np.vstack([N, [0, -1, 0]])
    N /= np.linalg.norm(N, axis=1, keepdims=True)
    R = rot_y(yaw) @ rot_x(tilt)
    N = N @ R.T
    H = np.diag(np.asarray(half, float) ** 2)
    d = np.sqrt(np.einsum("ij,jk,ik->i", N, H, N)) * (1 + g.uniform(-jitter, jitter, len(N)))
    return polytope(N, d, r, centre), (N, d)


def slab(seed, a, b, n, y0, y1, r, centre=(0.0, 0.0), batter=6.0, tilt=(0.0, 0.0), chamfer=0.0, nch=0, jitter=0.12,
         yaw=0.0):
    """A stratum block: an n-sided jittered outline on an ellipse (half-axes a in x, b in z) extruded from y0 to y1, walls
    leaning in by `batter` degrees, the top tilted by `tilt` (deg about z, x), nch top edges chamfered by `chamfer` metres;
    every edge rounded by r. -> SDF."""
    g = np.random.default_rng(seed)
    t = yaw + 2 * np.pi * (np.arange(n) + g.uniform(-0.2, 0.2, n)) / n
    rad = a * b / np.sqrt((b * np.sin(t)) ** 2 + (a * np.cos(t)) ** 2) * (1 + g.uniform(-jitter, jitter, n))
    Q = np.stack([rad * np.sin(t), rad * np.cos(t)], 1) + centre
    E = np.roll(Q, -1, 0) - Q
    out2 = np.stack([E[:, 1], -E[:, 0]], 1)
    if (out2 * (Q - np.mean(Q, 0))).sum() < 0:
        out2 = -out2
    out2 /= np.linalg.norm(out2, axis=1, keepdims=True)
    M = (Q + np.roll(Q, -1, 0)) / 2
    tb = np.tan(np.radians(batter))
    Ns = np.column_stack([out2[:, 0], np.full(n, tb), out2[:, 1]])
    Ns /= np.linalg.norm(Ns, axis=1, keepdims=True)
    ym = (y0 + y1) / 2
    Pm = np.column_stack([M[:, 0], np.full(n, ym), M[:, 1]])
    ds = (Ns * Pm).sum(1)
    tz, tx = np.radians(tilt)
    Nt = np.array([-np.sin(tz), np.cos(tz) * np.cos(tx), np.sin(tx)])
    Nt /= np.linalg.norm(Nt)
    cxz = np.mean(Q, 0)
    dt = Nt @ [cxz[0], y1, cxz[1]]
    N = [*Ns, Nt, [0, -1, 0]]
    d = [*ds, dt, -y0]
    for i in g.choice(n, nch, replace=False) if nch else []:
        Nc = Ns[i] + Nt
        Nc /= np.linalg.norm(Nc)
        q = np.array([M[i, 0], y1, M[i, 1]])
        N.append(Nc); d.append(Nc @ q - chamfer)
    return polytope(N, d, r)


def wedge(c, n, y0, tan_a, r):
    """V-groove cutter: the region above the apex line (height y0 through c, along the plane of normal n) within
    |n.(p - c)| <= tan_a (y - y0), apex rounded by r. -> SDF, negative inside."""
    n = np.asarray(n, float)
    n = n - n[1] * UP
    n /= np.linalg.norm(n)
    c = np.asarray(c, float)
    N = np.array([n - tan_a * UP, -n - tan_a * UP])
    N /= np.linalg.norm(N, axis=1, keepdims=True)
    apex = np.array([c[0], y0, c[2]])
    return polytope(N, N @ apex, r)


def rot_x(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_z(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def capsule(a, b, r):
    a, b = np.asarray(a, float), np.asarray(b, float)
    ab = b - a
    L2 = ab @ ab

    def f(P):
        t = np.clip((P - a) @ ab / L2, 0, 1)
        return np.linalg.norm(P - (a + t[:, None] * ab), axis=1) - (r(t) if callable(r) else r)
    return f


def rbox(c, half, r, R=np.eye(3)):
    """Box of half extents `half` about c (rotated by R), edges rounded by r (r included in half)."""
    c, h = np.asarray(c, float), np.asarray(half, float) - r

    def f(P):
        q = np.abs((P - c) @ R) - h
        return np.linalg.norm(np.maximum(q, 0), axis=1) + np.minimum(q.max(1), 0) - r
    return f


def tube(pts, radii, ribs=0, depth=0.0, ref=(0, 0, 1), fade=1.0, chunk=200_000):
    """Round tube along a polyline (end caps hemispherical), radius interpolated per point. ribs > 0 cuts that many soft
    lengthwise grooves (depth x radius, narrow grooves between broad ridges), measured around the axis from `ref`
    (perpendicular to the tube's plane), faded out over `fade` radii before the far end so the tip dome stays smooth."""
    A = np.asarray(pts, float)[:-1]
    B = np.asarray(pts, float)[1:]
    ra, rb = np.asarray(radii, float)[:-1], np.asarray(radii, float)[1:]
    AB = B - A
    L = np.linalg.norm(AB, axis=1)
    T = AB / L[:, None]
    s0 = np.concatenate([[0], np.cumsum(L)[:-1]])
    total = L.sum()
    ref = np.asarray(ref, float)

    def f(P):
        out = np.empty(len(P))
        for i in range(0, len(P), chunk):
            p = P[i:i + chunk]
            t = np.clip(np.einsum("snk,sk->sn", p[None] - A[:, None], AB) / (L * L)[:, None], 0, 1)
            Q = A[:, None] + t[..., None] * AB[:, None]
            r = ra[:, None] + t * (rb - ra)[:, None]
            d = np.linalg.norm(p[None] - Q, axis=2) - r
            k = np.argmin(d, 0)
            n = np.arange(len(p))
            dd = d[k, n]
            if ribs:
                v = p - Q[k, n]
                Tk = T[k]
                v = v - (v * Tk).sum(1, keepdims=True) * Tk
                e1 = ref - (Tk @ ref)[:, None] * Tk
                e1 /= np.linalg.norm(e1, axis=1, keepdims=True)
                e2 = np.cross(Tk, e1)
                th = np.arctan2((v * e2).sum(1), (v * e1).sum(1))
                s = s0[k] + t[k, n] * L[k]
                rr = r[k, n]
                fd = np.clip((total - s) / (fade * rr), 0, 1)
                fd = fd * fd * (3 - 2 * fd)
                dd = dd + depth * rr * fd * (0.5 + 0.5 * np.cos(ribs * th)) ** 3
            out[i:i + chunk] = dd
        return out
    return f


def revolve(rfun, y0, y1, centre=(0, 0)):
    """Solid of revolution about the vertical axis through (centre x, z): radius rfun(y) between y0 and y1 (flat ends)."""
    cx, cz = centre

    def f(P):
        y = np.clip(P[:, 1], y0, y1)
        d = np.hypot(P[:, 0] - cx, P[:, 2] - cz) - rfun(y)
        return np.maximum(d, np.maximum(y0 - P[:, 1], P[:, 1] - y1))
    return f


def lathe_grid(R, ys, th):
    """Closed surface of revolution on a grid: R (K, M) radii at heights ys (K,) and angles th (M,) (from +z toward +x),
    capped by a pole vertex on the axis at each end. -> outward (V, F)."""
    K, M = R.shape
    X = R * np.sin(th)[None]
    Z = R * np.cos(th)[None]
    Y = np.broadcast_to(np.asarray(ys, float)[:, None], (K, M))
    V = np.vstack([np.stack([X, Y, Z], -1).reshape(-1, 3), [[0, ys[0], 0], [0, ys[-1], 0]]])
    j = np.arange(M)
    F = []
    for i in range(K - 1):
        a, b = i * M + j, i * M + (j + 1) % M
        F += [np.stack([a, b, b + M], 1), np.stack([a, b + M, a + M], 1)]
    F += [np.stack([np.full(M, K * M), (j + 1) % M, j], 1), np.stack([(K - 1) * M + j, (K - 1) * M + (j + 1) % M, np.full(M, K * M + 1)], 1)]
    F = np.vstack(F)
    if volume(V, F) < 0:
        F = F[:, ::-1]
    return V, F


def profile_normals(prof):
    """Outward (nr, ny) at each point of an (r, y) profile walked bottom to top."""
    p = np.asarray(prof, float)
    t = np.gradient(p, axis=0)
    n = np.stack([t[:, 1], -t[:, 0]], 1)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-20)


def lathe_normal_fn(prof, centre=(0, 0)):
    """Normals of a lathed profile at points on it: the nearest profile station's normal, swung about the axis."""
    from scipy.spatial import cKDTree
    p = np.asarray(prof, float)
    n = profile_normals(p)
    tree = cKDTree(p)
    cx, cz = centre

    def g(P):
        x, z = P[:, 0] - cx, P[:, 2] - cz
        rho = np.hypot(x, z)
        _, k = tree.query(np.stack([rho, P[:, 1]], 1))
        s = np.where(rho > 1e-9, 1 / np.maximum(rho, 1e-9), 0)
        return np.stack([n[k, 0] * x * s, n[k, 1], n[k, 0] * z * s], 1)
    return g


def ground_cut(f):
    """Solid above y = 0: a flat base flush with the ground."""
    return lambda P: np.maximum(f(P), -P[:, 1])


def grad(f, P, eps):
    o = np.eye(3) * eps
    g = np.stack([f(P + o[i]) - f(P - o[i]) for i in range(3)], 1) / (2 * eps)
    return g


def project(f, P, eps, iters=4, reach=None):
    """Newton steps onto the zero set; each vertex moves at most `reach` (default 2 eps) in total, so a vertex near an
    ill-conditioned spot (a tight crease) stays put rather than jumping across and folding its triangles."""
    reach = 2 * eps if reach is None else reach
    P0 = P.copy()
    P = P.copy()
    for _ in range(iters):
        v = f(P)
        g = grad(f, P, eps)
        P -= (v / np.maximum((g * g).sum(1), 1e-12))[:, None] * g
        d = P - P0
        n = np.linalg.norm(d, axis=1, keepdims=True)
        P = P0 + d * np.minimum(1, reach / np.maximum(n, 1e-20))
    return P


# ---------------------------------------------------------------- meshing

def _sample(f, lo, n, h):
    axes = [lo[i] + h * np.arange(n[i]) for i in range(3)]
    G = np.stack(np.meshgrid(*axes, indexing="ij"), -1).reshape(-1, 3)
    return np.concatenate([f(G[i:i + 2_000_000]) for i in range(0, len(G), 2_000_000)]).reshape(n)


def extract(f, lo, hi, h):
    """Marching cubes of f at spacing h -> outward-wound (V, F). [lo, hi] is a search box: a coarse pass finds the solid
    inside it and the fine pass samples only that, padded."""
    lo, hi = np.asarray(lo, float), np.asarray(hi, float)
    H = 4 * h
    n = np.ceil((hi - lo) / H).astype(int) + 1
    c = _sample(f, lo, n, H) < H
    if c[0].any() or c[-1].any() or c[:, 0].any() or c[:, -1].any() or c[:, :, 0].any() or c[:, :, -1].any():
        raise ValueError("solid touches the search box")
    idx = np.argwhere(c)
    lo, hi = lo + (idx.min(0) - 1) * H, lo + (idx.max(0) + 1) * H
    lo, hi = lo - 2.37 * h, hi + 2 * h   # off the grid: no sample lands exactly on the ground plane
    n = np.ceil((hi - lo) / h).astype(int) + 1
    vals = _sample(f, lo, n, h)
    if not (vals[0].min() > 0 and vals[-1].min() > 0 and vals[:, 0].min() > 0 and vals[:, -1].min() > 0
            and vals[:, :, 0].min() > 0 and vals[:, :, -1].min() > 0):
        raise ValueError("solid touches the sampling box")
    V, F, _, _ = marching_cubes(vals, 0.0, spacing=(h, h, h))
    ms = ms_of(V + lo, F)
    ms.meshing_remove_duplicate_vertices()
    ms.meshing_remove_null_faces()
    ms.meshing_remove_unreferenced_vertices()
    V, F = ms_out(ms)
    t = ms.get_topological_measures()
    if t["non_two_manifold_edges"] or t["boundary_edges"]:
        raise ValueError(f"marching cubes gave a non-manifold or open mesh: {t}")
    if volume(V, F) < 0:
        F = F[:, ::-1]
    return V, F


def volume(V, F):
    return np.einsum("ij,ij->i", V[F[:, 0]], np.cross(V[F[:, 1]], V[F[:, 2]])).sum() / 6


def area(V, F):
    return float(np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1).sum() / 2)


def ms_of(V, F):
    ms = pymeshlab.MeshSet()
    ms.add_mesh(pymeshlab.Mesh(np.asarray(V, float), np.asarray(F, np.int32)))
    return ms


def ms_out(ms):
    m = ms.current_mesh()
    return m.vertex_matrix().astype(float), m.face_matrix().astype(np.int64)


def decimate(V, F, target, planar=True):
    ms = ms_of(V, F)
    ms.meshing_decimation_quadric_edge_collapse(targetfacenum=int(target), qualitythr=0.5, preservenormal=True,
                                                preservetopology=True, optimalplacement=True, planarquadric=planar,
                                                planarweight=0.002, autoclean=True)
    return ms_out(ms)


def remesh(V, F, target):
    """Isotropic remeshing to about `target` triangles (even triangles, so per-vertex AO has no long-edge shards)."""
    V, F = decimate(V, F, max(30000, 4 * target), planar=False) if len(F) > 4 * max(30000, 4 * target) else (V, F)
    A = np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1).sum() / 2
    L = np.sqrt(4 * A / (np.sqrt(3) * target))
    for _ in range(4):
        ms = ms_of(V, F)
        ms.meshing_isotropic_explicit_remeshing(iterations=8, targetlen=pymeshlab.PureValue(L), featuredeg=60)
        V2, F2 = ms_out(ms)
        if 0.9 * target <= len(F2) <= target:
            break
        L *= np.sqrt(len(F2) / (0.95 * target))
    return V2, F2


def refine(V, F, max_edge):
    """Split edges longer than max_edge (midpoint) so flat facets carry enough vertices for baked AO."""
    ms = ms_of(V, F)
    ms.meshing_surface_subdivision_midpoint(iterations=3, threshold=pymeshlab.PureValue(max_edge))
    return ms_out(ms)


def edge_len(V, F):
    E = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    return np.linalg.norm(V[E[:, 0]] - V[E[:, 1]], axis=1)


def split(V, F, labels, g, lo_label, hi_label, f=None, eps=1e-3, only=None, snap=None):
    """Cut triangles along the zero set of g (a function of position, metres); faces labelled in `only` (default lo_label
    and hi_label) take hi_label where g > 0, else lo_label (None: keep their label). Vertices within `snap` (default 2 eps) of the zero set are
    taken as on it, so no cut lands next to a vertex. Every crossing triangle is cut and a cut edge is shared, so the
    solid stays watertight; new vertices are projected onto f when given."""
    only = set(only or {lo_label, hi_label} - {None})
    snap = 2 * eps if snap is None else snap
    V = np.asarray(V, float)
    gv = g(V)
    sg = np.where(gv > snap, 1, np.where(gv < -snap, -1, 0))
    newv, key = [], {}

    def cut(a, b):
        k = (min(a, b), max(a, b))
        if k not in key:
            t = gv[a] / (gv[a] - gv[b])
            key[k] = len(V) + len(newv)
            newv.append(V[a] + t * (V[b] - V[a]))
        return key[k]

    outF, outL = [], []
    for tri, lab in zip(F.tolist(), list(labels)):
        s = [int(sg[i]) for i in tri]
        mine = lab in only
        side = lambda x: (hi_label if x > 0 else lab if lo_label is None else lo_label) if mine else lab
        if min(s) >= 0 or max(s) <= 0:          # no strict crossing: label by its signed vertices
            outF.append(tri); outL.append(side(max(s) if max(s) > 0 else -1 if min(s) < 0 else gv[tri].mean()))
            continue
        if 0 in s:                              # one vertex on the cut, the others either side: one new vertex
            r = s.index(0)
            z, a, b = tri[r], tri[(r + 1) % 3], tri[(r + 2) % 3]
            x = cut(a, b)
            outF += [[z, a, x], [z, x, b]]
            outL += [side(sg[a]), side(sg[b])]
            continue
        for r in range(3):                      # the lone vertex on its side
            if s[r] != s[(r + 1) % 3] and s[r] != s[(r + 2) % 3]:
                break
        l, m1, m2 = tri[r], tri[(r + 1) % 3], tri[(r + 2) % 3]
        x1, x2 = cut(l, m1), cut(l, m2)
        outF += [[l, x1, x2], [x1, m1, m2], [x1, m2, x2]]
        outL += [side(s[r]), side(-s[r]), side(-s[r])]
    if newv:
        NV = np.array(newv)
        if f is not None:
            NV = project(f, NV, eps)
        V = np.vstack([V, NV])
    return V, np.array(outF, np.int64), np.array(outL, dtype=object)


# ---------------------------------------------------------------- baked lighting

def hemisphere(n):
    """n cosine-weighted directions about +Z (Fibonacci spiral on the disc, lifted): deterministic and even."""
    k = np.arange(n) + 0.5
    r = np.sqrt(k / n)
    th = np.pi * (1 + 5 ** 0.5) * k
    x, y = r * np.cos(th), r * np.sin(th)
    return np.stack([x, y, np.sqrt(np.maximum(0, 1 - x * x - y * y))], 1)


def bake_ao(f, V, N, radius, start, rays=96, lo=0.55, gamma=1.2, steps=48):
    """Ambient occlusion of the field f united with the ground (y = 0), sphere-traced from each vertex over a
    cosine-weighted hemisphere about its normal: a ray hitting at distance t < radius occludes by sqrt(1 - t / radius).
    -> multiplier lo + (1 - lo) * v ** gamma, v the visibility rescaled so half a hemisphere lost is 0. The field, not the mesh, is traced, so every LOD reads the same
    occlusion at the same place."""
    N = N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-20)
    T = np.cross(N, np.where(np.abs(N[:, 1:2]) < 0.9, [[0, 1, 0]], [[1, 0, 0]]))
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    B = np.cross(N, T)
    H = hemisphere(rays)
    D = H[None, :, 0:1] * T[:, None] + H[None, :, 1:2] * B[:, None] + H[None, :, 2:3] * N[:, None]   # (v, r, 3)
    P0 = (V + N * start)[:, None, :]
    scene = lambda P: np.minimum(f(P), P[:, 1])
    t = np.zeros(D.shape[:2])
    hit = np.zeros(D.shape[:2], bool)
    live = np.ones(D.shape[:2], bool)
    for _ in range(steps):
        idx = np.nonzero(live)
        if not len(idx[0]):
            break
        P = P0[idx[0], 0] + D[idx] * t[idx][:, None]
        d = scene(P)
        h = d < 0.002 * radius
        hit[idx[0][h], idx[1][h]] = True
        t[idx] += np.maximum(0.8 * d, 0.004 * radius)
        live[idx] = ~h & (t[idx] < radius)
    occ = np.where(hit, np.sqrt(1 - np.clip(t / radius, 0, 1)), 0.0).mean(1)
    # a wall standing on open ground loses at most half its hemisphere: that contact reads as the darkest
    vis = np.clip((0.5 - occ) / 0.5, 0, 1)
    return lo + (1 - lo) * vis ** gamma


# ---------------------------------------------------------------- output

def weld(V, F, tol=1e-5):
    """Merge vertices closer than tol (clusters by distance, not grid cells, so near pairs never straddle a cell edge)."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    from scipy.spatial import cKDTree
    pairs = cKDTree(V).query_pairs(tol, output_type="ndarray")
    n = len(V)
    _, comp = connected_components(coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(n, n)), directed=False)
    _, first, inv = np.unique(comp, return_index=True, return_inverse=True)
    return V[first], inv.ravel()[F]


def prims(V, F, labels, normal_fn, color, mat_index, hard=None):
    """One Prim per material. Corner normals come from normal_fn at the vertex, except faces flagged in `hard`, whose
    corners take the face normal (a separate vertex), e.g. the flat base."""
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-20)
    VN = normal_fn(V)
    VN /= np.maximum(np.linalg.norm(VN, axis=1, keepdims=True), 1e-20)
    hard = np.zeros(len(F), bool) if hard is None else hard
    out = []
    labels = np.asarray(labels, dtype=object)
    for m in sorted(set(labels.tolist()), key=lambda k: mat_index[k]):
        sel = labels == m
        Fm, H = F[sel], hard[sel]
        # corner key: vertex, or (vertex, face) for hard faces -> one glTF vertex per key
        cv = Fm.ravel()
        hk = np.repeat(np.where(H, np.arange(len(Fm)), -1), 3)
        hn = np.repeat(fn[sel], 3, 0)
        keys = np.stack([cv, np.where(hk >= 0, 1, 0), np.where(hk >= 0, np.round(hn[:, 0] * 1000), 0),
                         np.where(hk >= 0, np.round(hn[:, 1] * 1000), 0), np.where(hk >= 0, np.round(hn[:, 2] * 1000), 0)], 1).astype(np.int64)
        uk, first, inv = np.unique(keys, axis=0, return_index=True, return_inverse=True)
        inv = inv.ravel()
        vid = uk[:, 0]
        pos = V[vid]
        nor = np.where(uk[:, 1:2] == 1, hn[first], VN[vid])
        p = Prim(mat_index[m], pos, nor, None, inv.reshape(-1, 3))
        p.color = color[vid]
        out.append(p)
    return out


def write(path, node, prim_list, materials, generator="apex-outrun-cartoon-rocks"):
    used = sorted({p.material for p in prim_list})
    remap = {old: new for new, old in enumerate(used)}
    for p in prim_list:
        p.material = remap[p.material]
    return write_glb(path, [(node, prim_list)], [materials[i] for i in used], [], generator=generator)


# ---------------------------------------------------------------- noise

_PERM = np.random.default_rng(20261019).permutation(256)
_PERM = np.concatenate([_PERM, _PERM])
_GRAD = np.array([[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
                  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]], float)


def perlin(P, seed=0):
    """Gradient noise in about [-1, 1], unit feature size, gradient magnitude below about 2.5."""
    P = np.asarray(P, float) + np.array([17.31, 5.73, 29.17]) * seed
    Pi = np.floor(P)
    f = P - Pi
    i = Pi.astype(np.int64) & 255
    u = f * f * f * (f * (f * 6 - 15) + 10)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                h = _PERM[_PERM[_PERM[i[:, 0] + dx] + i[:, 1] + dy] + i[:, 2] + dz] % 12
                g = (_GRAD[h] * (f - [dx, dy, dz])).sum(1)
                w = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                out = out + w * g
    return out


def fbm(P, freq, octaves=2, seed=0, gain=0.5):
    """Sum of `octaves` perlin layers, the first at `freq` cycles per metre, each next at twice the frequency and `gain`
    the amplitude, normalised to the first layer's range."""
    s, a, tot = 0, 1.0, 0.0
    for o in range(octaves):
        s = s + a * perlin(np.asarray(P) * freq * 2 ** o, seed + 7 * o)
        tot += a
        a *= gain
    return s / tot


def warp(f, amp, freq, seed=0):
    """f seen through a smooth displacement of its domain (amp metres at freq cycles per metre): bends silhouettes and
    facets alike. Keeps the field near-Lipschitz while amp x freq stays below about 0.15."""
    def g(P):
        D = np.stack([perlin(P * freq, seed + k) for k in (101, 211, 307)], 1)
        return f(P + amp * D)
    return g
