"""Check out/manifest.json and its GLBs against the hero-car contract; exits non-zero listing every violation."""
import json, os, struct, sys
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ALLOWED = {"KHR_materials_clearcoat", "KHR_materials_emissive_strength"}
BUDGET = {"model/car-hero/lod0": (40000, 60000), "model/car-hero/lod1": (11000, 16500)}
WHEELS = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"]
m = json.load(open(f"{ROOT}/out/manifest.json"))
bad = []
if set(m) != set(BUDGET):
    bad.append(f"manifest ids {sorted(m)}")
for lid, r in m.items():
    b = open(f"{ROOT}/out/{r['file']}", "rb").read()
    import hashlib
    if hashlib.sha256(b).hexdigest() != r["sha256"] or r["file"] != r["sha256"] + ".glb" or len(b) != r["bytes"]:
        bad.append(f"{lid}: content address / size mismatch")
    magic, ver, _ = struct.unpack_from("<III", b, 0)
    if magic != 0x46546C67 or ver != 2:
        bad.append(f"{lid}: not glTF 2 binary")
    jl = struct.unpack_from("<I", b, 12)[0]
    g = json.loads(b[20:20 + jl])
    ext = set(g.get("extensionsUsed", []))
    if ext - ALLOWED or g.get("extensionsRequired"):
        bad.append(f"{lid}: extensions {ext - ALLOWED} required {g.get('extensionsRequired')}")
    if g.get("images") or g.get("textures"):
        bad.append(f"{lid}: has textures")
    for a in g["accessors"]:
        if a["componentType"] not in (5126, 5123, 5125) or a.get("normalized"):
            bad.append(f"{lid}: quantized accessor {a}"); break
    mats = {mt["name"]: mt for mt in g["materials"]}
    p = mats.get("paint", {})
    if "KHR_materials_clearcoat" not in p.get("extensions", {}) or not 0.05 <= p["pbrMetallicRoughness"]["metallicFactor"] <= 0.15 \
            or not 0.3 <= p["pbrMetallicRoughness"]["roughnessFactor"] <= 0.4:
        bad.append(f"{lid}: paint material {p}")
    if "KHR_materials_emissive_strength" not in mats.get("taillight", {}).get("extensions", {}):
        bad.append(f"{lid}: taillight lacks emissive strength")
    nodes = {n["name"]: n for n in g["nodes"]}
    wheels = {w["name"]: w for w in r["wheels"]}
    for w in WHEELS:
        if w not in nodes or w not in wheels or not np.allclose(nodes[w].get("translation"), wheels[w]["hub"], atol=1e-4):
            bad.append(f"{lid}: wheel node {w} missing or not pivoted at its hub")
    hz = sorted({round(w["hub"][2], 4) for w in r["wheels"]})
    if abs(hz[0] + hz[-1]) > 1e-3:
        bad.append(f"{lid}: origin not midway between axles {hz}")
    for w in r["wheels"]:
        if abs(w["hub"][1] - w["radius"]) > 1e-3:
            bad.append(f"{lid}: {w['name']} tyre does not touch the ground")
    # world-space bounds (root nodes carry only translations)
    lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
    for n in g["nodes"]:
        t = np.asarray(n.get("translation", [0, 0, 0]))
        for pr in g["meshes"][n["mesh"]]["primitives"]:
            a = g["accessors"][pr["attributes"]["POSITION"]]
            lo = np.minimum(lo, np.asarray(a["min"]) + t); hi = np.maximum(hi, np.asarray(a["max"]) + t)
    if abs(lo[1]) > 0.01:
        bad.append(f"{lid}: base not at y=0 ({lo[1]:.3f})")
    dims = hi - lo
    if not (4.3 < dims[2] < 4.5 and 1.9 < dims[0] < 2.1 and 1.1 < dims[1] < 1.2):
        bad.append(f"{lid}: dims {dims}")
    if abs(lo[0] + hi[0]) > 0.03:
        bad.append(f"{lid}: not centred in x ({lo[0]:.3f}, {hi[0]:.3f})")
    if not np.allclose([lo, hi], r["bounds_m"], atol=2e-3):
        bad.append(f"{lid}: manifest bounds {r['bounds_m']} != {lo.tolist()} {hi.tolist()}")
    tris = sum(g["accessors"][pr["indices"]]["count"] // 3 for me in g["meshes"] for pr in me["primitives"])
    if tris != r["tris"] or not BUDGET[lid][0] <= tris <= BUDGET[lid][1]:
        bad.append(f"{lid}: tris {tris} (manifest {r['tris']}, budget {BUDGET[lid]})")
    if r["forward"] != "+Z" or r["license"] != "CC0" or r["kind"] != "model":
        bad.append(f"{lid}: forward/license/kind")
print("\n".join(bad) or f"ok: {len(m)} items")
sys.exit(1 if bad else 0)
