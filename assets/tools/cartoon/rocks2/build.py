"""Build cartoon models from SDF parts into work/build/<name>_lod{0,1,2}.glb + work/build/<name>.json.

usage: build.py [name ...]      (models from rocks2.py)
A model is a list of Parts, each a closed solid meshed on its own (marching cubes -> QEM to its share of the LOD budget
-> long edges split at LOD0 so facets carry AO -> vertices projected back onto the field), cut into materials along
level sets, then the parts are baked together: per-vertex AO of the whole model on a ground slab, times an optional
painted gradient, into COLOR_0; normals are the field's gradient (smooth across bevels, exact on facets), except the
flat base, which keeps its own downward normal."""
import json, os, sys
from dataclasses import dataclass, field
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import toon

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LOD_SHARE = (1.0, 0.27, 0.07)


@dataclass
class Part:
    f: object                      # SDF, uncut
    box: tuple                     # (lo, hi) sampling bounds
    h: float                       # marching-cubes spacing
    mat: str                       # base material
    tris: tuple = None             # triangle caps per LOD (splits add a few); None shares the budget by area
    splits: list = field(default_factory=list)   # [(g, lo_label, hi_label, only)]
    ground: bool = True            # cut flat at y = 0
    refine: float = 0.0            # LOD0: split edges longer than this (m)
    planar: bool = True
    explicit: object = None        # explicit(lod) -> (V, F): a built mesh lying on f (f still gives AO)
    normal: object = None          # normal(P) -> (n, 3), default the gradient of f
    shift: object = 0.0
    iso_lods: int = 0              # LODs below this are isotropic remeshes (even AO); the rest are QEM (curvature-led)


@dataclass
class Model:
    parts: list
    materials: list
    budget: tuple                  # max tris per LOD
    note: str
    paint: object = None           # paint(V) -> (n, 3) multiplier, or None
    ao_lo: float = 0.55
    ao_radius: float = 0.5         # occlusion reach, fraction of max(height, 0.4 x largest extent)
    ao_reach: float = 0.0          # or this many metres (tall thin models)


def cut(f):
    return toon.ground_cut(f)


def mesh_part(p, lod, dense, scale, k):
    f = cut(p.f) if p.ground else p.f
    eps = p.h * 0.25
    reach = p.h
    cap = p.tris[lod] * k
    if p.explicit is not None:
        V, F = p.explicit(lod)
        V = V - p.shift
    elif lod < p.iso_lods:
        V, F = toon.remesh(*dense, int(0.93 * cap))
    elif lod == 0 and p.refine:
        V0, F0 = toon.decimate(*dense, int(0.6 * cap), planar=p.planar)
        r = p.refine
        while True:
            V, F = toon.refine(V0, F0, r)
            if len(F) <= 0.93 * cap:
                break
            r *= 1.12
    else:
        V, F = toon.decimate(*dense, int(0.93 * cap), planar=p.planar)
    if p.explicit is None:
        V = toon.project(f, V, eps, reach=reach)
    snap = max(0.6 * p.h, 0.004 * scale)
    if p.ground:
        V[V[:, 1] < snap, 1] = 0.0
    labels = np.array([p.mat] * len(F), dtype=object)
    for g, lo_l, hi_l, only in p.splits:
        V, F, labels = toon.split(V, F, labels, g, lo_l, hi_l, eps=eps, only=only)
    if p.ground:
        V[V[:, 1] < snap, 1] = 0.0
    # a cut can land a hair from a sliver's far vertex: weld coarser than the closed check and drop the collapsed faces
    V, F = toon.weld(V, F, 2e-4)
    keep = (F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])
    F, labels = F[keep], labels[keep]
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-20)
    hard = (fn[:, 1] < -0.98) & (V[F].max(1)[:, 1] <= 1e-9) if p.ground else np.zeros(len(F), bool)
    return V, F, labels, hard


def assemble(model, lod, dense_cache, k):
    Vs, Fs, Ls, Hs, Ns, base = [], [], [], [], [], 0
    for i, p in enumerate(model.parts):
        V, F, L, H = mesh_part(p, lod, dense_cache[i], dense_cache["scale"], k)
        Vs.append(V); Fs.append(F + base); Ls.append(L); Hs.append(H)
        Ns.append(np.full(len(V), i)); base += len(V)
    return np.vstack(Vs), np.vstack(Fs), np.concatenate(Ls), np.concatenate(Hs), np.concatenate(Ns)


def build(model, lod, dense_cache):
    """-> (prims, tris, bounds, ao, folded): the LOD meshed within its budget, normals, AO and paint baked."""
    k = 1.0
    while True:  # material cuts add triangles: shrink the parts' caps until the model fits its budget
        V, F, L, H, PI = assemble(model, lod, dense_cache, k)
        if len(F) <= model.budget[lod]:
            break
        k *= 0.97
        if k < 0.2:
            raise ValueError(f"lod{lod}: {len(F)} tris cannot fit {model.budget[lod]} (explicit parts too heavy)")
    parts = model.parts

    def normal_fn(P):
        """Field gradients per part; P is the whole vertex array (parts matched by index)."""
        out = np.zeros_like(P)
        for i, p in enumerate(parts):
            s = PI == i
            out[s] = p.normal(P[s] + p.shift) if p.normal is not None else toon.grad(p.f, P[s], p.h * 0.25)
        return out
    mats = {m["name"]: i for i, m in enumerate(model.materials)}
    lo, hi = V.min(0), V.max(0)
    reach = model.ao_reach or model.ao_radius * max(hi[1] - lo[1], 0.4 * float(np.max(hi - lo)))
    fields = [cut(p.f) if p.ground else p.f for p in parts]
    scene = lambda P: np.min([g(P) for g in fields], 0)
    N = normal_fn(V)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-20)
    hmin = min(p.h for p in parts)
    ao = toon.bake_ao(scene, V, N, reach, 1.5 * hmin, lo=model.ao_lo)
    col = np.repeat(ao[:, None], 3, 1)
    if model.paint is not None:
        col = col * model.paint(V)
    col = np.clip(col, 0.45, 1)   # paint under full occlusion stays a soft shade, never near black
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-20)
    folded = int(((fn[:, None, :] * N[F]).sum(2).min(1) < 0)[~H].sum())
    prims = toon.prims(V, F, L, normal_fn, col, mats, hard=H)
    return prims, int(len(F)), [lo.tolist(), hi.tolist()], ao, folded


def shifted(f, c):
    """Field moved by -c, so the footprint centre lands on the origin."""
    return lambda P: f(P + c)


def closed_problems(V, F):
    Vw, Fw = toon.weld(V, F, 1e-4)
    out = []
    if np.any((Fw[:, 0] == Fw[:, 1]) | (Fw[:, 1] == Fw[:, 2]) | (Fw[:, 0] == Fw[:, 2])):
        out.append("degenerate")
    E = np.concatenate([Fw[:, [0, 1]], Fw[:, [1, 2]], Fw[:, [2, 0]]])
    _, cnt = np.unique(E, axis=0, return_counts=True)
    if np.any(cnt != 1):
        out.append(f"{int((cnt > 1).sum())} repeated directed edges")
    d = {tuple(e) for e in E.tolist()}
    if sum((b, a) not in d for a, b in d):
        out.append("open")
    if toon.volume(Vw, Fw) <= 0:
        out.append("inward")
    return out


def build_all(models, names):
    os.makedirs(f"{ROOT}/work/build", exist_ok=True)
    for name in names:
        if name not in models:
            raise SystemExit(f"unknown model {name}")
        model = models[name]()
        cache = {}
        allv = []
        for i, p in enumerate(model.parts):
            f = cut(p.f) if p.ground else p.f
            V, F = p.explicit(0) if p.explicit is not None else toon.extract(f, *p.box, p.h)
            cache[i] = (V, F)
            allv.append(V)
        allv = np.vstack(allv)
        c = (allv.min(0) + allv.max(0)) / 2 * [1, 0, 1]
        for i, p in enumerate(model.parts):
            p.f = shifted(p.f, c)
            p.shift = c
            p.splits = [(shifted(g, c), *rest) for g, *rest in p.splits]
            cache[i] = (cache[i][0] - c, cache[i][1])
        allv = allv - c
        area = {i: toon.area(*cache[i]) for i, p in enumerate(model.parts) if p.tris is None}
        left = [model.budget[l] - sum(q.tris[l] for q in model.parts if q.tris is not None) for l in range(3)]
        for i, p in enumerate(model.parts):
            if p.tris is None:  # share what the explicit parts leave by surface area (min 12 tris, a box)
                p.tris = tuple(max(12, int(left[l] * area[i] / sum(area.values()))) for l in range(3))
        cache["scale"] = float(np.max(allv.max(0) - allv.min(0)))
        rec = {"name": name, "lods": [], "note": model.note}
        for lod in (0, 1, 2):
            prims, tris, bounds, ao, folded = build(model, lod, cache)
            V = np.vstack([p.pos for p in prims])
            F = np.vstack([p.idx + o for p, o in zip(prims, np.cumsum([0] + [len(p.pos) for p in prims])[:-1])])
            bad = closed_problems(V, F)
            if bad:
                raise ValueError(f"{name} lod{lod}: not closed: {bad}")
            path = f"{ROOT}/work/build/{name}_lod{lod}.glb"
            used = [model.materials[i]["name"] for i in sorted({p.material for p in prims})]
            size = toon.write(path, name, prims, model.materials)
            rec["lods"].append(dict(lod=lod, path=os.path.relpath(path, ROOT), tris=tris, bytes=size, bounds_m=bounds,
                                    nodes=[name], materials=used,
                                    ao=[round(float(ao.min()), 3), round(float(ao.max()), 3)], folded=folded))
            print(name, lod, tris, size, np.round(bounds, 3).tolist(), "ao", rec["lods"][-1]["ao"],
                  "median", round(float(np.median(ao)), 3), "folded", folded, flush=True)
        json.dump(rec, open(f"{ROOT}/work/build/{name}.json", "w"), indent=1)


def models():
    import rocks2
    return rocks2.MODELS


if __name__ == "__main__":
    M = models()
    build_all(M, sys.argv[1:] or list(M))
