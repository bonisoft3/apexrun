"""SDXL base 1.0 (fp16 weights, fp16-fix VAE) on MPS: reference images and tileable textures.

usage: sdxl.py <jobs.json> [name ...]   jobs: {name: {prompt, negative, seeds, steps, guidance, width, height, tile}}
Writes work/sdxl/<name>_s<seed>.png and work/sdxl/<name>.json with every parameter.
"""
import json, os, sys, time
import torch
from diffusers import AutoencoderKL, StableDiffusionXLPipeline

ROOT = os.path.join(os.path.dirname(__file__), "..")
BASE = ("stabilityai/stable-diffusion-xl-base-1.0", "462165984030d82259a11f4367a4eed129e94a7b")
VAE = ("madebyollin/sdxl-vae-fp16-fix", "207b116dae70ace3637169f1ddd2434b91b3a8cd")

jobs = json.load(open(sys.argv[1]))
only = set(sys.argv[2:])
vae = AutoencoderKL.from_pretrained(VAE[0], revision=VAE[1], torch_dtype=torch.float16)
pipe = StableDiffusionXLPipeline.from_pretrained(BASE[0], revision=BASE[1], vae=vae, variant="fp16",
                                                 torch_dtype=torch.float16, use_safetensors=True).to("mps")
pipe.set_progress_bar_config(disable=True)
convs = [m for m in list(pipe.unet.modules()) + list(pipe.vae.modules()) if isinstance(m, torch.nn.Conv2d)]
os.makedirs(f"{ROOT}/work/sdxl", exist_ok=True)
for name, j in jobs.items():
    if only and name not in only:
        continue
    for m in convs:
        m.padding_mode = "circular" if j.get("tile") else "zeros"
    log = []
    for seed in j["seeds"]:
        t = time.time()
        img = pipe(prompt=j["prompt"], negative_prompt=j["negative"], num_inference_steps=j["steps"],
                   guidance_scale=j["guidance"], width=j["width"], height=j["height"],
                   generator=torch.Generator("cpu").manual_seed(seed)).images[0]
        torch.mps.synchronize()
        dt = time.time() - t
        arr = torch.tensor(list(img.getdata())).float()
        if arr.std() < 1:
            raise RuntimeError(f"{name} seed {seed}: blank image (NaN decode?)")
        out = f"{ROOT}/work/sdxl/{name}_s{seed}.png"
        img.save(out)
        log.append({"seed": seed, "seconds": round(dt, 1), "file": os.path.basename(out)})
        print(name, seed, round(dt, 1), flush=True)
    json.dump({"model": BASE[0], "model_revision": BASE[1], "vae": VAE[0], "vae_revision": VAE[1],
               "scheduler": type(pipe.scheduler).__name__, "dtype": "float16", "device": "mps", **j, "runs": log},
              open(f"{ROOT}/work/sdxl/{name}.json", "w"), indent=1)
