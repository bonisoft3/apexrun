"""Download the pinned generator weights into the Hugging Face cache (fp16 safetensors only)."""
import time
from huggingface_hub import snapshot_download

PINS = [
    ("tencent/Hunyuan3D-2", "9cd649ba6913f7a852e3286bad86bfa9a2d83dcf",
     ["hunyuan3d-dit-v2-0/config.yaml", "hunyuan3d-dit-v2-0/model.fp16.safetensors"]),
    ("stabilityai/stable-diffusion-xl-base-1.0", "462165984030d82259a11f4367a4eed129e94a7b",
     ["model_index.json", "scheduler/*", "tokenizer/*", "tokenizer_2/*", "*/config.json",
      "text_encoder/model.fp16.safetensors", "text_encoder_2/model.fp16.safetensors",
      "unet/diffusion_pytorch_model.fp16.safetensors"]),
    ("madebyollin/sdxl-vae-fp16-fix", "207b116dae70ace3637169f1ddd2434b91b3a8cd",
     ["config.json", "diffusion_pytorch_model.safetensors"]),
]
for repo, rev, pats in PINS:
    t = time.time()
    p = snapshot_download(repo, revision=rev, allow_patterns=pats, max_workers=4)
    print(repo, rev, p, round(time.time() - t), "s", flush=True)
