"""Tone-map each stage HDRI to a 2048x1024 sRGB JPEG for the visible sky dome (ACES fitted, exposure from the upper hemisphere)."""
import json, os, sys
import cv2, numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from selection import HDRIS

ROOT = os.path.join(os.path.dirname(__file__), "..")
KEY = 0.18  # middle grey the upper hemisphere's log-average luminance maps to

def aces(x):
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    return np.clip((x * (a * x + b)) / (x * (c * x + d) + e), 0, 1)

def srgb(x):
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)

out = {}
os.makedirs(f"{ROOT}/work/sky", exist_ok=True)
for stage, ph in HDRIS.items():
    hdr = cv2.imread(f"{ROOT}/raw/polyhaven/{ph}/{ph}_2k.hdr", cv2.IMREAD_UNCHANGED)
    if hdr is None:
        raise RuntimeError(f"cannot read {ph}")
    rgb = cv2.cvtColor(hdr, cv2.COLOR_BGR2RGB).astype(np.float32)
    rgb = cv2.resize(rgb, (2048, 1024), interpolation=cv2.INTER_AREA)
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    upper = lum[: lum.shape[0] // 2]
    logavg = float(np.exp(np.mean(np.log(upper + 1e-4))))
    exposure = KEY / logavg
    img = (srgb(aces(rgb * exposure)) * 255 + 0.5).astype(np.uint8)
    path = f"{ROOT}/work/sky/{stage}.jpg"
    Image.fromarray(img).save(path, quality=88, optimize=True, progressive=True)
    # sun: brightest direction of the blurred upper hemisphere (equirect, +Y up, u=0.5 at -Z)
    blur = cv2.GaussianBlur(lum[:512], (0, 0), 6)
    vy, vx = np.unravel_index(np.argmax(blur), blur.shape)
    phi = (vx + 0.5) / 2048 * 2 * np.pi - np.pi
    theta = (vy + 0.5) / 1024 * np.pi
    sun = [float(np.sin(theta) * np.sin(phi)), float(np.cos(theta)), float(-np.sin(theta) * np.cos(phi))]
    # sun removal: clamp the sun disc out of the IBL source (GGX prefiltering turns it into fireflies) and
    # return its energy as an analytic directional light (illuminance on a surface facing the sun)
    full = cv2.cvtColor(hdr, cv2.COLOR_BGR2RGB).astype(np.float32)
    fl = full @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    h2 = full.shape[0]
    sky_med = float(np.median(fl[: h2 // 2]))
    cap = max(40.0 * sky_med, float(np.percentile(fl[: h2 // 2], 99.5)))
    over = fl > cap
    if over.any():  # only a compact disc is a sun; scattered city lights stay in the IBL
        ys_, xs_ = np.nonzero(over)
        ph_ = (xs_ + 0.5) / full.shape[1] * 2 * np.pi - np.pi; t_ = (ys_ + 0.5) / full.shape[0] * np.pi
        dv_ = np.stack([np.sin(t_) * np.sin(ph_), np.cos(t_), -np.sin(t_) * np.cos(ph_)], 1)
        spread = np.degrees(np.arccos(np.clip(dv_ @ (dv_.mean(0) / np.linalg.norm(dv_.mean(0))), -1, 1))).max()
        if spread > 15:
            over[:] = False
    th = (np.arange(h2) + 0.5) / h2 * np.pi
    dom = (np.sin(th) * (np.pi / h2) * (2 * np.pi / full.shape[1]))[:, None]  # solid angle per texel
    scale = np.where(over, cap / np.maximum(fl, 1e-9), 1.0)[..., None]
    removed = full * (1 - scale)
    sun_rgb = (removed * dom[..., None]).reshape(-1, 3).sum(0)  # illuminance, sun-facing (removed region is tiny)
    clamped = full * scale
    os.makedirs(f"{ROOT}/work/hdr", exist_ok=True)
    cv2.imwrite(f"{ROOT}/work/hdr/{stage}.hdr", cv2.cvtColor(clamped, cv2.COLOR_RGB2BGR))
    if over.any():
        ys_, xs_ = np.nonzero(over)
        wts = fl[over]
        phi_s = ((xs_ + 0.5) / full.shape[1] * 2 * np.pi - np.pi); th_s = (ys_ + 0.5) / h2 * np.pi
        dv = np.stack([np.sin(th_s) * np.sin(phi_s), np.cos(th_s), -np.sin(th_s) * np.cos(phi_s)], 1)
        dv = (dv * wts[:, None]).sum(0); sun = (dv / np.linalg.norm(dv)).tolist()
    out[stage] = {"sun_illuminance_rgb": [float(x) for x in sun_rgb], "clamp": cap, "clamped_texels": int(over.sum()), "sun_dir_equirect": sun, "sun_peak_ratio": float(blur.max() / np.median(blur)), "polyhaven": ph, "exposure": exposure, "key": KEY, "tonemap": "aces-fitted", "jpeg_quality": 88}
    print(stage, ph, round(exposure, 4), os.path.getsize(path), flush=True)
json.dump(out, open(f"{ROOT}/work/sky/sky_ldr.json", "w"), indent=1)
