"""Painted sky domes per stage: each stage's photographed sky, stylised.

The art pack's sky/<stage>.jpg (a 2048x1024 equirect, ACES toned) gives the
upper half, horizon to zenith; SDXL img2img with left-right circular padding
repaints it as a painted sky, keeping its sun, cloud layout and horizon. The
night city stage starts from a drawn starfield over a distant skyline instead:
its photograph is of streets shot from among the towers, whose verticals lean on
a dome; a far skyline on the horizon does not.
Below the horizon is the horizon's own colour (the ground hides it).
"""
import sys, json, torch, numpy as np
from diffusers import StableDiffusionXLImg2ImgPipeline, AutoencoderKL
from PIL import Image

MANIFEST = json.load(open(sys.argv[1]))
PACK_OUT = sys.argv[2]
STYLE = "stylized painted sky, cel shaded clouds with bold clean shapes and soft gradients, painterly matte painting, vibrant game art"
NEG = "text, watermark, logo, people, trees, land, mountains, fruit, animals, photo, noisy"
NEG_CLEAR = NEG + ", buildings, city"
NIGHT = "night city skyline far away on the horizon, straight towers with glowing windows, deep navy sky full of small bright stars, magenta city glow above the skyline"
STRENGTH = 0.55
SEED = 11

def circular_x(model):
    for m in model.modules():
        if isinstance(m, torch.nn.Conv2d):
            m.padding_mode = "circular"

def night_city(seed):
    """Stars over a distant skyline: towers stand on the bottom edge, straight up."""
    rng = np.random.default_rng(seed)
    v = np.linspace(0, 1, 512)[:, None, None]
    a = np.array([10, 14, 40], np.float32) * (1 - v) + np.array([90, 40, 110], np.float32) * v
    a = np.repeat(a, 2048, axis=1).copy()
    for _ in range(900):
        y, x = rng.integers(0, 380), rng.integers(0, 2048)
        a[y, x] = 255 * rng.uniform(0.5, 1.0)
    x = 0
    while x < 2048:
        w = int(rng.integers(18, 60)); h = int(rng.integers(30, 150))
        a[512 - h:, x:x + w] = (16, 14, 30)
        for wy in range(512 - h + 6, 506, 9):
            for wx in range(x + 4, min(x + w, 2048) - 3, 7):
                if rng.uniform() < 0.45:
                    a[wy:wy + 3, wx:wx + 3] = (255, 214, 140) if rng.uniform() < 0.8 else (140, 220, 255)
        x += w + int(rng.integers(0, 10))
    return Image.fromarray(a.clip(0, 255).astype(np.uint8))


def main(names):
    vae = AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", torch_dtype=torch.float16)
    pipe = StableDiffusionXLImg2ImgPipeline.from_pretrained("stabilityai/stable-diffusion-xl-base-1.0", vae=vae, torch_dtype=torch.float16, variant="fp16").to("mps")
    circular_x(pipe.unet); circular_x(pipe.vae)
    recipes = {}
    for name in names:
        night = name == "metropolis-night"
        src = night_city(SEED) if night else Image.open(f"{PACK_OUT}/{MANIFEST[f'sky/{name}.jpg']['file']}").convert("RGB").crop((0, 0, 2048, 512))
        prompt = f"{NIGHT}, {STYLE}" if night else STYLE
        g = torch.Generator("cpu").manual_seed(SEED)
        pano = pipe(prompt=prompt, negative_prompt=NEG if night else NEG_CLEAR, image=src, strength=0.6 if night else STRENGTH, guidance_scale=7.0, num_inference_steps=40, generator=g).images[0].resize((2048, 512))
        a = np.asarray(pano).astype(np.float32)
        eq = np.empty((1024, 2048, 3), np.float32)
        eq[:512] = a
        eq[512:] = a[-8:].mean(axis=(0, 1))
        Image.fromarray(eq.clip(0, 255).astype(np.uint8)).save(f"out/{name}.paint.jpg", quality=88)
        # The haze the game fades distance into: the sky just above its horizon.
        horizon = (np.asarray(Image.open(f"out/{name}.paint.jpg").convert("RGB")).astype(np.float32)[488:510].mean(axis=(0, 1)) / 255).round(4).tolist()
        recipes[name] = {"source": "night_city" if night else f"sky/{name}.jpg", "prompt": prompt, "negative": NEG if night else NEG_CLEAR, "seed": SEED, "strength": 0.6 if night else STRENGTH, "steps": 40, "guidance": 7.0, "model": "stabilityai/stable-diffusion-xl-base-1.0", "vae": "madebyollin/sdxl-vae-fp16-fix", "padding": "circular", "horizon_srgb": horizon}
        print(name, "done", flush=True)
    json.dump(recipes, open("out/recipes.json", "w"), indent=1)

if __name__ == "__main__":
    import os; os.makedirs("out", exist_ok=True)
    main(sys.argv[3:] or [k[4:-4] for k in MANIFEST if k.startswith("sky/") and k.endswith(".jpg")])
