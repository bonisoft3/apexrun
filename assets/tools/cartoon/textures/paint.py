"""Paint each ground set's photographed albedo as a stylised hand-painted tile.

The photo is first flattened into colour regions (mean shift, on a 3x3 wrap so the
tile edges see their neighbours), then SDXL img2img repaints it with circular
padding in both axes, so the painting tiles like the photo did.

usage: paint.py <orig_dir> <manifest.orig.json> <raw_out_dir> [set[:seed] ...]
  -> <raw_out_dir>/<set>.s<seed>.{png,json} (1024 px painting, its recipe)
"""
import json, sys, os
import cv2, numpy as np, torch
from diffusers import StableDiffusionXLImg2ImgPipeline, AutoencoderKL
from PIL import Image

MODEL = "stabilityai/stable-diffusion-xl-base-1.0"
VAE = "madebyollin/sdxl-vae-fp16-fix"
STYLE = ("stylized hand-painted game texture, seamless top-down view, clean painterly shapes, "
         "soft gradients, smooth rounded forms, cartoon, Breath of the Wild style, Mario Kart 8 style")
NEG = ("photo, photorealistic, noise, grain, speckles, film grain, jpeg artifacts, text, watermark, logo, "
       "perspective, horizon, sky, aerial landscape, diorama, miniature, trees, shadows of objects, people, animals, blurry, lowres")
STEPS, GUIDANCE = 40, 7.0

# set -> (material phrase, strength, seed, meanshift (spatial, colour) radii, negative extra)
SETS = {
    "asphalt": ("uniform dark grey asphalt road surface, worn smooth tarmac with a few soft lighter patches", 0.5, 3, (12, 18), "stripes, lines, cracks"),
    "cobble": ("grey cobblestone pavement, rounded square stones with soft bevelled edges and dark joints", 0.5, 3, (8, 18), ""),
    "field-soil": ("brown tilled farm soil, soft rounded earth clumps", 0.55, 3, (12, 18), ""),
    "forest-floor": ("forest floor seen from above, a few large soft patches of green moss and orange fallen leaves, simple calm shapes", 0.6, 3, (10, 20), "twigs, branches, small details, busy, clutter, circles, rings, objects"),
    "grass": ("lush cartoon meadow grass seen from above, soft large patches of lighter yellow-green and darker green, a few small darker grass blade strokes", 0.4, 3, (16, 24), "rocks, stones, pebbles, flowers, dirt, soil, mud, brown, tan, pink, purple, swirls, outlines"),
    "palm-bark": ("flat bark texture filling the frame, brown palm bark surface with fibrous bands and soft ridges", 0.35, 3, (10, 18), "tree, trunk, column, pillar, spiral, rope, background, frame, border, stones, pebbles, holes, spots"),
    "rock-canyon": ("flat red sandstone rock wall texture filling the frame, horizontal layered strata with soft rounded edges", 0.45, 3, (10, 20), "plants, grass, buildings, cliff edge, valley"),
    "rock-granite": ("light grey granite rock surface, smooth rounded facets with a few soft cracks", 0.5, 3, (10, 20), ""),
    "ruins-stone": ("ancient sandstone block wall, large rectangular stone blocks with soft bevelled edges and mossy joints", 0.5, 3, (8, 18), ""),
    "sand-beach": ("smooth pale beach sand with gentle soft ripples", 0.55, 3, (14, 14), ""),
    "sand-desert": ("flat desert sand ground texture, soft fine wind ripples and a few small smooth pebbles", 0.4, 3, (12, 18), "objects, shells, footprints, swirls, stars"),
    "snow": ("flat fresh white snow ground texture filling the frame, soft smooth drifts and gentle blue shadows", 0.45, 3, (14, 14), "rocks, stones, objects, footprints, paths, water"),
}


def circular(model):
    for m in model.modules():
        if isinstance(m, torch.nn.Conv2d):
            m.padding_mode = "circular"


def flatten(img, sp, sr):
    """Mean shift on a 3x3 wrap of the tile, centre kept: colour regions with no grain."""
    a = np.asarray(img.convert("RGB").resize((1024, 1024), Image.LANCZOS))
    t = np.tile(a, (3, 3, 1))
    f = cv2.pyrMeanShiftFiltering(np.ascontiguousarray(t[:, :, ::-1]), sp, sr)[:, :, ::-1]
    return Image.fromarray(np.ascontiguousarray(f[1024:2048, 1024:2048]))


def stretch(img):
    """Lift to mid grey, contrast doubled, hue kept: SDXL paints near-black inputs poorly."""
    a = np.asarray(img).astype(np.float32)
    mu = a.mean((0, 1))
    return Image.fromarray(np.clip((a - mu) * 2 + 120 + (mu - mu.mean()) * 2, 0, 255).astype(np.uint8))


def periodic_noise(rng, n, scale):
    """White noise low-passed in the Fourier domain at `scale` px: periodic, so it tiles."""
    f = np.fft.fftfreq(n)
    k = np.hypot(f[:, None], f[None, :]) * scale
    a = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((n, n))) * np.exp(-0.5 * (k * 2 * np.pi) ** 2)))
    return (a - a.mean()) / a.std()


def meadow(img):
    """A green base in place of the photo: large light and dark patches, a softer finer layer."""
    rng = np.random.default_rng(5)
    n = img.size[0]
    t = 0.75 * periodic_noise(rng, n, 90) + 0.35 * periodic_noise(rng, n, 24)
    mid, light, dark = np.array([110, 154, 60.]), np.array([150, 182, 72.]), np.array([72, 118, 42.])
    w = np.clip(t, -1.5, 1.5)[..., None] / 1.5
    a = mid + np.where(w > 0, w * (light - mid), -w * (dark - mid))
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def leaf_litter(img):
    """A calm base in place of the photo: large moss, leaf and soil patches from two periodic noises."""
    rng = np.random.default_rng(9)
    n = img.size[0]
    u, v = periodic_noise(rng, n, 70), periodic_noise(rng, n, 70)
    moss, leaf, soil = np.array([112, 118, 48.]), np.array([196, 118, 52.]), np.array([128, 92, 56.])
    w = np.stack([np.exp(5 * u), np.exp(5 * v), np.full_like(u, 3.0)], -1)
    w /= w.sum(-1, keepdims=True)
    a = w[..., :1] * moss + w[..., 1:2] * leaf + w[..., 2:] * soil
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def despeckle(img):
    """Dark twigs and footprints out (median over 41 px where darker than it): SDXL paints them as objects."""
    a = np.asarray(img)
    t = np.tile(a, (3, 3, 1))
    med = cv2.medianBlur(np.ascontiguousarray(t), 41)[1024:2048, 1024:2048]
    dark = a.astype(np.int16).sum(-1) < med.astype(np.int16).sum(-1) - 24
    return Image.fromarray(np.where(dark[..., None], med, a))


PRE = {"snow": (despeckle, "dark marks replaced by a 41 px wrapped median"),
       "asphalt": (stretch, "per-channel contrast doubled, lifted to mid grey"),
       "forest-floor": (leaf_litter, "replaced by a procedural base: two periodic Fourier noises (70 px, seed 9) sharp softmax (x5) over moss #707630, leaf #C47634, soil #805C38"),
       "grass": (meadow, "replaced by a procedural meadow base: periodic Fourier noise (90 px x0.75 + 24 px x0.35, seed 5) mapped dark #48762A / mid #6E9A3C / light #96B648")}


def main(orig, manifest, out, which):
    m = json.load(open(manifest))
    vae = AutoencoderKL.from_pretrained(VAE, torch_dtype=torch.float16)
    pipe = StableDiffusionXLImg2ImgPipeline.from_pretrained(MODEL, vae=vae, torch_dtype=torch.float16, variant="fp16").to("mps")
    circular(pipe.unet); circular(pipe.vae)
    os.makedirs(out, exist_ok=True)
    for spec in which:
        name, _, seed = spec.partition(":")
        material, strength, seed0, (sp, sr), neg_extra = SETS[name]
        neg = f"{NEG}, {neg_extra}" if neg_extra else NEG
        seed = int(seed) if seed else seed0
        src_file = m[f"tex/{name}/albedo"]["file"]
        src = Image.open(f"{orig}/{src_file}")
        init = flatten(src, sp, sr)
        if name in PRE:
            init = PRE[name][0](init)
        init.save(f"{out}/{name}.init.png")
        prompt = f"{STYLE}, {material}"
        g = torch.Generator("cpu").manual_seed(seed)
        img = pipe(prompt=prompt, negative_prompt=neg, image=init, strength=strength, guidance_scale=GUIDANCE,
                   num_inference_steps=STEPS, generator=g).images[0]
        img.save(f"{out}/{name}.s{seed}.png")
        pre = [f"lanczos 1024", f"mean shift on 3x3 wrap (spatial {sp}, colour {sr})"] + ([PRE[name][1]] if name in PRE else [])
        json.dump({"model": MODEL, "vae": VAE, "prompt": prompt, "negative": neg, "seed": seed, "strength": strength,
                   "steps": STEPS, "guidance": GUIDANCE, "padding": "circular", "from": m[f"tex/{name}/albedo"]["sha256"],
                   "pre": pre}, open(f"{out}/{name}.s{seed}.json", "w"), indent=1)
        print(name, "painted", flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:] or list(SETS))
