"""Build the hero car's riders -> work/riders_lod{0,1}.glb + work/riders.json.

usage: build.py
Each node is an SDF solid (figures.py): marching cubes -> QEM to its budget -> projected back onto the field -> cut into
materials along nearest-component level sets, then paint bands; normals are the field gradient; per-vertex ambient
occlusion in COLOR_0 (VEC3). Every node is a root node placed at its pivot in the car's frame, so the renderer turns
the wind parts about their own origin."""
import json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "flagman"))
sys.path.insert(0, HERE)
import toon, figures
from gltf_io import write_glb
from mats import pbr, srgb

ROOT = os.path.abspath(os.path.join(HERE, ".."))
H = 0.005
BUDGET = {0: {"girl": 9000, "boy": 5000, "girl_hair": 1600, "girl_ribbon": 500, "boy_scarf": 600, "boy_wave": 1400, "boy_rest": 1400, "boy_head": 5000},
          1: {"girl": 2400, "boy": 1300, "girl_hair": 400, "girl_ribbon": 140, "boy_scarf": 160, "boy_wave": 360, "boy_rest": 360, "boy_head": 1300}}
AO = dict(radius=0.12, lo=0.6)
MATERIALS = [pbr("skin", srgb("#f2c49b"), rough=0.7), pbr("cheek", srgb("#ee8c86"), rough=0.7),
             pbr("eye", srgb("#1e1a18"), rough=0.3), pbr("mouth", srgb("#b2453a"), rough=0.6),
             pbr("hair", srgb("#8a3f1e"), rough=0.75), pbr("hairB", srgb("#3a2414"), rough=0.75),
             pbr("dress", srgb("#f2c14e"), rough=0.8), pbr("collar", srgb("#fbf6ea"), rough=0.8),
             pbr("ribbon", srgb("#d8432f"), rough=0.6), pbr("jacket", srgb("#3e6fb0"), rough=0.8),
             pbr("trim", srgb("#2c5288"), rough=0.8), pbr("trousers", srgb("#5a4a3a"), rough=0.85),
             pbr("scarf", srgb("#d8432f"), rough=0.7), pbr("wheel", srgb("#1e1a18"), rough=0.4)]
MAT = {m["name"]: i for i, m in enumerate(MATERIALS)}


def mesh(part, target):
    f = part["f"]
    V, F = toon.extract(f, np.asarray(part["box"][0]), np.asarray(part["box"][1]), H)
    V0, F0 = toon.decimate(V, F, int(0.55 * target), planar=False)
    r = 0.012
    while True:
        V, F = toon.refine(V0, F0, r)
        if len(F) <= target:
            break
        r *= 1.1
    V = toon.project(f, V, H * 0.25, reach=H)
    mats = part["mats"]
    every = set(mats)
    labels = np.array([part["base"]] * len(F), dtype=object)
    for m in mats:
        if m == part["base"]:
            continue
        others = [g for k, g in mats.items() if k != m]
        g = (lambda gm, gs: (lambda P: np.min([x(P) for x in gs], 0) - gm(P)))(mats[m], others)
        V, F, labels = toon.split(V, F, labels, g, None, m, f=f, eps=H * 0.25, only=every)
    names = list(mats)
    C = V[F].mean(1)
    labels = np.array(names, dtype=object)[np.argmin([mats[k](C) for k in names], 0)]
    for cuts, m, onto in part["paint"]:
        for i, c in enumerate(cuts):
            rest = cuts[:i] + cuts[i + 1:]
            ci = (lambda c, rest: (lambda P: np.maximum(c(P), -np.min([x(P) for x in rest], 0) - 0.02)))(c, rest)
            V, F, labels = toon.split(V, F, labels, ci, None, None, f=f, eps=H * 0.25, only={"-"})
        C = V[F].mean(1)
        inside = np.min([c(C) for c in cuts], 0) > 0
        labels = np.where(inside & np.isin(labels, list(onto)), m, labels).astype(object)
    V, F = toon.weld(V, F, 2e-4)
    keep = (F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])
    F, labels = F[keep], labels[keep]
    normal_fn = lambda P: toon.grad(f, P, H * 0.25)
    N = normal_fn(V)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-20)
    ao = toon.bake_ao(f, V, N, AO["radius"], 1.5 * H, lo=AO["lo"])
    return toon.prims(V, F, labels, normal_fn, np.repeat(ao[:, None], 3, 1), MAT), len(F), V


def main():
    os.makedirs(f"{ROOT}/work", exist_ok=True)
    rec = {"lods": [], "nodes": {}, "seats": {k: v.tolist() for k, v in figures.SEATS.items()}, "driver": "girl"}
    for lod in (0, 1):
        nodes, pts, tris = [], [], {}
        for name, (make, who, pivot, axis, amp) in figures.NODES.items():
            prims, n, V = mesh(make(), BUDGET[lod][name])
            origin = figures.SEATS[who] + pivot
            nodes.append((name, prims, origin))   # built about its pivot, the node's origin
            pts.append(V + origin)
            tris[name] = n
            rec["nodes"][name] = dict(figure=who, pivot_m=origin.tolist(), flutter_axis=axis, flutter_rad=amp)
            print(lod, name, n, flush=True)
        used = sorted({p.material for _, ps, _ in nodes for p in ps})
        remap = {o: k for k, o in enumerate(used)}
        for _, ps, _ in nodes:
            for p in ps:
                p.material = remap[p.material]
        path = f"{ROOT}/work/riders_lod{lod}.glb"
        size = write_glb(path, nodes, [MATERIALS[i] for i in used], [], generator="apex-outrun-riders")
        allv = np.vstack(pts)
        rec["lods"].append(dict(lod=lod, path=os.path.relpath(path, ROOT), tris=sum(tris.values()), tris_by_node=tris,
                                bytes=size, bounds_m=[allv.min(0).tolist(), allv.max(0).tolist()],
                                materials=[MATERIALS[i]["name"] for i in used]))
    json.dump(rec, open(f"{ROOT}/work/riders.json", "w"), indent=1)


if __name__ == "__main__":
    main()
