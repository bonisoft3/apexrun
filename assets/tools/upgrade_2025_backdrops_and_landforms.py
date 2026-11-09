"""Upgrade all 30 horizon backdrops (`backdrop/<stage>.{far,mid}`) and 12 landform GLBs
(`cliff-coast-a/b`, `mesa-a/b` lod0..2) into authentic 2025 Kazuo Oga gouache art.

Eliminates:
  - 1D vertical barcode stripes (`np.gradient(p)[None, :]` broadcast down columns)
  - Razor-sharp geometric `1 - d` sawtooth triangle cones on `mid` treelines
  - Sky-bleed haloes along silhouette edges
  - Unnatural mountain ranges on coastal / polder stages (`coconut-beach`, `destination-marina`, `tulip-gardens`)
"""
import hashlib
import io
import json
import os
import re
import struct
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = ROOT / "assets" / "manifest.json"
SEED_DIR = ROOT / ".seed-assets"

W, H = 2048, 512


def srgb(hexc: str) -> np.ndarray:
    return np.array([int(hexc[k : k + 2], 16) for k in (1, 3, 5)], dtype=np.float32)


def periodic1d(rng: np.random.Generator, n: int, scale: float) -> np.ndarray:
    f = np.fft.fftfreq(n)
    spec = np.fft.fft(rng.standard_normal(n)) * np.exp(-0.5 * (f * scale * 2.0 * np.pi) ** 2)
    a = np.real(np.fft.ifft(spec)).astype(np.float32)
    return (a - a.mean()) / (a.std() + 1e-6)


def periodic2d(rng: np.random.Generator, h: int, w: int, sy: float, sx: float) -> np.ndarray:
    """2D noise periodic in X (width w) and smooth in Y (height h)."""
    pad_y = 64
    hp = h + 2 * pad_y
    fy = np.fft.fftfreq(hp)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    env = np.exp(-0.5 * ((fy * sy * 2.0 * np.pi) ** 2 + (fx * sx * 2.0 * np.pi) ** 2))
    raw = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((hp, w))) * env)).astype(np.float32)
    out = raw[pad_y : pad_y + h, :]
    return (out - out.mean()) / (out.std() + 1e-6)


def gouache_impasto_canvas(rng: np.random.Generator, h: int, w: int) -> np.ndarray:
    """2D Kazuo Oga horizontal-biased gouache brushstroke & cold-press paper tooth."""
    b1 = periodic2d(rng, h, w, sy=5.5, sx=28.0)
    b2 = periodic2d(rng, h, w, sy=2.5, sx=11.0)
    tooth = periodic2d(rng, h, w, sy=1.4, sx=1.8)
    quant = np.round((0.55 * b1 + 0.35 * b2) * 4.5) / 4.5
    return (0.55 * quant + 0.30 * b1 + 0.15 * tooth).astype(np.float32)


def render_massif_layer(
    rng: np.random.Generator,
    peaks: list[tuple[float, float, float, float]],
    base_h: float,
    col_shadow: np.ndarray,
    col_mid: np.ndarray,
    col_sun: np.ndarray,
    col_snow: np.ndarray | None,
    col_foot: np.ndarray,
    sun_side: float = 1.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Render a 2D Kazuo Oga painted massif range where each peak has a 2D meandering ridge line
    separating its sunlit face from its shaded face, with painted 2D brushstrokes (zero 1D stripes!)."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    u = xx / W  # 0..1
    v = 1.0 - (yy + 0.5) / H  # 0 at bottom, 1 at top

    canvas = np.zeros((H, W, 3), dtype=np.float32)
    alpha = np.zeros((H, W), dtype=np.float32)

    brush = gouache_impasto_canvas(rng, H, W)
    warp_x = periodic2d(rng, H, W, sy=14.0, sx=22.0) * 0.012
    warp_y = periodic2d(rng, H, W, sy=12.0, sx=18.0) * 0.018

    # Base rolling piedmont
    piedmont_p = base_h * (1.0 + 0.22 * periodic1d(rng, W, 180) + 0.08 * periodic1d(rng, W, 45))
    piedmont_mask = np.clip((piedmont_p[None, :] - v) * H / 2.2, 0.0, 1.0)
    t_pied = np.clip(v / np.maximum(piedmont_p[None, :], 0.05), 0.0, 1.0)
    pied_col = col_foot[None, None, :] * (1.0 - t_pied[..., None]) + col_mid[None, None, :] * t_pied[..., None]
    pied_col *= 1.0 + 0.06 * brush[..., None]
    canvas = pied_col
    alpha = piedmont_mask.copy()

    # Paint individual overlapping 2D massifs back-to-front with smooth lateral feathering (zero wrap seams!)
    u_1d = np.arange(W, dtype=np.float32) / W
    r_n1 = periodic1d(rng, W, 65)
    r_n2 = periodic1d(rng, W, 22)
    for cx, width, height, asym in peaks:
        dx_1d = ((u_1d - cx + 0.5) % 1.0) - 0.5
        dx = ((u - cx + 0.5) % 1.0) - 0.5
        w_eff = width * (1.0 + 0.25 * asym * np.tanh(dx_1d / (width * 0.7)))
        norm_d = dx_1d / np.maximum(w_eff, 1e-4)
        # Multi-shoulder massif silhouette (main summit dome + two asymmetric subsidiary shoulders)
        sh_left = 0.68 * np.exp(-2.2 * ((norm_d + 0.58) ** 2))
        sh_right = 0.62 * np.exp(-2.4 * ((norm_d - 0.54) ** 2))
        main_dome = np.exp(-1.55 * (norm_d ** 2))
        envelope = np.maximum(main_dome, np.maximum(sh_left, sh_right))
        # Smoothly feather to 0 before |dx| reaches 0.45 so periodic wrap never creates a seam
        lat_feather = np.clip(1.0 - (np.abs(dx_1d) / np.minimum(width * 2.4, 0.44)) ** 2, 0.0, 1.0) ** 2
        ridge_mod = 1.0 + (0.055 * r_n1 + 0.020 * r_n2) * lat_feather
        prof = piedmont_p + (height - piedmont_p) * envelope * lat_feather * ridge_mod
        prof = np.clip(prof, 0.01, 0.96)

        m_mask = np.clip((prof[None, :] - v) * H / 2.2, 0.0, 1.0) * lat_feather[None, :]
        if m_mask.max() < 0.01:
            continue

        # 2D meandering ridge spine + secondary sub-ridge spurs
        rel_y = np.clip((prof[None, :] - v) / np.maximum(prof[None, :] - base_h * 0.35, 0.05), 0.0, 1.0)
        spine_curve = cx + asym * 0.22 * width * (rel_y ** 1.25) + warp_x * width * 3.8
        dx_spine = (((u - spine_curve + 0.5) % 1.0) - 0.5) / np.maximum(width * (0.28 + 0.72 * rel_y), 0.01)

        spur1 = np.sin(dx_spine * 3.4 + rel_y * 2.6 + warp_y * 7.5) * 0.38
        spur2 = np.cos(dx_spine * 6.2 - rel_y * 3.4 + brush * 1.1) * 0.22
        light_val = np.tanh((dx_spine * sun_side + spur1 + spur2) * 1.95) * 0.5 + 0.5
        light_plane = 0.62 * np.clip((light_val - 0.14) / 0.72, 0.0, 1.0) + 0.38 * np.round(light_val * 4.0) / 4.0

        body_col = (
            col_shadow[None, None, :] * (1.0 - light_plane[..., None])
            + col_sun[None, None, :] * light_plane[..., None]
        )
        flank_mix = np.clip(1.0 - rel_y * 1.12, 0.0, 1.0)
        body_col = body_col * (0.70 + 0.30 * flank_mix[..., None]) + col_mid[None, None, :] * (0.22 * (1.0 - flank_mix[..., None]))

        if col_snow is not None:
            snow_line = 0.38 + 0.20 * (1.0 - light_plane) + 0.14 * warp_y + 0.07 * np.abs(dx_spine)
            snow_mask = np.clip((flank_mix - snow_line) * 5.2, 0.0, 1.0) * np.clip((height - 0.30) * 4.0, 0.0, 1.0)
            snow_shade = col_snow * np.array([0.74, 0.81, 0.94], dtype=np.float32)
            snow_rgb = snow_shade[None, None, :] * (1.0 - light_plane[..., None]) + col_snow[None, None, :] * light_plane[..., None]
            body_col = body_col * (1.0 - snow_mask[..., None]) + snow_rgb * snow_mask[..., None]

        crest_rim = np.exp(-((prof[None, :] - v) * H / 5.5) ** 2) * (0.35 + 0.65 * light_plane)
        body_col += col_sun[None, None, :] * 0.20 * crest_rim[..., None]

        foot_blend = np.clip(1.0 - v / np.maximum(height * 0.52, 0.08), 0.0, 1.0) ** 1.6
        body_col = body_col * (1.0 - 0.58 * foot_blend[..., None]) + col_foot[None, None, :] * (0.58 * foot_blend[..., None])
        body_col *= 1.0 + 0.075 * brush[..., None]

        blend = m_mask[..., None]
        canvas = canvas * (1.0 - blend) + body_col * blend
        alpha = np.maximum(alpha, np.clip((prof[None, :] - v) * H / 2.2, 0.0, 1.0))

    return np.clip(canvas, 0.0, 255.0), np.clip(alpha, 0.0, 1.0)


def render_buttes_layer(
    rng: np.random.Generator,
    buttes: list[tuple[float, float, float, float]],
    base_h: float,
    col_shadow: np.ndarray,
    col_mid: np.ndarray,
    col_sun: np.ndarray,
    col_talus: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Monument-Valley / Ghibli gouache red-rock mesas & canyon buttes with 2D horizontal sedimentary
    strata bands, flared talus skirts, and 2D sunlit/shaded cliff facets (zero vertical barcode stripes)."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    u = xx / W
    v = 1.0 - (yy + 0.5) / H

    brush = gouache_impasto_canvas(rng, H, W)
    strata_warp = periodic2d(rng, H, W, sy=6.0, sx=45.0) * 0.015
    strata_v = v + strata_warp
    # Multi-frequency horizontal sedimentary rock strata
    strata = (
        0.50 * np.sin(strata_v * 58.0)
        + 0.30 * np.cos(strata_v * 115.0 + 1.4)
        + 0.20 * np.sin(strata_v * 28.0 - 0.8)
    )

    p_base = base_h * (1.0 + 0.18 * periodic1d(rng, W, 160) + 0.06 * periodic1d(rng, W, 45))
    alpha = np.clip((p_base[None, :] - v) * H / 2.2, 0.0, 1.0)
    canvas = col_talus[None, None, :] * (0.88 + 0.12 * (v / np.maximum(base_h, 0.05))[..., None]) * (1.0 + 0.06 * brush[..., None])

    u_1d = np.arange(W, dtype=np.float32) / W
    for cx, top_w, talus_w, height in buttes:
        dx_1d = ((u_1d - cx + 0.5) % 1.0) - 0.5
        dx = ((u - cx + 0.5) % 1.0) - 0.5
        adx = np.abs(dx_1d)
        # Flat plateau cap + steep cliff wall + flared concave talus apron
        cap_noise = 0.012 * periodic1d(rng, W, 32)
        excess = np.maximum(adx - top_w, 0.0) / np.maximum(talus_w, 0.01)
        cliff_prof = np.where(
            adx <= top_w,
            height + cap_noise,
            height * np.exp(-(excess ** 1.35) * 2.4) + cap_noise * 0.4,
        )
        cliff_prof = np.maximum(cliff_prof, p_base)
        lat_feather = np.clip(1.0 - (adx / np.minimum(top_w + talus_w * 2.8, 0.44)) ** 2, 0.0, 1.0) ** 2
        b_mask = np.clip((cliff_prof[None, :] - v) * H / 2.0, 0.0, 1.0) * lat_feather[None, :]

        # 2D cliff facet lighting (sun from right/front, with 2D rock buttress projections)
        buttress = periodic2d(rng, H, W, sy=18.0, sx=10.0) * 0.28
        face_light = np.clip(0.55 + 0.45 * np.tanh((dx / np.maximum(top_w, 0.01) + buttress) * 1.8), 0.0, 1.0)

        # Talus vs vertical cliff wall transition
        talus_h = height * 0.44 * (1.0 + 0.12 * periodic1d(rng, W, 40))[None, :]
        is_cliff = np.clip((v - talus_h) / np.maximum(height * 0.18, 0.03), 0.0, 1.0)

        rock_col = col_shadow[None, None, :] * (1.0 - face_light[..., None]) + col_sun[None, None, :] * face_light[..., None]
        rock_col *= 1.0 + 0.12 * strata[..., None] * (0.4 + 0.6 * is_cliff[..., None])
        talus_col = col_talus[None, None, :] * (0.78 + 0.34 * face_light[..., None]) * (1.0 + 0.05 * strata[..., None])

        body = talus_col * (1.0 - is_cliff[..., None]) + rock_col * is_cliff[..., None]
        # Warm rim on plateau cap edge
        cap_rim = np.exp(-((cliff_prof[None, :] - v) * H / 4.0) ** 2)
        body += col_sun[None, None, :] * 0.20 * cap_rim[..., None]
        body *= 1.0 + 0.07 * brush[..., None]

        canvas = canvas * (1.0 - b_mask[..., None]) + body * b_mask[..., None]
        alpha = np.maximum(alpha, np.clip((cliff_prof[None, :] - v) * H / 2.0, 0.0, 1.0))

    return np.clip(canvas, 0.0, 255.0), np.clip(alpha, 0.0, 1.0)


def render_foliage_canopy_layer(
    rng: np.random.Generator,
    h_base: float,
    h_max: float,
    crown_count: int,
    conifer_ratio: float,
    col_deep: np.ndarray,
    col_mid: np.ndarray,
    col_sun: np.ndarray,
    col_accent: np.ndarray | None = None,
    with_windmills: bool = False,
) -> tuple[np.ndarray, np.ndarray]:
    """Render a lush 2D Kazuo Oga painted foliage/hedgerow/forest backdrop (`mid` layer)
    built from overlapping multi-lobe billowy tree crowns and organic layered conifer boughs —
    NEVER raw `1 - d` geometric triangle spikes or 1D vertical stripes!"""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    u = xx / W
    v = 1.0 - (yy + 0.5) / H

    brush = gouache_impasto_canvas(rng, H, W)
    leaf_clusters1 = periodic2d(rng, H, W, sy=6.5, sx=14.0)
    leaf_clusters2 = periodic2d(rng, H, W, sy=3.2, sx=7.5)
    leaf_tex = 0.60 * leaf_clusters1 + 0.40 * leaf_clusters2

    # Rolling meadow/forest under-base
    p = h_base * (1.0 + 0.16 * periodic1d(rng, W, 220) + 0.06 * periodic1d(rng, W, 55))
    # Build 2D crown ownership map (cx, cy, rad_x, rad_y, is_conifer, shade_var)
    crowns = []
    for k in range(crown_count):
        cx = (k + rng.uniform(0.15, 0.85)) / crown_count
        is_con = rng.random() < conifer_ratio
        rx = rng.uniform(0.65, 1.35) / crown_count * (0.85 if is_con else 1.25)
        top_y = rng.uniform(h_base * 1.15, h_max)
        crowns.append((cx, rx, top_y, is_con, rng.uniform(-0.12, 0.14)))

    # Compute smooth organic silhouette profile
    u_1d = np.arange(W, dtype=np.float32) / W
    for cx, rx, top_y, is_con, _ in crowns:
        dx = ((u_1d - cx + 0.5) % 1.0) - 0.5
        nd = np.abs(dx) / np.maximum(rx, 1e-4)
        in_span = nd < 1.0
        s = np.clip(nd, 0.0, 1.0)
        if is_con:
            # Organic tiered bough crown (softly rounded tip + 4 scalloped bough tiers, NOT a sharp triangle!)
            tier_scallop = 0.08 * np.sin(s * np.pi * 5.0) * (1.0 - np.exp(-s * 4.0))
            shape = (1.0 - s ** 1.45) * np.sqrt(1.0 - 0.35 * s * s) + tier_scallop
        else:
            # Multi-lobe billowy Ghibli broadleaf/palm/cypress dome
            lobe = 0.07 * np.cos(dx / np.maximum(rx, 1e-4) * np.pi * 2.5)
            shape = np.sqrt(np.clip(1.0 - s * s, 0.0, 1.0)) + lobe * (1.0 - s)
        shape = np.clip(shape, 0.0, 1.08)
        crown_p = h_base * 0.55 + (top_y - h_base * 0.55) * shape
        p = np.where(in_span, np.maximum(p, crown_p), p)

    # Add gentle organic leaf-cluster scallops along the silhouette edge
    p += 0.008 * periodic1d(rng, W, 14) + 0.004 * periodic1d(rng, W, 5)
    p = np.clip(p, 0.02, 0.95)
    alpha = np.clip((p[None, :] - v) * H / 2.0, 0.0, 1.0)

    # 2D volumetric crown shading: sunlit top-right crown domes, deep cool-green under-bough hollows
    rel_v = np.clip(v / np.maximum(p[None, :], 0.04), 0.0, 1.0)
    # 2D cellular bough domes using sinusoidal 2D cells
    dome_x = np.sin(u * crown_count * np.pi * 1.5 + leaf_clusters1 * 0.9)
    dome_y = np.cos((1.0 - rel_v) * np.pi * 2.2 + leaf_clusters2 * 0.7)
    cluster_light = np.clip(0.50 * rel_v + 0.24 * dome_x + 0.22 * dome_y + 0.16 * leaf_tex, 0.0, 1.0)
    # Soft 3-step gouache foliage clusters
    b1 = np.clip((cluster_light - 0.25) / 0.30, 0.0, 1.0)
    b2 = np.clip((cluster_light - 0.58) / 0.28, 0.0, 1.0)
    canvas = (
        col_deep[None, None, :] * (1.0 - b1[..., None])
        + col_mid[None, None, :] * (b1[..., None] * (1.0 - b2[..., None]))
        + col_sun[None, None, :] * b2[..., None]
    )

    if col_accent is not None:
        acc_mask = np.clip((leaf_tex - 0.65) * 2.5, 0.0, 1.0) * np.clip((rel_v - 0.55) * 2.5, 0.0, 1.0)
        canvas = canvas * (1.0 - 0.45 * acc_mask[..., None]) + col_accent[None, None, :] * (0.45 * acc_mask[..., None])

    # Warm sunlit crown rim along the top 6 pixels of the canopy
    crown_rim = np.exp(-((p[None, :] - v) * H / 4.8) ** 2) * (0.45 + 0.55 * b1)
    canvas += col_sun[None, None, :] * 0.18 * crown_rim[..., None]
    canvas *= 1.0 + 0.07 * brush[..., None]

    if with_windmills:
        # Paint 6 Dutch smock windmills & lattice sails over the polder treeline
        for m_idx in range(6):
            mc = (m_idx + 0.45) / 6.0
            mh = h_max * rng.uniform(0.88, 1.05)
            dx_px = ((u - mc + 0.5) % 1.0 - 0.5) * W
            tower_top_y = (1.0 - mh) * H + 8.0
            tower_bot_y = (1.0 - h_base * 0.7) * H
            in_tower = (yy >= tower_top_y) & (yy <= tower_bot_y)
            t_prog = np.clip((yy - tower_top_y) / np.maximum(tower_bot_y - tower_top_y, 1.0), 0.0, 1.0)
            half_w = 5.5 + 6.5 * t_prog
            t_mask = np.clip((half_w - np.abs(dx_px)) / 1.5, 0.0, 1.0) * in_tower
            brick_col = np.where(dx_px[..., None] > 0, srgb("#9A6848"), srgb("#6E4832"))
            canvas = canvas * (1.0 - t_mask[..., None]) + brick_col * t_mask[..., None]
            alpha = np.maximum(alpha, t_mask)

            # 4 lattice sails
            turn = 0.32 + m_idx * 0.28
            dy_px = yy - (tower_top_y + 4.0)
            for k in range(4):
                ang = turn + k * (np.pi * 0.5)
                along = dx_px * np.cos(ang) + dy_px * np.sin(ang)
                across = -dx_px * np.sin(ang) + dy_px * np.cos(ang)
                arm_len = mh * H * 0.58
                in_arm = (along > 0.0) & (along < arm_len)
                spar = in_arm & (np.abs(across) < 1.6)
                sail = in_arm & (along > arm_len * 0.16) & (across > 0.0) & (across < 9.5)
                s_mask = np.maximum(spar.astype(np.float32), sail.astype(np.float32) * 0.92)
                sail_col = srgb("#F4ECE0") if k % 2 == 0 else srgb("#DDD2C0")
                canvas = canvas * (1.0 - s_mask[..., None]) + sail_col[None, None, :] * s_mask[..., None]
                alpha = np.maximum(alpha, s_mask)

    return np.clip(canvas, 0.0, 255.0), np.clip(alpha, 0.0, 1.0)


def render_coastal_archipelago_layer(
    rng: np.random.Generator,
    islands: list[tuple[float, float, float]],
    col_shadow: np.ndarray,
    col_mid: np.ndarray,
    col_sun: np.ndarray,
    col_beach: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """For coastal stages (`coconut-beach`, `destination-marina`):
    Instead of tall spiky mountains, paint low, tranquil tropical coral keys, palm-crowned lagoon
    atolls, and gentle coastal headlands separated by open ocean horizon channels!"""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    u = xx / W
    v = 1.0 - (yy + 0.5) / H

    brush = gouache_impasto_canvas(rng, H, W)
    canvas = np.zeros((H, W, 3), dtype=np.float32)
    alpha = np.zeros((H, W), dtype=np.float32)

    u_1d = np.arange(W, dtype=np.float32) / W
    for cx, width, height in islands:
        dx_1d = ((u_1d - cx + 0.5) % 1.0) - 0.5
        dx = ((u - cx + 0.5) % 1.0) - 0.5
        nd = np.abs(dx_1d) / width
        in_isl = nd < 1.0
        s = np.clip(nd, 0.0, 1.0)
        # Smooth flat-topped coral key / headland bluff + multi-lobe tropical canopy (never a pointed cone!)
        plateau = np.clip((1.0 - s ** 2.6), 0.0, 1.0) ** 1.4
        lobe_a = 0.78 * np.exp(-3.2 * ((dx_1d / width + 0.32) ** 2))
        lobe_b = 0.85 * np.exp(-2.8 * ((dx_1d / width - 0.22) ** 2))
        prof = height * (0.52 * plateau + 0.48 * np.maximum(lobe_a, lobe_b)) + 0.007 * periodic1d(rng, W, 24) * (1.0 - s)
        prof = np.where(in_isl, np.maximum(prof, 0.0), 0.0)

        i_mask = np.clip((prof[None, :] - v) * H / 2.2, 0.0, 1.0)
        if i_mask.max() < 0.01:
            continue

        rel_v = np.clip(v / np.maximum(prof[None, :], 0.02), 0.0, 1.0)
        light = np.clip(0.52 + 0.35 * np.tanh((-dx / (width * 0.45)) * 1.6) + 0.18 * brush, 0.0, 1.0)
        isl_col = col_shadow[None, None, :] * (1.0 - light[..., None]) + col_sun[None, None, :] * light[..., None]
        isl_col = isl_col * (0.65 + 0.35 * rel_v[..., None]) + col_mid[None, None, :] * (0.25 * (1.0 - rel_v[..., None]))
        # Golden coral sand beach strip along the water line (v < 0.028)
        beach_band = np.clip(1.0 - v / 0.028, 0.0, 1.0) ** 1.5
        isl_col = isl_col * (1.0 - 0.65 * beach_band[..., None]) + col_beach[None, None, :] * (0.65 * beach_band[..., None])
        isl_col *= 1.0 + 0.07 * brush[..., None]

        canvas = canvas * (1.0 - i_mask[..., None]) + isl_col * i_mask[..., None]
        alpha = np.maximum(alpha, i_mask)

    return np.clip(canvas, 0.0, 255.0), np.clip(alpha, 0.0, 1.0)


def render_skyline_layer(
    rng: np.random.Generator,
    h_max: float,
    col_dark: np.ndarray,
    col_top: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Night city skyline with stepped modern architectural towers and warm/cyan lit window grids."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    v = 1.0 - (yy + 0.5) / H

    p = np.full(W, 0.08 * h_max, dtype=np.float32)
    tower_id = np.zeros(W, dtype=np.int32)
    tower_c = np.zeros(W, dtype=np.float32)
    i = 0
    tid = 1
    while i < W:
        tw = int(rng.integers(24, 68))
        th = float(rng.uniform(0.28, 1.0) * h_max)
        end = min(W, i + tw)
        p[i:end] = np.maximum(p[i:end], th)
        tower_id[i:end] = tid
        tower_c[i:end] = np.linspace(-1.0, 1.0, end - i)
        # Optional stepped setback spire on tall towers
        if th > 0.65 * h_max and tw > 36:
            inset_w = tw // 4
            p[i + inset_w : end - inset_w] = min(0.96, th * 1.16)
        i += tw + int(rng.integers(2, 14))
        tid += 1

    alpha = np.clip((p[None, :] - v) * H / 1.8, 0.0, 1.0)
    rel_y = np.clip(v / np.maximum(h_max, 0.1), 0.0, 1.0)
    canvas = col_dark[None, None, :] * (1.0 - rel_y[..., None]) + col_top[None, None, :] * rel_y[..., None]
    # Tower side shading
    side_shade = 0.88 + 0.20 * (tower_c[None, :] > 0.15).astype(np.float32)
    canvas *= side_shade[..., None]

    # Glowing window grid inside towers
    gx = (xx % 7.0) / 7.0
    gy = (yy % 9.0) / 9.0
    in_pane = (gx > 0.22) & (gx < 0.78) & (gy > 0.22) & (gy < 0.80) & (np.abs(tower_c[None, :]) < 0.86)
    cell_hash = np.sin((xx // 7) * 12.9898 + (yy // 9) * 78.233 + tower_id[None, :] * 3.1) * 43758.5453
    cell_hash = cell_hash - np.floor(cell_hash)
    lit_win = in_pane & (cell_hash < 0.34) & (v < p[None, :] - 0.015)
    warm_win = srgb("#FFBE64")
    cyan_win = srgb("#78C8FF")
    win_col = np.where((cell_hash < 0.24)[..., None], warm_win[None, None, :], cyan_win[None, None, :])
    canvas = np.where(lit_win[..., None], canvas * 0.25 + win_col * 0.85, canvas)

    return np.clip(canvas, 0.0, 255.0), np.clip(alpha, 0.0, 1.0)


def build_stage_backdrop(stage: str, layer: str, horizon_rgb: np.ndarray) -> Image.Image:
    seed = (sum(map(ord, f"{stage}:{layer}:2025")) * 37) % 100000
    rng = np.random.default_rng(seed)

    if stage in ("coconut-beach", "destination-marina"):
        if layer == "far":
            # Low tropical coral islands & distant headlands with open sea horizon gaps (NO mountains!)
            islands = [
                (0.14, 0.11, 0.16),
                (0.36, 0.07, 0.11),
                (0.64, 0.13, 0.20),
                (0.87, 0.09, 0.14),
            ]
            rgb, alpha = render_coastal_archipelago_layer(
                rng,
                islands,
                col_shadow=srgb("#3D646E"),
                col_mid=srgb("#58867A"),
                col_sun=srgb("#8EB892"),
                col_beach=srgb("#E2C696"),
            )
            haze = 0.42
        else:
            rgb, alpha = render_foliage_canopy_layer(
                rng,
                h_base=0.14,
                h_max=0.31 if stage == "coconut-beach" else 0.24,
                crown_count=32,
                conifer_ratio=0.0,
                col_deep=srgb("#1B4734"),
                col_mid=srgb("#2F6E42"),
                col_sun=srgb("#6CA850"),
                col_accent=srgb("#94C45A"),
            )
            haze = 0.18
    elif stage in ("tulip-gardens", "destination-aerodrome"):
        if layer == "far":
            # Flat Dutch polder meadow with low distant hedgerow berms (NO mountains!)
            peaks = [
                (0.18, 0.18, 0.13, 0.2),
                (0.52, 0.22, 0.14, -0.15),
                (0.84, 0.19, 0.12, 0.1),
            ]
            rgb, alpha = render_massif_layer(
                rng,
                peaks,
                base_h=0.08,
                col_shadow=srgb("#547268"),
                col_mid=srgb("#6E8E72"),
                col_sun=srgb("#9EB88C"),
                col_snow=None,
                col_foot=srgb("#7E9A84"),
            )
            haze = 0.46
        else:
            rgb, alpha = render_foliage_canopy_layer(
                rng,
                h_base=0.15,
                h_max=0.34 if stage == "tulip-gardens" else 0.24,
                crown_count=36,
                conifer_ratio=0.12,
                col_deep=srgb("#2A4C32"),
                col_mid=srgb("#46723E"),
                col_sun=srgb("#7AA252"),
                with_windmills=(stage == "tulip-gardens"),
            )
            haze = 0.20
    elif stage in ("desert-canyons", "sunset-highway"):
        if layer == "far":
            buttes = [
                (0.10, 0.055, 0.045, 0.44),
                (0.28, 0.038, 0.035, 0.36),
                (0.49, 0.072, 0.052, 0.48),
                (0.71, 0.048, 0.040, 0.40),
                (0.89, 0.060, 0.045, 0.43),
            ]
            rgb, alpha = render_buttes_layer(
                rng,
                buttes,
                base_h=0.11,
                col_shadow=srgb("#7C3A48") if stage == "sunset-highway" else srgb("#8E4238"),
                col_mid=srgb("#B45A42"),
                col_sun=srgb("#E4925C"),
                col_talus=srgb("#C4744E"),
            )
            haze = 0.42
        else:
            buttes = [
                (0.18, 0.048, 0.042, 0.32),
                (0.42, 0.062, 0.048, 0.35),
                (0.66, 0.044, 0.038, 0.29),
                (0.86, 0.052, 0.044, 0.33),
            ]
            rgb, alpha = render_buttes_layer(
                rng,
                buttes,
                base_h=0.09,
                col_shadow=srgb("#6E323A") if stage == "sunset-highway" else srgb("#7E382C"),
                col_mid=srgb("#A64C34"),
                col_sun=srgb("#D8824E"),
                col_talus=srgb("#B46642"),
            )
            haze = 0.20
    elif stage == "destination-oasis":
        if layer == "far":
            # Sweeping Sahara erg sand dunes with crisp sunlit/shaded slip faces
            peaks = [
                (0.12, 0.16, 0.28, 0.42),
                (0.38, 0.18, 0.32, -0.38),
                (0.66, 0.17, 0.30, 0.45),
                (0.90, 0.15, 0.26, -0.35),
            ]
            rgb, alpha = render_massif_layer(
                rng,
                peaks,
                base_h=0.12,
                col_shadow=srgb("#9E6E4E"),
                col_mid=srgb("#C49462"),
                col_sun=srgb("#ECC48A"),
                col_snow=None,
                col_foot=srgb("#D4A876"),
            )
            haze = 0.38
        else:
            rgb, alpha = render_foliage_canopy_layer(
                rng,
                h_base=0.14,
                h_max=0.30,
                crown_count=26,
                conifer_ratio=0.0,
                col_deep=srgb("#284E2C"),
                col_mid=srgb("#427236"),
                col_sun=srgb("#78A446"),
                col_accent=srgb("#B89852"),
            )
            haze = 0.18
    elif stage == "alpine-peaks":
        if layer == "far":
            peaks = [
                (0.09, 0.13, 0.64, 0.28),
                (0.24, 0.11, 0.52, -0.22),
                (0.44, 0.16, 0.74, 0.32),
                (0.63, 0.12, 0.58, -0.26),
                (0.83, 0.15, 0.68, 0.25),
            ]
            rgb, alpha = render_massif_layer(
                rng,
                peaks,
                base_h=0.22,
                col_shadow=srgb("#586C94"),
                col_mid=srgb("#7A8EB0"),
                col_sun=srgb("#C8D6E8"),
                col_snow=srgb("#F6F8FC"),
                col_foot=srgb("#6C829E"),
            )
            haze = 0.36
        else:
            rgb, alpha = render_foliage_canopy_layer(
                rng,
                h_base=0.18,
                h_max=0.42,
                crown_count=48,
                conifer_ratio=0.82,
                col_deep=srgb("#183228"),
                col_mid=srgb("#2A503C"),
                col_sun=srgb("#4E7A58"),
                col_accent=srgb("#DCE8F0"),
            )
            haze = 0.18
    elif stage == "coastal-cliffs":
        if layer == "far":
            peaks = [
                (0.15, 0.14, 0.42, -0.35),
                (0.45, 0.16, 0.46, 0.38),
                (0.78, 0.15, 0.40, -0.32),
            ]
            rgb, alpha = render_massif_layer(
                rng,
                peaks,
                base_h=0.12,
                col_shadow=srgb("#4A6064"),
                col_mid=srgb("#687E78"),
                col_sun=srgb("#9EB09E"),
                col_snow=None,
                col_foot=srgb("#5E7474"),
            )
            haze = 0.42
        else:
            peaks = [
                (0.22, 0.16, 0.28, 0.25),
                (0.56, 0.18, 0.31, -0.28),
                (0.88, 0.15, 0.26, 0.22),
            ]
            rgb, alpha = render_massif_layer(
                rng,
                peaks,
                base_h=0.12,
                col_shadow=srgb("#325434"),
                col_mid=srgb("#4A743E"),
                col_sun=srgb("#78A252"),
                col_snow=None,
                col_foot=srgb("#42643A"),
            )
            haze = 0.20
    elif stage == "metropolis-night":
        rgb, alpha = render_skyline_layer(
            rng,
            h_max=0.66 if layer == "far" else 0.44,
            col_dark=srgb("#121426") if layer == "far" else srgb("#181A30"),
            col_top=srgb("#2A2E52") if layer == "far" else srgb("#343860"),
        )
        haze = 0.32 if layer == "far" else 0.15
    else:
        # `gateway-pass`, `wilderness-run`, `ancient-ruins`, `destination-castle`, `destination-colosseum`
        if layer == "far":
            peaks = [
                (0.11, 0.14, 0.46, 0.24),
                (0.32, 0.15, 0.38, -0.20),
                (0.54, 0.16, 0.50, 0.28),
                (0.76, 0.14, 0.42, -0.25),
                (0.93, 0.12, 0.36, 0.18),
            ]
            rgb, alpha = render_massif_layer(
                rng,
                peaks,
                base_h=0.18,
                col_shadow=srgb("#4E6682"),
                col_mid=srgb("#6C8498"),
                col_sun=srgb("#9EB4B8"),
                col_snow=None,
                col_foot=srgb("#627A8C"),
            )
            haze = 0.44
        else:
            conifer_ratio = 0.65 if stage == "wilderness-run" else 0.35
            rgb, alpha = render_foliage_canopy_layer(
                rng,
                h_base=0.16,
                h_max=0.35,
                crown_count=42,
                conifer_ratio=conifer_ratio,
                col_deep=srgb("#1E3E28"),
                col_mid=srgb("#366236"),
                col_sun=srgb("#649248"),
                col_accent=srgb("#88AC58"),
            )
            haze = 0.20

    # Aerial perspective blend toward stage horizon color, with zero unfeathered sky halo
    yy = np.arange(H, dtype=np.float32)[:, None, None] / H
    aerial = haze * (0.65 + 0.35 * yy)
    rgb = rgb * (1.0 - aerial) + horizon_rgb[None, None, :] * aerial

    out_rgba = np.zeros((H, W, 4), dtype=np.uint8)
    out_rgba[:, :, :3] = np.clip(np.round(rgb), 0, 255).astype(np.uint8)
    out_rgba[:, :, 3] = np.clip(np.round(alpha * 255.0), 0, 255).astype(np.uint8)
    return Image.fromarray(out_rgba, mode="RGBA")


def build_landform_gouache_atlas(model_name: str, sz: int = 1024) -> tuple[bytes, bytes]:
    """Generate a rich 1024x1024 Kazuo Oga gouache texture + tangent-space impasto normal map
    for `cliff-coast-a/b` (limestone sea cliff + lush grassy turf cap) and `mesa-a/b` (stratified red sandstone)."""
    seed = sum(map(ord, model_name)) * 73
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:sz, 0:sz].astype(np.float32) / sz

    f1 = periodic2d(rng, sz, sz, sy=8.0, sx=8.0)
    f2 = periodic2d(rng, sz, sz, sy=22.0, sx=22.0)
    f3 = periodic2d(rng, sz, sz, sy=48.0, sx=48.0)
    strata = np.sin(yy * 38.0 + f1 * 1.4) * 0.55 + np.cos(yy * 82.0 - f2 * 0.8) * 0.45

    if "mesa" in model_name:
        c_shadow = srgb("#843626")
        c_mid = srgb("#B85234")
        c_light = srgb("#DF8652")
        c_ochre = srgb("#E8A868")
        t = np.clip(0.5 + 0.28 * strata + 0.22 * f1 + 0.12 * f2, 0.0, 1.0)
        q = 0.65 * t + 0.35 * (np.round(t * 4.0) / 4.0)
        rgb = (
            c_shadow[None, None, :] * np.clip(1.0 - q * 2.0, 0.0, 1.0)[..., None]
            + c_mid[None, None, :] * np.clip(1.0 - np.abs(q - 0.5) * 2.2, 0.0, 1.0)[..., None]
            + c_light[None, None, :] * np.clip((q - 0.45) * 1.8, 0.0, 1.0)[..., None]
        )
        vein = np.clip((strata - 0.45) * 2.5, 0.0, 1.0)
        rgb = rgb * (1.0 - 0.35 * vein[..., None]) + c_ochre[None, None, :] * (0.35 * vein[..., None])
    else:
        # Coastal cliff: warm weathered coastal limestone strata + emerald-moss crevices
        c_shadow = srgb("#585A54")
        c_mid = srgb("#8A8678")
        c_light = srgb("#C4BCA6")
        c_moss = srgb("#48723E")
        t = np.clip(0.5 + 0.26 * strata + 0.24 * f1 + 0.14 * f2, 0.0, 1.0)
        q = 0.65 * t + 0.35 * (np.round(t * 4.0) / 4.0)
        rgb = (
            c_shadow[None, None, :] * np.clip(1.0 - q * 1.8, 0.0, 1.0)[..., None]
            + c_mid[None, None, :] * np.clip(1.0 - np.abs(q - 0.5) * 2.0, 0.0, 1.0)[..., None]
            + c_light[None, None, :] * np.clip((q - 0.45) * 1.8, 0.0, 1.0)[..., None]
        )
        moss_mask = np.clip((f1 + 0.5 * f2 - 0.35) * 1.8, 0.0, 1.0)
        rgb = rgb * (1.0 - 0.42 * moss_mask[..., None]) + c_moss[None, None, :] * (0.42 * moss_mask[..., None])

    rgb *= 1.0 + 0.06 * f3[..., None]
    albedo_im = Image.fromarray(np.clip(np.round(rgb), 0, 255).astype(np.uint8), mode="RGB")

    # Tangent-space normal map from height field
    h_field = 0.45 * strata + 0.35 * f2 + 0.20 * f3
    dy, dx = np.gradient(h_field)
    nx = -dx * 6.5
    ny = -dy * 6.5
    nz = np.ones_like(nx)
    nlen = np.sqrt(nx * nx + ny * ny + nz * nz)
    norm_rgb = np.stack([(nx / nlen * 0.5 + 0.5) * 255.0, (ny / nlen * 0.5 + 0.5) * 255.0, (nz / nlen * 0.5 + 0.5) * 255.0], axis=-1)
    norm_im = Image.fromarray(np.clip(np.round(norm_rgb), 0, 255).astype(np.uint8), mode="RGB")

    b_alb = io.BytesIO()
    albedo_im.save(b_alb, format="WEBP", quality=90, method=6)
    b_nrm = io.BytesIO()
    norm_im.save(b_nrm, format="WEBP", quality=88, method=6)
    return b_alb.getvalue(), b_nrm.getvalue()


def upgrade_landform_glb(glb_bytes: bytes, albedo_webp: bytes, norm_webp: bytes) -> bytes:
    jlen = struct.unpack_from("<I", glb_bytes, 12)[0]
    g = json.loads(glb_bytes[20 : 20 + jlen])
    bdata = bytearray(glb_bytes[28 + jlen :])

    # Replace images 0 (albedo) and 1 (normal) in the binary buffer
    new_blobs = [albedo_webp, norm_webp]
    for idx, blob in enumerate(new_blobs):
        if idx < len(g.get("images", [])):
            bv_idx = g["images"][idx]["bufferView"]
            while len(bdata) % 4 != 0:
                bdata.append(0)
            offset = len(bdata)
            bdata.extend(blob)
            g["bufferViews"][bv_idx]["byteOffset"] = offset
            g["bufferViews"][bv_idx]["byteLength"] = len(blob)

    g["buffers"][0]["byteLength"] = len(bdata)
    new_json = json.dumps(g, separators=(",", ":")).encode("utf-8")
    while len(new_json) % 4 != 0:
        new_json += b" "
    while len(bdata) % 4 != 0:
        bdata.append(0)

    total_len = 12 + 8 + len(new_json) + 8 + len(bdata)
    out = bytearray()
    out.extend(struct.pack("<III", 0x46546C67, 2, total_len))
    out.extend(struct.pack("<II", len(new_json), 0x4E4F534A))
    out.extend(new_json)
    out.extend(struct.pack("<II", len(bdata), 0x004E4942))
    out.extend(bdata)
    return bytes(out)


def main():
    manifest = json.loads(MANIFEST_PATH.read_text())

    sky_map = {
        "coconut-beach": "coconut-beach",
        "desert-canyons": "desert-canyons",
        "gateway-pass": "gateway-pass",
        "alpine-peaks": "alpine-peaks",
        "wilderness-run": "wilderness-run",
        "tulip-gardens": "tulip-gardens",
        "sunset-highway": "sunset-highway",
        "ancient-ruins": "ancient-ruins",
        "metropolis-night": "metropolis-night",
        "coastal-cliffs": "coconut-beach",
        "destination-marina": "coconut-beach",
        "destination-oasis": "desert-canyons",
        "destination-castle": "wilderness-run",
        "destination-colosseum": "ancient-ruins",
        "destination-aerodrome": "tulip-gardens",
    }

    updated_files = []

    # 1. Upgrade all 30 stage horizon backdrops
    for stage, sky_name in sky_map.items():
        horizon_srgb = np.array(manifest[f"sky/{sky_name}.paint.jpg"]["horizon_srgb"], dtype=np.float32) * 255.0
        for layer in ("far", "mid"):
            key = f"backdrop/{stage}.{layer}"
            img = build_stage_backdrop(stage, layer, horizon_srgb)
            buf = io.BytesIO()
            img.save(buf, format="WEBP", quality=90, method=6)
            webp_bytes = buf.getvalue()
            new_hash = hashlib.sha256(webp_bytes).hexdigest()
            new_file = f"{new_hash}.webp"

            (SEED_DIR / new_file).write_bytes(webp_bytes)
            manifest[key]["file"] = new_file
            manifest[key]["sha256"] = new_hash
            manifest[key]["bytes"] = len(webp_bytes)
            updated_files.append(new_file)
            print(f"Upgraded {key:32s} -> {new_file} ({len(webp_bytes)} bytes)")

    # 2. Upgrade `cliff-coast-a/b` and `mesa-a/b` (lod0..2)
    for model_name in ("cliff-coast-a", "cliff-coast-b", "mesa-a", "mesa-b"):
        alb_webp, nrm_webp = build_landform_gouache_atlas(model_name, sz=1024)
        for lod in (0, 1, 2):
            key = f"model/{model_name}/lod{lod}"
            old_file = manifest[key]["file"]
            raw_glb = (SEED_DIR / old_file).read_bytes()
            new_glb = upgrade_landform_glb(raw_glb, alb_webp, nrm_webp)
            new_hash = hashlib.sha256(new_glb).hexdigest()
            new_file = f"{new_hash}.glb"
            (SEED_DIR / new_file).write_bytes(new_glb)
            manifest[key]["file"] = new_file
            manifest[key]["sha256"] = new_hash
            manifest[key]["bytes"] = len(new_glb)
            updated_files.append(new_file)
            print(f"Upgraded {key:32s} -> {new_file} ({len(new_glb)} bytes)")

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(f"Done! Updated {len(updated_files)} assets in manifest.json.")


if __name__ == "__main__":
    main()
