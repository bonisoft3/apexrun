"""Check out/manifest.json and its GLBs against the contract; exits non-zero listing every violation.

Contract: plain glTF 2 binary, float accessors, no extensions or textures; every LOD closed (watertight once positions are
welded across primitives); base on y = 0 and footprint centred; manifest bounds and triangle counts true; LOD0 within
budget, LOD1 25-30 % and LOD2 6-8 % of it; every primitive carries NORMAL and a VEC3 float COLOR_0 in
[0.4, 1] (VEC4 would make Babylon draw the mesh alpha-blended); the required material names."""
import hashlib, json, os, struct, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import gltf_io

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
import rocks2
# per id: LOD0 budget and materials (LOD0 carries them all; a coarser LOD may lose a small patch material)
REQ = {}
for n, fn in rocks2.MODELS.items():
    mdl = fn()
    REQ[n] = dict(budget=mdl.budget[0], mats={m["name"] for m in mdl.materials})
LOD_SHARE = {1: (0.25, 0.30), 2: (0.06, 0.08)}   # of the LOD0 budget


def closed_problems(path):
    """Watertight: positions welded at 0.1 mm, every directed edge once and its reverse present, no degenerate faces,
    positive volume."""
    _, _, _, prims = gltf_io.load(path)
    P = np.vstack([p.pos for _, p in prims])
    F = np.vstack([p.idx + o for (_, p), o in zip(prims, np.cumsum([0] + [len(p.pos) for _, p in prims])[:-1])])
    _, first, weld = np.unique(np.round(P / 1e-4).astype(np.int64), axis=0, return_index=True, return_inverse=True)
    F = weld.ravel()[F]
    out = []
    if np.any((F[:, 0] == F[:, 1]) | (F[:, 1] == F[:, 2]) | (F[:, 0] == F[:, 2])):
        out.append("degenerate faces after welding")
    E = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    _, cnt = np.unique(E, axis=0, return_counts=True)
    if np.any(cnt != 1):
        out.append(f"{int((cnt > 1).sum())} directed edges repeated (inconsistent winding or non-manifold)")
    d = {tuple(e) for e in E.tolist()}
    open_ = sum((b, a) not in d for a, b in d)
    if open_:
        out.append(f"{open_} boundary edges (open)")
    V = P[first]
    vol = np.einsum("ij,ij->i", V[F[:, 0]], np.cross(V[F[:, 1]], V[F[:, 2]])).sum() / 6
    if vol <= 0:
        out.append(f"volume {vol:.4f} not positive (inward winding)")
    return out


m = json.load(open(f"{ROOT}/out/manifest.json"))
bad, seen = [], set()
for lid, r in sorted(m.items()):
    name, lod = lid.split("/")[1], int(lid.rsplit("lod", 1)[1])
    seen.add(name)
    req = REQ.get(name)
    if req is None:
        bad.append(f"{lid}: unexpected id"); continue
    b = open(f"{ROOT}/out/{r['file']}", "rb").read()
    if hashlib.sha256(b).hexdigest() != r["sha256"] or r["file"] != r["sha256"] + ".glb" or len(b) != r["bytes"]:
        bad.append(f"{lid}: content address / size mismatch")
    magic, ver, _ = struct.unpack_from("<III", b, 0)
    if magic != 0x46546C67 or ver != 2:
        bad.append(f"{lid}: not glTF 2 binary")
    jl = struct.unpack_from("<I", b, 12)[0]
    g = json.loads(b[20:20 + jl])
    binc = b[20 + jl + 8:]
    if g.get("extensionsUsed") or g.get("extensionsRequired") or g.get("images") or g.get("textures"):
        bad.append(f"{lid}: extensions or textures present")
    for a in g["accessors"]:
        if a["componentType"] not in (5126, 5123, 5125) or a.get("normalized"):
            bad.append(f"{lid}: quantized accessor"); break
    names = {mt["name"] for mt in g["materials"]}
    if (names != req["mats"]) if lod == 0 else not names <= req["mats"]:
        bad.append(f"{lid}: materials {sorted(names)} != {sorted(req['mats'])}")
    used = {pr["material"] for me in g["meshes"] for pr in me["primitives"]}
    if used != set(range(len(g["materials"]))):
        bad.append(f"{lid}: declared materials unused")
    for me in g["meshes"]:
        for pr in me["primitives"]:
            at = pr["attributes"]
            if "NORMAL" not in at:
                bad.append(f"{lid}: primitive without NORMAL")
            if "COLOR_0" not in at:
                bad.append(f"{lid}: primitive without COLOR_0"); continue
            a = g["accessors"][at["COLOR_0"]]
            if a["type"] != "VEC3" or a["componentType"] != 5126:
                bad.append(f"{lid}: COLOR_0 is {a['type']} {a['componentType']}, want VEC3 float"); continue
            bv = g["bufferViews"][a["bufferView"]]
            c = np.frombuffer(binc, np.float32, a["count"] * 3, bv.get("byteOffset", 0) + a.get("byteOffset", 0))
            if c.min() < 0.4 or c.max() > 1.0:
                bad.append(f"{lid}: COLOR_0 range [{c.min():.3f}, {c.max():.3f}] outside [0.4, 1]")
    lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
    for n in g["nodes"]:
        if any(k in n for k in ("rotation", "scale", "matrix", "children", "translation")):
            bad.append(f"{lid}: node {n['name']} carries a transform")
        for pr in g["meshes"][n["mesh"]]["primitives"]:
            a = g["accessors"][pr["attributes"]["POSITION"]]
            lo, hi = np.minimum(lo, a["min"]), np.maximum(hi, a["max"])
    if abs(lo[1]) > 1e-4:
        bad.append(f"{lid}: base not at y=0 ({lo[1]:.4f})")
    bad += [f"{lid}: {e}" for e in closed_problems(f"{ROOT}/out/{r['file']}")]
    if lod == 0 and (abs(lo[0] + hi[0]) > 0.02 * (hi[0] - lo[0]) + 0.002 or abs(lo[2] + hi[2]) > 0.02 * (hi[2] - lo[2]) + 0.002):
        bad.append(f"{lid}: footprint not centred x [{lo[0]:.3f}, {hi[0]:.3f}] z [{lo[2]:.3f}, {hi[2]:.3f}]")
    if not np.allclose([lo, hi], r["bounds_m"], atol=2e-3):
        bad.append(f"{lid}: manifest bounds {r['bounds_m']} != {lo.tolist()} {hi.tolist()}")
    tris = sum(g["accessors"][pr["indices"]]["count"] // 3 for me in g["meshes"] for pr in me["primitives"])
    if tris != r["tris"]:
        bad.append(f"{lid}: tris {tris} != manifest {r['tris']}")
    cap = req["budget"] if lod == 0 else LOD_SHARE[lod][1] * req["budget"] * 1.0001
    if tris > cap or (lod and tris < LOD_SHARE[lod][0] * req["budget"]):
        bad.append(f"{lid}: {tris} tris outside the LOD{lod} budget")
for name in REQ:
    if name not in seen:
        bad.append(f"{name}: missing from the manifest")
print("\n".join(bad) or f"ok: {len(m)} items")
sys.exit(1 if bad else 0)
