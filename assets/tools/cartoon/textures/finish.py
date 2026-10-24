"""Finish a painted albedo into the set's albedo, normal and arm, encoded like the originals.

The painting keeps its shapes; its colour statistics are moved onto the photo's
(sRGB per-channel mean and a set fraction of its spread, then the linear mean
exactly: the game's lighting, fog and ROAD_ALBEDO are tuned to it). Every filter
wraps, so the tile stays seamless.

usage: finish.py <orig_dir> <manifest.orig.json> <raw_dir> <out_dir> set:seed ...
  -> <out_dir>/<sha256>.webp, <out_dir>/manifest.json (merged with what is there)
"""
import hashlib, io, json, os, sys
import cv2, numpy as np
from PIL import Image

MODEL_REVISION = "462165984030d82259a11f4367a4eed129e94a7b"
VAE_REVISION = "207b116dae70ace3637169f1ddd2434b91b3a8cd"
PAD = 64
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
# Sets recoloured from the photo's palette, ranked along an axis: under a per-channel
# match their SDXL hue (grass painted from a greened photo) drifts to pink and violet.
PALETTE = {"sand-desert": ("value", LUMA)}
# Sets whose mean is a chosen colour, not the photo's (sRGB 0-255).
MEAN = {"grass": (110, 154, 60)}
# Smooth paintings where the VAE encoder's one-sided zero pad leaves a visible step at the tile edge.
RELAX = {"grass", "forest-floor"}

# set -> roughness, spread (fraction of the photo's sRGB std), normal slope (rms gradient), bilateral sigma colour
FINISH = {
    "asphalt":      (0.85, 0.35, 0.06, 18),
    "cobble":       (0.75, 0.9, 0.16, 20),
    "field-soil":   (0.90, 0.8, 0.10, 16),
    "forest-floor": (0.85, 0.45, 0.10, 20),
    "grass":        (0.80, 0.45, 0.07, 18),
    "palm-bark":    (0.85, 1.0, 0.14, 16),
    "rock-canyon":  (0.75, 0.9, 0.14, 20),
    "rock-granite": (0.75, 0.6, 0.12, 20),
    "ruins-stone":  (0.75, 0.8, 0.16, 20),
    "sand-beach":   (0.90, 1.0, 0.07, 12),
    "sand-desert":  (0.90, 0.9, 0.08, 16),
    "snow":         (0.60, 0.8, 0.07, 12),
}


def wrap(a, p=PAD):
    return np.pad(a, [(p, p), (p, p)] + [(0, 0)] * (a.ndim - 2), mode="wrap")


def unwrap(a, p):
    return a[p:-p, p:-p]


def resize(a, n):
    """Lanczos resize of a periodic tile: the border sees its neighbours."""
    s = n / a.shape[0]
    big = cv2.resize(wrap(a), None, fx=s, fy=s, interpolation=cv2.INTER_LANCZOS4)
    return unwrap(big, int(PAD * s))


def gauss(a, sigma):
    p = int(sigma * 4) + 1
    return unwrap(cv2.GaussianBlur(wrap(a, p), (0, 0), sigma), p)


def to_lin(s):
    return np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)


def to_srgb(l):
    l = np.clip(l, 0, 1)
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * l ** (1 / 2.4) - 0.055)


def relax(a, band=64):
    """Spread the step across each tile edge over `band` px either side, so the edge rows meet."""
    a = a.astype(np.float32)
    ramp = np.linspace(0.5, 0, band, dtype=np.float32)
    for _ in range(2):
        d = a[:, 0] - a[:, -1]
        f = np.fft.fftfreq(d.shape[0])[:, None]
        step = np.real(np.fft.ifft(np.fft.fft(d, axis=0) * np.exp(-0.5 * (2 * np.pi * f * 8) ** 2), axis=0))[:, None, :]
        a[:, :band] -= step * ramp[None, :, None]
        a[:, -band:] += step * ramp[::-1][None, :, None]
        a = a.transpose(1, 0, 2)
    return np.clip(a, 0, 255).astype(np.uint8)


def palette(a, photo, axis, bins=256):
    """Each pixel takes the blurred photo's mean colour at the same percentile along `axis`.

    Blurred (sigma 8 px), the ramp holds the photo's patch colours, not its grain's extremes."""
    photo = gauss(photo, 8)
    pl = (photo @ axis).ravel()
    order = np.argsort(pl, kind="stable")
    ramp = photo.reshape(-1, 3)[order].reshape(bins, -1, 3).mean(1)
    al = (a @ axis).ravel()
    rank = np.empty(al.size, np.int64)
    rank[np.argsort(al, kind="stable")] = np.arange(al.size)
    return ramp[rank * bins // al.size].reshape(a.shape).astype(np.float32)


def encode(img, enc):
    b = io.BytesIO()
    if enc.get("lossless"):
        img.save(b, "WEBP", lossless=True, method=enc["method"])
    else:
        img.save(b, "WEBP", quality=enc["quality"], method=enc["method"])
    return b.getvalue()


def entry(orig_entry, data, generated):
    sha = hashlib.sha256(data).hexdigest()
    e = {k: orig_entry[k] for k in ("channels", "colorspace", "encode", "kind", "license")}
    e.update(bytes=len(data), file=f"{sha}.webp", sha256=sha, source={"generated": generated})
    return dict(sorted(e.items())), sha


def main(orig, manifest, raw, out, picks):
    m = json.load(open(manifest))
    os.makedirs(out, exist_ok=True)
    frag_path = f"{out}/manifest.json"
    frag = json.load(open(frag_path)) if os.path.exists(frag_path) else {}
    for pick in picks:
        name, seed = pick.split(":")
        rough, spread, slope, sc = FINISH[name]
        recipe = json.load(open(f"{raw}/{name}.s{seed}.json"))
        oa = m[f"tex/{name}/albedo"]
        photo = np.asarray(Image.open(f"{orig}/{oa['file']}").convert("RGB")).astype(np.float32) / 255
        paint = np.asarray(Image.open(f"{raw}/{name}.s{seed}.png").convert("RGB"))

        if name in RELAX:
            paint = relax(paint)
        size = oa["encode"]["size"]
        a = resize(paint, size)
        a = unwrap(cv2.bilateralFilter(wrap(a, 16), 9, sc, 5), 16).astype(np.float32) / 255
        mu_o, sd_o = photo.mean((0, 1)), photo.std((0, 1))
        if name in MEAN:
            mu_o = np.array(MEAN[name], np.float32) / 255
        if name in PALETTE:
            # Hue from the ramp, value from the painting at the set's spread of the photo's.
            lp, lo = a @ LUMA, photo @ LUMA
            ramp = palette(a, photo, PALETTE[name][1])
            target = lo.mean() + (lp - lp.mean()) * (spread * lo.std() / lp.std())
            a = ramp * (target / (ramp @ LUMA))[..., None]
            a += mu_o - a.mean((0, 1))
        else:
            mu_p, sd_p = a.mean((0, 1)), a.std((0, 1)) + 1e-4
            a = (a - mu_p) * (spread * sd_o.mean() / sd_p.mean()) + mu_o
        if name not in MEAN:
            lin = to_lin(np.clip(a, 0, 1))
            lin *= to_lin(photo).mean((0, 1)) / lin.mean((0, 1))
            a = to_srgb(lin)
        a = np.clip(a, 0, 1)
        albedo = Image.fromarray((a * 255 + 0.5).astype(np.uint8))

        # Height: the painting's value, its shapes only (blurred), broad tilt removed.
        nsize = m[f"tex/{name}/normal"]["encode"]["size"]
        lum = resize((a @ LUMA).astype(np.float32), nsize)
        h = gauss(lum, 2.0 * nsize / 1024) - gauss(lum, 96 * nsize / 1024)
        dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / 2
        dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / 2
        k = slope / (np.sqrt((dx ** 2 + dy ** 2).mean()) + 1e-8)
        n = np.stack([-dx * k, dy * k, np.ones_like(h)], -1)
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        normal = Image.fromarray(((n * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8))

        # AO from cavities of the same height, mild; roughness flat with a whisper of the height.
        asize = m[f"tex/{name}/arm"]["encode"]["size"]
        ha = resize(h, asize)
        hn = (ha - ha.mean()) / (ha.std() + 1e-8)
        ao = np.clip(1 - 0.12 * np.clip(gauss(hn, 24 * asize / 2048) - hn, 0, None), 0.82, 1)
        ro = np.clip(rough - 0.02 * np.clip(hn, -2, 2), 0, 1)
        arm = Image.fromarray((np.stack([ao, ro, np.zeros_like(ao)], -1) * 255 + 0.5).astype(np.uint8))

        common = {"model": recipe["model"], "model_revision": MODEL_REVISION, "vae": recipe["vae"],
                  "vae_revision": VAE_REVISION, "prompt": recipe["prompt"], "negative": recipe["negative"],
                  "seed": recipe["seed"], "strength": recipe["strength"], "steps": recipe["steps"],
                  "guidance": recipe["guidance"], "padding": recipe["padding"], "from": recipe["from"]}
        alb_post = recipe["pre"] + [
            f"sdxl img2img at 1024",
            *(["tile-edge step spread over 64 px either side (edge-smoothed sigma 8 px)"] if name in RELAX else []), f"wrapped lanczos to {size}", f"wrapped bilateral (d 9, colour {sc}, space 5)",
            *([f"hue from the source's palette: each pixel the source's mean colour at its {PALETTE[name][0]} percentile (256 bins, source blurred sigma 8 px)",
               f"value: the painting's luminance at {spread}x the source's luminance std, sRGB per-channel mean to the source's"] if name in PALETTE else
              [f"sRGB per-channel mean to #{''.join(f'{c:02X}' for c in MEAN[name])}, spread {spread}x the source's std"] if name in MEAN else
              [f"sRGB per-channel mean to the source's, spread {spread}x the source's std", "linear per-channel mean scaled to the source's"])]
        enc = {kind: encode(img, m[f"tex/{name}/{kind}"]["encode"]) for kind, img in (("albedo", albedo), ("normal", normal), ("arm", arm))}
        alb_e, alb_sha = entry(oa, enc["albedo"], dict(common, post=alb_post))
        der = dict(common, from_albedo=alb_sha)
        nrm_e, _ = entry(m[f"tex/{name}/normal"], enc["normal"], dict(der, post=alb_post + [
            f"height: albedo luminance at {nsize}, wrapped gaussian band-pass (sigma {2.0 * nsize / 1024:g} minus {96 * nsize / 1024:g} px)",
            f"OpenGL (+Y) normal by central differences, rms slope {slope}"]))
        arm_e, _ = entry(m[f"tex/{name}/arm"], enc["arm"], dict(der, post=alb_post + [
            f"height as the normal's, at {asize}, standardised",
            "R: AO = 1 - 0.12 x cavity (wrapped gaussian 24 px minus height), clamped to [0.82, 1]",
            f"G: roughness {rough} - 0.02 x height, B: metallic 0"]))
        for kind, e in (("albedo", alb_e), ("normal", nrm_e), ("arm", arm_e)):
            old = frag.get(f"tex/{name}/{kind}")
            if old and old["file"] != e["file"] and os.path.exists(f"{out}/{old['file']}"):
                os.remove(f"{out}/{old['file']}")
            open(f"{out}/{e['file']}", "wb").write(enc[kind])
            frag[f"tex/{name}/{kind}"] = e
        print(name, "srgb mean", (a.mean((0, 1)) * 255).round(1), "photo", (mu_o * 255).round(1),
              "std", (a.std((0, 1)) * 255).round(1), "photo", (sd_o * 255).round(1),
              "lin mean", to_lin(np.asarray(albedo) / 255).mean().round(4), "photo", to_lin(photo).mean().round(4), flush=True)
    json.dump(dict(sorted(frag.items())), open(frag_path, "w"), indent=1)


if __name__ == "__main__":
    main(*sys.argv[1:5], sys.argv[5:])
