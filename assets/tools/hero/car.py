"""80s traffic: Hunyuan3D-2 shape -> symmetric body split into paint / glass / trim / lights / tyres / hubcaps.

usage: car.py <id> [...]   reads work/hy/<id>.glb and work/cut/<id>.png (the RGBA reference Hunyuan saw)
The reference is projected only to *classify* faces; every material is a hand PBR (clear-coat paint, glass, rubber, metal hubcaps, emissive lamps).
"""
import json, os, sys, time
import cv2
import numpy as np
import trimesh
import pymeshlab
sys.path.insert(0, os.path.dirname(__file__))
from gltf_io import Prim, write_glb
from lod import simplify
from items import ROOT, register

# length (m), tyre radius, tyre width, front sign override (None = from the reference view);
# a cab-over truck keeps glass in the cab (glass_zf_min) and its lamps low on the rear frame (tail_yh)
CARS = {
    "car-sedan": dict(length=4.65, tyre_r=0.31, tyre_w=0.20, front=None),
    "car-convertible": dict(length=4.25, tyre_r=0.30, tyre_w=0.21, front=None),
    "car-pickup": dict(length=4.55, tyre_r=0.36, tyre_w=0.22, front=None),
    "car-boxtruck": dict(length=7.2, tyre_r=0.47, tyre_w=0.26, front=None, glass_zf_min=0.45, tail_yh=(0.1, 0.24)),
}
BUDGET = 36000                     # LOD0 triangles, wheels included
LOD_FRACTIONS = (1.0, 0.25, 0.06)
PAINT, GLASS, TRIM, HEAD, TAIL, RUBBER, RIM = range(7)
NAMES = ["paint", "glass", "trim", "headlight", "taillight", "rubber", "rim"]


def materials(paint_rgb):
    lin = [float(c) for c in paint_rgb]
    return [
        {"name": "paint", "pbrMetallicRoughness": {"baseColorFactor": lin + [1], "metallicFactor": 0.0, "roughnessFactor": 0.35},
         "extensions": {"KHR_materials_clearcoat": {"clearcoatFactor": 1.0, "clearcoatRoughnessFactor": 0.04}}},
        {"name": "glass", "pbrMetallicRoughness": {"baseColorFactor": [0.015, 0.02, 0.025, 1], "metallicFactor": 0.0, "roughnessFactor": 0.04},
         "extensions": {"KHR_materials_clearcoat": {"clearcoatFactor": 1.0, "clearcoatRoughnessFactor": 0.0}}},
        {"name": "trim", "pbrMetallicRoughness": {"baseColorFactor": [0.025, 0.025, 0.025, 1], "metallicFactor": 0.0, "roughnessFactor": 0.55}},
        {"name": "headlight", "pbrMetallicRoughness": {"baseColorFactor": [0.9, 0.9, 0.85, 1], "metallicFactor": 0.0, "roughnessFactor": 0.1},
         "emissiveFactor": [1.0, 0.95, 0.8], "extensions": {"KHR_materials_emissive_strength": {"emissiveStrength": 0.6}}},
        {"name": "taillight", "pbrMetallicRoughness": {"baseColorFactor": [0.5, 0.02, 0.02, 1], "metallicFactor": 0.0, "roughnessFactor": 0.15},
         "emissiveFactor": [1.0, 0.05, 0.03], "extensions": {"KHR_materials_emissive_strength": {"emissiveStrength": 0.4}}},
        {"name": "rubber", "pbrMetallicRoughness": {"baseColorFactor": [0.03, 0.03, 0.03, 1], "metallicFactor": 0.0, "roughnessFactor": 0.88}},
        {"name": "rim", "pbrMetallicRoughness": {"baseColorFactor": [0.8, 0.8, 0.82, 1], "metallicFactor": 1.0, "roughnessFactor": 0.28}},
    ]


def reduce(mesh, faces):
    ms = pymeshlab.MeshSet()
    ms.add_mesh(pymeshlab.Mesh(mesh.vertices, mesh.faces))
    ms.meshing_decimation_quadric_edge_collapse(targetfacenum=int(faces), preservenormal=True, preserveboundary=True,
                                                 optimalplacement=True, planarquadric=True)
    m = ms.current_mesh()
    return trimesh.Trimesh(m.vertex_matrix(), m.face_matrix(), process=True)


def raster_ids(v2, depth, faces, shape):
    """Painter's-order face id buffer of projected triangles (larger depth = nearer)."""
    buf = np.zeros(shape, np.int32)
    tri = v2[faces]
    for f in np.argsort(depth[faces].mean(1)):
        cv2.fillConvexPoly(buf, np.round(tri[f] * 4).astype(np.int32), int(f) + 1, lineType=cv2.LINE_8, shift=2)
    return buf


def fit_view(mesh, alpha):
    """Find the yaw/pitch (about the Hunyuan frame, viewed from +Z) whose orthographic silhouette best matches the mask."""
    H, W = alpha.shape
    ys, xs = np.nonzero(alpha > 127)
    mb = np.array([xs.min(), ys.min(), xs.max(), ys.max()], np.float64)
    best = None
    small = mesh if len(mesh.faces) <= 60000 else reduce(mesh, 60000)
    for yaw in np.arange(-75, 76, 5):
        for pitch in np.arange(-10, 31, 5):
            R = rot(yaw, pitch)
            p = small.vertices @ R.T
            v2, sc, off = to_image(p, mb)
            sil = np.zeros((H, W), np.uint8)
            cv2.fillPoly(sil, list(np.round(v2[small.faces]).astype(np.int32)), 1)
            m = alpha > 127
            iou = (sil.astype(bool) & m).sum() / max(1, (sil.astype(bool) | m).sum())
            if best is None or iou > best[0]:
                best = (iou, yaw, pitch)
    return best


def rot(yaw, pitch):
    a, b = np.radians(yaw), np.radians(pitch)
    Ry = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
    Rx = np.array([[1, 0, 0], [0, np.cos(b), -np.sin(b)], [0, np.sin(b), np.cos(b)]])
    return Rx @ Ry


def to_image(p, mb):
    """Orthographic from +Z: x right, y up -> image pixels fitted to the mask bbox."""
    x, y = p[:, 0], -p[:, 1]
    sc = min((mb[2] - mb[0]) / (x.max() - x.min()), (mb[3] - mb[1]) / (y.max() - y.min()))
    ox = (mb[0] + mb[2]) / 2 - (x.max() + x.min()) / 2 * sc
    oy = (mb[1] + mb[3]) / 2 - (y.max() + y.min()) / 2 * sc
    return np.stack([x * sc + ox, y * sc + oy], 1), sc, (ox, oy)


def smooth_labels(mesh, lab, iters=8):
    adj = mesh.face_adjacency
    for _ in range(iters):
        votes = np.zeros((len(lab), len(NAMES)))
        np.add.at(votes, (adj[:, 0], lab[adj[:, 1]]), 1)
        np.add.at(votes, (adj[:, 1], lab[adj[:, 0]]), 1)
        votes[np.arange(len(lab)), lab] += 1.5
        lab = votes.argmax(1)
    return lab


def build(cid):
    t0 = time.time()
    spec = CARS[cid]
    hy = json.load(open(f"{ROOT}/work/hy/{cid}.json"))
    raw = trimesh.load(f"{ROOT}/work/hy/{cid}.glb", force="mesh")
    work = reduce(raw, 120000) if len(raw.faces) > 120000 else raw
    ref = cv2.cvtColor(cv2.imread(f"{ROOT}/work/cut/{cid}.png", cv2.IMREAD_UNCHANGED), cv2.COLOR_BGRA2RGBA)
    rgb, alpha = ref[..., :3], ref[..., 3]
    view = fit_view(work, alpha)
    # camera of the fitted view, as a direction in the Hunyuan frame (orthographic, looking down -Z after rot)
    cam = rot(view[1], view[2]).T @ np.array([0, 0, 1.0])
    # car frame: long horizontal axis -> +Z (front = the end nearer the camera: the references are front 3/4 views)
    xz = work.vertices[:, [0, 2]] - work.vertices[:, [0, 2]].mean(0)
    _, vecs = np.linalg.eigh(np.cov(xz.T))
    ax = np.array([vecs[0, 1], 0, vecs[1, 1]])
    if spec["front"]:
        ax *= spec["front"]
    elif ax @ cam < 0:
        ax = -ax
    up = np.array([0, 1.0, 0])
    M = np.stack([np.cross(up, ax), up, ax])  # rows: +X = car's left (glTF), +Y up, +Z forward; det +1
    seen_sign = 1 if M[0] @ cam > 0 else -1  # the side of the car the reference shows
    v = (work.vertices - work.vertices.mean(0)) @ M.T
    v *= spec["length"] / (v[:, 2].max() - v[:, 2].min())
    v -= [(v[:, 0].max() + v[:, 0].min()) / 2, v[:, 1].min(), (v[:, 2].max() + v[:, 2].min()) / 2]
    # labels: reference colours projected in the Hunyuan frame, rules evaluated in the car frame (same faces)
    tmp = trimesh.Trimesh(v, work.faces, process=False)
    lab, paint, cls = _rules(tmp, project_ids(trimesh.Trimesh(work.vertices, work.faces, process=False), alpha, view),
                             rgb, alpha, view, (spec["length"], v[:, 1].max()), spec)
    lab = smooth_labels(tmp, lab)
    tmp.visual.face_colors = np.stack([lab, lab, lab, np.full_like(lab, 255)], 1).astype(np.uint8)
    body = symmetrize_labelled(tmp, seen_sign)
    blab = body.visual.face_colors[:, 0].astype(int)
    # wheels stay Hunyuan's geometry; faces inside the tyre cylinders become rubber, the inner disc the hubcap
    vs = body.vertices
    low = vs[vs[:, 1] < 0.03 * vs[:, 1].max()]
    zs = np.sort(low[:, 2])
    gap = np.argmax(np.diff(zs))
    axles = [zs[:gap + 1].mean(), zs[gap + 1:].mean()]
    r, w = spec["tyre_r"], spec["tyre_w"]
    halfw = np.abs(vs[:, 0]).max()
    c = body.triangles_center
    for z in axles:
        d = np.hypot(c[:, 1] - r, c[:, 2] - z)
        side = np.abs(c[:, 0]) > halfw - w - 0.06
        blab[side & (d < r * 1.02) & (d >= r * 0.62)] = RUBBER
        blab[side & (d < r * 0.62)] = RIM
    body_tris = len(body.faces)
    wheel_info = dict(axles_z=[float(a) for a in axles], radius=r, width=w, half_width=float(halfw))
    out = []
    mats = materials((paint / 255.0) ** 2.2)
    for li, frac in enumerate(LOD_FRACTIONS):
        target = int(BUDGET * frac)
        prims = []
        for m in range(len(NAMES)):
            sel = np.nonzero(blab == m)[0]
            if len(sel) == 0:
                continue
            sub = body.submesh([sel], append=True)
            share = max(24, int(target * len(sel) / body_tris))
            p = Prim(m, sub.vertices, sub.vertex_normals, None, sub.faces)
            prims.append(simplify(p, share) if p.tris > share else p)
        merged = merge_by_material(prims)
        path = f"{ROOT}/work/models/{cid}_lod{li}.glb"
        size = write_glb(path, [(f"{cid}_lod{li}", merged)], mats, [])
        tris = sum(p.tris for p in merged)
        out.append((li, path, tris, size))
        print(cid, li, tris, size, flush=True)
    ids = [f"model/{cid}/lod{li}" for li, *_ in out]
    counts = {NAMES[m]: int((blab == m).sum()) for m in range(len(NAMES))}
    for li, path, tris, size in out:
        register(f"model/{cid}/lod{li}", path, "model",
                 {"generated": {"model": hy["model"], "model_revision": hy["model_revision"], "prompt": REF_META[cid]["prompt"],
                                "negative": REF_META[cid]["negative"], "seed": hy["seed"], "steps": hy["params"]["num_inference_steps"],
                                "params": {"hunyuan": hy["params"], "hunyuan_code": hy["code_commit"], "reference": REF_META[cid],
                                           "body": "symmetrised, faces classified from the reference", "classify": cls,
                                           "face_labels": counts, "wheels": wheel_info, "length_m": spec["length"]}}},
                 lods=ids, tris=tris, stages=["traffic"], forward="+Z", bounds_m=[vs.min(0).tolist(), vs.max(0).tolist()], paint_rgb=[float(x) for x in paint / 255.0])
    return dict(id=cid, seconds=round(time.time() - t0, 1), classify=cls, labels=counts, lods=[(t, s) for _, _, t, s in out])


def project_ids(ref_mesh, alpha, view):
    """Face id buffer of the Hunyuan-frame mesh seen from the fitted reference view."""
    _, yaw, pitch = view
    ys, xs = np.nonzero(alpha > 127)
    mb = np.array([xs.min(), ys.min(), xs.max(), ys.max()], np.float64)
    p = ref_mesh.vertices @ rot(yaw, pitch).T
    v2, _, _ = to_image(p, mb)
    return raster_ids(v2, p[:, 2], ref_mesh.faces, alpha.shape)


def _rules(mesh, ids, rgb, alpha, view, dims, spec):
    iou, yaw, pitch = view
    inner = cv2.erode((alpha > 127).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    sel = (ids > 0) & inner
    f = ids[sel] - 1
    col = np.zeros((len(mesh.faces), 3)); cnt = np.zeros(len(mesh.faces))
    np.add.at(col, f, rgb[sel].astype(np.float64)); np.add.at(cnt, f, 1)
    seen = cnt >= 1
    col[seen] /= cnt[seen, None]
    hsv = cv2.cvtColor(col[None].astype(np.float32) / 255, cv2.COLOR_RGB2HSV)[0]
    c = mesh.triangles_center
    n = mesh.face_normals
    L, Hh = dims
    zf = c[:, 2] / (L / 2)
    yh = c[:, 1] / Hh
    lab = np.full(len(mesh.faces), PAINT)
    side = seen & (np.abs(n[:, 0]) > 0.6) & (yh > 0.3) & (yh < 0.55) & (np.abs(zf) < 0.6)
    paint = np.median(col[side], 0) if side.sum() > 20 else np.median(col[seen], 0)
    pv = cv2.cvtColor(paint[None, None].astype(np.float32) / 255, cv2.COLOR_RGB2HSV)[0, 0]
    dist = np.linalg.norm((col - paint) / 255, axis=1)
    S, V = hsv[:, 1], hsv[:, 2]
    belt = float(np.percentile(yh[side], 90)) if side.sum() > 20 else 0.55
    upper = yh > belt + 0.06
    # greenhouse by geometry (both sides, front and back), minus pillars the reference shows in paint colour
    glass = upper & (n[:, 1] < 0.9) & ~(seen & (dist < 0.12)) & (zf > spec.get("glass_zf_min", -1.0))
    lab[glass] = GLASS
    # black trim only where cars have it: bumpers, grille, sills
    zone_trim = ((np.abs(zf) > 0.8) & (yh < 0.45)) | (yh < 0.22)
    lab[seen & zone_trim & (V < 0.25) & (S < 0.35) & (dist > 0.25)] = TRIM
    lab[~seen & (np.abs(zf) > 0.9) & (yh < 0.3) & (np.abs(n[:, 2]) > 0.5)] = TRIM
    front_band = (zf > 0.85) & (yh > 0.2) & (yh < 0.55) & (n[:, 2] > 0.3)
    # bright and neutral, and far from the paint colour: on a pale car body only the lamps qualify
    lab[seen & front_band & (V > 0.85) & (S < 0.15) & (dist > 0.3)] = HEAD
    lab[seen & front_band & (hsv[:, 0] > 15) & (hsv[:, 0] < 50) & (S > 0.45) & (V > 0.5)] = HEAD
    t0, t1 = spec.get("tail_yh", (0.3, belt))
    rear_band = (zf < -0.88) & (yh > t0) & (yh < t1) & (n[:, 2] < -0.5)
    lab[rear_band & (~seen | (((hsv[:, 0] < 15) | (hsv[:, 0] > 340)) & (S > 0.45)))] = TAIL
    return lab, paint, dict(iou=float(iou), yaw=float(yaw), pitch=float(pitch), seen=float(seen.mean()), belt=belt)


def symmetrize_labelled(mesh, keep_sign):
    """Keep the half the reference saw, pull its straddling vertices onto x = 0, mirror, weld."""
    c = mesh.triangles_center
    keep = c[:, 0] * keep_sign >= 0
    faces = mesh.faces[keep]
    lab = mesh.visual.face_colors[keep]
    used, inv = np.unique(faces, return_inverse=True)
    v = mesh.vertices[used].copy()
    v[v[:, 0] * keep_sign < 1e-4, 0] = 0
    f = inv.reshape(-1, 3)
    mir = v.copy(); mir[:, 0] *= -1
    out = trimesh.Trimesh(np.vstack([v, mir]), np.vstack([f, f[:, ::-1] + len(v)]), process=False)
    out.visual.face_colors = np.vstack([lab, lab])
    out.merge_vertices(digits_vertex=5)
    return out


def merge_by_material(prims):
    by = {}
    for p in prims:
        by.setdefault(p.material, []).append(p)
    out = []
    for m, ps in sorted(by.items()):
        base, idx = 0, []
        for p in ps:
            idx.append(p.idx + base); base += len(p.pos)
        out.append(Prim(m, np.concatenate([p.pos for p in ps]), np.concatenate([p.nor for p in ps]), None, np.concatenate(idx)))
    return out


REF_META = {}

if __name__ == "__main__":
    refs = json.load(open(f"{ROOT}/work/cut/refs.json"))
    log = []
    for cid in sys.argv[1:]:
        REF_META[cid] = refs[cid]
        r = build(cid)
        print(json.dumps(r), flush=True)
        log.append(r)
    json.dump(log, open(f"{ROOT}/logs/car_{'_'.join(sys.argv[1:])}.json", "w"), indent=1)
