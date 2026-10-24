"""Procedural building blocks for the props: per-material triangle soups with UVs, crease-split normals, and GLB output.

Frame: Y up, metres. UVs are in metres unless a part sets its own (tiled textures repeat per metre / per cell)."""
import numpy as np
from gltf_io import Prim, write_glb


def rot_y(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_x(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_z(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def face_normals(V, F):
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    a = np.linalg.norm(n, axis=1)
    return n / np.maximum(a, 1e-20)[:, None], a / 2


def crease_split(V, F, UV, crease_deg):
    """Per-corner normals averaged over faces within crease_deg; corners welded when vertex, normal and UV agree."""
    fn, area = face_normals(V, F)
    nf = len(F)
    cv = F.ravel()
    cf = np.repeat(np.arange(nf), 3)
    order = np.argsort(cv, kind="stable")
    cnt = np.bincount(cv, minlength=len(V))
    start = np.concatenate([[0], np.cumsum(cnt)])
    N = np.zeros((len(cv), 3))
    c = np.cos(np.radians(crease_deg))
    w = area[:, None] * fn
    for vi in np.nonzero(cnt)[0]:
        corners = order[start[vi]:start[vi + 1]]
        faces = cf[corners]
        if len(faces) == 1:
            N[corners] = fn[faces]
            continue
        dots = fn[faces] @ fn[faces].T >= c
        N[corners] = dots.astype(float) @ w[faces]
    N /= np.maximum(np.linalg.norm(N, axis=1), 1e-20)[:, None]
    uvc = UV[cv] if UV is not None else np.zeros((len(cv), 2))
    key = np.column_stack([cv, np.round(N * 512), np.round(uvc * 4096)]).astype(np.int64)
    uniq, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    Nout = np.zeros((len(uniq), 3))
    np.add.at(Nout, inv, N)
    Nout /= np.maximum(np.linalg.norm(Nout, axis=1), 1e-20)[:, None]
    return V[uniq[:, 0]], Nout, (uvc[first] if UV is not None else None), inv.reshape(-1, 3)


class Mesh:
    """Accumulates parts per material. Each part: V (n,3), F (m,3), UV (n,2) or None, crease angle."""

    def __init__(self):
        self.parts = {}

    def add(self, mat, V, F, UV=None, crease=35.0):
        V = np.asarray(V, float); F = np.asarray(F, np.int64)
        if len(F) == 0:
            return
        if UV is None:
            UV = box_uv(V, F)
        self.parts.setdefault(mat, []).append((V, F, np.asarray(UV, float), crease))

    def extend(self, other, M=np.eye(3), t=(0, 0, 0)):
        flip = np.linalg.det(M) < 0
        for m, lst in other.parts.items():
            for V, F, UV, cr in lst:
                self.parts.setdefault(m, []).append((V @ np.asarray(M).T + t, F[:, ::-1] if flip else F, UV, cr))

    def shifted(self, t):
        out = Mesh()
        out.extend(self, np.eye(3), t)
        return out

    def tris(self):
        return sum(len(F) for lst in self.parts.values() for _, F, _, _ in lst)

    def bounds(self):
        allv = np.vstack([V[np.unique(F)] for lst in self.parts.values() for V, F, _, _ in lst])
        return allv.min(0), allv.max(0)

    def prims(self, mat_index, uv_mats=()):
        """-> [Prim] one per material; UVs are kept only for materials in uv_mats (textured)."""
        out = []
        for m in sorted(self.parts, key=lambda k: mat_index[k]):
            Vs, Ns, UVs, Fs, base = [], [], [], [], 0
            for V, F, UV, cr in self.parts[m]:
                v, n, uv, f = crease_split(V, F, UV if m in uv_mats else None, cr)
                Vs.append(v); Ns.append(n); UVs.append(uv); Fs.append(f + base); base += len(v)
            out.append(Prim(mat_index[m], np.concatenate(Vs), np.concatenate(Ns),
                            np.concatenate(UVs) if m in uv_mats else None, np.concatenate(Fs)))
        return out


def box_uv(V, F):
    """Per-vertex planar UVs in metres, projected along each vertex's dominant face axis (vertices are not shared across
    differently-facing faces in the generators below, so this is per face in practice)."""
    fn, _ = face_normals(V, F)
    vn = np.zeros_like(V)
    np.add.at(vn, F.ravel(), np.repeat(fn, 3, 0))
    ax = np.argmax(np.abs(vn), 1)
    uv = np.where(ax[:, None] == 0, V[:, [2, 1]], np.where(ax[:, None] == 1, V[:, [0, 2]], V[:, [0, 1]]))
    return uv


# ---------- primitives ----------

def quad(p0, p1, p2, p3, uv=None):
    """Two triangles p0 p1 p2 p3 counter-clockwise seen from the front."""
    V = np.array([p0, p1, p2, p3], float)
    return V, np.array([[0, 1, 2], [0, 2, 3]]), (np.asarray(uv, float) if uv is not None else None)


def box(c, s, R=np.eye(3), faces="xXyYzZ"):
    """Axis box of size s centred at c, rotated by R about its centre. Each face has its own 4 vertices (hard edges).
    UV per face in metres. faces: which of -x +x -y +y -z +z to emit."""
    c = np.asarray(c, float); h = np.asarray(s, float) / 2
    spec = {"x": (0, -1), "X": (0, 1), "y": (1, -1), "Y": (1, 1), "z": (2, -1), "Z": (2, 1)}
    Vs, Fs, UVs = [], [], []
    for k in faces:
        a, sg = spec[k]
        u, v = [(1, 2), (2, 0), (0, 1)][a]
        if sg < 0:
            u, v = v, u
        corners = []
        for du, dv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            p = np.zeros(3); p[a] = sg * h[a]; p[u] = du * h[u]; p[v] = dv * h[v]
            corners.append(p)
        corners = np.array(corners)
        uvs = np.stack([corners[:, u] + c[u], corners[:, v] + c[v]], 1)
        if a == 1:
            uvs = np.stack([corners[:, 0] + c[0], corners[:, 2] + c[2]], 1)
        elif a == 0:
            uvs = np.stack([corners[:, 2] * -sg + c[2], corners[:, 1] + c[1]], 1)
        else:
            uvs = np.stack([corners[:, 0] * sg + c[0], corners[:, 1] + c[1]], 1)
        Vs.append(corners @ R.T + c); Fs.append(np.array([[0, 1, 2], [0, 2, 3]]) + 4 * len(Fs)); UVs.append(uvs)
    return np.vstack(Vs), np.vstack(Fs), np.vstack(UVs)


def prism(poly, y0, y1, caps=True, uv_scale=1.0):
    """Extrude an XZ polygon (either winding) from y0 to y1. Side UV: u = perimeter metres, v = height."""
    P = np.asarray(poly, float)
    if (P[:, 0] * np.roll(P[:, 1], -1) - np.roll(P[:, 0], -1) * P[:, 1]).sum() < 0:
        P = P[::-1]
    n = len(P)
    Vs, Fs, UVs = [], [], []
    per = 0.0
    for i in range(n):
        a, b = P[i], P[(i + 1) % n]
        L = np.linalg.norm(b - a)
        V = np.array([[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]])
        k = 4 * len(Fs)
        # CCW polygon from +Y: outward side faces need order a,b at bottom seen from outside -> a, a_top, b_top, b
        Fs.append(np.array([[0, 2, 1], [0, 3, 2]]) + 4 * i)
        UVs.append(np.array([[per, y0], [per + L, y0], [per + L, y1], [per, y1]]) * uv_scale)
        Vs.append(V)
        per += L
    V = np.vstack(Vs); F = np.vstack(Fs); UV = np.vstack(UVs)
    if caps:
        tri = triangulate(P)
        base = len(V)
        top = np.column_stack([P[:, 0], np.full(n, y1), P[:, 1]])
        bot = np.column_stack([P[:, 0], np.full(n, y0), P[:, 1]])
        V = np.vstack([V, top, bot])
        F = np.vstack([F, tri[:, ::-1] + base, tri + base + n])
        UV = np.vstack([UV, P * uv_scale, P * uv_scale])
    return V, F, UV


def triangulate(P):
    """Ear clipping of a simple CCW polygon (XZ, seen from +Y is CW in x-z math axes; we only need consistency)."""
    idx = list(range(len(P)))
    area = sum(P[i][0] * P[(i + 1) % len(P)][1] - P[(i + 1) % len(P)][0] * P[i][1] for i in range(len(P)))
    sgn = 1 if area > 0 else -1
    out = []
    guard = 0
    while len(idx) > 3 and guard < 10000:
        guard += 1
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = P[i0], P[i1], P[i2]
            cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
            if cr * sgn <= 1e-12:
                continue
            ok = True
            for j in idx:
                if j in (i0, i1, i2):
                    continue
                p = P[j]
                d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
                d2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0])
                d3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0])
                if d1 * sgn > 0 and d2 * sgn > 0 and d3 * sgn > 0:
                    ok = False; break
            if ok:
                out.append([i0, i1, i2]); idx.pop(k); break
        else:
            raise RuntimeError("triangulate: no ear found (self-intersecting polygon?)")
    out.append(idx)
    T = np.array(out)
    # make every triangle wind like +area in (x, z); caller flips for +Y facing
    return T if sgn > 0 else T[:, ::-1]


def lathe(profile, segs, a0=0.0, a1=2 * np.pi, close=True, uv_v="len"):
    """Revolve (r, y) points about +Y. Profile walked bottom -> top gives outward faces. UV: u = angle * mean radius
    (metres around), v = metres along the profile."""
    p = np.asarray(profile, float)
    full = close and abs(a1 - a0 - 2 * np.pi) < 1e-9
    nseg = segs
    cols = segs if full else segs + 1
    t = a0 + (a1 - a0) * np.arange(cols) / segs
    r, y = p[:, 0][:, None], p[:, 1][:, None]
    V = np.stack([r * np.sin(t)[None], np.broadcast_to(y, (len(p), cols)), r * np.cos(t)[None]], -1).reshape(-1, 3)
    i = np.arange(len(p) - 1)[:, None] * cols
    j = np.arange(nseg)[None]
    a = i + j
    b = i + (j + 1) % cols
    c, d = a + cols, b + cols
    F = np.concatenate([np.stack([a, b, d], -1).reshape(-1, 3), np.stack([a, d, c], -1).reshape(-1, 3)])
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))])
    rm = max(p[:, 0].mean(), 1e-3)
    UV = np.stack([np.broadcast_to((t * rm)[None], (len(p), cols)), np.broadcast_to(s[:, None], (len(p), cols))], -1).reshape(-1, 2)
    # drop degenerate faces at r = 0
    A = np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1)
    return V, F[A > 1e-12], UV


def cylinder(p0, p1, r0, r1=None, segs=8, caps=True):
    """Tapered cylinder between two points."""
    r1 = r0 if r1 is None else r1
    prof = ([(0, 0)] if caps else []) + [(r0, 0), (r1, 1)] + ([(0, 1)] if caps else [])
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    L = np.linalg.norm(p1 - p0)
    V, F, UV = lathe([(r, y * L) for r, y in prof], segs)
    y = (p1 - p0) / L
    x = np.cross(y, [0, 0, 1.0]) if abs(y[2]) < 0.9 else np.cross(y, [1.0, 0, 0])
    x /= np.linalg.norm(x); z = np.cross(x, y)
    M = np.stack([x, y, z], 1)
    return V @ M.T + p0, F, UV


def ellipsoid(c, r, segs=12, rings=8):
    prof = [(np.sin(t), -np.cos(t)) for t in np.linspace(0, np.pi, rings + 1)]
    V, F, UV = lathe(prof, segs)
    return V * r + c, F, UV


def write(path, nodes, materials, images=(), generator="apex-outrun-props2"):
    """nodes: [(name, Mesh, translation or None)]; materials: glTF dicts in index order (names are the contract)."""
    used_names = {k for _, mesh, _ in nodes for k in mesh.parts}
    missing = used_names - {m["name"] for m in materials}
    if missing:
        raise KeyError(f"materials used but not declared: {missing}")
    materials = [m for m in materials if m["name"] in used_names]  # a LOD may drop a part and its material
    idx = {m["name"]: i for i, m in enumerate(materials)}
    textured = {m["name"] for m in materials if any(k in m.get("pbrMetallicRoughness", {}) for k in ("baseColorTexture",))
                or "emissiveTexture" in m or "normalTexture" in m}
    used = set()
    out_nodes = []
    for name, mesh, tr in nodes:
        used.update(mesh.parts)
        prims = mesh.prims(idx, textured)
        out_nodes.append((name, prims, tr) if tr is not None else (name, prims))
    mats = [m for m in materials]
    return write_glb(path, out_nodes, mats, list(images), generator=generator)
