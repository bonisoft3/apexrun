"""Check out/manifest.json and its GLBs against the cartoon-plants contract; exits non-zero listing every violation."""
import hashlib, json, os, struct, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import gltf_io
from picks import IDS

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TREE = dict(max_tris=4000)
SMALL = dict(max_tris=1500)
# per id: required materials (double-sided ones True), whether every shell is closed, LOD0 footprint centred, budget
REQ = {
    # trees and palms stand on their trunk foot at the origin
    **{n: dict(TREE, mats={"foliage": False, "bark": False}, closed=True, centred=False) for n in ("tree-fir-a", "tree-fir-b", "tree-pine-young", "tree-broadleaf-a", "tree-broadleaf-b")},
    "shrub-b": dict(SMALL, mats={"foliage": False}, closed=True, centred=True),
    "shrub-desert": dict(SMALL, mats={"foliage": False}, closed=True, centred=True),
    "shrub-tropical": dict(SMALL, mats={"foliage": False}, closed=False, centred=True),
    "fern": dict(SMALL, mats={"frond": True}, closed=False, centred=True),
    "grass-tuft": dict(max_tris=300, mats={"grass": True}, closed=False, centred=True),
    "grass-beach": dict(max_tris=300, mats={"grass": True}, closed=False, centred=True),
    **{n: dict(TREE, mats={"bark": False, "frond": True}, closed=False, centred=False) for n in ("palm-a", "palm-b", "palm-c")},
}
DOUBLE = {"leaf", "frond", "frond_dry", "grass"}
GAME = json.load(open("/Users/davi/code/trash/.worktrees/apex-outrun/apps/apexrun/assets/manifest.json"))


def closed_problems(path, mats):
    """Every primitive of the named materials is a watertight, consistently wound, outward solid (welded at 0.1 mm)."""
    g, _, _, prims = gltf_io.load(path)
    out = []
    for _, p in prims:
        if g["materials"][p.material]["name"] not in mats:
            continue
        _, weld = np.unique(np.round(p.pos / 1e-4).astype(np.int64), axis=0, return_inverse=True)
        F = weld.ravel()[p.idx]
        E = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
        _, cnt = np.unique(E, axis=0, return_counts=True)
        if np.any(cnt != 1):
            out.append(f"{g['materials'][p.material]['name']}: {int((cnt > 1).sum())} directed edges repeated")
        d = {tuple(e) for e in E.tolist()}
        if any((b, a) not in d for a, b in d):
            out.append(f"{g['materials'][p.material]['name']}: open")
        vol = np.einsum("ij,ij->i", p.pos[p.idx[:, 0]], np.cross(p.pos[p.idx[:, 1]], p.pos[p.idx[:, 2]])).sum() / 6
        if vol <= 0:
            out.append(f"{g['materials'][p.material]['name']}: volume {vol:.3f} not positive")
    return out


m = json.load(open(f"{ROOT}/out/manifest.json"))
bad = []
for lid, r in sorted(m.items()):
    name = lid.split("/")[1]
    req = REQ.get(name)
    if req is None:
        bad.append(f"{lid}: unexpected id"); continue
    b = open(f"{ROOT}/out/{r['file']}", "rb").read()
    if hashlib.sha256(b).hexdigest() != r["sha256"] or r["file"] != r["sha256"] + ".glb" or len(b) != r["bytes"]:
        bad.append(f"{lid}: content address / size mismatch")
    jl = struct.unpack_from("<I", b, 12)[0]
    g = json.loads(b[20:20 + jl])
    if g.get("extensionsUsed") or g.get("images") or g.get("textures"):
        bad.append(f"{lid}: extensions or textures present")
    mats = {mt["name"]: mt for mt in g["materials"]}
    for mn, double in req["mats"].items():
        if mn not in mats:
            bad.append(f"{lid}: material {mn} missing"); continue
        if bool(mats[mn].get("doubleSided")) != double:
            bad.append(f"{lid}: material {mn} doubleSided should be {double}")
    for mt in g["materials"]:
        if bool(mt.get("doubleSided")) != (mt["name"] in DOUBLE):
            bad.append(f"{lid}: material {mt['name']} doubleSided {mt.get('doubleSided')}")
        if mt.get("alphaMode", "OPAQUE") != "OPAQUE":
            bad.append(f"{lid}: material {mt['name']} not opaque")
    for me in g["meshes"]:
        for pr in me["primitives"]:
            a = pr["attributes"]
            if "COLOR_0" not in a or g["accessors"][a["COLOR_0"]]["type"] != "VEC3" or "NORMAL" not in a:
                bad.append(f"{lid}: primitive without NORMAL / VEC3 COLOR_0")
    _, _, bins, _ = gltf_io.load(f"{ROOT}/out/{r['file']}")
    if len(g["nodes"]) != 1 or any(k in g["nodes"][0] for k in ("translation", "rotation", "scale", "matrix", "children")):
        bad.append(f"{lid}: expected one untransformed node")
    lo = np.min([g["accessors"][pr["attributes"]["POSITION"]]["min"] for me in g["meshes"] for pr in me["primitives"]], 0)
    hi = np.max([g["accessors"][pr["attributes"]["POSITION"]]["max"] for me in g["meshes"] for pr in me["primitives"]], 0)
    if abs(lo[1]) > 0.01:
        bad.append(f"{lid}: base not at y=0 ({lo[1]:.3f})")
    if req["closed"]:
        bad += [f"{lid}: {e}" for e in closed_problems(f"{ROOT}/out/{r['file']}", {"foliage", "bark"})]
    if req["centred"] and lid.endswith("lod0") and (abs(lo[0] + hi[0]) > 0.02 * (hi[0] - lo[0]) + 0.02 or abs(lo[2] + hi[2]) > 0.02 * (hi[2] - lo[2]) + 0.02):
        bad.append(f"{lid}: footprint not centred x [{lo[0]:.2f}, {hi[0]:.2f}] z [{lo[2]:.2f}, {hi[2]:.2f}]")
    if not np.allclose([lo, hi], r["bounds_m"], atol=2e-3):
        bad.append(f"{lid}: manifest bounds {r['bounds_m']} != {lo.tolist()} {hi.tolist()}")
    tris = sum(g["accessors"][pr["indices"]]["count"] // 3 for me in g["meshes"] for pr in me["primitives"])
    if tris != r["tris"]:
        bad.append(f"{lid}: tris {tris} != manifest {r['tris']}")
    if tris > req["max_tris"]:
        bad.append(f"{lid}: {tris} tris over budget {req['max_tris']}")
    old_h = GAME[lid]["bounds_m"][1][1]
    if lid.endswith("lod0") and abs(hi[1] - old_h) > 0.12 * old_h:
        bad.append(f"{lid}: height {hi[1]:.2f} m vs the shipped {old_h:.2f} m")
for name in IDS:
    for l in range(3):
        if f"model/{name}/lod{l}" not in m:
            bad.append(f"model/{name}/lod{l}: missing from the manifest")
print("\n".join(bad) or f"ok: {len(m)} items")
sys.exit(1 if bad else 0)
