import sys, os, numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import wheel
from gltf_io import Prim, write_glb
from materials import materials, IDX
nodes = []
for lod, z in ((0, 0.45), (1, -0.45)):
    P = wheel.build(0.32, 0.245, 0.2032, lod)
    prims = [Prim(IDX[m], V, N, None, F) for m, (V, N, F) in P.emit().items()]
    nodes.append((f"w{lod}", prims, [0, 0.32, z]))
write_glb(sys.argv[1], nodes, materials(), [])
