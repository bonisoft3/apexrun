"""Painted distance per stage (DESIGN.md "Ghibli gouache"): a far and a mid backdrop strip, seamless horizontally.

Each layer's silhouette is procedural (a profile of the stage's scenery, periodic in x: rolling hills, jagged snow
ranges, flat-topped buttes, a city skyline, fir treelines, sea bluffs, windmills over fields); SDXL img2img paints its
interior in Kazuo Oga gouache from an init that fills the silhouette with the layer's land colours over the stage's
horizon colour, with circular padding so the strip tiles. The silhouette is the alpha, feathered a pixel; aerial
perspective is baked in, each layer mixed toward the stage's horizon colour by its distance.

usage: paint.py <manifest.json> <out_dir> [stage ...]  -> <out_dir>/<stage>.<layer>.webp + recipes.json
"""
import json, os, sys
import numpy as np
import torch
from diffusers import StableDiffusionXLImg2ImgPipeline, AutoencoderKL
from PIL import Image

MODEL, VAE = "stabilityai/stable-diffusion-xl-base-1.0", "madebyollin/sdxl-vae-fp16-fix"
W, H = 2048, 512
STYLE = ("gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, "
         "opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade")
NEG = "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border"
STRENGTH, STEPS, GUIDANCE = 0.78, 36, 7.5
HAZE = {"far": 0.5, "mid": 0.22}

# stage -> layer -> (profile, params, colours bottom/top sRGB, phrase)
P = lambda kind, **kw: (kind, kw)
SCENES = {
    "coconut-beach": {"far": (P("bluffs", h=0.42), ("#5E7A6A", "#8FA48A"), "distant green coastal headlands and bluffs over a calm sea"),
                      "mid": (P("treeline", h=0.4, spikes=0.0, bumps=34), ("#2F6B35", "#5E9A48"), "lush tropical tree line with palms along a beach")},
    "desert-canyons": {"far": (P("buttes", h=0.5), ("#B65A3A", "#D9925E"), "distant red sandstone mesas and buttes, layered strata"),
                       "mid": (P("buttes", h=0.36, seed=9), ("#A84A2E", "#C9784A"), "red rock mesas and canyon walls")},
    "gateway-pass": {"far": (P("hills", h=0.5), ("#5E7E9A", "#8EA4B4"), "distant blue mountain ridges"),
                     "mid": (P("treeline", h=0.32, spikes=0.6, bumps=60), ("#264F2E", "#4E7A3A"), "tall dark cypress and pine treeline on green hills")},
    "alpine-peaks": {"far": (P("peaks", h=0.75), ("#6E7E9E", "#E8EEF4"), "distant soft rounded snow-covered mountain range, gentle violet shade"),
                     "mid": (P("treeline", h=0.5, spikes=1.0, bumps=70), ("#1E3E2C", "#3E6A44"), "dense dark fir forest ridge with snow")},
    "wilderness-run": {"far": (P("hills", h=0.55, seed=4), ("#4E6E7E", "#7E9AA4"), "distant forested mountains in blue haze"),
                       "mid": (P("treeline", h=0.38, spikes=0.8, bumps=80), ("#1E4426", "#3E6E34"), "dense wild forest of firs and broadleaf trees")},
    "tulip-gardens": {"far": (P("hills", h=0.16, seed=6), ("#6E8A6E", "#9AB08A"), "distant flat green polder with tree rows"),
                      "mid": (P("windmills", h=0.42), ("#4E6E3E", "#7E9A5A"), "dutch windmills and tree rows over flat fields")},
    "sunset-highway": {"far": (P("buttes", h=0.38, seed=13), ("#8E4A4A", "#C97A5A"), "distant desert mesas in warm sunset light"),
                       "mid": (P("hills", h=0.24, seed=14), ("#7A5A3E", "#A87E52"), "low desert hills with scrub")},
    "ancient-ruins": {"far": (P("hills", h=0.42, seed=7), ("#6E7E6A", "#9AA48A"), "distant olive hills with cypress"),
                      "mid": (P("treeline", h=0.34, spikes=0.5, bumps=50), ("#3E5A30", "#6E8A44"), "olive groves and cypress on mediterranean hills")},
    "metropolis-night": {"far": (P("skyline", h=0.7), ("#141428", "#2E2E52"), "distant city skyline at night with glowing windows"),
                         "mid": (P("skyline", h=0.45, seed=21), ("#1A1A30", "#3A3A5E"), "city towers at night with lit windows")},
    "coastal-cliffs": {"far": (P("bluffs", h=0.5, seed=8), ("#5A6E6A", "#8A9A88"), "distant sea cliffs and headlands"),
                       "mid": (P("hills", h=0.3, seed=19), ("#3E6A34", "#6E9A4A"), "green clifftop meadows and hedgerows")},
    "destination-marina": {"far": (P("bluffs", h=0.36, seed=11), ("#5E7A7A", "#8EA4A4"), "distant coastal hills over a harbour"),
                           "mid": (P("treeline", h=0.26, spikes=0.0, bumps=36), ("#2E6A3E", "#5E9A54"), "harbour town trees and palms")},
    "destination-oasis": {"far": (P("hills", h=0.3, seed=12), ("#B8885A", "#D8B080"), "distant golden sand dunes"),
                          "mid": (P("treeline", h=0.32, spikes=0.0, bumps=24), ("#3E6A2E", "#6E9A3E"), "date palm oasis grove")},
    "destination-castle": {"far": (P("hills", h=0.5, seed=15), ("#5A6E8A", "#8A9AB0"), "distant blue hills with a far castle"),
                           "mid": (P("treeline", h=0.34, spikes=0.3, bumps=50), ("#2E5A30", "#5A8A44"), "green forest and hedgerow hills")},
    "destination-colosseum": {"far": (P("hills", h=0.38, seed=16), ("#7A7A6A", "#A8A48A"), "distant roman hills with pines"),
                              "mid": (P("treeline", h=0.3, spikes=0.2, bumps=30), ("#3E5A30", "#6E8A44"), "umbrella pines and cypress")},
    "destination-aerodrome": {"far": (P("hills", h=0.28, seed=17), ("#6A7E8A", "#9AAAB0"), "distant low hills"),
                              "mid": (P("treeline", h=0.22, spikes=0.2, bumps=40), ("#3A6030", "#6A9040"), "airfield hedgerows and tree lines")},
}


# the painted sky each stage draws under (shell/engine/art.js STAGE_ART)
SKY = {**{s: s for s in SCENES}, "coastal-cliffs": "coconut-beach", "destination-marina": "coconut-beach",
       "destination-oasis": "desert-canyons", "destination-castle": "wilderness-run",
       "destination-colosseum": "ancient-ruins", "destination-aerodrome": "tulip-gardens"}


def periodic1d(rng, n, scale):
    f = np.fft.fftfreq(n)
    a = np.real(np.fft.ifft(np.fft.fft(rng.standard_normal(n)) * np.exp(-0.5 * (f * scale * 2 * np.pi) ** 2)))
    return (a - a.mean()) / a.std()


def profile(kind, kw, seed):
    """Silhouette height per column, 0..1 of the strip's height, periodic in x."""
    rng = np.random.default_rng(seed + kw.get("seed", 0))
    x = np.arange(W) / W
    h = kw["h"]
    if kind == "hills":
        p = h * (0.7 + 0.3 * periodic1d(rng, W, 220) * 0.6 + 0.08 * periodic1d(rng, W, 40))
    elif kind == "peaks":
        # a soft range, as the concepts paint it: rounded massifs on a long ridge, not cut triangles
        p = 0.3 * h * (1 + 0.3 * periodic1d(rng, W, 200))
        for _ in range(7):
            c, w, a = rng.uniform(0, 1), rng.uniform(0.07, 0.16), rng.uniform(0.5, 1.0)
            d = ((x - c + 0.5) % 1 - 0.5) / w
            p = p + a * h * 0.75 * np.exp(-2.2 * d * d)
        p = np.minimum(p, 0.95 * h) + 0.012 * h * periodic1d(rng, W, 8)
    elif kind == "buttes":
        p = np.full(W, 0.12 * h)
        for _ in range(7):
            c, w, a = rng.uniform(0, 1), rng.uniform(0.03, 0.1), rng.uniform(0.55, 1.0)
            d = np.abs((x - c + 0.5) % 1 - 0.5) / w
            p = np.maximum(p, a * h * np.clip((1.15 - d) * 5, 0, 1))
        p += 0.015 * periodic1d(rng, W, 10)
    elif kind == "skyline":
        p = np.full(W, 0.1 * h)
        i = 0
        while i < W:
            w = int(rng.integers(18, 70)); a = rng.uniform(0.25, 1.0) * h
            p[i:i + w] = np.maximum(p[i:i + w], a)
            i += w + int(rng.integers(0, 14))
    elif kind == "treeline":
        # individual crowns over a rolling base: firs are spires (spikes 1), broadleaf and palms are domes (spikes 0)
        p = h * (0.45 + 0.08 * periodic1d(rng, W, 300))
        for _ in range(kw["bumps"]):
            c = rng.uniform(0, 1); w = rng.uniform(0.5, 1.4) / kw["bumps"] * (1.3 - 0.6 * kw["spikes"])
            a = h * rng.uniform(0.6, 1.0)
            d = np.abs((x - c + 0.5) % 1 - 0.5) / w
            fir = np.clip(1 - d, 0, 1)
            dome = np.sqrt(np.clip(1 - d * d, 0, 1))
            crown = kw["spikes"] * fir + (1 - kw["spikes"]) * dome
            p = np.maximum(p, np.where(d < 1, h * 0.4 + (a - h * 0.4) * crown, 0))
    elif kind == "bluffs":
        p = np.full(W, 0.05)
        for _ in range(5):
            c, w, a = rng.uniform(0, 1), rng.uniform(0.06, 0.14), rng.uniform(0.6, 1.0)
            d = (x - c + 0.5) % 1 - 0.5
            p = np.maximum(p, a * h * np.clip(1 - np.abs(d) / w, 0, 1) ** 0.4 * (1 - 0.3 * np.clip(d / w, 0, 1)))
        p += 0.02 * periodic1d(rng, W, 30)
    elif kind == "windmills":
        # tree rows over flat polder; the mills' towers here, their sails in sails()
        trees = np.clip(np.sin(np.pi * x * 60 + 0.8 * periodic1d(rng, W, 40)), 0, 1) ** 2 * 0.14 * h
        p = h * (0.36 + 0.04 * periodic1d(rng, W, 120)) + trees
        for c, hh in mills(kw, seed):
            d = np.abs((x - c + 0.5) % 1 - 0.5) * W
            p = np.maximum(p, np.where(d < 13, hh - np.clip(d - 7, 0, None) * 0.004, 0))
    else:
        raise ValueError(kind)
    return np.clip(p, 0.02, 0.98)


def mills(kw, seed):
    """Each windmill's place along the strip and its tower's height."""
    rng = np.random.default_rng(seed + 99)
    return [(c, rng.uniform(0.75, 1.0) * kw["h"]) for c in (np.arange(6) + rng.uniform(0.15, 0.85, 6)) / 6]


def sails(kw, seed):
    """Four sails turned a little off square on each mill's cap: a lattice blade either side of each arm."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32) + 0.5
    m = np.zeros((H, W), np.float32)
    rng = np.random.default_rng(seed + 7)
    for c, hh in mills(kw, seed):
        hx, hy = c * W, (1 - hh) * H + 6
        turn = rng.uniform(0, np.pi / 2)
        dx = (xx - hx + W / 2) % W - W / 2
        dy = yy - hy
        for k in range(4):
            a = turn + k * np.pi / 2
            along = dx * np.cos(a) + dy * np.sin(a)
            across = -dx * np.sin(a) + dy * np.cos(a)
            arm = (along > 0) & (along < hh * H * 0.62)
            m = np.maximum(m, (arm & (np.abs(across) < 1.6)).astype(np.float32))
            m = np.maximum(m, (arm & (along > hh * H * 0.12) & (across > 0) & (across < 11)).astype(np.float32) * 0.999)
    return m


def mask_of(p):
    y = (np.arange(H)[:, None] + 0.5) / H        # 0 at the top row
    return np.clip(((y - (1 - p[None, :])) * H + 0.5) / 1.5, 0, 1)   # feathered over 1.5 px


def srgb(hexc):
    return np.array([int(hexc[k:k + 2], 16) for k in (1, 3, 5)], np.float32)


def circular_x(model):
    for m in model.modules():
        if isinstance(m, torch.nn.Conv2d):
            m.padding_mode = "circular"


def main(manifest, out, stages):
    m = json.load(open(manifest))
    vae = AutoencoderKL.from_pretrained(VAE, torch_dtype=torch.float16)
    pipe = StableDiffusionXLImg2ImgPipeline.from_pretrained(MODEL, vae=vae, torch_dtype=torch.float16, variant="fp16").to("mps")
    circular_x(pipe.unet); circular_x(pipe.vae)
    os.makedirs(out, exist_ok=True)
    recipes = json.load(open(f"{out}/recipes.json")) if os.path.exists(f"{out}/recipes.json") else {}
    for stage in stages:
        horizon = np.array(m[f"sky/{SKY[stage]}.paint.jpg"]["horizon_srgb"], np.float32) * 255
        for layer, ((kind, kw), (lo, hi), phrase) in SCENES[stage].items():
            seed = (sum(map(ord, stage + layer)) * 31) % 10000
            p = profile(kind, kw, seed)
            a = mask_of(p)
            if kind == "windmills":
                a = np.maximum(a, sails(kw, seed))
            y = np.linspace(0, 1, H)[:, None, None]
            land = srgb(hi) * (1 - y) + srgb(lo) * y
            # light and form for SDXL to paint over: sunlit faces, shaded hollows, mottled masses
            rng = np.random.default_rng(seed)
            form = sum(np.outer(periodic1d(rng, H, s * H / W), periodic1d(rng, W, s)) for s in (6, 18, 50)) / 3
            slope = np.gradient(p)[None, :] * W * 0.5
            land = land * (1 + 0.16 * form[..., None] + 0.22 * np.clip(-slope, -1, 1)[..., None])
            init = horizon * (1 - a[..., None]) + land * a[..., None]
            init = Image.fromarray(np.clip(init, 0, 255).astype(np.uint8))
            g = torch.Generator("cpu").manual_seed(seed)
            prompt = f"{STYLE}, {phrase}"
            img = pipe(prompt=prompt, negative_prompt=NEG, image=init, strength=STRENGTH, guidance_scale=GUIDANCE,
                       num_inference_steps=STEPS, generator=g).images[0].resize((W, H), Image.LANCZOS)
            rgb = np.asarray(img).astype(np.float32)
            rgb = rgb * (1 - HAZE[layer]) + horizon * HAZE[layer]
            rgba = np.dstack([np.clip(rgb, 0, 255), a * 255]).astype(np.uint8)
            Image.fromarray(rgba, "RGBA").save(f"{out}/{stage}.{layer}.webp", quality=88, method=6)
            recipes[f"{stage}.{layer}"] = {"profile": kind, "params": kw, "colours": [lo, hi], "prompt": prompt, "negative": NEG,
                                           "seed": seed, "strength": STRENGTH, "steps": STEPS, "guidance": GUIDANCE,
                                           "model": MODEL, "vae": VAE, "padding": "circular", "haze": HAZE[layer],
                                           "horizon_from": f"sky/{SKY[stage]}.paint.jpg"}
            json.dump(recipes, open(f"{out}/recipes.json", "w"), indent=1)
            print(stage, layer, flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3:] or list(SCENES))
