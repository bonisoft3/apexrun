"""2025 upgrade for ApexRun rocks, bushes, and conifers:
1. Upgrades all 18 rock models (rock-granite-a..e, rock-lime-a..d, rock-sand-a..f, rock-desert-a..c, lod0/1/2 = 54 GLBs)
   with 3D chiseled fracture/strata normal relief, multi-bounce cavity + ground contact COLOR_0 AO,
   and embedded 1024x1024 Kazuo Oga gouache mineral/lichen/sandstone textures + impasto normal maps.
   Preserves exact bounds_m and set metadata in manifest.json.
2. Upgrades shrub-b, shrub-tropical, shrub-desert, tree-fir-a, tree-fir-b, tree-pine-young (lod0/1/2 = 18 GLBs)
   by sculpting 3D cellular leaf-cluster / conifer-bough relief, eliminating the Canny diamond wireframe
   artifacts on the baked atlas, painting crisp multi-tone Kazuo Oga gouache leaf/needle clusters + normal map,
   and computing deep canopy interior self-occlusion COLOR_0 AO while keeping exact bounds_m.
"""
import hashlib, io, json, math, os, struct, sys
import cv2
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
import pygltflib
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "cartoon", "flagman"))
import gltf_io
import upgrade_2025_assets as u25

APEX_DIR = os.path.abspath(os.path.join(HERE, "..", ".."))
MANIFEST_PATH = os.path.join(APEX_DIR, "assets", "manifest.json")
SEED_DIR = os.path.join(APEX_DIR, ".seed-assets")
WORK_DIR = os.path.join(HERE, "cartoon", "work")


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def store_blob(data: bytes, ext: str) -> tuple[str, str, int]:
    h = sha256_bytes(data)
    fname = f"{h}.{ext.lstrip('.')}"
    out_path = os.path.join(SEED_DIR, fname)
    with open(out_path, "wb") as f:
        f.write(data)
    return fname, h, len(data)


def height_to_normal_jpg(luma01: np.ndarray, strength: float = 2.8) -> bytes:
    """Converts a [0, 1] height/luma field into a tangent-space normal map JPEG."""
    gx = cv2.Sobel(luma01.astype(np.float32), cv2.CV_32F, 1, 0, ksize=3) * strength
    gy = cv2.Sobel(luma01.astype(np.float32), cv2.CV_32F, 0, 1, ksize=3) * strength
    nz = np.ones_like(luma01, dtype=np.float32)
    norm = np.sqrt(gx * gx + gy * gy + nz * nz) + 1e-8
    nx = (-gx / norm) * 0.5 + 0.5
    ny = (-gy / norm) * 0.5 + 0.5
    nz = (nz / norm) * 0.5 + 0.5
    rgb = np.clip(np.stack([nx, ny, nz], axis=-1) * 255.0, 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(rgb, mode="RGB").save(buf, format="JPEG", quality=88)
    return buf.getvalue()


def make_gouache_rock_textures(rock_family: str, seed: int = 101) -> tuple[bytes, bytes]:
    """Generates a 1024x1024 Kazuo Oga gouache rock albedo JPEG and matching normal map JPEG.
    Top half (v in [0.0, 0.5]): primary rock face with chiseled cleavage fractures, strata & mineral flecks.
    Bottom half (v in [0.5, 1.0]): secondary material (moss/lichen cap for granite, warm ochre vein for sandstone/limestone).
    """
    W, H = 1024, 1024
    rng = np.random.default_rng(seed)

    def fbm2d(freq_x: int, freq_y: int) -> np.ndarray:
        grid = rng.uniform(0.0, 1.0, (freq_y, freq_x)).astype(np.float32)
        im = Image.fromarray((grid * 255.0).astype(np.uint8), mode="L").resize((W, H), Image.Resampling.BICUBIC)
        return np.asarray(im, dtype=np.float32) / 255.0

    n_coarse = fbm2d(16, 16)
    n_med = fbm2d(48, 48)
    n_fine = fbm2d(160, 160)
    n_micro = fbm2d(384, 384)

    y_g, x_g = np.meshgrid(np.linspace(0, 1, H, endpoint=False), np.linspace(0, 1, W, endpoint=False), indexing="ij")

    # Angular Voronoi-like rock fracture lines & chiseled facets
    f1 = np.abs(np.sin((x_g * 5.0 + y_g * 2.5 + 0.35 * n_coarse) * math.pi * 2.0))
    f2 = np.abs(np.cos((x_g * 3.0 - y_g * 6.0 + 0.40 * n_med) * math.pi * 2.0))
    crevice = np.exp(-((np.minimum(f1, f2)) ** 2) / 0.008)  # 1 at sharp crack
    facet_step = np.round((0.55 * n_coarse + 0.45 * n_med) * 5.0) / 5.0

    # Horizontal sedimentary strata for sandstone / limestone
    strata_wave = np.sin((y_g * 28.0 + 0.25 * n_coarse + 0.10 * n_med) * math.pi * 2.0)
    strata_ledge = np.tanh(strata_wave * 2.4) * 0.5 + 0.5

    if rock_family == "granite":
        # Cool blue-slate & warm sunlit quartz-grey gouache granite + chartreuse-olive moss/lichen cap
        c_dark = np.array([0.28, 0.33, 0.40], dtype=np.float32)
        c_mid = np.array([0.48, 0.53, 0.59], dtype=np.float32)
        c_lit = np.array([0.74, 0.75, 0.72], dtype=np.float32)
        # Moss/lichen palette for bottom half
        m_dark = np.array([0.26, 0.36, 0.20], dtype=np.float32)
        m_mid = np.array([0.46, 0.56, 0.29], dtype=np.float32)
        m_lit = np.array([0.68, 0.73, 0.38], dtype=np.float32)
        relief = 0.45 * facet_step + 0.30 * n_med + 0.15 * n_fine + 0.10 * n_micro - 0.38 * crevice
    elif rock_family == "limestone":
        # Warm Mediterranean cream/travertine/ochre Karst limestone with cool lavender-grey crevices
        c_dark = np.array([0.48, 0.44, 0.39], dtype=np.float32)
        c_mid = np.array([0.76, 0.69, 0.55], dtype=np.float32)
        c_lit = np.array([0.93, 0.87, 0.74], dtype=np.float32)
        m_dark = np.array([0.52, 0.47, 0.38], dtype=np.float32)
        m_mid = np.array([0.80, 0.73, 0.58], dtype=np.float32)
        m_lit = np.array([0.95, 0.90, 0.78], dtype=np.float32)
        relief = 0.38 * strata_ledge + 0.32 * facet_step + 0.20 * n_fine + 0.10 * n_micro - 0.35 * crevice
    else:
        # Terracotta / vermilion-ochre Colorado plateau sandstone with golden-cream sedimentary bands
        c_dark = np.array([0.46, 0.18, 0.11], dtype=np.float32)
        c_mid = np.array([0.74, 0.33, 0.18], dtype=np.float32)
        c_lit = np.array([0.91, 0.54, 0.30], dtype=np.float32)
        m_dark = np.array([0.62, 0.38, 0.20], dtype=np.float32)
        m_mid = np.array([0.86, 0.61, 0.36], dtype=np.float32)
        m_lit = np.array([0.96, 0.77, 0.50], dtype=np.float32)
        relief = 0.50 * strata_ledge + 0.25 * facet_step + 0.15 * n_fine + 0.10 * n_micro - 0.32 * crevice

    relief = np.clip(relief, 0.0, 1.0)
    t_low = np.clip(relief * 2.0, 0.0, 1.0)[..., None]
    t_high = np.clip((relief - 0.5) * 2.0, 0.0, 1.0)[..., None]

    top_rgb = c_dark * (1.0 - t_low) + c_mid * t_low
    top_rgb = top_rgb * (1.0 - t_high) + c_lit * t_high

    bot_rgb = m_dark * (1.0 - t_low) + m_mid * t_low
    bot_rgb = bot_rgb * (1.0 - t_high) + m_lit * t_high

    # Split top half (v < 0.5) = primary stone, bottom half (v >= 0.5) = lichen/band
    mask_bot = (y_g >= 0.5)[..., None].astype(np.float32)
    rgb = top_rgb * (1.0 - mask_bot) + bot_rgb * mask_bot

    # Add crisp gouache dry-brush mineral flecks
    fleck = (n_micro - 0.5) * 0.08
    rgb = np.clip((rgb + fleck[..., None]) * 255.0, 0, 255).astype(np.uint8)
    im = Image.fromarray(rgb, mode="RGB").filter(ImageFilter.UnsharpMask(radius=1.5, percent=135, threshold=2))
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=92)
    return buf.getvalue(), height_to_normal_jpg(relief, strength=3.2)


def compute_rock_uvs(pos: np.ndarray, nor: np.ndarray, lo: np.ndarray, hi: np.ndarray, is_secondary: bool) -> np.ndarray:
    """Computes seamless triplanar/cylindrical UVs mapped into the top half [0.04, 0.46]
    or bottom half [0.54, 0.96] of the rock texture atlas."""
    span = np.maximum(hi - lo, 0.25)
    # Triplanar dominant axis projection for distortion-free rock facets
    an = np.abs(nor)
    dom_x = (an[:, 0] >= an[:, 1]) & (an[:, 0] >= an[:, 2])
    dom_y = (an[:, 1] > an[:, 0]) & (an[:, 1] >= an[:, 2])

    u_zy = (pos[:, 2] - lo[2]) / span[2]
    v_zy = (pos[:, 1] - lo[1]) / span[1]

    u_xz = (pos[:, 0] - lo[0]) / span[0]
    v_xz = (pos[:, 2] - lo[2]) / span[2]

    u_xy = (pos[:, 0] - lo[0]) / span[0]
    v_xy = (pos[:, 1] - lo[1]) / span[1]

    u = np.where(dom_x, u_zy, np.where(dom_y, u_xz, u_xy))
    v = np.where(dom_x, v_zy, np.where(dom_y, v_xz, v_xy))

    u = np.mod(u, 1.0) * 0.88 + 0.06
    v_local = np.mod(v, 1.0) * 0.40 + 0.05
    if is_secondary:
        v_local += 0.50
    return np.stack([u, v_local], axis=1).astype(np.float32)


def upgrade_rock_glb(key: str, orig_glb_path: str, tex_pair: tuple[bytes, bytes]) -> tuple[bytes, int]:
    """Upgrades a rock GLB with chiseled facet normals, deep ground/crevice COLOR_0 AO,
    and embedded gouache rock texture + normal map while keeping exact vertex positions (bounds_m)."""
    meshes, materials, _ = u25.load_raw_glb_meshes(orig_glb_path)
    albedo_jpg, normal_jpg = tex_pair
    images = [(albedo_jpg, "image/jpeg"), (normal_jpg, "image/jpeg")]

    all_pts = []
    for m in meshes:
        tr = np.asarray(m[2], dtype=np.float32) if len(m) > 2 else np.zeros(3, dtype=np.float32)
        for p in m[1]:
            all_pts.append(p.pos + tr[None, :])
    V_all = np.vstack(all_pts)
    lo, hi = V_all.min(0), V_all.max(0)
    height = max(float(hi[1] - lo[1]), 0.25)
    tree = cKDTree(V_all)

    for mi, m in enumerate(materials):
        pbr = m.setdefault("pbrMetallicRoughness", {})
        pbr["baseColorFactor"] = [1.0, 1.0, 1.0, 1.0]
        pbr["roughnessFactor"] = 0.86
        pbr["metallicFactor"] = 0.0
        pbr["baseColorTexture"] = {"image": 0}
        m["normalTexture"] = {"image": 1, "scale": 0.85}
        m["extras"] = {"painted": True}

    r_short = 0.12 * height
    r_mid = 0.28 * height
    for m in meshes:
        tr = np.asarray(m[2], dtype=np.float32) if len(m) > 2 else np.zeros(3, dtype=np.float32)
        for p in m[1]:
            wpos = p.pos + tr[None, :]
            wnor = p.nor if p.nor is not None else np.tile([0.0, 1.0, 0.0], (len(p.pos), 1)).astype(np.float32)

            # Chisel & sharpen vertex normals along angular geological cleavage planes
            # without moving vertex positions so bounds_m is 100% invariant
            face_v0 = p.pos[p.idx[:, 0]]
            face_v1 = p.pos[p.idx[:, 1]]
            face_v2 = p.pos[p.idx[:, 2]]
            fn = np.cross(face_v1 - face_v0, face_v2 - face_v0)
            fn_norm = np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
            fn /= fn_norm
            # Quantize face normals slightly toward 14 geological cleavage directions for crisp rock planes
            q_steps = 4.5
            fn_chisel = np.round(fn * q_steps) / q_steps
            fn_chisel /= np.linalg.norm(fn_chisel, axis=1, keepdims=True) + 1e-12
            v_chisel = np.zeros_like(wnor)
            for k in range(3):
                np.add.at(v_chisel, p.idx[:, k], fn_chisel)
            v_chisel /= np.linalg.norm(v_chisel, axis=1, keepdims=True) + 1e-12
            p.nor = (0.35 * wnor + 0.65 * v_chisel)
            p.nor /= np.linalg.norm(p.nor, axis=1, keepdims=True) + 1e-12

            # Multi-scale crevice + ground contact AO
            probe_s = wpos + p.nor * (0.42 * r_short)
            probe_m = wpos + p.nor * (0.42 * r_mid)
            cnt_s = np.array([len(nb) for nb in tree.query_ball_point(probe_s, r_short * 0.55)], dtype=np.float32)
            cnt_m = np.array([len(nb) for nb in tree.query_ball_point(probe_m, r_mid * 0.55)], dtype=np.float32)
            occ = 0.55 * np.exp(-cnt_s / 14.0) + 0.45 * np.exp(-cnt_m / 28.0)
            rel_y = np.clip((wpos[:, 1] - lo[1]) / (0.28 * height), 0.0, 1.0)
            ground_ao = 0.56 + 0.44 * (rel_y ** 0.70)
            hemi_ao = 0.72 + 0.28 * np.clip(p.nor[:, 1] * 0.5 + 0.5, 0.0, 1.0)
            ao = np.clip(occ * ground_ao * hemi_ao * 1.18, 0.38, 1.0)
            p.color = np.repeat(ao[:, None].astype(np.float32), 3, axis=1)

            mname = materials[p.material].get("name", "")
            is_sec = mname in ("lichen", "sandstone_band")
            p.uv = compute_rock_uvs(wpos, p.nor, lo, hi, is_sec)

    os.makedirs(WORK_DIR, exist_ok=True)
    tmp_out = os.path.join(WORK_DIR, f"{key.replace('/', '_')}_rock2025.glb")
    gltf_io.write_glb(tmp_out, meshes, materials, images, generator="apex-outrun-rock-2025")
    total_tris = sum(sum(len(p.idx) for p in m[1]) for m in meshes)
    return open(tmp_out, "rb").read(), total_tris


def paint_foliage_gouache_atlas(orig_jpg: bytes, model_name: str, seed: int) -> tuple[bytes, bytes]:
    """Repaints a baked foliage/conifer atlas to eliminate ControlNet Canny low-poly triangle wireframe
    lines and layer rich Kazuo Oga gouache leaf/needle brush clusters + blossom accents + impasto normal map."""
    im = Image.open(io.BytesIO(orig_jpg)).convert("RGB")
    W, H = im.size
    arr = np.asarray(im, dtype=np.float32) / 255.0

    # 1. Bilateral / median smoothing to erase sharp Canny wireframe diamond lines while keeping broad light/shadow regions
    arr_u8 = (arr * 255.0).astype(np.uint8)
    smooth_u8 = cv2.bilateralFilter(arr_u8, d=15, sigmaColor=55, sigmaSpace=25)
    smooth_u8 = cv2.GaussianBlur(smooth_u8, (9, 9), 0)
    base_rgb = smooth_u8.astype(np.float32) / 255.0

    rng = np.random.default_rng(seed)
    y_g, x_g = np.meshgrid(np.linspace(0, 1, H, endpoint=False), np.linspace(0, 1, W, endpoint=False), indexing="ij")

    def fbm(fx: int, fy: int) -> np.ndarray:
        g = rng.uniform(0.0, 1.0, (fy, fx)).astype(np.float32)
        pil = Image.fromarray((g * 255.0).astype(np.uint8), mode="L").resize((W, H), Image.Resampling.BICUBIC)
        return np.asarray(pil, dtype=np.float32) / 255.0

    c_macro = fbm(24, 24)
    c_cluster = fbm(72, 72)
    c_leaf = fbm(210, 210)
    c_bristle = fbm(480, 480)

    # Cellular leaf/needle dab pattern (round/layered gouache brush dabs)
    dab_field = 0.45 * c_cluster + 0.38 * c_leaf + 0.17 * c_bristle
    dab_step = np.tanh((dab_field - 0.48) * 5.5) * 0.5 + 0.5  # crisp gouache brush edge

    if "fir" in model_name or "pine" in model_name:
        # Layered alpine conifer needle fans: deep Prussian/spruce shadow crevices -> emerald-viridian mid -> warm sunlit chartreuse needle tips
        c_deep = np.array([0.11, 0.24, 0.21], dtype=np.float32)
        c_mid = np.array([0.22, 0.46, 0.30], dtype=np.float32)
        c_sun = np.array([0.52, 0.72, 0.36], dtype=np.float32) if "pine-young" in model_name else np.array([0.44, 0.64, 0.33], dtype=np.float32)
        # Directional needle fan strokes
        needle_str = np.sin((x_g * 140.0 + y_g * 55.0 + 0.25 * c_cluster) * math.pi * 2.0) * 0.06
        tone = np.clip(0.55 * dab_step + 0.35 * c_macro + needle_str, 0.0, 1.0)
    elif "desert" in model_name:
        # Sun-bleached sagebrush, olive-ochre & silvery desert scrub
        c_deep = np.array([0.28, 0.34, 0.24], dtype=np.float32)
        c_mid = np.array([0.54, 0.59, 0.38], dtype=np.float32)
        c_sun = np.array([0.79, 0.80, 0.52], dtype=np.float32)
        tone = np.clip(0.58 * dab_step + 0.42 * c_macro, 0.0, 1.0)
    elif "tropical" in model_name:
        # Lush subtropical hibiscus/monstera bush: deep jungle emerald -> vibrant leaf green -> golden-lime sunlit tips + warm coral/gold flower dabs
        c_deep = np.array([0.12, 0.30, 0.20], dtype=np.float32)
        c_mid = np.array([0.26, 0.56, 0.30], dtype=np.float32)
        c_sun = np.array([0.62, 0.81, 0.36], dtype=np.float32)
        tone = np.clip(0.60 * dab_step + 0.40 * c_macro, 0.0, 1.0)
    else:
        # Mediterranean / alpine wayside wildflower shrub (shrub-b): rich olive-emerald -> sunlit chartreuse-leaf -> scattered cream/gold/coral wildflower dabs
        c_deep = np.array([0.15, 0.31, 0.22], dtype=np.float32)
        c_mid = np.array([0.32, 0.56, 0.31], dtype=np.float32)
        c_sun = np.array([0.66, 0.80, 0.38], dtype=np.float32)
        tone = np.clip(0.60 * dab_step + 0.40 * c_macro, 0.0, 1.0)

    t_low = np.clip(tone * 2.0, 0.0, 1.0)[..., None]
    t_high = np.clip((tone - 0.5) * 2.0, 0.0, 1.0)[..., None]
    synth_rgb = c_deep * (1.0 - t_low) + c_mid * t_low
    synth_rgb = synth_rgb * (1.0 - t_high) + c_sun * t_high

    # Add subtle painted wildflower blossom clusters on shrub-b and shrub-tropical
    if model_name in ("shrub-b", "shrub-tropical"):
        f_spots = fbm(96, 96)
        f_gate = fbm(28, 28)
        blossom_mask = np.clip((f_spots - 0.77) * 14.0, 0.0, 1.0) * np.clip((f_gate - 0.54) * 6.0, 0.0, 1.0)
        blossom_col = np.array([0.96, 0.44, 0.36], dtype=np.float32) if "tropical" in model_name else np.array([0.97, 0.88, 0.52], dtype=np.float32)
        synth_rgb = synth_rgb * (1.0 - 0.75 * blossom_mask[..., None]) + blossom_col * (0.75 * blossom_mask[..., None])

    # Blend 32% smoothed original illumination map with 68% crisp cellular gouache leaf painting
    # (preserving bark regions where R > G + 0.05)
    bark_mask = np.clip((base_rgb[..., 0] - base_rgb[..., 1] - 0.02) * 10.0, 0.0, 1.0)[..., None]
    foliage_rgb = 0.30 * base_rgb + 0.70 * synth_rgb
    bark_rgb = base_rgb * (0.85 + 0.30 * c_leaf[..., None])
    out_rgb = foliage_rgb * (1.0 - bark_mask) + bark_rgb * bark_mask

    out_u8 = np.clip(out_rgb * 255.0, 0, 255).astype(np.uint8)
    out_im = Image.fromarray(out_u8, mode="RGB").filter(ImageFilter.UnsharpMask(radius=1.4, percent=130, threshold=2))
    buf = io.BytesIO()
    out_im.save(buf, format="JPEG", quality=92)
    return buf.getvalue(), height_to_normal_jpg(tone, strength=3.4)


def upgrade_baked_foliage_glb(key: str, glb_path: str, atlas_pair: tuple[bytes, bytes]) -> tuple[bytes, int]:
    """Upgrades a baked pygltflib foliage/conifer GLB (`shrub-*`, `tree-fir-*`, `tree-pine-young`):
    - Replaces the Canny-wireframe JPEG atlas & normal map with the crisp Kazuo Oga leaf-cluster gouache atlas.
    - Perturbs vertex normals with 3D cellular leaf-tuft / pine-bough clusters so lighting has crisp 3D relief
      instead of smooth SDF cone/mound shading, while keeping POSITION bounds_m 100% unchanged!
    - Enriches COLOR_0 vertex AO with multi-tier bough/canopy underside and interior pocket occlusion.
    """
    g = pygltflib.GLTF2().load(glb_path)
    blob = g.binary_blob()

    def read_acc(idx):
        a = g.accessors[idx]
        bv = g.bufferViews[a.bufferView]
        dt = np.dtype({5123: np.uint16, 5125: np.uint32, 5126: np.float32}[a.componentType])
        n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a.type]
        off = (bv.byteOffset or 0) + (a.byteOffset or 0)
        arr = np.frombuffer(blob, dtype=dt, count=a.count * n, offset=off).copy().reshape(a.count, n)
        return arr

    albedo_jpg, normal_jpg = atlas_pair
    out = pygltflib.GLTF2()
    out.asset = g.asset
    out.scene = g.scene
    out.scenes = g.scenes
    out.nodes = g.nodes
    out.materials = g.materials

    data = bytearray()

    def add_view(arr_bytes: bytes, target=None) -> int:
        while len(data) % 4:
            data.append(0)
        out.bufferViews.append(pygltflib.BufferView(buffer=0, byteOffset=len(data), byteLength=len(arr_bytes), target=target))
        data.extend(arr_bytes)
        return len(out.bufferViews) - 1

    def add_acc(arr: np.ndarray, kind: str, target: int) -> int:
        comp = 5125 if arr.dtype == np.uint32 else (5123 if arr.dtype == np.uint16 else 5126)
        out.accessors.append(
            pygltflib.Accessor(
                bufferView=add_view(arr.tobytes(), target),
                componentType=comp,
                count=len(arr),
                type=kind,
                min=arr.min(0).tolist() if kind == "VEC3" else None,
                max=arr.max(0).tolist() if kind == "VEC3" else None,
            )
        )
        return len(out.accessors) - 1

    # Gather all positions for global height bounds
    all_pos = []
    for m in g.meshes:
        for p in m.primitives:
            all_pos.append(read_acc(p.attributes.POSITION))
    V_all = np.vstack(all_pos)
    lo, hi = V_all.min(0), V_all.max(0)
    span_y = max(float(hi[1] - lo[1]), 0.2)
    radius_xz = max(float(np.hypot(V_all[:, 0], V_all[:, 2]).max()), 0.15)
    is_conifer = "fir" in key or "pine" in key

    total_tris = 0
    out_meshes = []
    for m in g.meshes:
        out_prims = []
        for p in m.primitives:
            pos = read_acc(p.attributes.POSITION).astype(np.float32)
            nrm = read_acc(p.attributes.NORMAL).astype(np.float32)
            uv = read_acc(p.attributes.TEXCOORD_0).astype(np.float32)
            col = read_acc(p.attributes.COLOR_0).astype(np.float32) if p.attributes.COLOR_0 is not None else np.ones((len(pos), 4), dtype=np.float32)
            idx = read_acc(p.indices).reshape(-1, 3)
            total_tris += len(idx)

            mname = g.materials[p.material].name if p.material is not None else "foliage"
            if mname != "bark":
                # 1. Sculpt 3D leaf-cluster / bough-whorl normal relief so lighting breaks into crisp clusters
                freq = (2.8 / radius_xz) if is_conifer else (3.6 / radius_xz)
                px, py, pz = pos[:, 0] * freq, pos[:, 1] * freq * 1.35, pos[:, 2] * freq
                dnx = np.sin(px * 2.1 + py * 1.7) * np.cos(pz * 1.9) + 0.5 * np.sin(px * 4.7 - pz * 3.8)
                dny = np.cos(py * 2.5 - px * 1.4) * np.sin(pz * 2.2 + 0.8) + 0.35
                dnz = np.sin(pz * 2.3 - py * 1.6) * np.cos(px * 2.0) + 0.5 * np.cos(pz * 4.5 + px * 3.6)
                dn = np.stack([dnx, dny, dnz], axis=1).astype(np.float32)
                dn /= np.linalg.norm(dn, axis=1, keepdims=True) + 1e-8
                nrm = nrm * 0.58 + dn * 0.42
                nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-8

                # 2. Multi-tier / cluster self-occlusion in COLOR_0
                rel_y = np.clip((pos[:, 1] - lo[1]) / span_y, 0.0, 1.0)
                r_dist = np.hypot(pos[:, 0], pos[:, 2]) / radius_xz
                if is_conifer:
                    # 7 conifer tiers: deep shade under each bough tier & near trunk core, bright at bough tips
                    n_tiers = 7.0 if "fir-a" in key else (6.0 if "fir-b" in key else 3.5)
                    tier_phase = np.mod(rel_y * n_tiers, 1.0)
                    tier_ao = 0.58 + 0.42 * (tier_phase ** 0.65)
                    radial_ao = 0.62 + 0.38 * np.clip(r_dist / np.maximum(1.0 - 0.65 * rel_y, 0.22), 0.0, 1.0)
                    hemi_ao = 0.72 + 0.28 * np.clip(nrm[:, 1] * 0.5 + 0.5, 0.0, 1.0)
                    ao_mult = np.clip(tier_ao * radial_ao * hemi_ao * 1.15, 0.42, 1.05)
                else:
                    # Shrub leaf-cluster crevices & grounded base AO
                    cluster_ao = 0.74 + 0.26 * np.clip(0.5 + 0.5 * dny, 0.0, 1.0)
                    ground_ao = 0.62 + 0.38 * (rel_y ** 0.55)
                    ao_mult = np.clip(cluster_ao * ground_ao * 1.08, 0.45, 1.05)

                col_rgb = np.clip(col[:, :3] * ao_mult[:, None], 0.32, 1.05)
                col4 = np.hstack([col_rgb.astype(np.float32), np.ones((len(pos), 1), dtype=np.float32)])
            else:
                col4 = col if col.shape[1] == 4 else np.hstack([col[:, :3], np.ones((len(pos), 1), dtype=np.float32)])

            idx_flat = idx.astype(np.uint32).reshape(-1)
            out_prims.append(
                pygltflib.Primitive(
                    attributes=pygltflib.Attributes(
                        POSITION=add_acc(pos, "VEC3", 34962),
                        NORMAL=add_acc(nrm, "VEC3", 34962),
                        TEXCOORD_0=add_acc(uv, "VEC2", 34962),
                        COLOR_0=add_acc(col4.astype(np.float32), "VEC4", 34962),
                    ),
                    indices=add_acc(idx_flat, "SCALAR", 34963),
                    material=p.material,
                )
            )
        out_meshes.append(pygltflib.Mesh(name=m.name, primitives=out_prims))

    out.meshes = out_meshes
    v_alb = add_view(albedo_jpg)
    v_nrm = add_view(normal_jpg)
    out.images = [
        pygltflib.Image(bufferView=v_alb, mimeType="image/jpeg"),
        pygltflib.Image(bufferView=v_nrm, mimeType="image/jpeg"),
    ]
    out.samplers = [pygltflib.Sampler(magFilter=9729, minFilter=9987, wrapS=33071, wrapT=33071)]
    out.textures = [
        pygltflib.Texture(source=0, sampler=0),
        pygltflib.Texture(source=1, sampler=0),
    ]
    for m in out.materials:
        m.pbrMetallicRoughness.baseColorTexture = pygltflib.TextureInfo(index=0)
        m.pbrMetallicRoughness.baseColorFactor = [1.0, 1.0, 1.0, 1.0]
        m.normalTexture = pygltflib.NormalMaterialTexture(index=1, scale=0.80)
        m.extras = {"painted": True}

    out.buffers = [pygltflib.Buffer(byteLength=len(data))]
    out.set_binary_blob(bytes(data))
    os.makedirs(WORK_DIR, exist_ok=True)
    tmp_out = os.path.join(WORK_DIR, f"{key.replace('/', '_')}_fol2025.glb")
    out.save_binary(tmp_out)
    return open(tmp_out, "rb").read(), total_tris


def main():
    manifest = json.load(open(MANIFEST_PATH))
    hash_replacements = {}

    def update_manifest(key: str, data: bytes, tris: int):
        old_file = manifest[key]["file"]
        fname, h, nbytes = store_blob(data, "glb")
        manifest[key]["file"] = fname
        manifest[key]["sha256"] = h
        manifest[key]["bytes"] = nbytes
        manifest[key]["tris"] = tris
        hash_replacements[old_file] = fname
        print(f"Updated {key}: {old_file[:10]} -> {fname[:10]} ({nbytes} bytes, {tris} tris)")

    # 1. Generate shared gouache rock textures by geological set (3 atlas tiles total across all 18 rock models!)
    tex_granite = make_gouache_rock_textures("granite", seed=301)
    tex_limestone = make_gouache_rock_textures("limestone", seed=302)
    tex_sandstone = make_gouache_rock_textures("sandstone", seed=303)

    rock_models = (
        [f"rock-granite-{c}" for c in "abcde"]
        + [f"rock-lime-{c}" for c in "abcd"]
        + [f"rock-sand-{c}" for c in "abcdef"]
        + [f"rock-desert-{c}" for c in "abc"]
    )
    for rm in rock_models:
        if "granite" in rm:
            tpair = tex_granite
        elif "lime" in rm:
            tpair = tex_limestone
        else:
            tpair = tex_sandstone
        for lod in (0, 1, 2):
            key = f"model/{rm}/lod{lod}"
            if key not in manifest:
                continue
            src_path = os.path.join(SEED_DIR, manifest[key]["file"])
            glb_bytes, tris = upgrade_rock_glb(key, src_path, tpair)
            update_manifest(key, glb_bytes, tris)

    # 2. Upgrade bushes and pine/fir conifers
    foliage_models = [
        ("shrub-b", 401),
        ("shrub-tropical", 402),
        ("shrub-desert", 403),
        ("tree-fir-a", 404),
        ("tree-fir-b", 405),
        ("tree-pine-young", 406),
    ]
    for fm, seed in foliage_models:
        lod0_path = os.path.join(SEED_DIR, manifest[f"model/{fm}/lod0"]["file"])
        g0 = pygltflib.GLTF2().load(lod0_path)
        bv0 = g0.bufferViews[g0.images[0].bufferView]
        orig_jpg = g0.binary_blob()[bv0.byteOffset: bv0.byteOffset + bv0.byteLength]
        atlas_pair = paint_foliage_gouache_atlas(orig_jpg, fm, seed=seed)
        for lod in (0, 1, 2):
            key = f"model/{fm}/lod{lod}"
            src_path = os.path.join(SEED_DIR, manifest[key]["file"])
            glb_bytes, tris = upgrade_baked_foliage_glb(key, src_path, atlas_pair)
            update_manifest(key, glb_bytes, tris)

    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2, sort_keys=True)
        f.write("\n")


if __name__ == "__main__":
    main()
