"""Feature-preserving fairing of a triangle mesh: bilateral face-normal filtering over vertex-ring neighbourhoods, then the
vertex update that fits the surface to the filtered normals (Sun et al. 2007). Ripples (small normal deviations) are averaged
away; creases (normal jumps well above sigma_r) survive."""
import numpy as np
import scipy.sparse as sp
from meshkit import face_normals


def face_ring(F, nv):
    """Pairs (f, g) of faces sharing at least one vertex, f != g."""
    nf = len(F)
    M = sp.csr_matrix((np.ones(3 * nf), (np.repeat(np.arange(nf), 3), F.ravel())), shape=(nf, nv))
    A = (M @ M.T).tocoo()
    keep = A.row != A.col
    return A.row[keep], A.col[keep]


def filter_normals(V, F, sigma_r=0.3, sigma_s=None, iters=30, pinned=None):
    n, area = face_normals(V, F)
    c = V[F].mean(1)
    fi, gi = face_ring(F, len(V))
    if sigma_s is None:
        sigma_s = 2.0 * np.linalg.norm(c[fi] - c[gi], axis=1).mean()
    ws = area[gi] * np.exp(-((c[fi] - c[gi]) ** 2).sum(1) / (2 * sigma_s ** 2))
    for _ in range(iters):
        d2 = ((n[fi] - n[gi]) ** 2).sum(1)
        w = ws * np.exp(-d2 / (2 * sigma_r ** 2))
        acc = n * area[:, None]
        for k in range(3):
            acc[:, k] += np.bincount(fi, w * n[gi, k], minlength=len(F))
        nn = acc / np.linalg.norm(acc, axis=1, keepdims=True)
        if pinned is not None:
            nn[pinned] = n[pinned]
        n = nn
    return n


def fit_vertices(V, F, n, iters=20, fixed=None):
    V = V.copy()
    nv = len(V)
    cnt = np.bincount(F.ravel(), minlength=nv).astype(float)
    for _ in range(iters):
        c = V[F].mean(1)
        d = np.zeros((nv, 3))
        for j in range(3):
            proj = ((c - V[F[:, j]]) * n).sum(1, keepdims=True) * n
            for k in range(3):
                d[:, k] += np.bincount(F[:, j], proj[:, k], minlength=nv)
        d /= np.maximum(cnt, 1)[:, None]
        if fixed is not None:
            d[fixed] = 0
        V += d
    return V


def fair(V, F, sigma_r=0.3, iters=30, vert_iters=20, sigma_s=None, fixed=None):
    n = filter_normals(V, F, sigma_r, sigma_s, iters)
    return fit_vertices(V, F, n, vert_iters, fixed)


def crease_vertices(V, F, deg):
    """Vertices on an edge whose two faces meet at more than deg degrees (plus mesh-boundary vertices)."""
    n, _ = face_normals(V, F)
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    fid = np.tile(np.arange(len(F)), 3)
    k = np.sort(e, 1)
    order = np.lexsort((k[:, 1], k[:, 0]))
    k, fid, e = k[order], fid[order], e[order]
    same = (k[1:] == k[:-1]).all(1)
    i = np.nonzero(same)[0]
    sharp = (n[fid[i]] * n[fid[i + 1]]).sum(1) < np.cos(np.radians(deg))
    out = np.zeros(len(V), bool)
    out[k[i[sharp]].ravel()] = True
    paired = np.zeros(len(k), bool); paired[i] = True; paired[i + 1] = True
    out[k[~paired].ravel()] = True
    return out


def lowpass_pinned(V, F, w, pinned):
    """Screened bi-Laplacian fairing: argmin |L V|^2 + w |V - V0|^2 with crease vertices held. On the uniform Laplacian a
    component of wavelength lam edges keeps the fraction w / (w + (2 pi / lam)^4): dents a few tens of edges across go,
    the overall form stays, and the held crease lines stay crisp."""
    from scipy.sparse.linalg import cg
    nv = len(V)
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    A = sp.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(nv, nv)).tocsr()
    A = ((A + A.T) > 0).astype(float)
    L = sp.identity(nv) - sp.diags(1 / np.maximum(np.asarray(A.sum(1)).ravel(), 1)) @ A
    M = (L.T @ L + w * sp.identity(nv)).tocsr()
    fr = np.nonzero(~pinned)[0]
    pn = np.nonzero(pinned)[0]
    Mff = M[fr][:, fr]
    rhs = w * V[fr] - M[fr][:, pn] @ V[pn]
    pre = sp.diags(1 / Mff.diagonal())
    out = V.copy()
    for k in range(3):
        x, info = cg(Mff, rhs[:, k], x0=V[fr, k], M=pre, rtol=1e-9, maxiter=4000)
        if info > 0:
            raise RuntimeError(f"lowpass cg did not converge ({info})")
        out[fr, k] = x
    return out
