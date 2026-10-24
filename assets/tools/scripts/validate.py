"""Check every shipped file against the pack contract; exits non-zero on the first class of violation found."""
import io, json, os, struct, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from items import ROOT

ALLOWED = {"EXT_texture_webp", "KHR_materials_clearcoat", "KHR_materials_emissive_strength"}
m = json.load(open(f"{ROOT}/out/manifest.json"))
bad = []
for lid, r in m.items():
    b = open(f"{ROOT}/out/{r['file']}", "rb").read()
    if r["kind"] == "texture":
        im = Image.open(io.BytesIO(b))
        w, h = im.size
        if w != h or w & (w - 1) or w > 2048:
            bad.append(f"{lid}: texture {im.size}")
    if r["kind"] != "model":
        continue
    jl = struct.unpack_from("<I", b, 12)[0]
    g = json.loads(b[20:20 + jl]); body = b[20 + jl + 8:]
    ext = set(g.get("extensionsUsed", []))
    if ext - ALLOWED:
        bad.append(f"{lid}: extensions {ext - ALLOWED}")
    for im in g.get("images", []):
        bv = g["bufferViews"][im["bufferView"]]
        w, h = Image.open(io.BytesIO(body[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]])).size
        if w & (w - 1) or h & (h - 1) or max(w, h) > 2048:
            bad.append(f"{lid}: image {w}x{h}")
    mins = np.array([g["accessors"][p["attributes"]["POSITION"]]["min"] for me in g["meshes"] for p in me["primitives"]]).min(0)
    maxs = np.array([g["accessors"][p["attributes"]["POSITION"]]["max"] for me in g["meshes"] for p in me["primitives"]]).max(0)
    if abs(mins[1]) > 0.05:
        bad.append(f"{lid}: base not at y=0 (min y {mins[1]:.3f})")
    cx, cz = (mins[0] + maxs[0]) / 2, (mins[2] + maxs[2]) / 2
    ext_xz = max(maxs[0] - mins[0], maxs[2] - mins[2])
    if lid.endswith("/lod0") and r.get("build", {}).get("origin", "bbox") == "bbox" and max(abs(cx), abs(cz)) > 0.02 * ext_xz + 0.01:
        bad.append(f"{lid}: footprint not centred ({cx:.3f}, {cz:.3f})")
    tris = sum(g["accessors"][p["indices"]]["count"] // 3 for me in g["meshes"] for p in me["primitives"])
    if tris != r["tris"]:
        bad.append(f"{lid}: manifest tris {r['tris']} != {tris}")
print("\n".join(bad) or f"ok: {len(m)} items")
sys.exit(1 if bad else 0)
