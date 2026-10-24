"""Build the flagman rig -> work/flagman_lod0.glb + work/flagman.json.

usage: build.py
Body and right arm are SDF solids (figure.py): marching cubes -> QEM to their budget -> projected back onto the field ->
cut into materials along nearest-component level sets, then paint bands; normals are the field gradient; per-vertex AO
(the part's own field on the ground, the arm at rest so its own fist and elbow read, the body without the arm since the
arm moves) in COLOR_0 (VEC3). The flag is explicit: a lathed pole and a chequered cloth grid.
Node tree: flagman (body) > arm_R (origin at the right shoulder joint, arm hanging along -Y) > flag (origin at the grip)."""
import json, os, struct, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import toon, figure
from gltf_io import Prim, write_glb
from mats import pbr, srgb

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
H = 0.006                      # marching-cubes spacing (m)
BUDGET = {"body": 6000, "arm": 2100}
MAX_TRIS = 12000
AO = dict(radius=0.26, lo=0.58)
MATERIALS = [pbr("suit", srgb("#efe6cf"), rough=0.7), pbr("stripe", srgb("#d9412a"), rough=0.6),
             pbr("skin", srgb("#eaa57a"), rough=0.65), pbr("hair", srgb("#5a3822"), rough=0.85),
             pbr("shades", srgb("#15151b"), rough=0.25), pbr("cap", srgb("#1f2c52"), rough=0.6),
             pbr("glove", srgb("#2c2c33"), rough=0.55), pbr("boot", srgb("#1d1917"), rough=0.45),
             pbr("pole", srgb("#8e5a2e"), rough=0.7), pbr("flag", [1, 1, 1], rough=0.8, double=True)]
MAT = {m["name"]: i for i, m in enumerate(MATERIALS)}


def solid(part, offset, target, ground):
    """-> (V, F, labels, hard, field) in the frame where the part sits at `offset` (arm: its rest pose in the body frame)."""
    f0 = part["f"]
    f = (lambda P: f0(P - offset))
    fc = toon.ground_cut(f) if ground else f
    lo, hi = np.asarray(part["box"][0]) + offset, np.asarray(part["box"][1]) + offset
    V, F = toon.extract(fc, lo, hi, H)
    V0, F0 = toon.decimate(V, F, int(0.55 * target), planar=False)
    r = 0.02
    while True:   # curvature-led density from QEM, long edges split so thin paint bands and AO have vertices
        V, F = toon.refine(V0, F0, r)
        if len(F) <= target:
            break
        r *= 1.1
    V = toon.project(fc, V, H * 0.25, reach=H)
    if ground:
        V[V[:, 1] < 0.3 * H, 1] = 0.0
    labels = np.array([part["base"]] * len(F), dtype=object)
    mats = {m: (lambda g: (lambda P: g(P - offset)))(g) for m, g in part["mats"].items()}
    every = set(mats)
    for m in mats:
        if m == part["base"]:
            continue
        others = [g for k, g in mats.items() if k != m]
        g = (lambda gm, gs: (lambda P: np.min([x(P) for x in gs], 0) - gm(P)))(mats[m], others)
        V, F, labels = toon.split(V, F, labels, g, None, m, f=fc, eps=H * 0.25, only=every)
    # the cuts follow the level sets; each piece then takes its nearest material at its centroid (a cut face whose
    # vertices all sit within the snap band would otherwise keep a stale label)
    names = list(mats)
    C = V[F].mean(1)
    labels = np.array(names, dtype=object)[np.argmin([mats[k](C) for k in names], 0)]
    for cuts, m, onto in part["paint"]:   # cut along each edge of the region, then label pieces by centroid
        cuts = [(lambda c: (lambda P: c(P - offset)))(c) for c in cuts]
        for i, c in enumerate(cuts):   # each edge only where the other edges let it bound the region (within 2 cm)
            rest = cuts[:i] + cuts[i + 1:]
            ci = (lambda c, rest: (lambda P: np.maximum(c(P), -np.min([x(P) for x in rest], 0) - 0.02)))(c, rest)
            V, F, labels = toon.split(V, F, labels, ci, None, None, f=fc, eps=H * 0.25, only={"-"})
        C = V[F].mean(1)
        inside = np.min([c(C) for c in cuts], 0) > 0
        labels = np.where(inside & np.isin(labels, list(onto)), m, labels).astype(object)
    if ground:
        V[V[:, 1] < 0.3 * H, 1] = 0.0
    V, F = toon.weld(V, F, 2e-4)
    keep = (F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])
    F, labels = F[keep], labels[keep]
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-20)
    hard = (fn[:, 1] < -0.98) & (V[F].max(1)[:, 1] <= 1e-9) if ground else np.zeros(len(F), bool)
    return V, F, labels, hard, fc


def baked(V, F, labels, hard, fc):
    normal_fn = lambda P: toon.grad(fc, P, H * 0.25)
    N = normal_fn(V)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-20)
    ao = toon.bake_ao(fc, V, N, AO["radius"], 1.5 * H, lo=AO["lo"])
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-20)
    folded = int(((fn[:, None, :] * N[F]).sum(2).min(1) < 0)[~hard].sum())
    col = np.repeat(ao[:, None], 3, 1)
    return toon.prims(V, F, labels, normal_fn, col, MAT, hard=hard), ao, folded


def flag_prims():
    V, F, N = figure.pole()
    p = Prim(MAT["pole"], V, N, None, F)
    Vc, Fc, C, UV = figure.cloth()
    c = Prim(MAT["flag"], Vc, np.tile([0.0, 0.0, 1.0], (len(Vc), 1)), UV, Fc)
    c.color = C
    return [p, c], len(F), len(Fc)


def write_rig(path, body, arm, flag):
    """GLB with the node tree flagman > arm_R > flag; materials compacted to those used."""
    allp = body + arm + flag
    used = sorted({p.material for p in allp})
    remap = {o: n for n, o in enumerate(used)}
    for p in allp:
        p.material = remap[p.material]
    write_glb(path, [("flagman", body), ("arm_R", arm, figure.SHOULDER), ("flag", flag, figure.GRIP)],
              [MATERIALS[i] for i in used], [], generator="apex-outrun-flagman")
    b = open(path, "rb").read()
    jl = struct.unpack_from("<I", b, 12)[0]
    g = json.loads(b[20:20 + jl])
    binc = b[20 + jl:]
    g["scenes"] = [{"nodes": [0]}]
    g["nodes"][0]["children"] = [1]
    g["nodes"][1]["children"] = [2]
    js = json.dumps(g, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + len(binc)) + struct.pack("<II", len(js), 0x4E4F534A) + js + binc
    open(path, "wb").write(out)
    return len(out), [MATERIALS[i]["name"] for i in used]


def main():
    os.makedirs(f"{ROOT}/work", exist_ok=True)
    Vb, Fb, Lb, Hb, fb = solid(figure.body(), np.zeros(3), BUDGET["body"], True)
    Va, Fa, La, Ha, fa = solid(figure.arm(), figure.SHOULDER, BUDGET["arm"], False)
    pb, aob, fold_b = baked(Vb, Fb, Lb, Hb, fb)
    pa, aoa, fold_a = baked(Va, Fa, La, Ha, fa)
    for p in pa:                       # into arm_R space
        p.pos = p.pos - figure.SHOULDER
    pf, tp, tc = flag_prims()
    tris = {"body": len(Fb), "arm_R": len(Fa), "pole": tp, "cloth": tc}
    total = sum(tris.values())
    if total > MAX_TRIS:
        raise ValueError(f"{total} tris > {MAX_TRIS}")
    path = f"{ROOT}/work/flagman_lod0.glb"
    size, used = write_rig(path, pb, pa, pf)
    # rest-pose bounds of everything, in the root frame
    pts = [Vb, Va] + [p.pos + figure.SHOULDER + figure.GRIP for p in pf]
    allv = np.vstack(pts)
    bounds = [allv.min(0).tolist(), allv.max(0).tolist()]
    rec = dict(path=os.path.relpath(path, ROOT), tris=total, tris_by_node=tris, bytes=size, bounds_m=bounds, materials=used,
               nodes=["flagman", "arm_R", "flag"], ao_body=[round(float(aob.min()), 3), round(float(aob.max()), 3)],
               ao_arm=[round(float(aoa.min()), 3), round(float(aoa.max()), 3)], folded=fold_b + fold_a,
               height_m=float(Vb[:, 1].max()), shoulder=figure.SHOULDER.tolist(), grip=figure.GRIP.tolist())
    json.dump(rec, open(f"{ROOT}/work/flagman.json", "w"), indent=1)
    print(json.dumps(rec))


if __name__ == "__main__":
    main()
