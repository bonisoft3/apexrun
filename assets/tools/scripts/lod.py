"""LOD building blocks: gltfpack simplification for solid meshes, billboard-cloud card baking for foliage, texture encoding."""
import io, os, subprocess, tempfile
import cv2
import numpy as np
from PIL import Image
from gltf_io import Prim, load, write_glb

HERE = os.path.dirname(os.path.abspath(__file__))
GLTFPACK = os.path.join(HERE, "..", "web", "node_modules", ".bin", "gltfpack")


# ---------- solids ----------

def simplify(prim, target):
    """Simplify one primitive to about `target` triangles with gltfpack (plain output, no quantization)."""
    if target >= prim.tris:
        return prim
    ratio = max(target / prim.tris, 1e-4)
    with tempfile.TemporaryDirectory() as d:
        src, dst = f"{d}/in.glb", f"{d}/out.glb"
        write_glb(src, [("m", [Prim(0, prim.pos, prim.nor, prim.uv, prim.idx)])],
                  [{"pbrMetallicRoughness": {"baseColorTexture": {"image": 0}}}], [(_png1(), "image/png")])
        best = None
        # sloppy (-sa) welds across UV seams and smears textures, so it is the last resort
        # (-se 1 lets meshopt collapse a whole mesh to nothing; the default error bound keeps sloppy mode sane)
        for extra, slack in ((["-se", "0.25"], 1.25), (["-se", "0.25", "-sp"], 2.5), (["-sa"], 1e9)):
            r_try = ratio
            while True:  # sloppy simplification can erase a tiny target entirely; grow it until something survives
                r = subprocess.run([GLTFPACK, "-i", src, "-o", dst, "-noq", "-kv", "-si", f"{r_try:.6f}", *extra],
                                   capture_output=True, text=True)
                if r.returncode:
                    raise RuntimeError(f"gltfpack failed: {r.stderr}")
                g, _, _, prims = load(dst)
                if prims:
                    break
                if r_try >= 1:
                    raise RuntimeError("gltfpack removed the whole mesh at ratio 1")
                r_try = min(1.0, r_try * 1.25)
            if len(prims) != 1:
                raise RuntimeError(f"gltfpack returned {len(prims)} primitives")
            best = prims[0][1]
            if best.tris <= target * slack:
                break
        best.material = prim.material
        return best


def _png1():
    b = io.BytesIO(); Image.new("RGB", (1, 1)).save(b, "PNG"); return b.getvalue()


# ---------- foliage: billboard cloud ----------

SS = 4  # supersampling per atlas texel when rasterising leaves into cards
LAYERS = 8  # depth slices per card for opacity-aware compositing

def components(idx, n):
    """Connected components of a triangle list -> per-triangle label."""
    import scipy.sparse as sp
    from scipy.sparse.csgraph import connected_components
    a = sp.coo_matrix((np.ones(idx.size), (np.repeat(idx[:, 0], 3), idx.ravel())), shape=(n, n))
    _, lab = connected_components(a, directed=False)
    return lab[idx[:, 0]]


def cluster_atoms(cent, k, seed=0):
    """Group atom centroids into about k voxel clusters (jittered grid); returns per-atom cluster id."""
    if len(cent) <= k:
        return np.arange(len(cent))
    lo, hi = cent.min(0), cent.max(0)
    ext = np.maximum(hi - lo, 1e-3)
    rng = np.random.default_rng(seed)
    off = rng.random(3)
    a, b = 1e-4, float(ext.max())
    for _ in range(40):
        s = (a * b) ** 0.5
        keys = np.floor((cent - lo) / s + off).astype(np.int64)
        n = len(np.unique(keys, axis=0))
        if abs(n - k) <= max(2, k * 0.03):
            break
        if n > k:
            a = s
        else:
            b = s
    _, lab = np.unique(keys, axis=0, return_inverse=True)
    return lab.ravel()


def bake_cards(prims, textures, k, atlas, axis_xz, radial_w=0.5, seed=0, ao_strength=0.3):
    """Bake foliage primitives into k planar cards with an atlas.

    prims: foliage Prims (positions in final model space); textures: per-prim dict of float arrays
    {"albedo": HxWx3 0..1, "arm": HxWx3 or None}. Returns (card Prim with material None, albedo RGBA uint8,
    normal RGB uint8, arm RGB uint8, stats)."""
    pos = np.concatenate([p.pos for p in prims])
    nor = np.concatenate([p.nor for p in prims])
    uv = np.concatenate([p.uv for p in prims])
    tex_of_tri = np.concatenate([np.full(p.tris, i) for i, p in enumerate(prims)])
    base, idx = 0, []
    for p in prims:
        idx.append(p.idx + base); base += len(p.pos)
    idx = np.concatenate(idx)
    atom = components(idx, len(pos))
    if atom.max() + 1 < k:  # fewer leaves than cards: split leaves themselves, triangle by triangle
        atom = np.arange(len(idx))
    tri_c = pos[idx].mean(1)
    n_atoms = atom.max() + 1
    cnt = np.bincount(atom, minlength=n_atoms)
    cent = np.stack([np.bincount(atom, tri_c[:, j], n_atoms) for j in range(3)], 1) / cnt[:, None]
    cl_atom = cluster_atoms(cent, k, seed)
    cl = cl_atom[atom]
    ncl = cl.max() + 1
    order = np.argsort(cl, kind="stable")
    starts = np.searchsorted(cl[order], np.arange(ncl + 1))
    crown_c = np.array([axis_xz[0], 0, axis_xz[1]])
    crown_r = np.percentile(np.linalg.norm((tri_c - crown_c)[:, [0, 2]], axis=1), 95) + 1e-3
    top, bot = tri_c[:, 1].max(), tri_c[:, 1].min()
    # canopy self-occlusion per source triangle: darker toward the trunk and the crown's underside
    depth_in = np.clip(1 - np.linalg.norm((tri_c - crown_c)[:, [0, 2]], axis=1) / crown_r, 0, 1)
    hfrac = np.clip((tri_c[:, 1] - bot) / max(top - bot, 1e-3), 0, 1)
    tri_ao = 1 - ao_strength * (0.6 * depth_in + 0.4 * (1 - hfrac))

    cards = []
    for c in range(ncl):
        tris = order[starts[c]:starts[c + 1]]
        v = pos[idx[tris]].reshape(-1, 3)
        ctr = v.mean(0)
        w, e = np.linalg.eigh(np.cov((v - ctr).T) + np.eye(3) * 1e-9)
        n_pca = e[:, 0]
        rad = ctr - crown_c; rad[1] = 0
        rl = np.linalg.norm(rad)
        if rl > 1e-3:
            rad /= rl
            if n_pca @ rad < 0:
                n_pca = -n_pca
            n = n_pca * (1 - radial_w) + rad * radial_w
        else:
            n = n_pca if n_pca[1] >= 0 else -n_pca
        n /= np.linalg.norm(n)
        up = np.array([0, 1.0, 0])
        u = np.cross(up, n)
        if np.linalg.norm(u) < 1e-3:
            u = np.cross(np.array([0, 0, 1.0]), n)
        u /= np.linalg.norm(u)
        vv = np.cross(n, u)
        p2 = np.stack([(v - ctr) @ u, (v - ctr) @ vv], 1)
        lo, hi = p2.min(0), p2.max(0)
        pad = (hi - lo) * 0.02 + 1e-3
        lo, hi = lo - pad, hi + pad
        cards.append(dict(tris=tris, ctr=ctr, u=u, v=vv, n=n, lo=lo, hi=hi))

    # texel density so the shelf-packed tiles fill the atlas
    areas = np.array([(c["hi"] - c["lo"]).prod() for c in cards])
    rho = np.sqrt(atlas * atlas * 0.82 / areas.sum())
    for _ in range(60):
        place = _shelf(cards, rho, atlas)
        if place is not None:
            break
        rho *= 0.96
    else:
        raise RuntimeError("atlas packing failed")

    alb = np.zeros((atlas, atlas, 3), np.float32)
    cov = np.zeros((atlas, atlas), np.float32)
    nrm = np.zeros((atlas, atlas, 3), np.float32); nrm[..., 2] = 1
    arm = np.zeros((atlas, atlas, 3), np.float32)
    out_pos, out_uv, out_nor, out_idx = [], [], [], []
    for ci, (c, (x0, y0, tw, th)) in enumerate(zip(cards, place)):
        tris = c["tris"]
        tv = pos[idx[tris]]                                  # T,3,3
        q = np.stack([(tv - c["ctr"]) @ c["u"], (tv - c["ctr"]) @ c["v"]], -1)  # T,3,2
        dep = ((tv - c["ctr"]) @ c["n"]).mean(1)
        sx = (tw - 2) / (c["hi"][0] - c["lo"][0]); sy = (th - 2) / (c["hi"][1] - c["lo"][1])
        px = (1 + (q[..., 0] - c["lo"][0]) * sx) * SS
        py = (1 + (c["hi"][1] - q[..., 1]) * sy) * SS        # image rows go down = -v
        # depth layers far -> near; within a layer painter's order, then the opacity map decides per texel,
        # so a cut-out leaf in front does not hide the leaves behind it
        sub = np.zeros((th * SS, tw * SS, 10), np.float32)
        order_t = np.argsort(dep)
        for layer in np.array_split(order_t, min(LAYERS, len(order_t))):
            idbuf = np.zeros((th * SS, tw * SS), np.int32)
            for t in layer:
                pts = np.round(np.stack([px[t], py[t]], 1) * 16).astype(np.int32)
                cv2.fillConvexPoly(idbuf, pts, int(t) + 1, lineType=cv2.LINE_8, shift=4)
            yy, xx = np.nonzero(idbuf)
            if not len(yy):
                continue
            t = idbuf[yy, xx] - 1
            a, b, cc = (np.stack([px[t, j], py[t, j]], 1) for j in range(3))
            p = np.stack([xx + 0.5, yy + 0.5], 1)
            v0, v1, v2 = b - a, cc - a, p - a
            d00 = (v0 * v0).sum(1); d01 = (v0 * v1).sum(1); d11 = (v1 * v1).sum(1)
            d20 = (v2 * v0).sum(1); d21 = (v2 * v1).sum(1)
            den = d00 * d11 - d01 * d01
            den = np.where(np.abs(den) < 1e-12, 1e-12, den)
            l1 = np.clip((d11 * d20 - d01 * d21) / den, 0, 1); l2 = np.clip((d00 * d21 - d01 * d20) / den, 0, 1)
            l0 = np.clip(1 - l1 - l2, 0, 1)
            gt = tris[t]
            vi = idx[gt]
            tuv = uv[vi[:, 0]] * l0[:, None] + uv[vi[:, 1]] * l1[:, None] + uv[vi[:, 2]] * l2[:, None]
            tn = nor[vi[:, 0]] * l0[:, None] + nor[vi[:, 1]] * l1[:, None] + nor[vi[:, 2]] * l2[:, None]
            tn /= np.linalg.norm(tn, axis=1, keepdims=True) + 1e-9
            ln = np.stack([tn @ c["u"], tn @ c["v"], tn @ c["n"]], 1)
            ln[ln[:, 2] < 0] *= -1
            ln[:, 2] = np.maximum(ln[:, 2], 0.25)
            ln /= np.linalg.norm(ln, axis=1, keepdims=True)
            col = np.zeros((len(t), 3), np.float32); rgh = np.zeros((len(t), 3), np.float32)
            opa = np.ones(len(t), np.float32)
            for ti, tx in enumerate(textures):
                m = tex_of_tri[gt] == ti
                if m.any():
                    col[m] = _sample(tx["albedo"], tuv[m])
                    rgh[m] = _sample(tx["arm"], tuv[m]) if tx.get("arm") is not None else (1, 0.6, 0)
                    if tx.get("alpha") is not None:
                        opa[m] = _sample(tx["alpha"][..., None], tuv[m])[:, 0]
            rgh[:, 0] *= tri_ao[gt]
            keep = opa >= 0.5
            yy, xx = yy[keep], xx[keep]
            sub[yy, xx, 0:3] = col[keep]; sub[yy, xx, 3:6] = ln[keep]; sub[yy, xx, 6:9] = rgh[keep]; sub[yy, xx, 9] = 1
        if sub[..., 9].any():
            # supersampled tile -> coverage-weighted average per atlas texel
            sub[..., :9] *= sub[..., 9:10]
            sub = sub.reshape(th, SS, tw, SS, 10).sum((1, 3))
            w = sub[..., 9]
            ok = w > 0
            inv = np.where(ok, 1 / np.maximum(w, 1e-6), 0)[..., None]
            ty, tx = np.nonzero(ok)
            alb[y0 + ty, x0 + tx] = (sub[..., 0:3] * inv)[ok]; nrm[y0 + ty, x0 + tx] = (sub[..., 3:6] * inv)[ok]
            arm[y0 + ty, x0 + tx] = (sub[..., 6:9] * inv)[ok]; cov[y0 + ty, x0 + tx] = w[ok] / (SS * SS)
        # card quad (2 tris), texture coords in [0,1] atlas space
        corners = [(c["lo"][0], c["hi"][1]), (c["hi"][0], c["hi"][1]), (c["hi"][0], c["lo"][1]), (c["lo"][0], c["lo"][1])]
        P = np.array([c["ctr"] + a * c["u"] + b * c["v"] for a, b in corners])
        U = np.array([[x0 + 1, y0 + 1], [x0 + tw - 1, y0 + 1], [x0 + tw - 1, y0 + th - 1], [x0 + 1, y0 + th - 1]], np.float64) / atlas
        base = 4 * ci
        out_pos.append(P); out_uv.append(U); out_nor.append(np.repeat(c["n"][None], 4, 0))
        out_idx.append(np.array([[base, base + 3, base + 2], [base, base + 2, base + 1]]))
    card = Prim(None, np.concatenate(out_pos), np.concatenate(out_nor), np.concatenate(out_uv), np.concatenate(out_idx))
    a8 = (np.clip(cov * 1.6, 0, 1) * 255 + 0.5).astype(np.uint8)  # soft coverage; 1.6 keeps half-covered texels above the 0.5 cutoff
    hit = (cov > 0).astype(np.float32)
    alb = _pushpull(alb, hit); arm = _pushpull(arm, hit)
    nrm_f = _pushpull(nrm, hit)
    nrm_f /= np.linalg.norm(nrm_f, axis=2, keepdims=True) + 1e-9
    alb = alb * arm[..., :1]  # occlusion goes into the albedo: cards ship without an ARM map
    rgba = np.dstack([(np.clip(alb, 0, 1) ** (1 / 2.2) * 255 + 0.5).astype(np.uint8), a8])
    n8 = ((nrm_f * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8)
    m8 = (np.clip(arm, 0, 1) * 255 + 0.5).astype(np.uint8)
    stats = dict(atoms=int(n_atoms), cards=len(cards), source_tris=int(len(idx)), texel_per_m=float(rho), coverage=float(cov.mean()))
    return card, rgba, n8, m8, stats


def _shelf(cards, rho, atlas):
    sizes = [(max(4, int(np.ceil((c["hi"][0] - c["lo"][0]) * rho)) + 2), max(4, int(np.ceil((c["hi"][1] - c["lo"][1]) * rho)) + 2)) for c in cards]
    order = sorted(range(len(cards)), key=lambda i: -sizes[i][1])
    place = [None] * len(cards)
    x = y = rowh = 0
    for i in order:
        w, h = sizes[i]
        if w > atlas:
            return None
        if x + w > atlas:
            x, y, rowh = 0, y + rowh, 0
        if y + h > atlas:
            return None
        place[i] = (x, y, w, h)
        x += w; rowh = max(rowh, h)
    return place


def _sample(img, uv):
    """Bilinear sample (wrap) of a float HxWxC linear image at glTF uv (v down)."""
    h, w = img.shape[:2]
    x = (uv[:, 0] % 1.0) * w - 0.5
    y = (uv[:, 1] % 1.0) * h - 0.5
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int)
    fx = (x - x0)[:, None]; fy = (y - y0)[:, None]
    x0 %= w; y0 %= h; x1 = (x0 + 1) % w; y1 = (y0 + 1) % h
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x1] * fx * (1 - fy) + img[y1, x0] * (1 - fx) * fy + img[y1, x1] * fx * fy)


def _pushpull(img, w):
    """Fill uncovered texels from covered neighbours (pull-push pyramid) so mips do not bleed black."""
    if w.min() > 0:
        return img
    levels = [(img * w[..., None], w)]
    while min(levels[-1][1].shape) > 1:
        ci, cw = levels[-1]
        ci = cv2.resize(ci, (max(1, ci.shape[1] // 2), max(1, ci.shape[0] // 2)), interpolation=cv2.INTER_AREA)
        cw = cv2.resize(cw, (max(1, cw.shape[1] // 2), max(1, cw.shape[0] // 2)), interpolation=cv2.INTER_AREA)
        if ci.ndim == 2:
            ci = ci[..., None]
        levels.append((ci, cw))
    ci, cw = levels[-1]
    fill = ci / np.maximum(cw[..., None], 1e-6)
    for ci, cw in reversed(levels[:-1]):
        up = cv2.resize(fill, (cw.shape[1], cw.shape[0]), interpolation=cv2.INTER_LINEAR)
        if up.ndim == 2:
            up = up[..., None]
        own = ci / np.maximum(cw[..., None], 1e-6)
        a = np.clip(cw, 0, 1)[..., None]
        fill = own * a + up * (1 - a)
    return fill


# ---------- textures ----------

def encode(img, kind, size):
    """PIL image -> (bytes, mime). albedo/arm WebP q85 (albedo keeps alpha), normal WebP q92."""
    if img.size != (size, size):
        img = img.resize((size, size), Image.LANCZOS)
    b = io.BytesIO()
    if kind == "normal":
        img.convert("RGB").save(b, "WEBP", quality=92, method=6)
    elif kind == "albedo" and img.mode == "RGBA":
        img.save(b, "WEBP", quality=85, method=6, exact=True)
    else:
        img.convert("RGB").save(b, "WEBP", quality=85, method=6)
    return b.getvalue(), "image/webp"
