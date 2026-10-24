"""Hunyuan3D-2 prop -> metres, ground at y = 0, footprint centred, light Taubin smoothing, quadric LODs, one flat material.

usage: hy_prop2.py <candidate> <out name> <height m> <yaw deg> <lod0 tris> <material name> <#rrggbb> [rough]
reads work/hy/<candidate>.glb, writes work/build/<out name>_lod{0,1,2}.glb + work/build/<out name>.json
The single flat material is deliberate: the cel post-process reads the geometry; a projected reference colour would
bring the reference's lighting and speckles with it."""
import json, os, sys
import numpy as np
import pymeshlab
import trimesh
sys.path.insert(0, os.path.dirname(__file__))
from gltf_io import Prim, write_glb
from meshkit import crease_normals
from mats import pbr, srgb
import geo

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FRACTIONS = (1.0, 0.25, 0.06)


def decimate(V, F, n):
    ms = pymeshlab.MeshSet()
    ms.add_mesh(pymeshlab.Mesh(V, F))
    ms.meshing_decimation_quadric_edge_collapse(targetfacenum=int(n), preservenormal=True, preserveboundary=True,
                                                optimalplacement=True, planarquadric=True, qualitythr=0.5)
    c = ms.current_mesh()
    return c.vertex_matrix().astype(float), c.face_matrix().astype(np.int64)


def main(cand, name, height, yaw, budget, mat, hexc, rough=0.85):
    raw = trimesh.load(f"{ROOT}/work/hy/{cand}.glb", force="mesh")
    V, F = np.asarray(raw.vertices, float), np.asarray(raw.faces, np.int64)
    V, F = decimate(V, F, 400000) if len(F) > 400000 else (V, F)
    ms = pymeshlab.MeshSet(); ms.add_mesh(pymeshlab.Mesh(V, F))
    ms.apply_coord_taubin_smoothing(stepsmoothnum=6)
    V = ms.current_mesh().vertex_matrix().astype(float)
    V = V @ geo.rot_y(np.radians(float(yaw))).T
    V *= float(height) / np.ptp(V[:, 1])
    V -= [(V[:, 0].max() + V[:, 0].min()) / 2, V[:, 1].min(), (V[:, 2].max() + V[:, 2].min()) / 2]
    mats = [pbr(mat, srgb(hexc), 0.0, float(rough))]
    rec = {"name": name, "candidate": cand, "height_m": float(height), "yaw_deg": float(yaw), "lods": []}
    for lod, f in enumerate(FRACTIONS):
        v, fc = decimate(V, F, int(int(budget) * f))
        vv, nn, ff = crease_normals(v, fc, 45)
        path = f"{ROOT}/work/build/{name}_lod{lod}.glb"
        size = write_glb(path, [(name, [Prim(0, vv, nn, None, ff)])], mats, [], generator="apex-outrun-props2")
        rec["lods"].append(dict(lod=lod, path=os.path.relpath(path, ROOT), tris=int(len(ff)), bytes=size,
                                bounds_m=[vv.min(0).tolist(), vv.max(0).tolist()], nodes=[name], materials=[mat]))
        print(name, lod, len(ff), size, np.round(vv.min(0), 2).tolist(), np.round(vv.max(0), 2).tolist(), flush=True)
    rec["note"] = "single flat material; Hunyuan geometry carries the detail"
    json.dump(rec, open(f"{ROOT}/work/build/{name}.json", "w"), indent=1)


if __name__ == "__main__":
    main(*sys.argv[1:])
