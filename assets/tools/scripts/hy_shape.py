"""Hunyuan3D-2 full shape model (hunyuan3d-dit-v2-0, fp16) on MPS: RGBA reference -> raw mesh.

usage: hy_shape.py <name>:<rgba png>:<seed> ...   (PYTORCH_ENABLE_MPS_FALLBACK=1 required: one torchvision resize op)
Writes work/hy/<name>.glb (floaters and degenerate faces removed, otherwise full resolution) and work/hy/<name>.json.
"""
import glob, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
# Tencent's Hunyuan3D-2 code, checked out at the commit recipes.json names.
if not os.environ.get("HY3D_PATH"):
    raise SystemExit("set HY3D_PATH to a Hunyuan3D-2 checkout")
sys.path.insert(0, os.environ["HY3D_PATH"])
if os.environ.get("PYTORCH_ENABLE_MPS_FALLBACK") != "1":
    raise SystemExit("set PYTORCH_ENABLE_MPS_FALLBACK=1")
import torch
from PIL import Image
from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline, FloaterRemover, DegenerateFaceRemover

REPO, REV, SUB = "tencent/Hunyuan3D-2", "9cd649ba6913f7a852e3286bad86bfa9a2d83dcf", "hunyuan3d-dit-v2-0"
HY_COMMIT = "f8db63096c8282cb27354314d896feba5ba6ff8a"
PARAMS = dict(num_inference_steps=60, octree_resolution=512, num_chunks=20000, guidance_scale=5.0, box_v=1.01, mc_level=0.0)
d = os.path.expanduser(f"~/.cache/huggingface/hub/models--tencent--Hunyuan3D-2/snapshots/{REV}/{SUB}")
t0 = time.time()
pipe = Hunyuan3DDiTFlowMatchingPipeline.from_single_file(f"{d}/model.fp16.safetensors", f"{d}/config.yaml",
                                                         device="mps", dtype=torch.float16, use_safetensors=True)
load_s = time.time() - t0
os.makedirs(f"{ROOT}/work/hy", exist_ok=True)
for spec in sys.argv[1:]:
    name, ref, seed = spec.split(":")
    img = Image.open(ref)
    if img.mode != "RGBA":
        raise ValueError(f"{ref}: reference must be RGBA (background already removed)")
    t = time.time()
    mesh = pipe(image=img, generator=torch.manual_seed(int(seed)), output_type="trimesh", **PARAMS)[0]
    torch.mps.synchronize()
    gen_s = time.time() - t
    raw = len(mesh.faces)
    mesh = DegenerateFaceRemover()(FloaterRemover()(mesh))
    mesh.export(f"{ROOT}/work/hy/{name}.glb")
    rec = dict(name=name, ref=os.path.relpath(ref, ROOT), seed=int(seed), model=REPO, model_revision=REV, subfolder=SUB,
               code_commit=HY_COMMIT, dtype="float16", device="mps", params=PARAMS, gen_seconds=round(gen_s, 1),
               load_seconds=round(load_s, 1), raw_faces=raw, faces=len(mesh.faces))
    json.dump(rec, open(f"{ROOT}/work/hy/{name}.json", "w"), indent=1)
    print(json.dumps(rec), flush=True)
