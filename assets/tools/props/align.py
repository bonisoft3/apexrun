"""Raw Hunyuan mesh -> car frame (Y up, +Z forward, metres, ground at y=0, centred), mirror-symmetrised.

usage: align.py <name> <rgba ref> <front|rear> <left|right> <length> <width> <height>   (end and side of the car the reference shows)    reads work/hy/<name>.glb, writes work/align/<name>.ply + .json
Hunyuan3D-2 keeps the input camera near its +Z, so the fitted view (yaw within +-75 deg) tells which end the image saw:
the front for a front reference, the rear for a rear one. Which side the image shows is given by hand: the silhouette
IoU ties between the camera and its left/right mirror (rear2: 0.783 at yaw -30/pitch -5 vs 0.773 at +30/+5), and a render
from the fitted camera came out mirrored against the reference. The mirror plane is refined (offset and yaw) by minimising the mesh-to-mirror distance before the unseen half is replaced.
"""
import json, os, sys, time
import cv2
import numpy as np
import trimesh
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.dirname(__file__))
from car import reduce, fit_view, rot
from meshkit import split_plane

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WORK_FACES = 400000


def mirror_fit(v):
    """Best (yaw, x0) of the plane x' = x0 after yawing: minimise the mean distance from points to their mirror image."""
    rng = np.random.default_rng(0)
    pts = v[rng.choice(len(v), min(40000, len(v)), replace=False)]
    best = None
    for yaw in np.arange(-3, 3.01, 0.5):
        a = np.radians(yaw)
        R = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
        p = pts @ R.T
        tree = cKDTree(p)
        for x0 in np.linspace(-0.03, 0.03, 13) * (p[:, 0].max() - p[:, 0].min()) + (p[:, 0].max() + p[:, 0].min()) / 2:
            m = p.copy(); m[:, 0] = 2 * x0 - m[:, 0]
            d = tree.query(m)[0].mean()
            if best is None or d < best[0]:
                best = (d, yaw, x0, R)
    return best


def symmetrize(mesh, keep_sign):
    """Keep the half with x * keep_sign >= 0, snap the seam to x = 0, mirror, weld."""
    V, F, side, _ = split_plane(mesh.vertices, mesh.faces, [keep_sign, 0, 0], 0.0, eps=1e-6)
    used, inv = np.unique(F[side > 0], return_inverse=True)
    v = V[used]
    v[np.abs(v[:, 0]) < 1e-9, 0] = 0
    f = inv.reshape(-1, 3)
    mir = v.copy(); mir[:, 0] *= -1
    out = trimesh.Trimesh(np.vstack([v, mir]), np.vstack([f, f[:, ::-1] + len(v)]), process=False)
    out.merge_vertices(digits_vertex=5)
    out.remove_unreferenced_vertices()
    return out


def main(name, ref, end, side, length, width, height):
    TARGET = dict(length=float(length), width=float(width), height=float(height))
    t0 = time.time()
    raw = trimesh.load(f"{ROOT}/work/hy/{name}.glb", force="mesh")
    work = reduce(raw, WORK_FACES) if len(raw.faces) > WORK_FACES else raw
    rgba = cv2.cvtColor(cv2.imread(ref, cv2.IMREAD_UNCHANGED), cv2.COLOR_BGRA2RGBA)
    view = fit_view(work, rgba[..., 3])
    cam = rot(view[1], view[2]).T @ np.array([0, 0, 1.0])
    xz = work.vertices[:, [0, 2]] - work.vertices[:, [0, 2]].mean(0)
    _, vecs = np.linalg.eigh(np.cov(xz.T))
    ax = np.array([vecs[0, 1], 0, vecs[1, 1]])
    if (ax @ cam < 0) == (end == "front"):
        ax = -ax
    up = np.array([0, 1.0, 0])
    M = np.stack([np.cross(up, ax), up, ax])  # +X = car's left, +Y up, +Z forward, det +1
    seen = 1 if side == "left" else -1  # +X is the car's left
    v = (work.vertices - work.vertices.mean(0)) @ M.T
    sym_err, yaw, x0, R = mirror_fit(v)
    v = v @ R.T
    v[:, 0] -= x0
    body = symmetrize(trimesh.Trimesh(v, work.faces, process=False), seen)
    v = body.vertices
    v -= [0, v[:, 1].min(), (v[:, 2].max() + v[:, 2].min()) / 2]
    L, Hh = v[:, 2].ptp(), v[:, 1].ptp()
    W = 2 * np.abs(v[v[:, 1] < 0.55 * Hh, 0]).max()  # body width below the mirrors
    s = np.array([TARGET["width"] / W, TARGET["height"] / Hh, TARGET["length"] / L])
    body.vertices = v * s
    os.makedirs(f"{ROOT}/work/align", exist_ok=True)
    body.export(f"{ROOT}/work/align/{name}.ply")
    rec = dict(name=name, ref=os.path.relpath(ref, ROOT), end=end, iou=float(view[0]), yaw=float(view[1]), pitch=float(view[2]),
               seen_side=side, fitted_cam_x_in_car=float(M[0] @ cam), mirror_yaw_deg=float(yaw), mirror_rms_m_raw=float(sym_err), raw_dims=[float(W), float(Hh), float(L)],
               aspect_raw=dict(w_over_l=float(W / L), h_over_l=float(Hh / L)), scale=s.tolist(), faces=len(body.faces),
               target=TARGET, watertight=bool(body.is_watertight), seconds=round(time.time() - t0, 1))
    json.dump(rec, open(f"{ROOT}/work/align/{name}.json", "w"), indent=1)
    print(json.dumps(rec), flush=True)


if __name__ == "__main__":
    main(*sys.argv[1:8])
