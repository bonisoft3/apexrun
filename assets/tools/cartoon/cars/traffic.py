"""80s traffic, rebuilt with the hero-car material cut: aligned symmetric Hunyuan body -> labelled body + procedural wheels.

usage: traffic.py <car> [...]   reads work/align/<car>.ply, writes work/build/<car>_lod{0,1}.glb + .json
Labels come from geometry only (hero.py): soft regions on the dense mesh (wheel wells and backdrops, underbody) carried to
each LOD by a 4-nearest-face vote, then crisp convex regions from specs_traffic.py sliced into the mesh along their planes,
then same-label islands under ISLAND faces join their dominant neighbour. No reference colour is used, so no speckles.
Frame: +X the car's left, +Y up, +Z forward, metres; origin on the ground at the centre of the body's footprint."""
import json, os, sys, time
import numpy as np
import pymeshlab
import trimesh
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.dirname(__file__))
import hero
import wheel
from gltf_io import Prim, write_glb
from meshkit import crease_normals, face_normals

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
NAMES = ["paint", "glass", "trim", "taillight", "headlight", "rubber", "rim"]
IDX = {n: i for i, n in enumerate(NAMES)}
hero.IDX = IDX  # apply_regions / clean_islands resolve region material names through this
P, G, T = IDX["paint"], IDX["glass"], IDX["trim"]
WHEEL_MAT = {"rubber": "rubber", "rim": "rim", "trim": "trim", "chrome": "rim"}
LODS = {0: dict(budget=36000, wheel_lod=1, island=40, grooves=True),
        1: dict(budget=12000, wheel_lod=2, island=12, grooves=False)}


def materials(paint_lin, glass_blend=False):
    def pbr(name, rgb, metal, rough, **extra):
        a = extra.pop("alpha", 1.0)
        return {"name": name, "pbrMetallicRoughness": {"baseColorFactor": list(rgb) + [a], "metallicFactor": metal, "roughnessFactor": rough}, **extra}
    glass = (pbr("glass", (0.03, 0.035, 0.04), 0.0, 0.03, alpha=0.35, alphaMode="BLEND") if glass_blend else
             pbr("glass", (0.012, 0.016, 0.02), 0.0, 0.04, extensions={"KHR_materials_clearcoat": {"clearcoatFactor": 1.0, "clearcoatRoughnessFactor": 0.0}}))
    return [
        pbr("paint", paint_lin, 0.1, 0.35, extensions={"KHR_materials_clearcoat": {"clearcoatFactor": 1.0, "clearcoatRoughnessFactor": 0.03}}),
        glass,
        pbr("trim", (0.02, 0.02, 0.021), 0.0, 0.55),
        pbr("taillight", (0.42, 0.01, 0.008), 0.0, 0.12, emissiveFactor=[1.0, 0.04, 0.02],
            extensions={"KHR_materials_emissive_strength": {"emissiveStrength": 0.6}}),
        pbr("headlight", (0.85, 0.85, 0.82), 0.0, 0.08, emissiveFactor=[1.0, 0.96, 0.85],
            extensions={"KHR_materials_emissive_strength": {"emissiveStrength": 0.25}}),
        pbr("rubber", (0.022, 0.022, 0.022), 0.0, 0.88),
        pbr("rim", (0.75, 0.75, 0.77), 1.0, 0.25),
    ]


FALSE = {"paint": "#d03030", "glass": "#40c0ff", "trim": "#303030", "taillight": "#ff00a0", "headlight": "#ffff60",
         "rubber": "#101010", "rim": "#a0a0c0"}


def find_wheels(V, spec):
    """Axles given in the spec (when ground-contact clustering splits one tyre); hub x from the outer face of Hunyuan's tyre."""
    out = []
    for name in ("front", "rear"):
        za = spec["axles_z"][name]
        w = spec["wheels"][name]
        R = w["radius"]
        near = (np.hypot(V[:, 1] - R, V[:, 2] - za) < 0.85 * R) & (V[:, 0] > 0)
        x_out = min(float(np.percentile(V[near, 0], 99.5)), w.get("x_out_max", 9.0))
        out.append(dict(axle=name, z=za, radius=R, width=w["width"], x_out=x_out, hub_x=x_out - w["width"] / 2))
    return out


def soft_labels(V, F, wheels, spec):
    n, _ = face_normals(V, F)
    c = V[F].mean(1)
    lab = np.full(len(F), P)
    for w in wheels:
        x_in = w["x_out"] - w["width"] - 0.015
        rad = np.hypot(c[:, 1] - w["radius"], c[:, 2] - w["z"])
        to_hub = np.stack([np.zeros(len(c)), w["radius"] - c[:, 1], w["z"] - c[:, 2]], 1)
        to_hub /= np.linalg.norm(to_hub, axis=1, keepdims=True) + 1e-9
        disc = (rad < w["radius"] + 0.015) & (np.abs(c[:, 0]) > x_in - 0.2)
        liner = (rad < w["radius"] + spec.get("well", 0.16)) & (np.abs(c[:, 0]) < w["x_out"] + 0.005) & ((n * to_hub).sum(1) > 0.35) & (c[:, 1] > 0.05)
        lab[disc | liner] = T
    lab[(n[:, 1] < -0.5) & (c[:, 1] < spec["under_y"])] = T
    return lab


def body_lod(V, F, tree, dense_lab, spec, o, target):
    Vl, Fl = hero.reduce(V, F, target, dense_lab == T, coarse_share=0.3)
    _, nb = tree.query(Vl[Fl].mean(1), k=4)
    votes = np.zeros((len(Fl), len(NAMES)))
    for k in range(4):
        np.add.at(votes, (np.arange(len(Fl)), dense_lab[nb[:, k]]), 1)
    lab = hero.clean_islands(Fl, votes.argmax(1), o["island"])
    Vl, Fl, lab, locked = hero.apply_regions(Vl, Fl, lab, spec["regions"], o["grooves"])
    return Vl, Fl, hero.clean_islands(Fl, lab, o["island"], locked)


def build(car, spec):
    t0 = time.time()
    m = trimesh.load(f"{ROOT}/work/align/{car}.ply", process=False)
    V, F = np.asarray(m.vertices, float), np.asarray(m.faces, np.int64)
    wheels = find_wheels(V, spec) if "axles_z" in spec else hero.find_wheels(V, spec)
    V = hero.flatten_wheels(V, wheels)
    if spec.get("debadge"):
        V = hero.debadge(V, F, spec["debadge"])
    if spec.get("taubin"):
        ms = pymeshlab.MeshSet(); ms.add_mesh(pymeshlab.Mesh(V, F))
        ms.apply_coord_taubin_smoothing(stepsmoothnum=spec["taubin"])
        V = ms.current_mesh().vertex_matrix().astype(float)
    dense_lab = hero.clean_islands(F, soft_labels(V, F, wheels, spec), 300)
    tree = cKDTree(V[F].mean(1))
    wheel_nodes = {}
    for w in wheels:
        for side, sx in (("L", 1), ("R", -1)):
            wheel_nodes[f"wheel_{w['axle'][0].upper()}{side}"] = dict(hub=[sx * w["hub_x"], w["radius"], w["z"]], radius=w["radius"], width=w["width"], sx=sx)
    results = []
    for lod, o in LODS.items():
        wtris = {}
        for key, wn in wheel_nodes.items():
            Pw = wheel.build(wn["radius"], wn["width"], spec["rim_r"], o["wheel_lod"])
            wtris[key] = Pw
        wsum = sum(p.tris() for p in wtris.values())
        body_budget = o["budget"] - wsum
        target = body_budget
        for attempt in range(6):
            Vl, Fl, lab = body_lod(V, F, tree, dense_lab, spec, o, target)
            if len(Fl) <= body_budget:
                break
            target -= len(Fl) - body_budget + 50
        else:
            raise RuntimeError(f"{car} LOD{lod} body stays over budget: {len(Fl)} > {body_budget}")
        prims, counts = [], {}
        for mi in range(len(NAMES)):
            sel = lab == mi
            if not sel.any():
                continue
            used, inv = np.unique(Fl[sel], return_inverse=True)
            v, nrm, f = crease_normals(Vl[used], inv.reshape(-1, 3), spec.get("crease", 38))
            prims.append(Prim(mi, v, nrm, None, f))
            counts[NAMES[mi]] = int(sel.sum())
        nodes = [("body", prims)]
        for key, wn in wheel_nodes.items():
            Pw = wtris[key]
            if wn["sx"] < 0:
                Pw = Pw.transformed(np.diag([-1.0, 1, 1]), np.zeros(3))
            by = {}
            for mn, (v, nrm, f) in Pw.emit().items():
                by.setdefault(IDX[WHEEL_MAT[mn]], []).append((v, nrm, f))
            wp = []
            for mi, lst in sorted(by.items()):
                base, vs, ns, fs = 0, [], [], []
                for v, nrm, f in lst:
                    vs.append(v); ns.append(nrm); fs.append(f + base); base += len(v)
                wp.append(Prim(mi, np.concatenate(vs), np.concatenate(ns), None, np.concatenate(fs)))
            nodes.append((key, wp, wn["hub"]))
        path = f"{ROOT}/work/build/{car}_lod{lod}.glb"
        os.makedirs(os.path.dirname(path), exist_ok=True)
        size = write_glb(path, nodes, materials(spec["paint"], spec.get("glass_blend", False)), [], generator="apex-outrun-props2-traffic")
        tris = sum(p.tris for nd in nodes for p in nd[1])
        allv = np.vstack([p.pos + (nd[2] if len(nd) > 2 else 0) for nd in nodes for p in nd[1]])
        results.append(dict(lod=lod, path=os.path.relpath(path, ROOT), tris=int(tris), body_tris=int(len(Fl)), wheel_tris=int(wsum),
                            bytes=size, labels=counts, bounds_m=[allv.min(0).tolist(), allv.max(0).tolist()]))
        print(car, json.dumps(results[-1]), flush=True)
    rec = dict(car=car, wheels=[dict(name=k, hub=v["hub"], radius=v["radius"], width=v["width"]) for k, v in wheel_nodes.items()],
               wheel_detect=wheels, lods=results, seconds=round(time.time() - t0, 1))
    json.dump(rec, open(f"{ROOT}/work/build/{car}.json", "w"), indent=1)
    return rec


if __name__ == "__main__":
    from specs_traffic import SPECS
    for car in sys.argv[1:]:
        build(car, SPECS[car])
