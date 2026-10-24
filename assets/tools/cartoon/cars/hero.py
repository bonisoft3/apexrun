"""Hero car: aligned symmetric Hunyuan body -> labelled body + procedural wheels -> LOD0 / LOD1 GLBs.

usage: hero.py <candidate>      reads work/align/<candidate>.ply, writes work/build/<candidate>_lod{0,1}.glb + .json

Labels come from geometry only, in two kinds:
- soft regions found on the dense mesh (windscreen sheet, wheel wells, underbody) and carried to each LOD by nearest face;
- crisp regions (cockpit, windscreen frame, lamps, plate, grille, bumpers, strakes, pop-up lid gaps) given as convex boxes
  in car coordinates (picked against orthographic elevations of the clay and the reference), sliced into the mesh along
  their planes so their edges are straight whatever the triangulation.
Every label is then cleaned: islands smaller than ISLAND faces join the label they touch most.
"""
import json, os, sys, time
import numpy as np
import pymeshlab
import scipy.sparse as sp
import trimesh
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.dirname(__file__))
import wheel
from gltf_io import Prim, write_glb
from materials import IDX, NAMES, materials
from meshkit import crease_normals, face_normals, split_plane

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LODS = {0: dict(body=41500, wheel_lod=0, island=40, grooves=True, tip_segs=24),
        1: dict(body=10800, wheel_lod=1, island=12, grooves=False, tip_segs=10)}  # body: after slicing
P, G, I, T, C = IDX["paint"], IDX["glass"], IDX["interior"], IDX["trim"], IDX["chrome"]


def reduce(V, F, faces, coarse=None, coarse_share=0.4):
    """Quadric decimation to about `faces`. Faces flagged `coarse` (underbody, wheel backdrops, wells: hidden or black) are
    then decimated on their own down to coarse_share of the budget, so the visible surface keeps the rest."""
    kw = dict(preservenormal=True, preserveboundary=True, optimalplacement=True, planarquadric=True, qualitythr=0.5)
    q = np.zeros(len(F)) if coarse is None else coarse.astype(float)
    t1 = faces
    for _ in range(3):
        ms = pymeshlab.MeshSet()
        ms.add_mesh(pymeshlab.Mesh(V, F, f_scalar_array=q))
        ms.meshing_decimation_quadric_edge_collapse(targetfacenum=int(t1), **kw)
        if coarse is None:
            break
        n_coarse = int((ms.current_mesh().face_scalar_array() > 0.5).sum())
        keep = int(coarse_share * faces)
        if n_coarse > keep:
            ms.compute_selection_by_condition_per_face(condselect="fq > 0.5")
            ms.meshing_decimation_quadric_edge_collapse(targetfacenum=keep, selected=True, **kw)  # counts selected faces
        n = ms.current_mesh().face_number()
        if abs(n - faces) < 0.02 * faces:
            break
        t1 += faces - n
    m = ms.current_mesh()
    return m.vertex_matrix().astype(float), m.face_matrix().astype(np.int64)


def adjacency(F):
    """Face adjacency pairs through shared edges."""
    e = np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), 1)
    fid = np.tile(np.arange(len(F)), 3)
    order = np.lexsort((e[:, 1], e[:, 0]))
    e, fid = e[order], fid[order]
    same = (e[1:] == e[:-1]).all(1)
    return np.stack([fid[:-1][same], fid[1:][same]], 1)


def clean_islands(F, lab, min_faces, locked=None):
    """Relabel connected same-label patches smaller than min_faces to the label they border most; repeat until stable."""
    adj = adjacency(F)
    n = len(F)
    for _ in range(6):
        same = lab[adj[:, 0]] == lab[adj[:, 1]]
        a = adj[same]
        g = sp.coo_matrix((np.ones(len(a)), (a[:, 0], a[:, 1])), shape=(n, n))
        ncomp, comp = connected_components(g, directed=False)
        size = np.bincount(comp, minlength=ncomp)
        small = size[comp] < min_faces
        if locked is not None:
            small &= ~locked
        if not small.any():
            break
        d = adj[~same]
        votes = {}
        for x, y in ((d[:, 0], d[:, 1]), (d[:, 1], d[:, 0])):
            m = small[x]
            for c, l in zip(comp[x[m]], lab[y[m]]):
                votes.setdefault(c, {}).setdefault(l, 0)
                votes[c][l] += 1
        changed = 0
        for c, v in votes.items():
            best = max(v, key=v.get)
            sel = comp == c
            if lab[sel][0] != best:
                lab[sel] = best; changed += 1
        if not changed:
            break
    return lab


# ---------- wheels ----------

def find_wheels(V, spec):
    """Axles from the ground-contact clusters; hub x from the outer face of Hunyuan's tyre."""
    low = V[V[:, 1] < 0.015]
    zs = np.sort(low[:, 2])
    gap = np.argmax(np.diff(zs))
    out = []
    for name, zz in (("front", zs[gap + 1:]), ("rear", zs[:gap + 1])):
        za = float(np.median(zz))
        w = spec["wheels"][name]
        R = w["radius"]
        d = np.hypot(V[:, 1] - R, V[:, 2] - za)
        near = (d < 0.85 * R) & (V[:, 0] > 0)
        x_out = float(np.percentile(V[near, 0], 99.5))
        x_out = min(x_out, w.get("x_out_max", 9.0))
        out.append(dict(axle=name, z=za, radius=R, width=w["width"], x_out=x_out, hub_x=x_out - w["width"] / 2))
    return out


def debadge(V, F, boxes):
    """Replace the surface inside each box by the biharmonic fill of its surroundings (curvature carries across, so a
    rounded edge stays rounded): wipes badges/lettering Hunyuan copied from the reference."""
    from scipy.sparse.linalg import spsolve
    V = V.copy()
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    A = sp.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(len(V), len(V))).tocsr()
    A = ((A + A.T) > 0).astype(float)
    deg = np.asarray(A.sum(1)).ravel()
    for lo, hi in boxes:
        free = np.all((V >= lo) & (V <= hi), 1) & (deg > 0)
        if not free.any():
            raise RuntimeError(f"debadge box {lo}..{hi} holds no vertices")
        # work on the free set plus two rings of fixed neighbours
        ring = free.copy()
        for _ in range(3):
            ring |= (A @ ring.astype(float)) > 0
        idx = np.nonzero(ring)[0]
        sub = A[idx][:, idx]
        L = sp.diags(np.asarray(sub.sum(1)).ravel()) - sub
        L2 = (L @ L).tocsr()
        f = free[idx]
        rhs = -L2[f][:, ~f] @ V[idx][~f]
        V[idx[f]] = np.column_stack([spsolve(L2[f][:, f].tocsc(), rhs[:, k]) for k in range(3)])
    return V


def flatten_wheels(V, wheels):
    """Squash Hunyuan's wheel blobs onto a plane just inboard of the new tyre: a closed, dark backdrop, no holes."""
    V = V.copy()
    for w in wheels:
        x_in = w["x_out"] - w["width"] - 0.015
        d = np.hypot(V[:, 1] - w["radius"], V[:, 2] - w["z"])
        m = (d < w["radius"] + 0.012) & (np.abs(V[:, 0]) > x_in)
        V[m, 0] = np.sign(V[m, 0]) * x_in
    return V


# ---------- soft labels (dense mesh) ----------

def soft_labels(V, F, wheels, spec):
    n, _ = face_normals(V, F)
    c = V[F].mean(1)
    lab = np.full(len(F), P)
    ws = spec["windscreen"]
    y_ws = ws["a"] + ws["b"] * c[:, 2] + ws["d"] * c[:, 2] ** 2 + ws["c"] * c[:, 0] ** 2
    lab[(np.abs(c[:, 1] - y_ws) < ws["tol"]) & (c[:, 2] > ws["z"][0]) & (c[:, 2] < ws["z"][1]) & (np.abs(c[:, 0]) < ws["x_max"])] = G
    # wheel wells and the flattened wheel backdrops
    for w in wheels:
        x_in = w["x_out"] - w["width"] - 0.015
        rad = np.hypot(c[:, 1] - w["radius"], c[:, 2] - w["z"])
        to_hub = np.stack([np.zeros(len(c)), w["radius"] - c[:, 1], w["z"] - c[:, 2]], 1)
        to_hub /= np.linalg.norm(to_hub, axis=1, keepdims=True) + 1e-9
        disc = (rad < w["radius"] + 0.015) & (np.abs(c[:, 0]) > x_in - 0.2)
        liner = (rad < w["radius"] + 0.16) & (np.abs(c[:, 0]) < w["x_out"] + 0.005) & ((n * to_hub).sum(1) > 0.35) & (c[:, 1] > 0.05)
        lab[disc | liner] = T
    # underbody
    lab[(n[:, 1] < -0.5) & (c[:, 1] < spec["under_y"])] = T
    return lab


# ---------- crisp regions ----------

def region_planes(r):
    lo, hi = np.asarray(r["box"][0], float), np.asarray(r["box"][1], float)
    planes = []
    for a in range(3):
        e = np.eye(3)[a]
        if np.isfinite(lo[a]):
            planes.append((-e, -lo[a]))
        if np.isfinite(hi[a]):
            planes.append((e, hi[a]))
    for p in r.get("planes", []):
        nn = np.asarray(p[0], float)
        planes.append((nn / np.linalg.norm(nn), p[1] / np.linalg.norm(nn)))
    return planes  # inside: n.x <= d for all


def mirrored(r):
    """Regions are given for the +X half (car's left) and applied to both sides."""
    if not r.get("mirror", True):
        return [r]
    lo, hi = np.asarray(r["box"][0], float), np.asarray(r["box"][1], float)
    if lo[0] >= 0:
        m = dict(r)
        m["box"] = ([-hi[0], lo[1], lo[2]], [-lo[0], hi[1], hi[2]])
        m["planes"] = [([-p[0][0], p[0][1], p[0][2]], p[1]) for p in r.get("planes", [])]
        m["_mirror"] = True
        return [r, m]
    return [r]


def apply_regions(V, F, lab, regions, grooves):
    locked = np.zeros(len(F), bool)
    for r0 in regions:
        for r in mirrored(r0):
            planes = region_planes(r)
            fdir = None
            if "facing" in r:
                fdir = np.asarray(r["facing"][0], float) * ([-1, 1, 1] if r.get("_mirror") else 1)
            for nn, d in planes:
                c = V[F].mean(1)
                inb = np.ones(len(F), bool)
                for n2, d2 in planes:
                    if n2 is not nn:
                        inb &= (c @ n2) <= d2 + 0.02
                if fdir is not None:
                    inb &= face_normals(V, F)[0] @ fdir > r["facing"][1] - 0.35
                if "only" in r:
                    inb &= np.isin(lab, [IDX[x] for x in r["only"]])
                V, F, _, X = split_plane_masked(V, F, nn, d, inb, np.stack([lab, locked], 1))
                lab, locked = X[:, 0].copy(), X[:, 1].astype(bool)
            c = V[F].mean(1)
            fn, _ = face_normals(V, F)
            inside = np.ones(len(F), bool)
            for nn, d in planes:
                inside &= (c @ nn) <= d + 1e-6
            if fdir is not None:
                inside &= fn @ fdir > r["facing"][1]
            if "only" in r:
                inside &= np.isin(lab, [IDX[x] for x in r["only"]])
            lab[inside] = IDX[r["mat"]]
            locked |= inside
            if grooves and r.get("push"):
                # sink the region's interior vertices along their averaged normal: real grooves, not paint
                vid = np.unique(F[inside])
                on_edge = np.unique(F[~inside])
                vid = np.setdiff1d(vid, on_edge)
                if len(vid):
                    vn = np.zeros((len(V), 3))
                    np.add.at(vn, F[inside].ravel(), np.repeat(fn[inside], 3, 0))
                    vn = vn[vid] / (np.linalg.norm(vn[vid], axis=1, keepdims=True) + 1e-9)
                    V[vid] -= vn * r["push"]
    return V, F, lab, locked


def split_plane_masked(V, F, n, d, mask, extra):
    """split_plane restricted to faces in mask; neighbours of cut edges outside the mask are bisected (no T-junctions)."""
    s = V @ n - d
    fs = np.sign(np.where(np.abs(s) <= 1e-7, 0, s))[F]
    cross = (fs.max(1) > 0) & (fs.min(1) < 0) & mask
    if not cross.any():
        return V, F, None, extra
    sub = np.nonzero(cross)[0]
    rest = np.nonzero(~cross)[0]
    V2, F2, _, X2 = split_plane(V, F[sub], n, d, eps=1e-7, extra=extra[sub])
    # cut points sit on edges of sub faces; bisect untouched faces that share those edges
    nv = len(V)
    newpts = V2[nv:]
    if len(newpts) == 0:
        return V2, np.vstack([F[rest], F2]), None, np.vstack([extra[rest], X2])
    Fr = F[rest]
    Xr = extra[rest]
    # map each cut edge (a, b) -> new vertex: recover by geometry (new point lies on segment a-b)
    e_sub = np.concatenate([F[sub][:, [0, 1]], F[sub][:, [1, 2]], F[sub][:, [2, 0]]])
    a, b = V[e_sub[:, 0]], V[e_sub[:, 1]]
    sa, sb = s[e_sub[:, 0]], s[e_sub[:, 1]]
    cut = (np.sign(sa) * np.sign(sb) < 0) & (np.abs(sa) > 1e-7) & (np.abs(sb) > 1e-7)
    e_cut = e_sub[cut]
    pts = a[cut] + (sa[cut] / (sa[cut] - sb[cut]))[:, None] * (b[cut] - a[cut])
    tree = cKDTree(newpts)
    dd, ii = tree.query(pts)
    if dd.max() > 1e-6:
        raise RuntimeError(f"cut point lookup failed ({dd.max():.2e})")
    emap = {(min(p, q), max(p, q)): nv + int(k) for (p, q), k in zip(e_cut, ii)}
    outF, outX = [], []
    for f, x in zip(Fr, Xr):
        hits = [j for j in range(3) if (min(f[j], f[(j + 1) % 3]), max(f[j], f[(j + 1) % 3])) in emap]
        pt = lambda j: emap[(min(f[j], f[(j + 1) % 3]), max(f[j], f[(j + 1) % 3]))]
        if not hits:
            outF.append(f); outX.append(x)
        elif len(hits) == 1:
            j = hits[0]
            p = pt(j)
            a0, b0, c0 = f[j], f[(j + 1) % 3], f[(j + 2) % 3]
            outF += [[a0, p, c0], [p, b0, c0]]; outX += [x, x]
        elif len(hits) == 2:
            # edges j and k share the lone vertex; rotate so it is first: edges (a,b) and (c,a)
            j, k = hits
            r = (j + 1) % 3 if (j + 1) % 3 == k else (k + 1) % 3  # vertex shared by both edges
            a0, b0, c0 = f[r], f[(r + 1) % 3], f[(r + 2) % 3]
            pab, pca = pt(r), pt((r + 2) % 3)
            outF += [[a0, pab, pca], [pab, b0, c0], [pab, c0, pca]]; outX += [x, x, x]
        else:
            raise RuntimeError("face with three cut edges")
    return V2, np.vstack([np.asarray(outF, np.int64).reshape(-1, 3), F2]), None, np.vstack([np.asarray(outX).reshape(-1, extra.shape[1]), X2])


# ---------- procedural add-ons ----------

def exhaust_tips(spec, segs):
    """Chrome tips with a rolled lip and a dark bore, axis along Z."""
    from meshkit import Parts, lathe
    e = spec["exhausts"]
    r, z0, z1 = e["radius"], e["z0"], e["z1"]
    Pt = Parts()
    for x, y in e["centres"]:
        for sx in (1, -1):
            # profile in (radius, axial) walking outside -> lip -> bore; axial maps to z
            outer = [(r, z0), (r, z1 + 0.006), (r - 0.002, z1), (r - 0.006, z1 + 0.001), (r - 0.0065, z1 + 0.01)]
            bore = [(r - 0.0065, z1 + 0.01), (r - 0.0065, z1 + 0.07), (0.0, z1 + 0.07)]
            for prof, mat in ((outer, "chrome"), (bore, "trim")):
                V, F = lathe([(a, b) for a, b in prof], segs)
                # lathe revolves about X: swap so the axis is Z, then place
                V = V[:, [1, 2, 0]] + [sx * x, y, 0]
                Pt.add(mat, V, F if sx > 0 else F, crease=40)
    # winding: lathe faces outward for profiles walked away from +axis; verified in the tip render
    return Pt


def wipers(spec, V):
    """Two parked blades lying on the cowl strip, following the surface heights of the body mesh V."""
    from meshkit import Parts
    Pt = Parts()
    w = spec["wipers"]
    for x0, x1, z in w["spans"]:
        pts = []
        for x in (x0, x1):
            near = (np.abs(V[:, 0] - x) < 0.025) & (np.abs(V[:, 2] - z) < 0.025)
            if not near.any():
                raise RuntimeError(f"no cowl surface near x={x}")
            pts.append([x, V[near, 1].max() + 0.006, z])
        a, b = np.asarray(pts[0]), np.asarray(pts[1])
        ax = (b - a) / np.linalg.norm(b - a)
        up = np.array([0, 1.0, 0]); up -= ax * (up @ ax); up /= np.linalg.norm(up)
        sd = np.cross(ax, up)
        hw, hh = 0.007, 0.009
        corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
        Vb = np.array([p + sd * cx * hw + up * cy * hh for p in (a, b) for cx, cy in corners])
        Fb = []
        for k in range(4):
            j = (k + 1) % 4
            Fb += [[k, j, 4 + j], [k, 4 + j, 4 + k]]
        Fb += [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7]]
        Fb = np.asarray(Fb)
        n = np.cross(Vb[Fb[:, 1]] - Vb[Fb[:, 0]], Vb[Fb[:, 2]] - Vb[Fb[:, 0]])
        out = (Vb[Fb].mean(1) - (a + b) / 2)
        flip = (n * out).sum(1) < 0
        Fb[flip] = Fb[flip][:, ::-1]
        Pt.add("trim", Vb, Fb, crease=30)
    return Pt


# ---------- build ----------

def merge_prims(prims):
    by = {}
    for p in prims:
        by.setdefault(p.material, []).append(p)
    out = []
    for mi in sorted(by):
        ps, base, idx = by[mi], 0, []
        for p in ps:
            idx.append(p.idx + base); base += len(p.pos)
        out.append(Prim(mi, np.concatenate([p.pos for p in ps]), np.concatenate([p.nor for p in ps]), None, np.concatenate(idx)))
    return out


def body_lod(V, F, tree, dense_lab, spec, o, target):
    # hidden or black parts (wheel backdrops, wells, underbody, cockpit) share a fixed slice of the budget
    c = V[F].mean(1)
    coarse = dense_lab == T
    for r in spec["regions"]:
        if r["mat"] == "interior":
            lo, hi = np.asarray(r["box"][0], float), np.asarray(r["box"][1], float)
            coarse |= np.all((c >= lo) & (c <= hi), 1)
    Vl, Fl = reduce(V, F, target, coarse, coarse_share=0.4)
    # soft labels by majority of the 4 nearest dense faces
    _, nb = tree.query(Vl[Fl].mean(1), k=4)
    votes = np.zeros((len(Fl), len(NAMES)))
    for k in range(4):
        np.add.at(votes, (np.arange(len(Fl)), dense_lab[nb[:, k]]), 1)
    lab = clean_islands(Fl, votes.argmax(1), o["island"])
    Vl, Fl, lab, locked = apply_regions(Vl, Fl, lab, spec["regions"], o["grooves"])
    return Vl, Fl, clean_islands(Fl, lab, o["island"], locked)


def build(cand, spec):
    t0 = time.time()
    m = trimesh.load(f"{ROOT}/work/align/{cand}.ply", process=False)
    V, F = np.asarray(m.vertices, float), np.asarray(m.faces, np.int64)
    wheels = find_wheels(V, spec)
    V = flatten_wheels(V, wheels)
    V = debadge(V, F, spec.get("debadge", []))
    if spec.get("taubin"):
        ms = pymeshlab.MeshSet(); ms.add_mesh(pymeshlab.Mesh(V, F))
        ms.apply_coord_taubin_smoothing(stepsmoothnum=spec["taubin"])
        V = ms.current_mesh().vertex_matrix().astype(float)
    dense_lab = soft_labels(V, F, wheels, spec)
    dense_lab = clean_islands(F, dense_lab, 300)
    dense_c = V[F].mean(1)
    tree = cKDTree(dense_c)
    dz = -(wheels[0]["z"] + wheels[1]["z"]) / 2  # origin midway between the axles
    wheel_nodes = {}
    for w in wheels:
        for side, sx in (("L", 1), ("R", -1)):
            key = f"wheel_{w['axle'][0].upper()}{side}"
            wheel_nodes[key] = dict(hub=[sx * w["hub_x"], w["radius"], w["z"] + dz], radius=w["radius"], width=w["width"], sx=sx)
    results = []
    for lod, o in LODS.items():
        target = o["body"]
        for attempt in range(5):  # slicing adds faces: shrink the decimation target until the sliced body fits
            Vl, Fl, lab = body_lod(V, F, tree, dense_lab, spec, o, target)
            if len(Fl) <= o["body"]:
                break
            target -= len(Fl) - o["body"] + 50
        else:
            raise RuntimeError(f"LOD{lod} body stays over budget: {len(Fl)}")
        prims = []
        counts = {}
        for mi in range(len(NAMES)):
            sel = lab == mi
            if not sel.any():
                continue
            used, inv = np.unique(Fl[sel], return_inverse=True)
            v, nrm, f = crease_normals(Vl[used], inv.reshape(-1, 3), spec.get("crease", 38))
            prims.append(Prim(mi, v, nrm, None, f))
            counts[NAMES[mi]] = int(sel.sum())
        tips = exhaust_tips(spec, o["tip_segs"])
        tips.extend(wipers(spec, V))
        tips = tips.emit()
        for mn, (v, nrm, f) in tips.items():
            prims.append(Prim(IDX[mn], v, nrm, None, f))
        prims = merge_prims(prims)
        for p in prims:
            p.pos = p.pos + [0, 0, dz]
        Vl = Vl + [0, 0, dz]
        nodes = [("body", prims)]
        wtris = 0
        for key, wn in wheel_nodes.items():
            Pw = wheel.build(wn["radius"], wn["width"], 0.2032, o["wheel_lod"])
            if wn["sx"] < 0:
                Pw = Pw.transformed(np.diag([-1.0, 1, 1]), np.zeros(3))
            wp = [Prim(IDX[mn], v, nrm, None, f) for mn, (v, nrm, f) in Pw.emit().items()]
            wtris += sum(p.tris for p in wp)
            nodes.append((key, wp, wn["hub"]))
        path = f"{ROOT}/work/build/{cand}_lod{lod}.glb"
        os.makedirs(os.path.dirname(path), exist_ok=True)
        size = write_glb(path, nodes, materials(), [], generator="apex-outrun-hero-car")
        tris = sum(p.tris for p in prims) + wtris
        allv = np.vstack([p.pos + (nd[2] if len(nd) > 2 else 0) for nd in nodes for p in nd[1]])
        results.append(dict(lod=lod, path=os.path.relpath(path, ROOT), tris=int(tris), body_tris=int(sum(p.tris for p in prims)), wheel_tris=int(wtris),
                            bytes=size, labels=counts, bounds_m=[allv.min(0).tolist(), allv.max(0).tolist()]))
        print(json.dumps(results[-1]), flush=True)
    rec = dict(candidate=cand, wheels=[dict(name=k, hub=v["hub"], radius=v["radius"], width=v["width"]) for k, v in wheel_nodes.items()],
               wheel_detect=wheels, origin_shift_z=dz, lods=results, seconds=round(time.time() - t0, 1))
    json.dump(rec, open(f"{ROOT}/work/build/{cand}.json", "w"), indent=1)
    return rec


if __name__ == "__main__":
    from specs import SPECS
    build(sys.argv[1], SPECS[sys.argv[1]])
