"""Check out/manifest.json and its GLBs as drop-in replacements for the shipped car entries; exits non-zero listing every
violation. Rules: props2 validate.py's car rules (content address, glTF 2 binary, allowed extensions, no images, emissive
lamps, translation-only nodes, ground at y = 0, forward +Z) plus: same ids, material names in the same order, node names,
wheel hub translations equal to the shipped manifest, bounds within 3 cm of the shipped ones, the budgets below, COLOR_0
(VEC3 float, 0.6..1.0) on every body primitive and none on the wheels.
usage: validate.py <shipped manifest.json>"""
import hashlib, json, os, struct, sys
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ALLOWED = {"KHR_materials_clearcoat", "KHR_materials_emissive_strength"}
BUDGET = {"car-hero": (60000, 15000)}
TRAFFIC = (30000, 9000)
NODES = ["body", "wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"]
EMISSIVE = {"taillight", "headlight", "indicator"}

shipped = json.load(open(sys.argv[1]))
m = json.load(open(f"{ROOT}/out/manifest.json"))
want = sorted(k for k in shipped if k.startswith("model/car-"))
bad = []
if sorted(m) != want:
    bad.append(f"ids {sorted(m)} != shipped {want}")
for lid, r in sorted(m.items()):
    s = shipped[lid]
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
    if g.get("images") or g.get("textures"):
        bad.append(f"{lid}: carries textures")
    for a in g["accessors"]:
        if a["componentType"] not in (5126, 5123, 5125) or a.get("normalized"):
            bad.append(f"{lid}: quantized accessor"); break
    names = [mt["name"] for mt in g["materials"]]
    if names != s["materials"] or names != r["materials"]:
        bad.append(f"{lid}: materials {names} != shipped {s['materials']}")
    for mt in g["materials"]:
        lit = any(c > 0 for c in mt.get("emissiveFactor", [0, 0, 0]))
        if (mt["name"] in EMISSIVE) != lit:
            bad.append(f"{lid}: material {mt['name']} emissive={lit}")
    for k in ("forward", "wheels", "paint_rgb", "nodes", "emissive", "lods", "note", "license", "kind"):
        if s.get(k) != r.get(k):
            bad.append(f"{lid}: field {k} changed")
    nodes = {n["name"]: n for n in g["nodes"]}
    if [n["name"] for n in g["nodes"]] != NODES:
        bad.append(f"{lid}: nodes {[n['name'] for n in g['nodes']]}")
    for w in s["wheels"]:
        t = nodes.get(w["name"], {}).get("translation")
        if t is None or not np.allclose(t, w["hub"], atol=1e-4):
            bad.append(f"{lid}: {w['name']} pivot {t} != hub {w['hub']}")
    lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
    for n in g["nodes"]:
        if any(k in n for k in ("rotation", "scale", "matrix", "children")):
            bad.append(f"{lid}: node {n['name']} carries more than a translation")
        t = np.asarray(n.get("translation", [0, 0, 0]))
        for pr in g["meshes"][n["mesh"]]["primitives"]:
            a = g["accessors"][pr["attributes"]["POSITION"]]
            lo = np.minimum(lo, np.asarray(a["min"]) + t); hi = np.maximum(hi, np.asarray(a["max"]) + t)
            col = pr["attributes"].get("COLOR_0")
            if n["name"] == "body":
                if col is None:
                    bad.append(f"{lid}: body primitive {names[pr['material']]} without COLOR_0"); continue
                ca = g["accessors"][col]
                bv = g["bufferViews"][ca["bufferView"]]
                if ca["type"] != "VEC3" or ca["componentType"] != 5126:
                    bad.append(f"{lid}: COLOR_0 not float VEC3")
                c = np.frombuffer(binc[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]], np.float32)
                if c.min() < 0.6 - 1e-6 or c.max() > 1 + 1e-6:
                    bad.append(f"{lid}: COLOR_0 range {c.min():.3f}..{c.max():.3f}")
            elif col is not None:
                bad.append(f"{lid}: wheel {n['name']} carries COLOR_0")
    if abs(lo[1]) > 0.005:
        bad.append(f"{lid}: base not at y=0 ({lo[1]:.3f})")
    if not np.allclose([lo, hi], r["bounds_m"], atol=2e-3):
        bad.append(f"{lid}: manifest bounds {r['bounds_m']} != {lo.tolist()} {hi.tolist()}")
    dev = np.abs(np.asarray([lo, hi]) - np.asarray(s["bounds_m"])).max()
    if dev > 0.03:
        bad.append(f"{lid}: bounds {dev * 100:.1f} cm off the shipped ones")
    tris = sum(g["accessors"][pr["indices"]]["count"] // 3 for me in g["meshes"] for pr in me["primitives"])
    if tris != r["tris"]:
        bad.append(f"{lid}: tris {tris} != manifest {r['tris']}")
    car = lid.split("/")[1]
    cap = BUDGET.get(car, TRAFFIC)[int(lid.endswith("lod1"))]
    if tris > cap:
        bad.append(f"{lid}: {tris} tris over the {cap} budget")
    if car != "car-hero":
        used = {pr["material"] for me in g["meshes"] for pr in me["primitives"]}
        if used != set(range(len(names))):
            bad.append(f"{lid}: declared materials unused {[names[i] for i in set(range(len(names))) - used]}")
    print(f"{lid}: {tris} tris, bounds dev {dev * 100:.1f} cm")
print("\n".join(bad) or f"ok: {len(m)} items")
sys.exit(1 if bad else 0)
