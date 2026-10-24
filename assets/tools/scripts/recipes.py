"""Write out/recipes.json: everything needed to refetch or regenerate the pack, no bytes."""
import glob, hashlib, json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from items import ROOT
import selection, car

def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()

web = json.load(open(f"{ROOT}/web/package.json"))
sdxl = {os.path.basename(p)[:-5]: {k: v for k, v in json.load(open(p)).items() if k != "runs"}
        | {"seeds_run": [r["seed"] for r in json.load(open(p))["runs"]]} for p in sorted(glob.glob(f"{ROOT}/work/sdxl/*.json"))}
hy = {os.path.basename(p)[:-5]: json.load(open(p)) for p in sorted(glob.glob(f"{ROOT}/work/hy/*.json"))}
recipes = {
    "toolchain": {
        "python": "3.12.8 (uv; pyproject.toml + uv.lock)", "uv_lock_sha256": sha(f"{ROOT}/uv.lock"),
        "node": os.popen("node --version").read().strip(),
        "npm_pins": web["dependencies"], "pnpm_lock_sha256": sha(f"{ROOT}/web/pnpm-lock.yaml"),
        "babylon_shader_compilers": {"source": "https://cdn.babylonjs.com/{glslang,twgsl}/ (unversioned; the 9.31.0 path 404s)",
                                     "sha256": dict(l.split()[::-1] for l in open(f"{ROOT}/web/vendor/SHA256SUMS").read().splitlines())},
        "hunyuan3d_2_code": {"repo": "https://github.com/Tencent-Hunyuan/Hunyuan3D-2", "commit": "f8db63096c8282cb27354314d896feba5ba6ff8a",
                             "note": "used unmodified via sys.path; PYTORCH_ENABLE_MPS_FALLBACK=1"},
        "weights": [{"repo": r, "revision": v, "files": f} for r, v, f in [
            ("tencent/Hunyuan3D-2", "9cd649ba6913f7a852e3286bad86bfa9a2d83dcf", ["hunyuan3d-dit-v2-0/config.yaml", "hunyuan3d-dit-v2-0/model.fp16.safetensors"]),
            ("stabilityai/stable-diffusion-xl-base-1.0", "462165984030d82259a11f4367a4eed129e94a7b", ["fp16 variant: unet, text_encoder, text_encoder_2, tokenizers, configs"]),
            ("madebyollin/sdxl-vae-fp16-fix", "207b116dae70ace3637169f1ddd2434b91b3a8cd", ["config.json", "diffusion_pytorch_model.safetensors"]),
            ("rembg u2net", "rembg 2.0.62 default download", ["~/.u2net/u2net.onnx"])]],
        "machine": "Apple M2 Ultra 64 GB, macOS, torch MPS",
    },
    "polyhaven": {"api": "https://api.polyhaven.com/files/<id>", "res": "2k", "hdris": selection.HDRIS,
                  "textures": selection.TEXTURES, "models": selection.MODELS,
                  "fetched": json.load(open(f"{ROOT}/raw/polyhaven/fetched.json"))},
    "sky": json.load(open(f"{ROOT}/work/sky/sky_ldr.json")),
    "env": json.load(open(f"{ROOT}/work/env/env.json")),
    "sdxl_jobs": sdxl,
    "hunyuan_shapes": hy,
    "cars": {"specs": car.CARS, "budget": car.BUDGET, "lod_fractions": car.LOD_FRACTIONS,
             "references": json.load(open(f"{ROOT}/work/cut/refs.json"))},
    "steps": [
        "uv sync && (cd web && pnpm install)",
        "uv run python scripts/fetch_models.py",
        "uv run python scripts/fetch_polyhaven.py",
        "uv run python scripts/sky_ldr.py",
        "(cd web && node env.mjs 512)",
        "uv run python scripts/register_sky.py",
        "uv run python scripts/textures.py",
        "uv run python scripts/build_models.py",
        "uv run python scripts/sdxl.py scripts/jobs_refs.json",
        "uv run python scripts/cutout.py rembg work/sdxl/<picked>.png work/cut/<id>.png  (picks: scripts/refs_pick.py)",
        "uv run python scripts/refs_pick.py",
        "PYTORCH_ENABLE_MPS_FALLBACK=1 uv run python scripts/hy_shape.py <id>:work/cut/<id>.png:1234 ...",
        "uv run python scripts/car.py car-sedan car-convertible car-pickup car-boxtruck",
        "uv run python scripts/pack.py && uv run python scripts/recipes.py",
        "uv run python scripts/evidence.py jobs all && for c in renders/*/; do (cd web && node render.mjs ../$c/jobs.json); done && uv run python scripts/evidence.py contact",
    ],
}
json.dump(recipes, open(f"{ROOT}/out/recipes.json", "w"), indent=1, default=str)
print("recipes.json", os.path.getsize(f"{ROOT}/out/recipes.json"))
