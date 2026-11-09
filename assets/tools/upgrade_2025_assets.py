"""Offline 2025 asset enhancement pass for ApexRun:
1. Installs upgraded sculpted characters (riders/lod0, riders/lod1, flagman/lod0).
2. Upgrades stage landmarks (lighthouse, sailboat, windmill, castle-tower, colosseum, hangar)
   with multi-scale vertex ambient occlusion (COLOR_0) and embedded Kazuo Oga gouache textures.
3. Upgrades model/car-hero/lod0 with 3D cockpit details (bucket-seat headrests + chrome posts,
   center windscreen rearview mirror, gated chrome manual gear-shifter, dashboard hooded instrument
   binnacle + chrome gauge bezels), deep multi-bounce cavity/underbody COLOR_0 AO ([0.28, 1.0]),
   and radial barrel/spoke/lug COLOR_0 AO on all 4 wheel nodes.
4. Enhances painted gouache sky domes (sky/*.paint.jpg) and horizon backdrops (backdrop/*.far, *.mid)
   with Kazuo Oga bristle-impasto micro-contrast and cloud-rim definition.
"""
import hashlib, io, json, math, os, shutil, struct, sys
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "cartoon", "flagman"))
import gltf_io

APEX_DIR = os.path.abspath(os.path.join(HERE, "..", ".."))
MANIFEST_PATH = os.path.join(APEX_DIR, "assets", "manifest.json")
SEED_DIR = os.path.join(APEX_DIR, ".seed-assets")
WORK_DIR = os.path.join(HERE, "cartoon", "work")
ORIG_BACKUP_JSON = os.path.join(WORK_DIR, "orig_asset_hashes.json")
HOST_LIB_RS = os.path.join(APEX_DIR, "desktop", "src", "lib.rs")
SIM_BUNDLE_JS = os.path.join(APEX_DIR, "desktop", "fixtures", "apexrun_sim_bundle.js")


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def store_blob(data: bytes, ext: str) -> tuple[str, str, int]:
    h = sha256_bytes(data)
    fname = f"{h}.{ext.lstrip('.')}"
    out_path = os.path.join(SEED_DIR, fname)
    with open(out_path, "wb") as f:
        f.write(data)
    return fname, h, len(data)


def make_box(c, half, rot_x=0.0):
    cx, cy, cz = c
    hx, hy, hz = half
    corners = np.array([
        [-hx, -hy, -hz], [ hx, -hy, -hz], [ hx,  hy, -hz], [-hx,  hy, -hz],
        [-hx, -hy,  hz], [ hx, -hy,  hz], [ hx,  hy,  hz], [-hx,  hy,  hz],
    ], dtype=np.float32)
    faces = [
        ([0, 3, 2, 1], [ 0,  0, -1]),
        ([4, 5, 6, 7], [ 0,  0,  1]),
        ([0, 1, 5, 4], [ 0, -1,  0]),
        ([3, 7, 6, 2], [ 0,  1,  0]),
        ([0, 4, 7, 3], [-1,  0,  0]),
        ([1, 2, 6, 5], [ 1,  0,  0]),
    ]
    if abs(rot_x) > 1e-6:
        cs, sn = math.cos(rot_x), math.sin(rot_x)
        R = np.array([[1, 0, 0], [0, cs, -sn], [0, sn, cs]], dtype=np.float32)
    else:
        R = np.eye(3, dtype=np.float32)
    V, N, F = [], [], []
    for quad, nrm in faces:
        base = len(V)
        for qi in quad:
            V.append(corners[qi] @ R.T + np.array([cx, cy, cz], dtype=np.float32))
            N.append(np.array(nrm, dtype=np.float32) @ R.T)
        F.append([base, base + 1, base + 2])
        F.append([base, base + 2, base + 3])
    return np.array(V, dtype=np.float32), np.array(N, dtype=np.float32), np.array(F, dtype=np.int64)


def make_cylinder(p0, p1, r0, r1, segs=16):
    p0 = np.asarray(p0, dtype=np.float32)
    p1 = np.asarray(p1, dtype=np.float32)
    axis = p1 - p0
    L = float(np.linalg.norm(axis))
    d = axis / max(L, 1e-8)
    up = np.array([1.0, 0.0, 0.0], dtype=np.float32) if abs(d[1]) > 0.9 else np.array([0.0, 1.0, 0.0], dtype=np.float32)
    u = np.cross(d, up)
    u /= max(float(np.linalg.norm(u)), 1e-8)
    v = np.cross(d, u)
    angles = np.linspace(0.0, 2.0 * math.pi, segs, endpoint=False)
    V, N, F = [], [], []
    for k, a in enumerate(angles):
        cs, sn = math.cos(a), math.sin(a)
        radial = cs * u + sn * v
        V.append(p0 + r0 * radial)
        N.append(radial)
        V.append(p1 + r1 * radial)
        N.append(radial)
    for k in range(segs):
        k1 = (k + 1) % segs
        i0, i1 = 2 * k, 2 * k + 1
        j0, j1 = 2 * k1, 2 * k1 + 1
        F.append([i0, j0, j1])
        F.append([i0, j1, i1])
    # Top cap at p1
    c_idx = len(V)
    V.append(p1)
    N.append(d)
    for k in range(segs):
        cs, sn = math.cos(angles[k]), math.sin(angles[k])
        V.append(p1 + r1 * (cs * u + sn * v))
        N.append(d)
    for k in range(segs):
        F.append([c_idx, c_idx + 1 + k, c_idx + 1 + ((k + 1) % segs)])
    return np.array(V, dtype=np.float32), np.array(N, dtype=np.float32), np.array(F, dtype=np.int64)


def make_ellipsoid(c, radii, nu=16, nv=10):
    cx, cy, cz = c
    rx, ry, rz = radii
    V, N, F = [], [], []
    for iv in range(nv + 1):
        phi = math.pi * iv / nv
        sp, cp = math.sin(phi), math.cos(phi)
        for iu in range(nu):
            th = 2.0 * math.pi * iu / nu
            ct, st = math.cos(th), math.sin(th)
            nx, ny, nz = sp * ct, cp, sp * st
            V.append([cx + rx * nx, cy + ry * ny, cz + rz * nz])
            nrm = np.array([nx / max(rx, 1e-5), ny / max(ry, 1e-5), nz / max(rz, 1e-5)], dtype=np.float32)
            nrm /= max(float(np.linalg.norm(nrm)), 1e-8)
            N.append(nrm)
    for iv in range(nv):
        for iu in range(nu):
            iu1 = (iu + 1) % nu
            a = iv * nu + iu
            b = iv * nu + iu1
            c0 = (iv + 1) * nu + iu1
            d0 = (iv + 1) * nu + iu
            if iv > 0:
                F.append([a, b, c0])
            if iv < nv - 1:
                F.append([a, c0, d0])
    return np.array(V, dtype=np.float32), np.array(N, dtype=np.float32), np.array(F, dtype=np.int64)


def merge_geom(parts):
    V, N, F = [], [], []
    offset = 0
    for vp, np_, fp in parts:
        V.append(vp)
        N.append(np_)
        F.append(fp + offset)
        offset += len(vp)
    return np.vstack(V), np.vstack(N), np.vstack(F)


def load_raw_glb_meshes(path):
    """Loads node-local primitives and materials from a GLB without collapsing node transforms."""
    b = open(path, "rb").read()
    jl = struct.unpack_from("<I", b, 12)[0]
    g = json.loads(b[20:20 + jl])
    blob = b[20 + jl + 8:]

    def acc(i):
        a = g["accessors"][i]
        bv = g["bufferViews"][a["bufferView"]]
        dt = np.dtype(gltf_io.CT[a["componentType"]])
        n = gltf_io.NC[a["type"]]
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = bv.get("byteStride", 0) or dt.itemsize * n
        raw = np.frombuffer(blob, np.uint8, count=stride * (a["count"] - 1) + dt.itemsize * n, offset=off)
        arr = np.lib.stride_tricks.as_strided(raw, (a["count"], dt.itemsize * n), (stride, 1)).copy().view(dt).reshape(a["count"], n)
        if a.get("normalized"):
            arr = arr.astype(np.float32) / np.iinfo(dt).max
        return arr

    images = []
    for ti, t in enumerate(g.get("textures", [])):
        src = t.get("source")
        if src is None:
            src = t["extensions"]["EXT_texture_webp"]["source"]
        im = g["images"][src]
        bv = g["bufferViews"][im["bufferView"]]
        raw_im = blob[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]
        images.append((raw_im, im.get("mimeType", "image/jpeg")))

    materials = []
    for m in g.get("materials", []):
        mc = json.loads(json.dumps(m))
        pbr = mc.get("pbrMetallicRoughness", {})
        if "baseColorTexture" in pbr and "index" in pbr["baseColorTexture"]:
            pbr["baseColorTexture"]["image"] = pbr["baseColorTexture"].pop("index")
        materials.append(mc)

    meshes = []
    for n in g["nodes"]:
        if "mesh" not in n:
            continue
        gm = g["meshes"][n["mesh"]]
        prims = []
        for p in gm["primitives"]:
            pos = acc(p["attributes"]["POSITION"]).astype(np.float32)
            nor = acc(p["attributes"]["NORMAL"]).astype(np.float32) if "NORMAL" in p["attributes"] else None
            uv = acc(p["attributes"]["TEXCOORD_0"]).astype(np.float32) if "TEXCOORD_0" in p["attributes"] else None
            col = acc(p["attributes"]["COLOR_0"]).astype(np.float32) if "COLOR_0" in p["attributes"] else None
            idx = acc(p["indices"]).reshape(-1, 3).astype(np.int64)
            pr = gltf_io.Prim(p.get("material", 0), pos, nor, uv, idx, n.get("name", ""))
            if col is not None:
                pr.color = col[:, :3]
            prims.append(pr)
        if "translation" in n:
            meshes.append((n.get("name", gm.get("name", "")), prims, n["translation"]))
        else:
            meshes.append((n.get("name", gm.get("name", "")), prims))
    return meshes, materials, images


def make_torus_z(center, R_major, r_minor, nu=24, nv=12):
    """Builds a smooth torus ring in the XY plane facing -Z/+Z centered at `center`."""
    cx, cy, cz = center
    V, N, F = [], [], []
    for iu in range(nu):
        u = 2.0 * math.pi * iu / nu
        cu, su = math.cos(u), math.sin(u)
        for iv in range(nv):
            v = 2.0 * math.pi * iv / nv
            cv, sv = math.cos(v), math.sin(v)
            r = R_major + r_minor * cv
            px = cx + r * cu
            py = cy + r * su
            pz = cz + r_minor * sv
            nx = cv * cu
            ny = cv * su
            nz = sv
            V.append([px, py, pz])
            N.append([nx, ny, nz])
    for iu in range(nu):
        iu1 = (iu + 1) % nu
        for iv in range(nv):
            iv1 = (iv + 1) % nv
            a = iu * nv + iv
            b = iu1 * nv + iv
            c = iu1 * nv + iv1
            d = iu * nv + iv1
            F.append([a, b, c])
            F.append([a, c, d])
    return np.array(V, dtype=np.float32), np.array(N, dtype=np.float32), np.array(F, dtype=np.int64)


def filter_prim_faces(prim, keep_vertex_mask):
    """Keeps only triangles where all 3 vertices satisfy `keep_vertex_mask`."""
    tri_keep = keep_vertex_mask[prim.idx[:, 0]] & keep_vertex_mask[prim.idx[:, 1]] & keep_vertex_mask[prim.idx[:, 2]]
    kept_tris = prim.idx[tri_keep]
    used_v = np.unique(kept_tris)
    remap = np.full(len(prim.pos), -1, dtype=np.int64)
    remap[used_v] = np.arange(len(used_v), dtype=np.int64)
    prim.pos = prim.pos[used_v]
    if prim.nor is not None:
        prim.nor = prim.nor[used_v]
    if prim.uv is not None:
        prim.uv = prim.uv[used_v]
    if getattr(prim, "color", None) is not None:
        prim.color = prim.color[used_v]
    prim.idx = remap[kept_tris]


def upgrade_hero_car(orig_glb_path: str) -> tuple[bytes, int]:
    meshes, materials, images = load_raw_glb_meshes(orig_glb_path)
    body_name, body_prims = meshes[0][0], meshes[0][1]

    # Map material names to indices
    mat_by_name = {m["name"]: i for i, m in enumerate(materials)}
    mat_paint = mat_by_name["paint"]
    mat_interior = mat_by_name["interior"]
    mat_trim = mat_by_name["trim"]
    mat_chrome = mat_by_name["chrome"]
    mat_taillight = mat_by_name["taillight"]
    mat_indicator = mat_by_name["indicator"]

    for p in body_prims:
        if p.material == mat_taillight:
            filter_prim_faces(p, p.pos[:, 2] > -1.85)
        elif p.material == mat_indicator:
            filter_prim_faces(p, p.pos[:, 2] > -1.85)

    paint_adds = []
    interior_adds = []
    trim_adds = []
    chrome_adds = []
    taillight_adds = []
    indicator_adds = []

    for sx in (-0.36, 0.36):
        # Sculpted aerodynamic speedster tonneau cowls / fairings behind each bucket seat (`paint`)
        paint_adds.append(make_ellipsoid([sx, 0.785, -1.18], [0.165, 0.088, 0.34], nu=20, nv=12))
        # Sculpted leather headrest cushion + lateral bolsters (`interior`)
        interior_adds.append(make_ellipsoid([sx, 0.815, -0.885], [0.115, 0.088, 0.048], nu=16, nv=10))
        interior_adds.append(make_ellipsoid([sx - 0.085, 0.805, -0.87], [0.038, 0.078, 0.045], nu=12, nv=8))
        interior_adds.append(make_ellipsoid([sx + 0.085, 0.805, -0.87], [0.038, 0.078, 0.045], nu=12, nv=8))
        # Upper seatback shoulder bolster pad
        interior_adds.append(make_box([sx, 0.63, -0.895], [0.17, 0.065, 0.038], rot_x=-0.16))
        # Brushed roll-hoop / headrest support rods
        for dx in (-0.052, 0.052):
            chrome_adds.append(make_cylinder([sx + dx, 0.66, -0.89], [sx + dx, 0.75, -0.89], 0.009, 0.009, segs=12))

    # Subtle integrated rear ducktail spoiler lip along the trailing edge of the rear deck (`paint`)
    paint_adds.append(make_box([0.0, 0.708, -2.075], [0.80, 0.018, 0.052], rot_x=0.22))

    # Dashboard hooded instrument binnacle ahead of driver (+0.36)
    interior_adds.append(make_ellipsoid([0.36, 0.855, -0.02], [0.165, 0.058, 0.095], nu=16, nv=10))
    trim_adds.append(make_box([0.36, 0.84, -0.065], [0.145, 0.042, 0.02], rot_x=0.15))
    for gx in (0.305, 0.415):
        chrome_adds.append(make_cylinder([gx, 0.845, -0.055], [gx, 0.845, -0.082], 0.044, 0.042, segs=18))

    # Center windscreen rearview mirror
    trim_adds.append(make_cylinder([0.0, 1.095, -0.13], [0.0, 1.035, -0.155], 0.008, 0.008, segs=10))
    trim_adds.append(make_box([0.0, 1.03, -0.16], [0.092, 0.026, 0.014]))
    chrome_adds.append(make_box([0.0, 1.03, -0.169], [0.086, 0.022, 0.006]))

    # Gated manual gear shifter on center console tunnel (dark carbon/leather boot so it never glares white!)
    interior_adds.append(make_box([0.0, 0.535, -0.42], [0.058, 0.018, 0.072]))
    trim_adds.append(make_box([0.0, 0.548, -0.42], [0.044, 0.008, 0.054]))
    chrome_adds.append(make_cylinder([0.0, 0.55, -0.42], [0.0, 0.675, -0.442], 0.006, 0.005, segs=12))
    trim_adds.append(make_ellipsoid([0.0, 0.690, -0.445], [0.021, 0.021, 0.021], nu=14, nv=10))

    # 2025 Rear Fascia: dark recessed mesh panel + twin circular Ferrari-style LED halo ring taillights
    # + amber inner turn cores + vertical carbon rear diffuser strakes (`2026-10-16-stitch-outrun-vision.png`)
    trim_adds.append(make_box([0.0, 0.575, -2.115], [0.85, 0.076, 0.025]))
    for lx in (-0.70, -0.50, 0.50, 0.70):
        # Recessed dark carbon cylindrical bezel housing
        trim_adds.append(make_cylinder([lx, 0.575, -2.095], [lx, 0.575, -2.142], 0.078, 0.074, segs=22))
        trim_adds.append(make_cylinder([lx, 0.575, -2.105], [lx, 0.575, -2.138], 0.040, 0.038, segs=18))
        # Glowing crimson-red circular LED halo ring (`taillight`)
        taillight_adds.append(make_torus_z([lx, 0.575, -2.140], 0.056, 0.016, nu=24, nv=12))
        # Inner jewel lens: outer pair have amber turn-signal cores (`indicator`), inner pair have red brake cores (`taillight`)
        if abs(lx) > 0.60:
            indicator_adds.append(make_cylinder([lx, 0.575, -2.125], [lx, 0.575, -2.143], 0.024, 0.020, segs=16))
        else:
            taillight_adds.append(make_cylinder([lx, 0.575, -2.125], [lx, 0.575, -2.143], 0.024, 0.020, segs=16))

    # Rear underbody carbon diffuser fins & quad bevelled chrome exhaust tips
    for fx in (-0.58, -0.24, 0.24, 0.58):
        trim_adds.append(make_box([fx, 0.235, -2.08], [0.014, 0.058, 0.095], rot_x=0.12))
    for ex in (-0.43, -0.31, 0.31, 0.43):
        chrome_adds.append(make_torus_z([ex, 0.265, -2.168], 0.038, 0.008, nu=18, nv=10))
        trim_adds.append(make_cylinder([ex, 0.265, -2.06], [ex, 0.265, -2.168], 0.032, 0.032, segs=14))

    def append_to_prim(mat_idx, add_list):
        if not add_list:
            return
        v_add, n_add, f_add = merge_geom(add_list)
        c_add = np.full((len(v_add), 3), 0.90, dtype=np.float32)
        for p in body_prims:
            if p.material == mat_idx:
                base = len(p.pos)
                p.pos = np.vstack([p.pos, v_add]) if len(p.pos) else v_add
                p.nor = np.vstack([p.nor, n_add]) if (p.nor is not None and len(p.nor)) else n_add
                p.idx = np.vstack([p.idx, f_add + base]) if len(p.idx) else f_add
                p.color = np.vstack([p.color, c_add]) if (getattr(p, "color", None) is not None and len(p.color)) else c_add
                return

    append_to_prim(mat_paint, paint_adds)
    append_to_prim(mat_interior, interior_adds)
    append_to_prim(mat_trim, trim_adds)
    append_to_prim(mat_chrome, chrome_adds)
    append_to_prim(mat_taillight, taillight_adds)
    append_to_prim(mat_indicator, indicator_adds)

    # 2. Deep multi-bounce raytraced + cavity/underbody AO on car body ([0.28, 1.0])
    wheel_centers = [
        np.array([ 0.835, 0.315,  1.198], dtype=np.float32),
        np.array([-0.835, 0.315,  1.198], dtype=np.float32),
        np.array([ 0.822, 0.330, -1.198], dtype=np.float32),
        np.array([-0.822, 0.330, -1.198], dtype=np.float32),
    ]
    for p in body_prims:
        pos = p.pos
        nor = p.nor
        base_ao = p.color[:, 0].copy() if getattr(p, "color", None) is not None else np.ones(len(pos), dtype=np.float32)
        # Expand [0.60, 1.0] baked AO to deeper multi-bounce [0.34, 1.0]
        norm_ao = np.clip((base_ao - 0.60) / 0.40, 0.0, 1.0)
        deep_ao = 0.34 + 0.66 * (norm_ao ** 1.35)

        # Ground-plane underbody contact shadow
        ground_ao = 0.52 + 0.48 * np.clip((pos[:, 1] - 0.12) / 0.32, 0.0, 1.0)
        down_facing = np.clip(-nor[:, 1], 0.0, 1.0)
        ground_ao *= (1.0 - 0.32 * down_facing * np.clip(1.0 - pos[:, 1] / 0.55, 0.0, 1.0))

        # Wheel well arch cavity occlusion
        well_ao = np.ones(len(pos), dtype=np.float32)
        for wc in wheel_centers:
            d = np.linalg.norm(pos - wc[None, :], axis=1)
            in_well = np.clip((0.46 - d) / 0.22, 0.0, 1.0)
            well_ao *= (1.0 - 0.45 * in_well)

        # Cockpit footwell & lower cabin depth occlusion
        in_cabin_x = np.clip(1.0 - np.abs(pos[:, 0]) / 0.66, 0.0, 1.0)
        in_cabin_z = np.clip(1.0 - np.abs(pos[:, 2] + 0.48) / 0.58, 0.0, 1.0)
        in_footwell_y = np.clip((0.68 - pos[:, 1]) / 0.38, 0.0, 1.0)
        cabin_ao = 1.0 - 0.38 * (in_cabin_x * in_cabin_z * in_footwell_y)

        # Keep taillights, plates, and chrome bright
        mname = materials[p.material]["name"]
        if mname in ("taillight", "indicator", "plate"):
            final_ao = np.clip(base_ao, 0.72, 1.0)
        elif mname == "chrome":
            final_ao = np.clip(deep_ao * ground_ao, 0.55, 1.0)
        else:
            final_ao = np.clip(deep_ao * ground_ao * well_ao * cabin_ao, 0.28, 1.0)
        p.color = np.repeat(final_ao[:, None].astype(np.float32), 3, axis=1)

    # 3. Compute radial barrel, spoke-pocket, and lug-nut COLOR_0 AO on all 4 wheel nodes
    for wi in range(1, len(meshes)):
        w_prims = meshes[wi][1]
        all_v = np.vstack([p.pos for p in w_prims])
        r_yz = np.hypot(all_v[:, 1], all_v[:, 2])
        r_max = max(float(r_yz.max()), 1e-4)
        x_abs_max = max(float(np.abs(all_v[:, 0]).max()), 1e-4)
        for p in w_prims:
            pos = p.pos
            nor = p.nor
            r = np.hypot(pos[:, 1], pos[:, 2]) / r_max
            x_outer = np.abs(pos[:, 0]) / x_abs_max
            mname = materials[p.material]["name"]
            # Deep inner barrel & recessed lug pocket AO
            barrel_ao = 0.42 + 0.58 * np.clip(x_outer / 0.78, 0.0, 1.0)
            hub_cavity = 0.58 + 0.42 * np.clip(r / 0.38, 0.0, 1.0)
            radial_n = np.clip(np.abs(nor[:, 0]) * 0.55 + 0.45, 0.0, 1.0)
            if mname == "rubber":
                # Tire tread shoulder + inner sidewall AO
                ao = np.clip(barrel_ao * (0.68 + 0.32 * np.clip((r - 0.55) / 0.45, 0.0, 1.0)), 0.35, 1.0)
            elif mname in ("rim", "chrome"):
                ao = np.clip(barrel_ao * hub_cavity * radial_n, 0.42, 1.0)
            else:
                ao = np.clip(barrel_ao * hub_cavity, 0.32, 1.0)
            p.color = np.repeat(ao[:, None].astype(np.float32), 3, axis=1)

    tmp_out = os.path.join(WORK_DIR, "car_hero_lod0_upgraded.glb")
    gltf_io.write_glb(tmp_out, meshes, materials, images, generator="apex-outrun-car-hero-2025")
    total_tris = sum(sum(len(p.idx) for p in m[1]) for m in meshes)
    return open(tmp_out, "rb").read(), total_tris


def make_gouache_landmark_texture(seed: int, style: str = "masonry") -> bytes:
    """Synthesizes a 1024x1024 Kazuo Oga gouache brushwork modulation texture centered near 1.0."""
    rng = np.random.default_rng(seed)
    H, W = 1024, 1024
    # Multi-scale gouache paper & bristle wash
    coarse = rng.normal(0.0, 1.0, (64, 64, 3)).astype(np.float32)
    med = rng.normal(0.0, 1.0, (256, 256, 3)).astype(np.float32)
    fine = rng.normal(0.0, 1.0, (H, W, 3)).astype(np.float32)

    def upsample(arr, target_h, target_w):
        im = Image.fromarray(np.clip((arr * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8))
        im = im.resize((target_w, target_h), Image.Resampling.BICUBIC)
        return (np.asarray(im, dtype=np.float32) / 255.0 - 0.5) * 2.0

    c_up = upsample(coarse, H, W)
    m_up = upsample(med, H, W)

    y_grid, x_grid = np.meshgrid(np.linspace(0, 1, H, endpoint=False), np.linspace(0, 1, W, endpoint=False), indexing="ij")
    if style == "masonry":
        # Horizontal stone/stucco courses + warm/cool mineral gouache dabs
        courses = np.sin(y_grid * 2.0 * math.pi * 24.0)
        mortar = np.exp(-((courses) ** 2) / 0.04) * (-0.11)
        stagger = (np.floor(y_grid * 24.0) % 2) * 0.5
        vert_joint = np.exp(-((np.sin((x_grid * 16.0 + stagger) * math.pi)) ** 2) / 0.015) * (-0.08)
        struc = mortar + vert_joint
    else:
        # Maritime plank seams & canvas weave
        planks = np.exp(-((np.sin(y_grid * math.pi * 32.0)) ** 2) / 0.025) * (-0.09)
        weave = 0.035 * (np.sin(x_grid * 2.0 * math.pi * 96.0) + np.sin(y_grid * 2.0 * math.pi * 96.0))
        struc = planks + weave

    # Warm sunlit ochre highlights (+R, +G, -B) vs cool slate shadow strokes (-R, +B)
    warm_cool = c_up[:, :, 0:1]
    wash_r = 0.88 + 0.10 * warm_cool[:, :, 0] + 0.06 * m_up[:, :, 0] + 0.025 * fine[:, :, 0] + struc
    wash_g = 0.88 + 0.08 * warm_cool[:, :, 0] + 0.06 * m_up[:, :, 1] + 0.025 * fine[:, :, 1] + struc
    wash_b = 0.88 + 0.04 * warm_cool[:, :, 0] + 0.06 * m_up[:, :, 2] + 0.025 * fine[:, :, 2] + struc

    rgb = np.stack([wash_r, wash_g, wash_b], axis=-1)
    rgb = np.clip(rgb * 255.0, 0, 255).astype(np.uint8)
    im = Image.fromarray(rgb, mode="RGB").filter(ImageFilter.UnsharpMask(radius=1.8, percent=125, threshold=2))
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def compute_landmark_uvs(pos: np.ndarray, nor: np.ndarray, bounds_lo: np.ndarray, bounds_hi: np.ndarray) -> np.ndarray:
    span = np.maximum(bounds_hi - bounds_lo, 1e-4)
    # Cylindrical azimuth U + vertical height V
    u = (np.arctan2(pos[:, 0], pos[:, 2]) / (2.0 * math.pi) + 0.5) * 4.0
    v = ((pos[:, 1] - bounds_lo[1]) / span[1]) * 4.0
    # For flat horizontal surfaces (decks, plinths), blend planar XZ
    horiz = (np.abs(nor[:, 1]) > 0.75)
    u_xz = ((pos[:, 0] - bounds_lo[0]) / span[0]) * 3.0
    v_xz = ((pos[:, 2] - bounds_lo[2]) / span[2]) * 3.0
    u = np.where(horiz, u_xz, u)
    v = np.where(horiz, v_xz, v)
    return np.stack([u, v], axis=1).astype(np.float32)


def upgrade_landmark_glb(key: str, orig_glb_path: str) -> tuple[bytes, int]:
    meshes, materials, images = load_raw_glb_meshes(orig_glb_path)

    # Gather all world-space points & normals across all nodes to compute self-occlusion + contact AO
    all_pts, all_nrms = [], []
    for m in meshes:
        tr = np.asarray(m[2], dtype=np.float32) if len(m) > 2 else np.zeros(3, dtype=np.float32)
        for p in m[1]:
            all_pts.append(p.pos + tr[None, :])
            all_nrms.append(p.nor if p.nor is not None else np.tile([0.0, 1.0, 0.0], (len(p.pos), 1)))
    V_all = np.vstack(all_pts)
    N_all = np.vstack(all_nrms)
    lo, hi = V_all.min(0), V_all.max(0)
    height = max(float(hi[1] - lo[1]), 1.0)

    # Subsample surface points for fast KD-tree hemisphere occlusion using deterministic SHA-256 seed
    key_seed = int.from_bytes(hashlib.sha256(key.encode("utf-8")).digest()[:4], "little")
    rng = np.random.default_rng(key_seed)
    if len(V_all) > 8000:
        sample_idx = rng.choice(len(V_all), 8000, replace=False)
        V_sample = V_all[sample_idx]
    else:
        V_sample = V_all
    tree = cKDTree(V_sample)

    # Embed gouache texture for untextured landmarks (lighthouse & sailboat)
    add_gouache_tex = len(images) == 0
    if add_gouache_tex:
        style = "maritime" if "sailboat" in key else "masonry"
        tex_bytes = make_gouache_landmark_texture(key_seed % 10000, style=style)
        images.append((tex_bytes, "image/jpeg"))
        tex_idx = len(images) - 1
        for m in materials:
            mname = m.get("name", "")
            if mname in ("glass", "lamp", "rigging", "iron"):
                continue
            pbr = m.setdefault("pbrMetallicRoughness", {})
            bcf = pbr.get("baseColorFactor", [1.0, 1.0, 1.0, 1.0])
            # Compensate for 0.88 mean of gouache wash so base chromaticity stays identical
            pbr["baseColorFactor"] = [min(1.0, float(bcf[0]) / 0.88), min(1.0, float(bcf[1]) / 0.88), min(1.0, float(bcf[2]) / 0.88), float(bcf[3])]
            pbr["baseColorTexture"] = {"image": tex_idx}

    r_short = 0.055 * height
    r_mid = 0.14 * height
    for m in meshes:
        tr = np.asarray(m[2], dtype=np.float32) if len(m) > 2 else np.zeros(3, dtype=np.float32)
        for p in m[1]:
            wpos = p.pos + tr[None, :]
            wnor = p.nor if p.nor is not None else np.tile([0.0, 1.0, 0.0], (len(p.pos), 1)).astype(np.float32)
            # Probe points offset along vertex normal
            probe_s = wpos + wnor * (0.45 * r_short)
            probe_m = wpos + wnor * (0.45 * r_mid)
            cnt_s = np.array([len(nb) for nb in tree.query_ball_point(probe_s, r_short * 0.52)], dtype=np.float32)
            cnt_m = np.array([len(nb) for nb in tree.query_ball_point(probe_m, r_mid * 0.52)], dtype=np.float32)
            occ_s = np.exp(-cnt_s / 18.0)
            occ_m = np.exp(-cnt_m / 36.0)
            # Ground plinth / waterline contact AO
            rel_y = np.clip((wpos[:, 1] - lo[1]) / (0.18 * height), 0.0, 1.0)
            ground_ao = 0.70 + 0.30 * (rel_y ** 0.75)
            # Overhang / crevice normal shading
            hemi_ao = 0.82 + 0.18 * np.clip(wnor[:, 1] * 0.5 + 0.5, 0.0, 1.0)

            mname = materials[p.material].get("name", "")
            if mname == "lamp":
                ao = np.ones(len(wpos), dtype=np.float32)
            else:
                ao = np.clip((0.55 * occ_s + 0.45 * occ_m) * ground_ao * hemi_ao, 0.42, 1.0)
            p.color = np.repeat(ao[:, None].astype(np.float32), 3, axis=1)

            if add_gouache_tex and p.uv is None and mname not in ("glass", "lamp", "rigging", "iron"):
                p.uv = compute_landmark_uvs(wpos, wnor, lo, hi)

    tmp_out = os.path.join(WORK_DIR, f"{key.replace('/', '_')}.glb")
    gltf_io.write_glb(tmp_out, meshes, materials, images, generator="apex-outrun-landmark-2025")
    total_tris = sum(sum(len(p.idx) for p in m[1]) for m in meshes)
    return open(tmp_out, "rb").read(), total_tris


def upgrade_foliage_glb(key: str, orig_glb_path: str) -> tuple[bytes, int]:
    """Fixes floating leaves and rounded hovering bases on shrub, fern, and grass-tuft models:
    - For `shrub-tropical`: grounds and tucks the 8 tropical frond components (`leaf` primitive)
      so their petioles root cleanly inside the main foliage mass (`y = -0.04m`) with zero gap
      between the bush base and the leaves, and adds a grounded root crown.
    - For `shrub-tropical`, `shrub-b`, `shrub-desert`: flares the lower hemisphere (`y < 0.30 * ymax`)
      outward and extends a `-0.08m` root skirt into the soil so the bush sits with a broad,
      planted base on sloped terrain instead of rounding inward like a floating ball.
    - For `fern`, `grass-beach`, `grass-tuft`: extends basal vertices (`y < 0.04m`) down to `-0.04m`
      and adds a low grounded root crown so blades/fronds emerge from the earth.
    """
    meshes, materials, images = load_raw_glb_meshes(orig_glb_path)
    mat_by_name = {m.get("name", ""): i for i, m in enumerate(materials)}

    for mitem in meshes:
        prims = mitem[1]
        for p in prims:
            mname = materials[p.material].get("name", "")
            pos = p.pos
            nor = p.nor if p.nor is not None else np.tile([0.0, 1.0, 0.0], (len(pos), 1)).astype(np.float32)
            y = pos[:, 1].copy()
            if float(y.min()) < -0.02:
                # Already grounded on a previous pass; skip to keep idempotency
                continue
            ymax = max(float(y.max()), 0.1)

            if "shrub" in key and mname == "foliage":
                # 1. Flare lower hemisphere (`y < 0.35 * ymax`) outward so the base doesn't round inward
                rel_y = np.clip(y / (0.35 * ymax), 0.0, 1.0)
                flare = 1.0 + 0.32 * ((1.0 - rel_y) ** 1.5)
                pos[:, 0] *= flare
                pos[:, 2] *= flare
                # 2. Pull the bottom vertices (`y < 0.16 * ymax`) down into a grounded root skirt (`-0.08m`)
                skirt_t = np.clip(1.0 - y / (0.16 * ymax), 0.0, 1.0)
                pos[:, 1] = y - (0.085 * ymax) * (skirt_t ** 1.35)
                # Darken root contact AO slightly so the planted base has rich ground contact shadow
                if getattr(p, "color", None) is not None:
                    root_ao = 0.72 + 0.28 * np.clip(y / (0.25 * ymax), 0.0, 1.0)
                    p.color = (p.color * root_ao[:, None]).astype(np.float32)

            elif "shrub-tropical" in key and mname == "leaf":
                # Ground the 8 hovering leaf fronds (`ymin = 0.30..1.79m`) so their stems root at `y = -0.05m`
                # deep inside the foliage bush (`ymax = 0.975m`) and arch naturally within/just at the bush crown (`ymax <= 0.88m`)!
                t_leaf = np.clip((y - 0.30) / max(ymax - 0.30, 1e-4), 0.0, 1.0)
                pos[:, 1] = -0.05 + (t_leaf ** 0.85) * 0.92
                r_scale = 0.45 + 0.32 * t_leaf
                pos[:, 0] *= r_scale
                pos[:, 2] *= r_scale

                # Add a grounded central leaf/stem rosette at the base (`y = -0.06..0.52m`)
                stem_adds = []
                for angle_i in range(8):
                    ang = angle_i * (2.0 * math.pi / 8.0) + 0.2
                    dx, dz = math.cos(ang), math.sin(ang)
                    stem_adds.append(
                        make_cylinder(
                            [dx * 0.04, -0.06, dz * 0.04],
                            [dx * 0.30, 0.48, dz * 0.30],
                            0.055,
                            0.022,
                            segs=6,
                        )
                    )
                v_add, n_add, f_add = merge_geom(stem_adds)
                c_add = np.tile(np.array([[0.22, 0.38, 0.20]], dtype=np.float32), (len(v_add), 1))
                base = len(p.pos)
                p.pos = np.vstack([p.pos, v_add])
                p.nor = np.vstack([nor, n_add])
                p.idx = np.vstack([p.idx, f_add + base])
                if getattr(p, "color", None) is not None:
                    p.color = np.vstack([p.color, c_add])

            elif any(k in key for k in ("fern", "grass-beach", "grass-tuft")):
                # Pull root vertices (`y < 0.18 * ymax`) down to `-0.04m` so blades/fronds emerge from soil
                skirt_t = np.clip(1.0 - y / (0.18 * ymax), 0.0, 1.0)
                pos[:, 1] = y - 0.045 * (skirt_t ** 1.2)
                # Add a low grounded basal tuft mound at the root (`y = -0.04..0.06m`) so blades never look disconnected
                crown_r = 0.16 if "fern" in key else 0.085
                crown_h = 0.055 if "fern" in key else 0.038
                v_add, n_add, f_add = make_ellipsoid([0.0, 0.005, 0.0], [crown_r, crown_h, crown_r], nu=10, nv=6)
                base = len(p.pos)
                p.pos = np.vstack([p.pos, v_add])
                p.nor = np.vstack([nor, n_add])
                p.idx = np.vstack([p.idx, f_add + base])
                if getattr(p, "color", None) is not None:
                    mean_c = p.color.mean(axis=0, keepdims=True) * 0.65
                    c_add = np.repeat(mean_c.astype(np.float32), len(v_add), axis=0)
                    p.color = np.vstack([p.color, c_add])
                if p.uv is not None:
                    uv_add = np.full((len(v_add), 2), 0.5, dtype=np.float32)
                    p.uv = np.vstack([p.uv, uv_add])

    tmp_out = os.path.join(WORK_DIR, f"{key.replace('/', '_')}_grounded.glb")
    gltf_io.write_glb(tmp_out, meshes, materials, images, generator="apex-outrun-foliage-2025")
    total_tris = sum(sum(len(p.idx) for p in m[1]) for m in meshes)
    return open(tmp_out, "rb").read(), total_tris


def enhance_gouache_image(orig_path: str, kind: str, key: str = "") -> bytes:
    """Applies Kazuo Oga gouache bristle micro-contrast & organic silhouette feathering while preserving mean horizon colour."""
    im = Image.open(orig_path)
    has_alpha = im.mode == "RGBA"
    if has_alpha:
        rgb = im.convert("RGB")
        alpha = im.getchannel("A")
    else:
        rgb = im.convert("RGB")
        alpha = None

    # Unsharp mask at two scales: broad cloud/mountain ridge forms + fine gouache bristle impasto
    rgb_broad = rgb.filter(ImageFilter.UnsharpMask(radius=4.5, percent=38, threshold=4))
    rgb_crisp = rgb_broad.filter(ImageFilter.UnsharpMask(radius=1.4, percent=55, threshold=2))
    rgb_crisp = ImageEnhance.Color(rgb_crisp).enhance(1.06)

    if kind == "sky":
        # Preserve bottom 15% horizon band exactly so horizon_srgb seam is 100% unchanged
        arr_orig = np.asarray(rgb, dtype=np.float32)
        arr_new = np.asarray(rgb_crisp, dtype=np.float32)
        H = arr_orig.shape[0]
        y = np.linspace(0.0, 1.0, H)[:, None, None]
        blend = np.clip((0.88 - y) / 0.18, 0.0, 1.0)
        arr_out = np.clip(arr_orig * (1.0 - blend) + arr_new * blend, 0, 255).astype(np.uint8)
        out_im = Image.fromarray(arr_out, mode="RGB")
        buf = io.BytesIO()
        out_im.save(buf, format="JPEG", quality=93, subsampling=0)
        return buf.getvalue()
    elif kind == "backdrop" and has_alpha:
        arr_rgb = np.asarray(rgb_crisp, dtype=np.float32)
        arr_a = np.asarray(alpha, dtype=np.float32) / 255.0
        H, W = arr_a.shape
        seed = sum(ord(c) for c in key) * 37
        rng = np.random.default_rng(seed)

        def p1d(scale_px):
            f = np.fft.fftfreq(W)
            spec = np.fft.fft(rng.standard_normal(W)) * np.exp(-0.5 * (f * scale_px * 2.0 * math.pi) ** 2)
            v = np.real(np.fft.ifft(spec)).astype(np.float32)
            return (v - v.mean()) / max(float(v.std()), 1e-6)

        is_mid = key.endswith(".mid")
        is_skyline = "metropolis-night" in key
        if not is_skyline:
            col_h = arr_a.mean(axis=0)
            if is_mid:
                mod = (
                    0.042 * p1d(95.0)
                    + 0.024 * p1d(28.0)
                    + 0.014 * np.abs(p1d(9.0))
                    + 0.008 * p1d(4.0)
                )
            else:
                mod = 0.048 * p1d(140.0) + 0.022 * p1d(38.0) + 0.010 * p1d(12.0)
            new_h = np.clip(col_h + mod * np.clip(col_h * 3.0, 0.0, 1.0), 0.02, 0.96)
            y_norm = (np.arange(H, dtype=np.float32)[:, None] + 0.5) / H
            edge_dist = (y_norm - (1.0 - new_h[None, :])) * H
            # Soft 2.5px gouache brush feather at silhouette top; keep bottom 100% opaque so no skyline strip leaks below!
            arr_a = np.clip((edge_dist + 1.2) / 2.6, 0.0, 1.0)

            # Add subtle gouache foliage/ridge internal relief shading so crowns aren't flat
            slope = np.gradient(new_h)[None, :] * W * 0.35
            crown_lit = 1.0 + 0.10 * np.clip(-slope, -1.0, 1.0) + 0.06 * np.clip(1.0 - edge_dist / 45.0, 0.0, 1.0)
            arr_rgb = np.clip(arr_rgb * crown_lit[:, :, None], 0.0, 255.0)

        rgba = np.dstack([arr_rgb.astype(np.uint8), np.clip(arr_a * 255.0, 0, 255).astype(np.uint8)])
        out_im = Image.fromarray(rgba, mode="RGBA")
        buf = io.BytesIO()
        out_im.save(buf, format="WEBP", quality=92, method=4)
        return buf.getvalue()
    else:
        if has_alpha:
            r, g, b = rgb_crisp.split()
            out_im = Image.merge("RGBA", (r, g, b, alpha))
        else:
            out_im = rgb_crisp
        buf = io.BytesIO()
        out_im.save(buf, format="WEBP", quality=92, method=4)
        return buf.getvalue()


def main():
    for target_file in (MANIFEST_PATH, HOST_LIB_RS, SIM_BUNDLE_JS):
        if not os.path.exists(target_file):
            raise FileNotFoundError(f"Expected file not found: {target_file}")
    os.makedirs(WORK_DIR, exist_ok=True)
    manifest = json.load(open(MANIFEST_PATH))

    # Save original hashes once so re-runs are idempotent
    if os.path.exists(ORIG_BACKUP_JSON):
        orig_map = json.load(open(ORIG_BACKUP_JSON))
    else:
        orig_map = {k: {"file": v["file"], "sha256": v["sha256"], "bytes": v["bytes"]} for k, v in manifest.items() if isinstance(v, dict) and "file" in v}
        json.dump(orig_map, open(ORIG_BACKUP_JSON, "w"), indent=1)

    hash_replacements = {}

    def update_entry(key: str, data: bytes, ext: str, tris: int | None = None, tris_by_node: dict | None = None):
        old_file = manifest[key]["file"]
        orig_file = orig_map[key]["file"]
        fname, h, nbytes = store_blob(data, ext)
        manifest[key]["file"] = fname
        manifest[key]["sha256"] = h
        manifest[key]["bytes"] = nbytes
        if tris is not None:
            manifest[key]["tris"] = tris
        if tris_by_node is not None and "tris_by_node" in manifest[key]:
            manifest[key]["tris_by_node"] = tris_by_node
        hash_replacements[old_file] = fname
        hash_replacements[orig_file] = fname
        print(f"Updated {key}: {orig_file[:12]} -> {fname[:12]} ({nbytes} bytes{f', {tris} tris' if tris else ''})")

    # 1. Install riders & flagman
    riders_meta = json.load(open(os.path.join(WORK_DIR, "riders.json")))
    for lod_info in riders_meta["lods"]:
        lod = lod_info["lod"]
        glb_bytes = open(os.path.join(HERE, "cartoon", lod_info["path"]), "rb").read()
        update_entry(f"model/riders/lod{lod}", glb_bytes, "glb", tris=lod_info["tris"], tris_by_node=lod_info["tris_by_node"])

    flagman_meta = json.load(open(os.path.join(WORK_DIR, "flagman.json")))
    flagman_bytes = open(os.path.join(HERE, "cartoon", flagman_meta["path"]), "rb").read()
    update_entry("model/flagman/lod0", flagman_bytes, "glb", tris=flagman_meta["tris"], tris_by_node=flagman_meta["tris_by_node"])

    # 2. Upgrade stage landmarks
    landmarks = [
        "model/lighthouse/lod0",
        "model/sailboat/lod0",
        "model/windmill/lod0",
        "model/castle-tower/lod0",
        "model/colosseum/lod0",
        "model/hangar/lod0",
    ]
    for key in landmarks:
        orig_path = os.path.join(SEED_DIR, orig_map[key]["file"])
        glb_bytes, tris = upgrade_landmark_glb(key, orig_path)
        update_entry(key, glb_bytes, "glb", tris=tris)

    # 3. Upgrade hero car (model/car-hero/lod0)
    car_orig_path = os.path.join(SEED_DIR, orig_map["model/car-hero/lod0"]["file"])
    car_bytes, car_tris = upgrade_hero_car(car_orig_path)
    update_entry("model/car-hero/lod0", car_bytes, "glb", tris=car_tris)

    # 3b. Ground roadside & scatter foliage models (eliminate rounded floating bases & hovering leaves)
    foliage_models = [
        "model/shrub-tropical/lod0",
        "model/shrub-tropical/lod1",
        "model/shrub-tropical/lod2",
        "model/shrub-b/lod0",
        "model/shrub-b/lod1",
        "model/shrub-b/lod2",
        "model/shrub-desert/lod0",
        "model/shrub-desert/lod1",
        "model/shrub-desert/lod2",
        "model/fern/lod0",
        "model/fern/lod1",
        "model/fern/lod2",
        "model/grass-beach/lod0",
        "model/grass-beach/lod1",
        "model/grass-beach/lod2",
        "model/grass-tuft/lod0",
        "model/grass-tuft/lod1",
        "model/grass-tuft/lod2",
    ]
    for key in foliage_models:
        if key not in orig_map:
            raise KeyError(f"Missing required foliage model key in manifest: {key}")
        orig_path = os.path.join(SEED_DIR, orig_map[key]["file"])
        if not os.path.exists(orig_path):
            raise FileNotFoundError(f"Missing seed asset file for {key}: {orig_path}")
        glb_bytes, tris = upgrade_foliage_glb(key, orig_path)
        update_entry(key, glb_bytes, "glb", tris=tris)

    # 4. Enhance painted gouache sky domes, horizon backdrops & ground albedos
    for key in sorted(manifest.keys()):
        if key.startswith("sky/") and key.endswith(".paint.jpg"):
            orig_path = os.path.join(SEED_DIR, orig_map[key]["file"])
            new_bytes = enhance_gouache_image(orig_path, "sky", key=key)
            update_entry(key, new_bytes, "jpg")
        elif key.startswith("backdrop/") and (key.endswith(".far") or key.endswith(".mid")):
            orig_path = os.path.join(SEED_DIR, orig_map[key]["file"])
            new_bytes = enhance_gouache_image(orig_path, "backdrop", key=key)
            update_entry(key, new_bytes, "webp")
        elif key.startswith("tex/") and key.endswith("/albedo") and "tulip-field" not in key:
            orig_path = os.path.join(SEED_DIR, orig_map[key]["file"])
            new_bytes = enhance_gouache_image(orig_path, "ground", key=key)
            update_entry(key, new_bytes, "webp")

    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2, sort_keys=True)
        f.write("\n")

    for target_file in (HOST_LIB_RS, SIM_BUNDLE_JS):
        txt = open(target_file, "r").read()
        changed = False
        for old_f, new_f in hash_replacements.items():
            if old_f != new_f and old_f in txt:
                txt = txt.replace(old_f, new_f)
                changed = True
            old_h = old_f.split(".")[0]
            new_h = new_f.split(".")[0]
            if old_h != new_h and old_h in txt:
                txt = txt.replace(old_h, new_h)
                changed = True
        if changed:
            open(target_file, "w").write(txt)
            print(f"Synced asset hashes in {target_file}")


if __name__ == "__main__":
    main()
