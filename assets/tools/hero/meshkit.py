"""Small mesh helpers shared by the hero-car build: crease-aware normals, lathes, part assembly."""
import numpy as np
import scipy.sparse as sp


def face_normals(V, F):
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    a = np.linalg.norm(n, axis=1)
    return n / np.maximum(a, 1e-20)[:, None], a / 2


def crease_normals(V, F, crease_deg=40.0):
    """Split vertices where adjacent faces meet at more than crease_deg; return (V, N, F) with area-weighted normals."""
    fn, area = face_normals(V, F)
    nf = len(F)
    corners_v = F.ravel()
    corners_f = np.repeat(np.arange(nf), 3)
    # incident faces per vertex (CSR)
    inc = sp.csr_matrix((np.ones(len(corners_v)), (corners_v, corners_f)), shape=(len(V), nf))
    indptr, indices = inc.indptr, inc.indices
    cnt = np.diff(indptr)[corners_v]
    rep_corner = np.repeat(np.arange(len(corners_v)), cnt)
    starts = indptr[corners_v]
    offs = np.arange(len(rep_corner)) - np.repeat(np.cumsum(cnt) - cnt, cnt)
    other = indices[np.repeat(starts, cnt) + offs]
    c = np.cos(np.radians(crease_deg))
    ok = (fn[corners_f[rep_corner]] * fn[other]).sum(1) >= c
    w = (area[other] * ok)[:, None] * fn[other]
    N = np.zeros((len(corners_v), 3))
    np.add.at(N, rep_corner, w)
    N /= np.maximum(np.linalg.norm(N, axis=1), 1e-20)[:, None]
    # weld corners sharing a vertex and (nearly) the same normal
    q = np.round(N * 64).astype(np.int64)
    key = np.stack([corners_v, q[:, 0], q[:, 1], q[:, 2]], 1)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.ravel()
    Nout = np.zeros((len(uniq), 3))
    np.add.at(Nout, inv, N)
    Nout /= np.maximum(np.linalg.norm(Nout, axis=1), 1e-20)[:, None]
    return V[uniq[:, 0]], Nout, inv.reshape(-1, 3)


def lathe(profile, segs, axis_x=True):
    """Revolve a (radius, x) polyline about the X axis. Rows: profile points; returns V, F (outward for a profile walked with
    the solid on its left when looking from +theta)."""
    p = np.asarray(profile, float)
    t = np.linspace(0, 2 * np.pi, segs, endpoint=False)
    r, x = p[:, 0][:, None], p[:, 1][:, None]
    V = np.stack([np.broadcast_to(x, (len(p), segs)), r * np.cos(t)[None], r * np.sin(t)[None]], -1).reshape(-1, 3)
    i = np.arange(len(p) - 1)[:, None] * segs
    j = np.arange(segs)[None]
    a, b = i + j, i + (j + 1) % segs
    c, d = a + segs, b + segs
    F = np.concatenate([np.stack([a, c, b], -1).reshape(-1, 3), np.stack([b, c, d], -1).reshape(-1, 3)])
    return V, F


class Parts:
    """Accumulates (material -> list of (V, F, crease)) and emits per-material arrays with normals."""

    def __init__(self):
        self.by = {}

    def add(self, mat, V, F, crease=40.0):
        self.by.setdefault(mat, []).append((np.asarray(V, float), np.asarray(F, np.int64), crease))

    def extend(self, other):
        for m, lst in other.by.items():
            self.by.setdefault(m, []).extend(lst)

    def transformed(self, M, t):
        out = Parts()
        flip = np.linalg.det(M) < 0
        for m, lst in self.by.items():
            for V, F, cr in lst:
                out.add(m, V @ M.T + t, F[:, ::-1] if flip else F, cr)
        return out

    def tris(self):
        return sum(len(F) for lst in self.by.values() for _, F, _ in lst)

    def emit(self):
        """-> {mat: (V, N, F)}"""
        out = {}
        for m, lst in self.by.items():
            Vs, Ns, Fs, base = [], [], [], 0
            for V, F, cr in lst:
                v, n, f = crease_normals(V, F, cr)
                Vs.append(v); Ns.append(n); Fs.append(f + base); base += len(v)
            out[m] = (np.concatenate(Vs), np.concatenate(Ns), np.concatenate(Fs))
        return out


def split_plane(V, F, n, d, eps=1e-7, extra=None):
    """Cut every triangle crossing the plane n.x = d so each face lies on one side. Vertices within eps are snapped onto the
    plane. extra: optional per-face array carried to the pieces. Returns (V, F, side[+1/-1 per face], extra)."""
    V = np.asarray(V, float).copy()
    n = np.asarray(n, float)
    s = V @ n - d
    on = np.abs(s) <= eps
    V[on] -= np.outer(s[on], n) / (n @ n)
    s[on] = 0
    sg = np.sign(s).astype(int)
    fs = sg[F]
    cross = (fs.max(1) > 0) & (fs.min(1) < 0)
    newV, edge_pt = [], {}

    def cut(a, b):
        k = (min(a, b), max(a, b))
        if k not in edge_pt:
            t = s[a] / (s[a] - s[b])
            newV.append(V[a] + t * (V[b] - V[a]))
            edge_pt[k] = len(V) + len(newV) - 1
        return edge_pt[k]

    outF, outX = [F[~cross]], [extra[~cross]] if extra is not None else None
    addF, addX = [], []
    for fi in np.nonzero(cross)[0]:
        f = F[fi]
        sv = sg[f]
        # rotate so the lone vertex (or the zero vertex) is first
        if (sv == 0).any():
            r = int(np.nonzero(sv == 0)[0][0])
            a, b, c = f[r], f[(r + 1) % 3], f[(r + 2) % 3]
            p = cut(b, c)
            addF += [[a, b, p], [a, p, c]]
            k = 2
        else:
            r = int([i for i in range(3) if (sv == sv[i]).sum() == 1][0])
            a, b, c = f[r], f[(r + 1) % 3], f[(r + 2) % 3]
            pab, pac = cut(a, b), cut(a, c)
            addF += [[a, pab, pac], [pab, b, c], [pab, c, pac]]
            k = 3
        if extra is not None:
            addX += [extra[fi]] * k
    V2 = np.vstack([V, np.asarray(newV).reshape(-1, 3)])
    F2 = np.vstack([outF[0], np.asarray(addF, np.int64).reshape(-1, 3)])
    s2 = V2 @ n - d
    side = np.where(s2[F2].sum(1) >= 0, 1, -1)
    X2 = None
    if extra is not None:
        X2 = np.concatenate([outX[0], np.asarray(addX, dtype=extra.dtype).reshape((-1,) + extra.shape[1:])])
    return V2, F2, side, X2
