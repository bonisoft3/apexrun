"""Poly Haven models -> game-ready GLBs: LOD0/1/2 (100/25/6 % of the LOD0 budget), Y-up metres, origin at the base centre.

Solid parts are simplified by gltfpack (-noq, plain output). Foliage is rebaked into a billboard cloud: leaves are
grouped into planar cards and their look (albedo, alpha, normal, AO/rough) is rasterised into an atlas per LOD.
usage: build_models.py [model id ...]
"""
import glob, io, json, os, sys, time
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from selection import MODELS
from gltf_io import Prim, load, image_bytes, write_glb
from lod import simplify, bake_cards, encode, components
from items import ROOT, register, polyhaven_source

LOD_FRACTIONS = (1.0, 0.25, 0.06)
FOLIAGE_WORDS = ("leaf", "leaves", "twig", "grass", "fern", "shrub", "needle")


def is_foliage(mat):
    name = mat.get("name", "").lower()
    if "bark" in name or "trunk" in name or "branch" in name:
        return False
    return mat.get("alphaMode", "OPAQUE") != "OPAQUE" or any(w in name for w in FOLIAGE_WORDS)


def yaw_matrix(deg):
    r = np.radians(deg); c, s = np.cos(r), np.sin(r)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def select(g, prims, spec):
    roots = {n.get("name"): n for n in g["nodes"]}
    if spec["compose"]:
        out = []
        for name, off, yaw in spec["compose"]:
            if name not in roots:
                raise KeyError(f"{spec['ph']}: no node {name}")
            t = np.array(roots[name].get("translation", [0, 0, 0]))
            R = yaw_matrix(yaw)
            found = False
            for root, p in prims:
                if root == name:
                    found = True
                    out.append(Prim(p.material, (p.pos - t) @ R.T + off, None if p.nor is None else p.nor @ R.T, p.uv, p.idx, root))
            if not found:
                raise KeyError(f"{spec['ph']}: node {name} has no mesh")
        return out
    keep = [p for root, p in prims if spec["nodes"] is None or root in spec["nodes"]]
    if spec["nodes"]:
        missing = set(spec["nodes"]) - {root for root, _ in prims}
        if missing:
            raise KeyError(f"{spec['ph']}: missing nodes {missing}")
    return keep


def recentre(prims, mode):
    allp = np.concatenate([p.pos for p in prims])
    y0 = allp[:, 1].min()
    if mode == "base":
        h = allp[:, 1].max() - y0
        foot = allp[allp[:, 1] < y0 + max(0.03 * h, 0.05)]
        cx, cz = foot[:, 0].mean(), foot[:, 2].mean()
    else:
        lo, hi = allp.min(0), allp.max(0)
        cx, cz = (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2
    off = np.array([cx, y0, cz])
    for p in prims:
        p.pos = p.pos - off
    return off


def srgb_to_linear(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def material_images(g, d, bins, mi):
    m = g["materials"][mi]
    pbr = m.get("pbrMetallicRoughness", {})
    def img(slot):
        t = slot.get("index") if slot else None
        return None if t is None else Image.open(io.BytesIO(image_bytes(g, d, bins, t)))
    alpha = None
    if is_foliage(m):  # Poly Haven glTFs omit the opacity map; fetch_polyhaven.py stores it beside the textures
        ph = os.path.basename(d)
        cands = sorted(glob.glob(f"{d}/textures/*alpha_2k.jpg"))
        name = m.get("name", "").lower()
        pref = [c for c in cands if ("twig" in name and "twig_alpha" in c) or ("lea" in name and "leaves_alpha" in c)]
        pick = pref or [c for c in cands if os.path.basename(c) == f"{ph}_alpha_2k.jpg"]
        if cands and not pick:
            raise RuntimeError(f"{name}: no opacity map among {cands}")
        alpha = Image.open(pick[0]).convert("L") if pick else None
    return dict(alpha=alpha, albedo=img(pbr.get("baseColorTexture")), normal=img(m.get("normalTexture")),
                arm=img(pbr.get("metallicRoughnessTexture")) or img(m.get("occlusionTexture")),
                factor=pbr.get("baseColorFactor", [1, 1, 1, 1]), rough=pbr.get("roughnessFactor", 1.0),
                metal=pbr.get("metallicFactor", 1.0), name=m.get("name", f"mat{mi}"))


def cull(p, target, min_tris=10):
    """Keep only the largest disconnected pieces when there are more than the budget can simplify (twig clouds)."""
    lab = components(p.idx, len(p.pos))
    n = lab.max() + 1
    if n * min_tris <= target:
        return p
    tri_area = np.linalg.norm(np.cross(p.pos[p.idx[:, 1]] - p.pos[p.idx[:, 0]], p.pos[p.idx[:, 2]] - p.pos[p.idx[:, 0]]), axis=1)
    keep = np.argsort(-np.bincount(lab, tri_area, n))[: max(1, target // min_tris)]
    grounded = np.unique(lab[p.pos[p.idx[:, 0], 1] < p.pos[:, 1].min() + 0.05])  # never float the model off its base
    keep = np.union1d(keep, grounded)
    idx = p.idx[np.isin(lab, keep)]
    used, inv = np.unique(idx, return_inverse=True)
    return Prim(p.material, p.pos[used], p.nor[used], p.uv[used], inv.reshape(-1, 3), p.node)


def build(mid, spec):
    t0 = time.time()
    path = glob.glob(f"{ROOT}/raw/polyhaven/{spec['ph']}/*.gltf")
    if len(path) != 1:
        raise RuntimeError(f"{spec['ph']}: expected one gltf, got {path}")
    g, d, bins, prims_all = load(path[0])
    prims = select(g, prims_all, spec)
    for p in prims:
        if p.nor is None or p.uv is None:
            raise RuntimeError(f"{mid}: primitive without normals or uvs")
    recentre(prims, spec["origin"])
    mats = {p.material for p in prims}
    imgs = {mi: material_images(g, d, bins, mi) for mi in mats}
    fol = [p for p in prims if is_foliage(g["materials"][p.material])]
    sol = [p for p in prims if not is_foliage(g["materials"][p.material])]
    S, C = sum(p.tris for p in sol), sum(p.tris for p in fol)
    # solid triangle budget follows surface area: a trunk is seen more than its share of source triangles
    area = {id(p): float(np.linalg.norm(np.cross(p.pos[p.idx[:, 1]] - p.pos[p.idx[:, 0]], p.pos[p.idx[:, 2]] - p.pos[p.idx[:, 0]]), axis=1).sum() / 2) for p in sol}
    A = sum(area.values()) or 1.0
    fol_tex = None
    if fol:
        fol_tex = []
        for p in fol:
            im = imgs[p.material]
            alb = srgb_to_linear(np.asarray(im["albedo"].convert("RGB"), np.float32) / 255) * np.array(im["factor"][:3], np.float32)
            arm = np.asarray(im["arm"].convert("RGB"), np.float32) / 255 if im["arm"] is not None else None
            op = np.asarray(im["alpha"], np.float32) / 255 if im["alpha"] is not None else None
            fol_tex.append({"albedo": alb, "arm": arm, "alpha": op})
    allp = np.concatenate([p.pos for p in prims])
    lods, stats = [], []
    for li, frac in enumerate(LOD_FRACTIONS):
        T = int(spec["budget"] * frac)
        res = max(64, spec["tex"] >> li)
        sres = max(64, spec["solid_tex"] >> li)
        if fol:
            s_target = min(S, int(T * 0.3)) if S else 0
            k = max(8, (T - s_target) // 2)
        else:
            s_target = T
        out_prims, materials, images, mat_of = [], [], [], {}
        whole = T >= S + C  # under budget: ship the source geometry, leaves included
        # solids keep their source materials, textures at this LOD's resolution
        for p in (sol + fol if whole else sol):
            q = p if whole or S <= s_target else simplify(cull(p, max(12, int(s_target * area[id(p)] / A))), max(12, int(s_target * area[id(p)] / A)))
            if p.material not in mat_of:
                im = imgs[p.material]
                slot = {}
                for kind in ("albedo", "normal", "arm"):
                    if im[kind] is not None and not (kind == "normal" and li == 2):  # far LOD: no normal map
                        src = im[kind].convert("RGB")
                        if kind == "albedo" and im["alpha"] is not None:
                            src = src.copy(); src.putalpha(im["alpha"].resize(src.size))
                        images.append(encode(src, kind, sres)); slot[kind] = len(images) - 1
                mat = {"name": im["name"], "pbrMetallicRoughness": {"baseColorFactor": im["factor"],
                       "metallicFactor": im["metal"], "roughnessFactor": im["rough"]}, "doubleSided": True}
                if is_foliage(g["materials"][p.material]):
                    mat.update(alphaMode="MASK", alphaCutoff=0.5)
                if "albedo" in slot: mat["pbrMetallicRoughness"]["baseColorTexture"] = {"image": slot["albedo"]}
                if "arm" in slot:
                    mat["pbrMetallicRoughness"]["metallicRoughnessTexture"] = {"image": slot["arm"]}
                    mat["occlusionTexture"] = {"image": slot["arm"]}
                if "normal" in slot: mat["normalTexture"] = {"image": slot["normal"]}
                materials.append(mat); mat_of[p.material] = len(materials) - 1
            q = Prim(mat_of[p.material], q.pos, q.nor, q.uv, q.idx, q.node)  # never mutate the source prim
            out_prims.append(q)
        if fol and not whole:
            card, rgba, n8, m8, st = bake_cards(fol, fol_tex, k, res, axis_xz=(0.0, 0.0), seed=li)
            images.append(encode(Image.fromarray(rgba, "RGBA"), "albedo", res))
            mat = {"name": f"{mid}_cards", "alphaMode": "MASK", "alphaCutoff": 0.5, "doubleSided": True,
                   "pbrMetallicRoughness": {"baseColorTexture": {"image": len(images) - 1}, "metallicFactor": 0.0,
                                            "roughnessFactor": float(np.median(m8[..., 1][rgba[..., 3] > 127]) / 255)}}
            if li == 0:  # leaf normals only where leaves are big on screen
                images.append(encode(Image.fromarray(n8), "normal", res)); mat["normalTexture"] = {"image": len(images) - 1}
            materials.append(mat)
            card.material = len(materials) - 1
            out_prims.append(card)
            st["lod"] = li
            stats.append(st)
        tris = sum(p.tris for p in out_prims)
        # simplification can lift or sink the lowest vertices; a LOD must still stand on y = 0
        dy = min(p.pos[:, 1].min() for p in out_prims)
        for p in out_prims:
            p.pos = p.pos - [0, dy, 0]
        os.makedirs(f"{ROOT}/work/models", exist_ok=True)
        out = f"{ROOT}/work/models/{mid}_lod{li}.glb"
        size = write_glb(out, [(f"{mid}_lod{li}", out_prims)], materials, images)
        lods.append(dict(lod=li, file=out, tris=tris, bytes=size, tex=res, solid_tex=sres))
        print(mid, f"lod{li}", tris, "tris", size, "bytes", flush=True)
    bb = (allp.min(0).tolist(), allp.max(0).tolist())
    fetched = json.load(open(f"{ROOT}/raw/polyhaven/fetched.json"))["assets"][spec["ph"]]
    lod_ids = [f"model/{mid}/lod{l['lod']}" for l in lods]
    for l in lods:
        register(f"model/{mid}/lod{l['lod']}", l["file"], "model", polyhaven_source(spec["ph"], "2k", fetched["files"]["gltf"]),
                 lods=lod_ids, tris=l["tris"], texture_size={"foliage_atlas": l["tex"] if fol else None, "solid": l["solid_tex"]}, bounds_m=bb, stages=spec["stages"],
                 source_tris={"solid": S, "foliage": C}, build={"nodes": spec["nodes"], "compose": spec["compose"],
                 "origin": spec["origin"], "budget": spec["budget"], "foliage": "billboard-cloud" if fol else None,
                 "cards": stats or None})
    return dict(id=mid, seconds=round(time.time() - t0, 1), source_tris=S + C, lods=[(l["tris"], l["bytes"]) for l in lods])


if __name__ == "__main__":
    ids = sys.argv[1:] or list(MODELS)
    log = []
    for mid in ids:
        r = build(mid, MODELS[mid])
        print(json.dumps(r), flush=True)
        log.append(r)
    os.makedirs(f"{ROOT}/logs", exist_ok=True)
    json.dump(log, open(f"{ROOT}/logs/build_models_{'all' if not sys.argv[1:] else '_'.join(ids)[:80]}.json", "w"), indent=1)
