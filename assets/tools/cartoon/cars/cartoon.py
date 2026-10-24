"""Cartoon rebuild of the hero car and the traffic set: same ids, nodes, material names, frame, hubs and bounds as the shipped
GLBs, with a faired body, smooth material borders, balloon wheels, cartoon PBR and baked per-vertex AO.

usage: cartoon.py <car> [...]     car in hero, car-sedan, car-convertible, car-pickup, car-boxtruck
       writes work/build/<car>_lod{0,1}.glb + work/build/<car>.json

Body: the aligned dense Hunyuan mesh as the original builders read it (wheel blobs flattened, badges refilled), then
fair.py's bilateral normal filtering + vertex fit and a screened bi-Laplacian low-pass with creases held (in place of Taubin
smoothing), PANELS refits, and circular wheel arches carved at each panel's own radius.
Borders: the hero windscreen sheet is a per-vertex field diffused over the dense mesh and cut into each LOD along its 0.5
isoline; crisp regions (plus an underbody region) are cut along their planes, their facing limits along the isoline of a
vertex facing field, the arches along their circles; a border-locked decimation then brings each LOD to budget, so no
border follows the triangulation. Shading normals come from the faired dense surface.
AO: ao.py over the body, the wheels at their hubs and the ground, into COLOR_0 as 0.6 + 0.4 * ao on every body primitive."""
import hashlib, json, os, sys, time
import numpy as np
import pymeshlab
import scipy.sparse as sp
import trimesh
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.dirname(__file__))
import ao
import cwheel
import hero
import traffic
from fair import crease_vertices, fair, lowpass_pinned
from gltf_io import Prim, write_glb
from meshkit import crease_normals, face_normals

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCRATCH = os.path.abspath(os.path.join(ROOT, "..", ".."))
HERO_NAMES = ["paint", "glass", "interior", "trim", "chrome", "taillight", "headlight", "indicator", "rubber", "rim", "plate"]
TRAFFIC_NAMES = ["paint", "glass", "trim", "taillight", "headlight", "rubber", "rim"]
FAIR = dict(sigma_r=0.3, iters=70, vert_iters=30)
LOWPASS = dict(w=2e-4, crease_deg=20.0, cap=0.012)   # screened bi-Laplacian after the bilateral pass: removes dents ~20-40 cm across
FIELD_STEPS = 40          # diffusion of the soft-label fields on the dense mesh (about 7 cm of border smoothing)
AO_RANGE = (0.6, 1.0)
# panels Hunyuan left dented beyond what fairing removes, refitted as a quadratic height field along an axis:
# (box lo, box hi, axis) - the pickup's tailgate skin, which also swallows the two cones on its bumper
PANELS = {"car-pickup": [([-0.66, 0.72, -2.4], [0.66, 1.13, -2.14], 2)]}


def car_def(car):
    if car == "hero":
        from specs_hero import SPECS
        return dict(ply=f"{SCRATCH}/hero-car/work/align/rear2_s1234.ply", spec=SPECS["rear2_s1234"], names=HERO_NAMES,
                    soft=hero.soft_labels, find=hero.find_wheels, paint=(0.55, 0.012, 0.01), glass_blend=True, rim_r=0.2032,
                    lods={0: dict(budget=60000, wheel_lod=0, island=40, grooves=True, tip_segs=32, coarse=0.35, pre=1.6),
                          1: dict(budget=15000, wheel_lod=2, island=12, grooves=False, tip_segs=12, coarse=0.35, pre=1.6)},
                    ids=("model/car-hero/lod0", "model/car-hero/lod1"))
    from specs_traffic import SPECS
    spec = SPECS[car]
    return dict(ply=f"{SCRATCH}/props2/work/align/{car}.ply", spec=spec, names=TRAFFIC_NAMES, soft=traffic.soft_labels,
                find=traffic.find_wheels if "axles_z" in spec else hero.find_wheels, paint=tuple(spec["paint"]),
                glass_blend=spec.get("glass_blend", False), rim_r=spec["rim_r"],
                lods={0: dict(budget=30000, wheel_lod=1, island=40, grooves=True, coarse=0.3, pre=1.6),
                      1: dict(budget=9000, wheel_lod=2, island=12, grooves=False, coarse=0.25, pre=1.6)},
                ids=(f"model/{car}/lod0", f"model/{car}/lod1"))


# ---------- materials ----------

def materials(names, paint, glass_blend):
    def pbr(name, rgb, metal, rough, **extra):
        a = extra.pop("alpha", 1.0)
        return {"name": name, "pbrMetallicRoughness": {"baseColorFactor": [float(x) for x in rgb] + [a], "metallicFactor": metal,
                                                       "roughnessFactor": rough}, **extra}
    cc = lambda f, r: {"KHR_materials_clearcoat": {"clearcoatFactor": f, "clearcoatRoughnessFactor": r}}
    lamp = lambda s: {"KHR_materials_emissive_strength": {"emissiveStrength": s}}
    lib = {
        "paint": pbr("paint", paint, 0.0, 0.45, extensions=cc(0.7, 0.22)),  # soft clearcoat: a toy sheen, not a mirror
        "glass": (pbr("glass", (0.02, 0.028, 0.038), 0.0, 0.05, alpha=0.35, alphaMode="BLEND") if glass_blend else
                  pbr("glass", (0.014, 0.02, 0.03), 0.0, 0.06, extensions=cc(1.0, 0.02))),
        "interior": pbr("interior", (0.05, 0.042, 0.038), 0.0, 0.75),
        "trim": pbr("trim", (0.028, 0.028, 0.03), 0.0, 0.5),
        "chrome": pbr("chrome", (0.95, 0.94, 0.92), 1.0, 0.12),
        "taillight": pbr("taillight", (0.5, 0.012, 0.01), 0.0, 0.15, emissiveFactor=[1.0, 0.04, 0.02], extensions=lamp(0.6)),
        "headlight": pbr("headlight", (0.88, 0.88, 0.85), 0.0, 0.1, emissiveFactor=[1.0, 0.96, 0.85], extensions=lamp(0.25)),
        "indicator": pbr("indicator", (0.8, 0.35, 0.02), 0.0, 0.15, emissiveFactor=[1.0, 0.45, 0.02], extensions=lamp(0.15)),
        "rubber": pbr("rubber", (0.03, 0.03, 0.032), 0.0, 0.95),
        "rim": pbr("rim", (0.9, 0.9, 0.92), 0.7, 0.28),
        "plate": pbr("plate", (0.62, 0.62, 0.6), 0.0, 0.5),
    }
    return [lib[n] for n in names]


# ---------- field cutting ----------

def split_field(V, F, s, mask=None, vf=None, ff=None, snap=0.0, plane=None):
    """Cut faces along the zero set of the per-vertex field s (linear on each face). Only crossing edges of faces in mask are
    cut; any face sharing a cut edge is split too, so the mesh stays conforming. Vertices with |s| <= snap become boundary
    vertices (moved onto the plane when plane=(n, d) is given). vf (per-vertex) and ff (per-face) arrays are carried.
    -> V, F, s, vf, ff"""
    V, s = V.copy(), s.astype(float).copy()
    if mask is None:
        mask = np.ones(len(F), bool)
    if snap > 0:
        near = np.zeros(len(V), bool)
        near[np.unique(F[mask])] = True
        near &= np.abs(s) <= snap
        if plane is not None:
            V[near] -= np.outer(s[near], plane[0])
        s[near] = 0.0
    nv = len(V)
    a = F[:, [0, 1, 2]]
    b = F[:, [1, 2, 0]]
    sa, sb = s[a], s[b]
    crossing = ((sa > 0) & (sb < 0)) | ((sa < 0) & (sb > 0))
    key = np.minimum(a, b).astype(np.int64) * nv + np.maximum(a, b)
    cut = np.unique(key[crossing & mask[:, None]])
    if len(cut) == 0:
        return V, F, s, vf, ff
    ca, cb = cut // nv, cut % nv
    t = s[ca] / (s[ca] - s[cb])
    V = np.vstack([V, V[ca] + t[:, None] * (V[cb] - V[ca])])
    s = np.concatenate([s, np.zeros(len(cut))])
    if vf is not None:
        vf = np.concatenate([vf, vf[ca] + t.reshape((-1,) + (1,) * (vf.ndim - 1)) * (vf[cb] - vf[ca])])
    pos = np.clip(np.searchsorted(cut, key), 0, len(cut) - 1)
    is_cut = cut[pos] == key
    pid = nv + pos
    n_cut = is_cut.sum(1)
    if (n_cut == 3).any():
        raise RuntimeError("face with three cut edges")
    outF, src = [F[n_cut == 0]], [np.nonzero(n_cut == 0)[0]]
    for j in range(3):
        sel = np.nonzero((n_cut == 1) & is_cut[:, j])[0]
        if len(sel):
            A, B, C, p = F[sel, j], F[sel, (j + 1) % 3], F[sel, (j + 2) % 3], pid[sel, j]
            outF += [np.stack([A, p, C], 1), np.stack([p, B, C], 1)]; src += [sel, sel]
        # two cuts with edge j uncut: the lone vertex is r = j + 2, cut edges r (r, r+1) and r + 2 (r+2, r)
        sel = np.nonzero((n_cut == 2) & ~is_cut[:, j])[0]
        if len(sel):
            r = (j + 2) % 3
            A, B, C = F[sel, r], F[sel, (r + 1) % 3], F[sel, (r + 2) % 3]
            pab, pca = pid[sel, r], pid[sel, (r + 2) % 3]
            outF += [np.stack([A, pab, pca], 1), np.stack([pab, B, C], 1), np.stack([pab, C, pca], 1)]; src += [sel, sel, sel]
    src = np.concatenate(src)
    F2 = np.vstack(outF).astype(np.int64)
    ff2 = None if ff is None else ff[src]
    return V, F2, s, vf, ff2


def vertex_adjacency(F, nv):
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    A = sp.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(nv, nv)).tocsr()
    A = ((A + A.T) > 0).astype(float)
    deg = np.asarray(A.sum(1)).ravel()
    return sp.diags(1 / np.maximum(deg, 1)) @ A


def label_fields(V, F, lab, n_labels, steps):
    """Per-vertex label shares: area-weighted one-hot of incident faces, diffused by `steps` lazy ring averages."""
    _, area = face_normals(V, F)
    Phi = np.zeros((len(V), n_labels))
    for k in range(3):
        np.add.at(Phi, (F[:, k], lab), area)
    Phi /= np.maximum(Phi.sum(1, keepdims=True), 1e-20)
    W = vertex_adjacency(F, len(V))
    for _ in range(steps):
        Phi = 0.5 * Phi + 0.5 * (W @ Phi)
    return Phi


def facing_field(V, F, fdir, thr):
    """Per-vertex facing margin: area-weighted mean over incident faces of clamp(n.fdir - thr, +-0.15); its zero set runs
    through a crease when the limit sits on one and interpolates smoothly where the surface turns gradually."""
    fn, area = face_normals(V, F)
    fv = np.clip(fn @ fdir - thr, -0.15, 0.15) * area
    acc = np.zeros(len(V)); w = np.zeros(len(V))
    for k in range(3):
        np.add.at(acc, F[:, k], fv); np.add.at(w, F[:, k], area)
    return acc / np.maximum(w, 1e-20)


def apply_regions(V, F, lab, regions, grooves, IDX):
    """hero.apply_regions with field cuts: planes and facing limits become straight / smooth borders."""
    locked = np.zeros(len(F), bool)
    for r0 in regions:
        for r in hero.mirrored(r0):
            planes = hero.region_planes(r)
            fdir = None
            if "facing" in r:
                fdir = np.asarray(r["facing"][0], float) * ([-1, 1, 1] if r.get("_mirror") else 1)
                fdir /= np.linalg.norm(fdir)
                thr = r["facing"][1]
            only = None if "only" not in r else np.isin(lab, [IDX[x] for x in r["only"]])

            def near(margin, skip=None):
                c = V[F].mean(1)
                ok = np.ones(len(F), bool)
                for k, (n2, d2) in enumerate(planes):
                    if k != skip:
                        ok &= (c @ n2) <= d2 + margin
                return ok
            for k, (nn, d) in enumerate(planes):
                mask = near(0.02, skip=k)
                if fdir is not None:
                    mask &= face_normals(V, F)[0] @ fdir > thr - 0.35
                if only is not None:
                    mask &= only
                V, F, _, _, X = split_field(V, F, V @ nn - d, mask, ff=np.stack([lab, locked, only if only is not None else lab * 0], 1),
                                            snap=0.003, plane=(nn, d))
                lab, locked = X[:, 0].copy(), X[:, 1].astype(bool)
                only = None if only is None else X[:, 2].astype(bool)
            fs = None
            if fdir is not None:
                mask = near(0.02)
                if only is not None:
                    mask &= only
                V, F, fs, _, X = split_field(V, F, facing_field(V, F, fdir, thr), mask,
                                             ff=np.stack([lab, locked, only if only is not None else lab * 0], 1), snap=0.004)
                lab, locked = X[:, 0].copy(), X[:, 1].astype(bool)
                only = None if only is None else X[:, 2].astype(bool)
            c = V[F].mean(1)
            inside = np.ones(len(F), bool)
            for nn, d in planes:
                inside &= (c @ nn) <= d + 1e-6
            if fs is not None:
                inside &= fs[F].mean(1) > 0
            if only is not None:
                inside &= only
            lab[inside] = IDX[r["mat"]]
            locked |= inside
            if grooves and r.get("push"):
                fn = face_normals(V, F)[0]
                vid = np.setdiff1d(np.unique(F[inside]), np.unique(F[~inside]))
                if len(vid):
                    vn = np.zeros((len(V), 3))
                    np.add.at(vn, F[inside].ravel(), np.repeat(fn[inside], 3, 0))
                    vn = vn[vid] / (np.linalg.norm(vn[vid], axis=1, keepdims=True) + 1e-9)
                    V[vid] -= vn * r["push"]
    return V, F, lab, locked


# ---------- build ----------

def decimate_locked(V, F, lab, target):
    """Quadric decimation that keeps every material border exactly: the mesh is unwelded along the borders so they become
    mesh boundaries, decimated with preserveboundary, then welded back by position."""
    nl = int(lab.max()) + 1
    key = F.astype(np.int64) * nl + lab[:, None]
    uk, inv = np.unique(key.ravel(), return_inverse=True)
    ms = pymeshlab.MeshSet()
    ms.add_mesh(pymeshlab.Mesh(V[uk // nl], inv.reshape(-1, 3), f_scalar_array=lab.astype(float)))
    # collapses keep an existing vertex: optimal placement can throw a vertex centimetres out of a thin part (mirrors)
    ms.meshing_decimation_quadric_edge_collapse(targetfacenum=int(target), preserveboundary=True, preservenormal=True,
                                                optimalplacement=False, planarquadric=True, qualitythr=0.5)
    m = ms.current_mesh()
    V2, F2, lab2 = m.vertex_matrix().astype(float), m.face_matrix().astype(np.int64), np.rint(m.face_scalar_array()).astype(int)
    _, first, weld = np.unique(np.round(V2 * 1e7).astype(np.int64), axis=0, return_index=True, return_inverse=True)
    F2 = weld.ravel()[F2]
    ok = (F2[:, 0] != F2[:, 1]) & (F2[:, 1] != F2[:, 2]) & (F2[:, 0] != F2[:, 2])
    return V2[first], F2[ok], lab2[ok]


def body_lod(D, o, target, pre):
    """Decimate the faired dense body to `pre` faces, cut the borders in, then decimate to `target` around fixed borders."""
    V, F, Phi, vtree, coarse, spec, IDX = D["V"], D["F"], D["Phi"], D["vtree"], D["coarse"], D["spec"], D["IDX"]
    Vl, Fl = hero.reduce(V, F, pre, coarse, coarse_share=o["coarse"])
    _, vi = vtree.query(Vl)
    P = Phi[vi]
    lab = np.full(len(Fl), IDX["paint"])
    for l in D["soft_order"]:
        Vl, Fl, _, P, lab = split_field(Vl, Fl, P[:, l] - 0.5, vf=P, ff=lab, snap=0.02)
        lab[P[Fl, l].mean(1) > 0.5] = l
    lab = hero.clean_islands(Fl, lab, o["island"])
    under = dict(mat="trim", box=([-np.inf] * 3, [np.inf, spec["under_y"], np.inf]), facing=([0, -1, 0], 0.5), mirror=False)
    Vl, Fl, lab, locked = apply_regions(Vl, Fl, lab, [under] + spec["regions"], o["grooves"], IDX)
    for a in D["arches"]:
        s = a["ra"] - np.hypot(Vl[:, 1] - a["y"], Vl[:, 2] - a["z"])
        out = np.abs(Vl[Fl, 0]).max(1) > a["x_in"] - 0.01
        Vl, Fl, s, _, X = split_field(Vl, Fl, s, out, ff=np.stack([lab, locked], 1), snap=0.002)
        lab, locked = X[:, 0].copy(), X[:, 1].astype(bool)
        c = Vl[Fl].mean(1)
        ax = np.abs(c[:, 0])
        well = (np.hypot(c[:, 1] - a["y"], c[:, 2] - a["z"]) < a["ra"] + 0.12) & (ax <= a["x_in"] - 0.02) & (ax > a["x_in"] - 0.45) \
            & (face_normals(Vl, Fl)[0][:, 1] < 0.3)
        inside = ((s[Fl].mean(1) > 0) & (ax > a["x_in"] - 0.02)) | well
        lab[inside] = IDX["trim"]
        locked |= inside
    lab = hero.clean_islands(Fl, lab, o["island"], locked)
    if len(Fl) > target:
        Vl, Fl, lab = decimate_locked(Vl, Fl, lab, target)
    Vl[:, 1] = np.maximum(Vl[:, 1], 0.0)  # decimation may dip a chassis vertex under the ground plane
    return Vl, Fl, lab


def refit_panel(V, lo, hi, ax, blend=0.05):
    """Replace the `ax` coordinate of the vertices in the box by a least-squares quadratic in the other two, blended back
    to the original over `blend` metres inside the box edges."""
    lo, hi = np.asarray(lo, float), np.asarray(hi, float)
    m = np.all((V >= lo) & (V <= hi), 1)
    if not m.any():
        raise RuntimeError(f"panel box {lo}..{hi} holds no vertices")
    u, v = [k for k in range(3) if k != ax]
    P = V[m]
    A = np.stack([np.ones(len(P)), P[:, u], P[:, v], P[:, u] ** 2, P[:, u] * P[:, v], P[:, v] ** 2], 1)
    coef, *_ = np.linalg.lstsq(A, P[:, ax], rcond=None)
    edge = np.minimum.reduce([P[:, u] - lo[u], hi[u] - P[:, u], P[:, v] - lo[v], hi[v] - P[:, v]])
    w = np.clip(edge / blend, 0, 1)
    w = w * w * (3 - 2 * w)
    V = V.copy()
    V[np.nonzero(m)[0], ax] = (1 - w) * P[:, ax] + w * (A @ coef)
    return V


def carve_arches(V, F, wheels):
    """Clean round wheel arches: the arch radius is read from the outer panel above each hub, the mesh is cut along that
    circle (in side view) and everything inside it outboard of the well wall is pressed onto the wall plane, so the panel
    ends on a true circle with a crisp lip. -> V, F, [dict(x_in, y, z, ra)]"""
    arches = []
    for w in wheels:
        x_in = w["x_out"] - w["width"] - 0.015
        d = np.hypot(V[:, 1] - w["radius"], V[:, 2] - w["z"])
        outer = (np.abs(V[:, 0]) > w["x_out"] - 0.03) & (V[:, 1] > w["radius"] + 0.05) & (d > w["radius"] + 0.01)
        ra = float(np.clip(np.percentile(d[outer], 0.5), w["radius"] + 0.03, w["radius"] + 0.12))
        out = np.abs(V[F, 0]).max(1) > x_in - 0.01
        V, F, s, _, _ = split_field(V, F, ra - d, out, snap=0.001)
        m = (s > 0) & (np.abs(V[:, 0]) > x_in)
        V[m, 0] = np.sign(V[m, 0]) * x_in
        arches.append(dict(x_in=x_in, y=w["radius"], z=w["z"], ra=ra))
    return V, F, arches


def transfer_normals(Vc, Nc, D, k=24, cone=35.0):
    """Shading normals from the faired dense surface: each (split) vertex averages the dense face normals around it that
    lie within `cone` of its own side's normal, so big decimated triangles shade like the smooth panel they stand for and
    creases stay split."""
    _, nb = D["ftree"].query(Vc, k=k)
    fn, fa = D["fn"][nb], D["fa"][nb]
    ok = (fn * Nc[:, None]).sum(2) > np.cos(np.radians(cone))
    acc = (fn * (fa * ok)[..., None]).sum(1)
    norm = np.linalg.norm(acc, axis=1, keepdims=True)
    return np.where(norm > 1e-12, acc / np.maximum(norm, 1e-12), Nc)


def emit_body(Vl, Fl, lab, names, crease, D):
    """Per-material primitives sharing one crease-aware normal field (no shading seam at material borders)."""
    Vc, Nc, Fc = crease_normals(Vl, Fl, crease)
    Nc = transfer_normals(Vc, Nc, D)
    prims, counts = [], {}
    for mi, name in enumerate(names):
        sel = lab == mi
        if not sel.any():
            continue
        used, inv = np.unique(Fc[sel], return_inverse=True)
        prims.append(Prim(mi, Vc[used], Nc[used], None, inv.reshape(-1, 3)))
        counts[name] = int(sel.sum())
    return prims, counts


def prepare(car, C):
    spec = C["spec"]
    m = trimesh.load(C["ply"], process=False)
    V, F = np.asarray(m.vertices, float), np.asarray(m.faces, np.int64)
    wheels = C["find"](V, spec)
    V = hero.flatten_wheels(V, wheels)
    if spec.get("debadge"):
        V = hero.debadge(V, F, spec["debadge"])
    t = time.time()
    V = fair(V, F, **FAIR)
    # wells and flattened wheel backdrops are held (their squashed vertices balloon under the bi-Laplacian); panel moves
    # are capped, since the dents it removes are millimetres to a centimetre deep
    pin = crease_vertices(V, F, LOWPASS["crease_deg"])
    for w in wheels:
        pin |= np.hypot(V[:, 1] - w["radius"], V[:, 2] - w["z"]) < w["radius"] + 0.2
    d = lowpass_pinned(V, F, LOWPASS["w"], pin) - V
    n = np.linalg.norm(d, axis=1, keepdims=True)
    V = V + d * np.minimum(1, LOWPASS["cap"] / np.maximum(n, 1e-12))
    print(car, f"faired in {time.time() - t:.0f}s", flush=True)
    for lo, hi, ax in PANELS.get(car, []):
        V = refit_panel(V, lo, hi, ax)
    V, F, arches = carve_arches(V, F, wheels)
    IDX = {n: i for i, n in enumerate(C["names"])}
    # soft labels: only the hero's windscreen sheet; wells come from the carved arches and the underbody from a facing
    # region, both cut as smooth curves
    dense_lab = np.full(len(F), IDX["paint"])
    if car == "hero":
        dense_lab[C["soft"](V, F, wheels, spec) == hero.G] = IDX["glass"]
        dense_lab = hero.clean_islands(F, dense_lab, 300)
    Phi = label_fields(V, F, dense_lab, len(C["names"]), FIELD_STEPS)
    c = V[F].mean(1)
    fn = face_normals(V, F)[0]
    coarse = (fn[:, 1] < -0.5) & (c[:, 1] < spec["under_y"])
    for a in arches:
        coarse |= np.hypot(c[:, 1] - a["y"], c[:, 2] - a["z"]) < a["ra"]
    for r in spec["regions"]:
        if r["mat"] == "interior":
            lo, hi = np.asarray(r["box"][0], float), np.asarray(r["box"][1], float)
            coarse |= np.all((c >= lo) & (c <= hi), 1)
    soft_order = [IDX[n] for n in ("glass", "trim") if (dense_lab == IDX[n]).any()]
    fn_, fa_ = face_normals(V, F)
    return dict(ftree=cKDTree(V[F].mean(1)), fn=fn_, fa=fa_, arches=arches, V=V, F=F, Phi=Phi, vtree=cKDTree(V), coarse=coarse, spec=spec, IDX=IDX, wheels=wheels, soft_order=soft_order)


def build(car):
    t0 = time.time()
    C = car_def(car)
    spec, names = C["spec"], C["names"]
    IDX = {n: i for i, n in enumerate(names)}
    D = prepare(car, C)
    wheels = D["wheels"]
    dz = -(wheels[0]["z"] + wheels[1]["z"]) / 2 if car == "hero" else 0.0
    wheel_nodes = {}
    for w in wheels:
        for side, sx in (("L", 1), ("R", -1)):
            wheel_nodes[f"wheel_{w['axle'][0].upper()}{side}"] = dict(hub=[sx * w["hub_x"], w["radius"], w["z"] + dz],
                                                                      radius=w["radius"], width=w["width"], sx=sx)
    wmat = {"rubber": "rubber", "rim": "rim", "trim": "trim", "chrome": "chrome" if "chrome" in IDX else "rim"}
    results = []
    for lod, o in C["lods"].items():
        wparts = {}
        for key, wn in wheel_nodes.items():
            Pw = cwheel.build(wn["radius"], wn["width"], C["rim_r"], o["wheel_lod"])
            if wn["sx"] < 0:
                Pw = Pw.transformed(np.diag([-1.0, 1, 1]), np.zeros(3))
            wparts[key] = Pw
        wsum = sum(p.tris() for p in wparts.values())
        extras = None
        if car == "hero":
            extras = hero.exhaust_tips(spec, o["tip_segs"])
            extras.extend(hero.wipers(spec, D["V"]))
        body_budget = o["budget"] - wsum - (extras.tris() if extras else 0)
        pre = int(body_budget * o["pre"])
        for attempt in range(8):
            Vl, Fl, lab = body_lod(D, o, body_budget, pre)
            print(car, f"LOD{lod} pre {pre} -> body {len(Fl)} / {body_budget}", flush=True)
            if len(Fl) <= body_budget:
                break
            pre = int(pre * 0.85)
        else:
            raise RuntimeError(f"{car} LOD{lod} body stays over budget: {len(Fl)} > {body_budget}")
        prims, counts = emit_body(Vl, Fl, lab, names, spec.get("crease", 38), D)
        if extras:
            for mn, (v, nrm, f) in extras.emit().items():
                prims.append(Prim(IDX[mn], v, nrm, None, f))
            prims = hero.merge_prims(prims)
        for p in prims:
            p.pos = p.pos + [0, 0, dz]
        # wheels
        wnodes = []
        occV, occF, base = [Vl + [0, 0, dz]], [Fl], len(Vl)
        for key, Pw in wparts.items():
            by = {}
            for mn, (v, nrm, f) in Pw.emit().items():
                by.setdefault(IDX[wmat[mn]], []).append((v, nrm, f))
            wp = []
            for mi, lst in sorted(by.items()):
                b, vs, ns, fs = 0, [], [], []
                for v, nrm, f in lst:
                    vs.append(v); ns.append(nrm); fs.append(f + b); b += len(v)
                wp.append(Prim(mi, np.concatenate(vs), np.concatenate(ns), None, np.concatenate(fs)))
                occV.append(wp[-1].pos + wheel_nodes[key]["hub"]); occF.append(wp[-1].idx + base); base += len(wp[-1].pos)
            wnodes.append((key, wp, wheel_nodes[key]["hub"]))
        # baked AO on the body
        t = time.time()
        allP = np.vstack([p.pos for p in prims]); allN = np.vstack([p.nor for p in prims])
        a = ao.bake(allP, allN, np.vstack(occV), np.vstack(occF))
        col = AO_RANGE[0] + (AO_RANGE[1] - AO_RANGE[0]) * a
        k = 0
        for p in prims:
            p.color = np.repeat(col[k:k + len(p.pos), None], 3, 1); k += len(p.pos)
        print(car, f"LOD{lod} AO {time.time() - t:.0f}s mean {a.mean():.3f} min {a.min():.3f}", flush=True)
        nodes = [("body", prims)] + wnodes
        path = f"{ROOT}/work/build/{car}_lod{lod}.glb"
        os.makedirs(os.path.dirname(path), exist_ok=True)
        size = write_glb(path, nodes, materials(names, C["paint"], C["glass_blend"]), [], generator="apex-outrun-cartoon-cars")
        tris = sum(p.tris for nd in nodes for p in nd[1])
        allv = np.vstack([p.pos + (nd[2] if len(nd) > 2 else 0) for nd in nodes for p in nd[1]])
        results.append(dict(id=C["ids"][lod], lod=lod, path=os.path.relpath(path, ROOT), tris=int(tris),
                            body_tris=int(sum(p.tris for p in prims)), wheel_tris=int(wsum), bytes=size,
                            sha256=hashlib.sha256(open(path, "rb").read()).hexdigest(), labels=counts,
                            bounds_m=[allv.min(0).tolist(), allv.max(0).tolist()], ao_mean=float(a.mean())))
        print(car, json.dumps({k: v for k, v in results[-1].items() if k != "labels"}), flush=True)
    rec = dict(car=car, wheels=[dict(name=k, hub=v["hub"], radius=v["radius"], width=v["width"]) for k, v in wheel_nodes.items()],
               fair=FAIR, lowpass=LOWPASS, field_steps=FIELD_STEPS, ao_range=AO_RANGE, lods=results, seconds=round(time.time() - t0, 1))
    json.dump(rec, open(f"{ROOT}/work/build/{car}.json", "w"), indent=1)
    return rec


if __name__ == "__main__":
    for car in sys.argv[1:]:
        build(car)
