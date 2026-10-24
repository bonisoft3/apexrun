"""Check out/manifest.json and its GLBs against the props2 contract; exits non-zero listing every violation."""
import hashlib, io, json, os, struct, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import gltf_io

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ALLOWED = {"KHR_materials_clearcoat", "KHR_materials_emissive_strength"}
# per model: required material names (emissive ones flagged), required nodes, ground (lowest y, False for none), centring,
# closed (watertight once positions are welded across primitives)
REQ = {
    "tower-a": dict(mats={"window": True, "facade": False}), "tower-b": dict(mats={"window": True, "facade": False}),
    "tower-c": dict(mats={"window": True, "facade": False}),
    "street-lamp": dict(mats={"lamp": True}, centred=False),
    "cypress": dict(), "windmill": dict(nodes=["sails"]),  "broken-arch": dict(),
    "lighthouse": dict(mats={"lamp": True, "glass": False}), "sailboat": dict(ground=False), "castle-tower": dict(),
    "colosseum": dict(max_tris=80000), "hangar": dict(),
}
LAND = dict(closed=True, ground=-2.0, max_tris=8000)
for n in ("mesa-a", "mesa-b"):
    REQ[n] = dict(LAND, mats={k: False for k in ("talus", "rock_red", "rock_orange", "rock_cream", "caprock")})
for n in ("cliff-coast-a", "cliff-coast-b"):
    REQ[n] = dict(LAND, mats={"rock": False, "grass": False})
CARS = ["car-sedan", "car-convertible", "car-pickup", "car-boxtruck"]
CAR_MATS = {"paint": False, "glass": False, "trim": False, "taillight": True, "headlight": True, "rubber": False, "rim": False}
for c in CARS:
    REQ[c] = dict(mats=CAR_MATS, car=True)



def closed_problems(path):
    """Watertight solid: positions welded at 0.1 mm, every edge used once in each direction (so shared by exactly two faces
    with consistent winding), no degenerate faces, positive volume (outward)."""
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
        out.append(f"volume {vol:.1f} not positive (inward winding)")
    return out


m = json.load(open(f"{ROOT}/out/manifest.json"))
bad = []
seen = set()
for lid, r in sorted(m.items()):
    name = lid.split("/")[1]
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
    ext = set(g.get("extensionsUsed", []))
    if ext - ALLOWED or g.get("extensionsRequired"):
        bad.append(f"{lid}: extensions {ext - ALLOWED} required {g.get('extensionsRequired')}")
    for a in g["accessors"]:
        if a["componentType"] not in (5126, 5123, 5125) or a.get("normalized"):
            bad.append(f"{lid}: quantized accessor"); break
    for im in g.get("images", []):
        if im.get("mimeType") not in ("image/png", "image/jpeg"):
            bad.append(f"{lid}: image type {im.get('mimeType')}")
        bv = g["bufferViews"][im["bufferView"]]
        w, h = Image.open(io.BytesIO(binc[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]])).size
        if w > 1024 or h > 1024 or w & (w - 1) or h & (h - 1):
            bad.append(f"{lid}: image {w}x{h} not power-of-two <= 1024")
    mats = {mt["name"]: mt for mt in g["materials"]}
    for mn, emis in req.get("mats", {}).items():
        if mn not in mats:
            bad.append(f"{lid}: material {mn} missing"); continue
        lit = any(c > 0 for c in mats[mn].get("emissiveFactor", [0, 0, 0]))
        if emis and not lit:
            bad.append(f"{lid}: material {mn} must be emissive")
    used = {pr["material"] for me in g["meshes"] for pr in me["primitives"]}
    if used != set(range(len(g["materials"]))):
        bad.append(f"{lid}: declared materials unused {[g['materials'][i]['name'] for i in set(range(len(g['materials']))) - used]}")
    nodes = {n["name"]: n for n in g["nodes"]}
    for nn in req.get("nodes", []):
        if nn not in nodes or "translation" not in nodes[nn]:
            bad.append(f"{lid}: node {nn} missing or not pivoted")
    lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
    for n in g["nodes"]:
        if any(k in n for k in ("rotation", "scale", "matrix", "children")):
            bad.append(f"{lid}: node {n['name']} carries more than a translation")
        t = np.asarray(n.get("translation", [0, 0, 0]))
        for pr in g["meshes"][n["mesh"]]["primitives"]:
            a = g["accessors"][pr["attributes"]["POSITION"]]
            lo = np.minimum(lo, np.asarray(a["min"]) + t); hi = np.maximum(hi, np.asarray(a["max"]) + t)
    base = req.get("ground", 0.0)
    if base is not False and abs(lo[1] - base) > 0.01:
        bad.append(f"{lid}: base not at y={base} ({lo[1]:.3f})")
    if req.get("closed"):
        bad += [f"{lid}: {e}" for e in closed_problems(f"{ROOT}/out/{r['file']}")]
    if req.get("centred", True) and lid.endswith("lod0") and (abs(lo[0] + hi[0]) > 0.02 * (hi[0] - lo[0]) + 0.02 or abs(lo[2] + hi[2]) > 0.02 * (hi[2] - lo[2]) + 0.02):
        bad.append(f"{lid}: footprint not centred x [{lo[0]:.2f}, {hi[0]:.2f}] z [{lo[2]:.2f}, {hi[2]:.2f}]")
    if not np.allclose([lo, hi], r["bounds_m"], atol=2e-3):
        bad.append(f"{lid}: manifest bounds {r['bounds_m']} != {lo.tolist()} {hi.tolist()}")
    tris = sum(g["accessors"][pr["indices"]]["count"] // 3 for me in g["meshes"] for pr in me["primitives"])
    if tris != r["tris"]:
        bad.append(f"{lid}: tris {tris} != manifest {r['tris']}")
    if tris > req.get("max_tris", 60000):
        bad.append(f"{lid}: {tris} tris over budget")
    if req.get("car"):
        if r.get("forward") != "+Z":
            bad.append(f"{lid}: forward")
        if lid.endswith("lod1") and not 9000 <= tris <= 15000:
            bad.append(f"{lid}: LOD1 {tris} tris outside 9-15k")
for name in REQ:
    if name not in seen:
        bad.append(f"{name}: missing from the manifest")
print("\n".join(bad) or f"ok: {len(m)} items")
sys.exit(1 if bad else 0)
