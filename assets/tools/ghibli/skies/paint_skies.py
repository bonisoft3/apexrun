"""Gouache sky domes per stage: a Ghibli background's towering cumulus.

Each stage's photographed sky (the pack's sky/<stage>.jpg, a 2048x1024 equirect)
gives the upper half, horizon to zenith, so its cloud layout carries over: its
brightest parts become cream cumulus over a clear afternoon gradient (the
concepts' clear blue; the sunset road's warm), whatever the photo's own light
was, and SDXL img2img with left-right circular padding repaints that as an
opaque gouache sky with towering cumulus. The night city starts from its own painted dome
(sky/metropolis-night.paint.jpg: stars over a distant skyline), since its
photograph is a street. Below the horizon is the horizon's own colour.

usage: paint_skies.py <manifest.json> <pack_dir> <out_dir> [stage ...]
  -> <out_dir>/<stage>.paint.jpg, <out_dir>/recipes.json
"""
import sys, os, json, torch, numpy as np
from diffusers import StableDiffusionXLImg2ImgPipeline, AutoencoderKL
from PIL import Image

MODEL = "stabilityai/stable-diffusion-xl-base-1.0"
VAE = "madebyollin/sdxl-vae-fp16-fix"
STYLE = ("gouache sky painting by Kazuo Oga, Studio Ghibli background art, towering white cumulus clouds with warm "
         "sunlit tops and soft blue-grey shaded bellies, deep clear sky, opaque layered paint, soft visible brushwork")
NIGHT = ("gouache painting by Kazuo Oga, Studio Ghibli night sky, deep navy sky with soft painted stars, "
         "a distant city skyline glowing on the horizon, opaque layered paint")
NEG = "text, watermark, logo, people, trees, land, mountains, animals, photo, photorealistic, noisy, buildings, city"
NEG_NIGHT = "text, watermark, logo, people, trees, animals, photo, photorealistic, noisy"
STRENGTH, STRENGTH_NIGHT, SEED, STEPS, GUIDANCE = 0.7, 0.5, 11, 40, 7.0
# The afternoon each sky is repainted toward, sRGB zenith and horizon, and the clouds' cream.
CLEAR = ((62, 120, 178), (170, 202, 208))
GRADIENTS = {"sunset-highway": ((70, 100, 160), (236, 190, 146))}
CREAM = (250, 244, 228)


def afternoon(photo, name):
    """The photo's cloud layout as cream cumulus over the stage's clear gradient, 2048x512, horizon at the bottom."""
    a = np.asarray(photo).astype(np.float32)
    lum = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    lo, hi = np.percentile(lum, 55), np.percentile(lum, 97)
    t = np.clip((lum - lo) / max(hi - lo, 1e-3), 0, 1)
    cloud = (t * t * (3 - 2 * t))[..., None]
    zenith, horizon = (np.array(c, np.float32) for c in GRADIENTS.get(name, CLEAR))
    up = (1 - np.linspace(0, 1, a.shape[0], dtype=np.float32))[:, None, None]
    sky = horizon + (zenith - horizon) * up ** 0.8
    shade = 0.82 + 0.18 * t[..., None]
    return Image.fromarray((sky * (1 - cloud) + np.array(CREAM, np.float32) * shade * cloud).clip(0, 255).astype(np.uint8))


def circular_x(model):
    for m in model.modules():
        if isinstance(m, torch.nn.Conv2d):
            m.padding_mode = "circular"


def main(manifest, pack, out, names):
    m = json.load(open(manifest))
    vae = AutoencoderKL.from_pretrained(VAE, torch_dtype=torch.float16)
    pipe = StableDiffusionXLImg2ImgPipeline.from_pretrained(MODEL, vae=vae, torch_dtype=torch.float16, variant="fp16").to("mps")
    circular_x(pipe.unet); circular_x(pipe.vae)
    os.makedirs(out, exist_ok=True)
    recipes = {}
    for name in names:
        night = name == "metropolis-night"
        source = f"sky/{name}.paint.jpg" if night else f"sky/{name}.jpg"
        src = Image.open(f"{pack}/{m[source]['file']}").convert("RGB").resize((2048, 1024)).crop((0, 0, 2048, 512))
        prompt, neg, strength = (NIGHT, NEG_NIGHT, STRENGTH_NIGHT) if night else (STYLE, NEG, STRENGTH)
        if not night:
            src = afternoon(src, name)
        g = torch.Generator("cpu").manual_seed(SEED)
        pano = pipe(prompt=prompt, negative_prompt=neg, image=src, strength=strength, guidance_scale=GUIDANCE,
                    num_inference_steps=STEPS, generator=g).images[0].resize((2048, 512))
        a = np.asarray(pano).astype(np.float32)
        eq = np.empty((1024, 2048, 3), np.float32)
        eq[:512] = a
        eq[512:] = a[-8:].mean(axis=(0, 1))
        path = f"{out}/{name}.paint.jpg"
        Image.fromarray(eq.clip(0, 255).astype(np.uint8)).save(path, quality=88)
        # The haze the game fades distance into: the sky just above its horizon.
        horizon = (np.asarray(Image.open(path).convert("RGB")).astype(np.float32)[488:510].mean(axis=(0, 1)) / 255).round(4).tolist()
        recipes[name] = {"source": source, "from": m[source]["sha256"], "prompt": prompt, "negative": neg, "seed": SEED,
                         "strength": strength, "steps": STEPS, "guidance": GUIDANCE, "model": MODEL, "vae": VAE,
                         "padding": "circular", "horizon_srgb": horizon,
                         **({} if night else {"afternoon": GRADIENTS.get(name, CLEAR), "cream": CREAM})}
        print(name, "done", flush=True)
    json.dump(recipes, open(f"{out}/recipes.json", "w"), indent=1)


if __name__ == "__main__":
    m = json.load(open(sys.argv[1]))
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:] or [k[4:-10] for k in m if k.startswith("sky/") and k.endswith(".paint.jpg")])
