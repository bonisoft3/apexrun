"""Painted surfaces for the pack's big props, baked by projection (DESIGN.md "Ghibli gouache").

A model's flat-shaded colour is rendered from a ring of views; SDXL img2img repaints each view as Oga gouache at a strength
that keeps its silhouette; what each painting adds to its render (its brushwork, and gently its warm and cool shifts) is
projected back onto the mesh, each texel taking the views that see it face on, over the model's own colour, into one UV
atlas (xatlas) shared by the model's materials. Views paint a region differently, so their colours taken whole met in
patchwork and a palm's thin trunk took its fronds' green: only the painting's departure from its render is carried.
Every LOD is baked from the same paintings, so the LODs agree.

usage: bake.py <glb_dir> <files.json> <out_dir> <model> [model ...]
  files.json maps manifest ids (model/<id>/lod<n>) to GLB file names in glb_dir
  -> <out_dir>/<model>_lod<n>.glb, <out_dir>/<model>.views.png (render | painting per view), <out_dir>/recipes.json
"""
import io, json, os, struct, sys
import cv2
import numpy as np
import pymeshlab
import torch
import xatlas
import pygltflib
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, TOOLS)
from device import device

MODEL, VAE = "stabilityai/stable-diffusion-xl-base-1.0", "madebyollin/sdxl-vae-fp16-fix"
CONTROLNETS = [
    ("diffusers/controlnet-depth-sdxl-1.0", "17bb97973f29801224cd66f192c5ffacf82648b4", 0.80),
    ("diffusers/controlnet-canny-sdxl-1.0", "eb115a19a10d14909256db740ed109532ab1483c", 0.50),
]
STYLE = ("gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, "
         "warm afternoon light, soft cool shadow, isolated on a plain pale background")
NEG = ("text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, "
       "cel shading, frame, border, ground, sky")
STRENGTH, STEPS, GUIDANCE, SEED = 0.75, 34, 7.0, 21
VIEW = 1024
# 8 views: 6 around the horizon (every 60 deg) and 2 elevated views (45 deg and 225 deg) so zero side crevices stretch.
VIEWS = [
    (0.0, 0.18),
    (np.pi / 3, 0.18),
    (2 * np.pi / 3, 0.18),
    (np.pi, 0.18),
    (4 * np.pi / 3, 0.18),
    (5 * np.pi / 3, 0.18),
    (np.pi / 4, 0.68),
    (5 * np.pi / 4, 0.68),
]
BACKGROUND = np.array([0.80, 0.82, 0.80], np.float32)
# What each model is, for the painter; the atlas size per LOD (all upgraded to 2048 / 1024 / 512).
SUBJECTS = {
    "mesa": ("a tall red sandstone butte, deeply fluted vertical rock, warm red and orange faces, violet shade", (2048, 1024, 512)),
    "palm": ("a tall slender coconut palm tree, curved ringed trunk, crown of drooping green fronds", (2048, 1024, 512)),
    "tree-fir": ("a tall dark green fir tree in layered tiers of needles, warm lit edges, blue-green shade", (2048, 1024, 512)),
    "tree-pine": ("a young green pine tree, layered tiers of needles", (2048, 1024, 512)),
    "cypress": ("a tall slender Italian cypress tree, dense dark green foliage with warm lit edges", (2048, 1024, 512)),
    "tree-broadleaf": ("a broadleaf tree with a rounded crown of clustered leaf masses, warm lit greens and cool shade", (2048, 1024, 512)),
    "shrub-tropical": ("a lush tropical green shrub with broad arching palmate leaves and clustered foliage masses, warm sunlit highlights and deep cool shade", (2048, 1024, 512)),
    "shrub-desert": ("a low sage-green desert scrub bush with clustered dry foliage tufts, warm ochre-green highlights and cool violet-grey shade", (2048, 1024, 512)),
    "shrub": ("a lush rounded green woodland shrub with overlapping painted leaf clusters, warm sunlit highlights and cool blue-green shade", (2048, 1024, 512)),
    "cliff-coast": ("a rounded grey coastal sea stack, fluted weathered rock under a grassy cap", (2048, 1024, 512)),
    "column": ("a weathered white marble roman column", (2048, 1024, 512)),
    "broken-arch": ("a weathered roman stone arch ruin, warm limestone", (2048, 1024, 512)),
    "rock-arch": ("a great natural red sandstone rock arch between two fluted buttes, warm red and orange faces, violet shade",
                  (2048, 1024, 512)),
    "sea-arch": ("a grey coastal sea arch of fluted weathered rock under a grassy cap", (2048, 1024, 512)),
    "chapel-alpine": ("a small white alpine chapel with a steep red roof and a slim bell tower under a green copper onion dome, "
                      "on a grey rock knoll", (2048, 1024, 512)),
    "chapel-tuscan": ("a small ochre Tuscan hill chapel with a terracotta roof and a square bell tower, on a green grass knoll",
                      (2048, 1024, 512)),
    "clock-tower": ("a white harbour clock tower with a green copper spire beside a small chapel, on a grey rock knoll",
                    (2048, 1024, 512)),
    "kasbah": ("a mud-brick desert kasbah with crenellated walls and a watchtower, on a red rock knoll", (2048, 1024, 512)),
    "aqueduct": ("a ruined roman aqueduct of warm limestone, two tiers of round arches, moss on top", (2048, 1024, 512)),
}


def subject(model):
    return next(v for k, v in SUBJECTS.items() if model.startswith(k))


# ---------------------------------------------------------------- glTF in and out

def read(g, blob, accessor):
    a = g.accessors[accessor]
    v = g.bufferViews[a.bufferView]
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a.type]
    dt = np.dtype({5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a.componentType])
    stride = v.byteStride or n * dt.itemsize
    out = np.ndarray((a.count, n), dt, blob, (v.byteOffset or 0) + (a.byteOffset or 0), (stride, dt.itemsize))
    out = out.astype(np.float32 if dt == np.float32 else np.int64)
    return out / np.iinfo(dt).max if a.normalized and dt != np.float32 else out


def compute_ao(prims, rays=256, lo=0.68, gamma=0.72):
    """Ray-traced hemisphere + ground-plane ambient occlusion per vertex across all primitives via pymeshlab."""
    Vs, Fs, base = [], [], 0
    for p in prims:
        Vs.append(p["pos"]); Fs.append(p["idx"] + base); base += len(p["pos"])
    allV = np.vstack(Vs)
    ext = np.abs(allV[:, [0, 2]]).max() * 4 + 5
    y_ground = max(float(allV[:, 1].min()), 0.0) - 0.002
    Vs.append(np.array([[-ext, y_ground, -ext], [ext, y_ground, -ext], [ext, y_ground, ext], [-ext, y_ground, ext]]))
    Fs.append(np.array([[0, 2, 1], [0, 3, 2]]) + base)
    ms = pymeshlab.MeshSet()
    ms.add_mesh(pymeshlab.Mesh(np.vstack(Vs).astype(np.float64), np.vstack(Fs).astype(np.int32)))
    ms.compute_scalar_ambient_occlusion(rays=rays)
    q = ms.current_mesh().vertex_scalar_array()
    ref = pymeshlab.MeshSet()
    ref.create_sphere(subdiv=3)
    ref.compute_scalar_ambient_occlusion(rays=rays)
    free = max(float(np.median(ref.current_mesh().vertex_scalar_array())), 1e-6)
    ao = np.clip(q / free, 0.0, 1.0)
    k = 0
    for p in prims:
        n = len(p["pos"])
        a = lo + (1.0 - lo) * (ao[k:k + n] ** gamma)
        k += n
        p["ao"] = np.repeat(a[:, None].astype(np.float32), 3, axis=1)


def load(path):
    """The model's primitives in its scene's space (the pack's models carry identity node transforms)."""
    g = pygltflib.GLTF2().load(path)
    blob = g.binary_blob()
    for n in g.nodes:
        if n.matrix or n.rotation or n.translation or n.scale:
            raise SystemExit(f"{path}: a node transform the baker does not carry ({n.name})")
    prims = []
    textured = [m.name for m in g.materials if m.pbrMetallicRoughness.baseColorTexture is not None]
    if textured:
        raise SystemExit(f"{path}: already textured ({textured}); the baker paints flat-shaded models")
    for mi, mesh in enumerate(g.meshes):
        for pi, p in enumerate(mesh.primitives):
            mat = g.materials[p.material]
            base = np.array(mat.pbrMetallicRoughness.baseColorFactor or [1, 1, 1, 1], np.float32)
            pos = read(g, blob, p.attributes.POSITION)
            col = read(g, blob, p.attributes.COLOR_0)[:, :3] if p.attributes.COLOR_0 is not None else np.ones_like(pos)
            nrm = read(g, blob, p.attributes.NORMAL) if p.attributes.NORMAL is not None else None
            idx = read(g, blob, p.indices).reshape(-1, 3)
            prims.append(dict(mesh=mi, prim=pi, pos=pos, nrm=nrm, col=col * base[:3], idx=idx, mat=mat.name))
    compute_ao(prims)
    return g, prims


def bake_normal_atlas(atlas_rgb):
    """Tangent-space impasto brushwork & rock-cleavage normal map derived from the painted gouache atlas."""
    h, w, _ = atlas_rgb.shape
    nh, nw = max(256, h // 2), max(256, w // 2)
    small = cv2.resize(atlas_rgb, (nw, nh), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    luma = 0.2126 * small[..., 0] + 0.7152 * small[..., 1] + 0.0722 * small[..., 2]
    # Multi-scale impasto relief: fine bristle ridges + medium gouache dab edges
    fine = luma - ndimage.gaussian_filter(luma, 1.4)
    med = luma - ndimage.gaussian_filter(luma, 5.0)
    height = 1.8 * fine + 0.9 * med
    gx = cv2.Sobel(height, cv2.CV_32F, 1, 0, ksize=3) * 2.2
    gy = cv2.Sobel(height, cv2.CV_32F, 0, 1, ksize=3) * 2.2
    nz = np.ones_like(gx)
    nrm = np.stack([-gx, -gy, nz], axis=-1)
    nrm /= np.maximum(np.linalg.norm(nrm, axis=-1, keepdims=True), 1e-8)
    rgb = np.clip((nrm * 0.5 + 0.5) * 255.0 + 0.5, 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(rgb, mode="RGB").save(buf, "JPEG", quality=88)
    return buf.getvalue()


def write(g, prims, atlas_jpg, path, normal_jpg=None):
    """The model with each primitive rebuilt over the atlas: positions, normals, UVs, ray-traced COLOR_0 AO, and normalTexture."""
    out = pygltflib.GLTF2(asset=pygltflib.Asset(version="2.0", generator="ghibli/bake"), scene=0, scenes=g.scenes,
                          nodes=g.nodes, meshes=[], materials=g.materials, accessors=[], bufferViews=[], buffers=[])
    data = bytearray()

    def view(arr, target=None):
        while len(data) % 4:
            data.append(0)
        out.bufferViews.append(pygltflib.BufferView(buffer=0, byteOffset=len(data), byteLength=arr.nbytes, target=target))
        data.extend(arr.tobytes())
        return len(out.bufferViews) - 1

    def accessor(arr, kind, target):
        comp = 5125 if arr.dtype == np.uint32 else 5126
        out.accessors.append(pygltflib.Accessor(bufferView=view(arr, target), componentType=comp, count=len(arr), type=kind,
                                                min=arr.min(0).tolist() if kind == "VEC3" else None,
                                                max=arr.max(0).tolist() if kind == "VEC3" else None))
        return len(out.accessors) - 1

    meshes = {}
    for p in prims:
        ao_rgb = p.get("ao")
        if ao_rgb is None:
            ao_rgb = np.ones((len(p["pos"]), 3), dtype=np.float32)
        col4 = np.hstack([ao_rgb.astype(np.float32), np.ones((len(p["pos"]), 1), dtype=np.float32)])
        prim = pygltflib.Primitive(attributes=pygltflib.Attributes(
            POSITION=accessor(p["pos"].astype(np.float32), "VEC3", 34962),
            NORMAL=accessor(p["nrm"].astype(np.float32), "VEC3", 34962),
            TEXCOORD_0=accessor(p["uv"].astype(np.float32), "VEC2", 34962),
            COLOR_0=accessor(col4, "VEC4", 34962)),
            indices=accessor(p["idx"].astype(np.uint32).reshape(-1), "SCALAR", 34963), material=g.meshes[p["mesh"]].primitives[p["prim"]].material)
        meshes.setdefault(p["mesh"], []).append(prim)
    out.meshes = [pygltflib.Mesh(name=g.meshes[i].name, primitives=meshes[i]) for i in range(len(g.meshes))]
    img = view(np.frombuffer(atlas_jpg, np.uint8))
    out.images = [pygltflib.Image(bufferView=img, mimeType="image/jpeg")]
    out.samplers = [pygltflib.Sampler(magFilter=9729, minFilter=9987, wrapS=33071, wrapT=33071)]
    out.textures = [pygltflib.Texture(source=0, sampler=0)]
    if normal_jpg is not None:
        nimg = view(np.frombuffer(normal_jpg, np.uint8))
        out.images.append(pygltflib.Image(bufferView=nimg, mimeType="image/jpeg"))
        out.textures.append(pygltflib.Texture(source=1, sampler=0))
    for m in out.materials:
        m.pbrMetallicRoughness.baseColorTexture = pygltflib.TextureInfo(index=0)
        m.pbrMetallicRoughness.baseColorFactor = [1, 1, 1, 1]
        if normal_jpg is not None:
            m.normalTexture = pygltflib.NormalMaterialTexture(index=1, scale=0.65)
        m.extras = {"painted": True}
    out.buffers = [pygltflib.Buffer(byteLength=len(data))]
    out.set_binary_blob(bytes(data))
    out.save_binary(path)


# ---------------------------------------------------------------- rasteriser

def raster(xy, z, w, h):
    """Triangles (T,3,2) in pixels with depths (T,3) -> per-pixel triangle (-1 where none), barycentrics, depth."""
    xy, z = torch.as_tensor(xy, dtype=torch.float32), torch.as_tensor(z, dtype=torch.float32)
    lo = torch.floor(xy.min(1).values).long()
    span = (torch.ceil(xy.max(1).values).long() - lo + 1).max(1).values
    best = torch.full((h * w,), float("inf"))
    cands = []
    size = 1
    while True:
        sel = torch.nonzero((span <= size) & (span > size // 2) if size > 1 else span <= 1).flatten()
        if len(sel):
            oy, ox = torch.meshgrid(torch.arange(size), torch.arange(size), indexing="ij")
            off = torch.stack([ox.flatten(), oy.flatten()], -1)
            for chunk in torch.split(sel, max(1, 4_000_000 // (size * size))):
                p = lo[chunk][:, None, :] + off[None]                       # (n, s*s, 2) pixel coords
                c = p.float() + 0.5
                a, b, d = xy[chunk, 0][:, None], xy[chunk, 1][:, None], xy[chunk, 2][:, None]
                area = ((b[..., 0] - a[..., 0]) * (d[..., 1] - a[..., 1]) - (b[..., 1] - a[..., 1]) * (d[..., 0] - a[..., 0]))
                w0 = ((b[..., 0] - c[..., 0]) * (d[..., 1] - c[..., 1]) - (b[..., 1] - c[..., 1]) * (d[..., 0] - c[..., 0])) / area
                w1 = ((d[..., 0] - c[..., 0]) * (a[..., 1] - c[..., 1]) - (d[..., 1] - c[..., 1]) * (a[..., 0] - c[..., 0])) / area
                w2 = 1 - w0 - w1
                inside = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4) & (area.abs() > 1e-9) \
                    & (p[..., 0] >= 0) & (p[..., 0] < w) & (p[..., 1] >= 0) & (p[..., 1] < h)
                k = torch.nonzero(inside)
                tri = chunk[k[:, 0]]
                bary = torch.stack([w0[inside], w1[inside], w2[inside]], -1)
                depth = (bary * z[tri]).sum(-1)
                pix = p[inside][:, 1] * w + p[inside][:, 0]
                best.scatter_reduce_(0, pix, depth, "amin")
                cands.append((pix, tri, bary, depth))
        if size >= max(w, h) * 2 or (span <= size).all():
            break
        size *= 2
    tri_id = torch.full((h * w,), -1, dtype=torch.long)
    bary_out = torch.zeros((h * w, 3))
    for pix, tri, bary, depth in cands:
        win = depth <= best[pix] + 1e-6
        tri_id[pix[win]] = tri[win]
        bary_out[pix[win]] = bary[win]
    return tri_id.view(h, w).numpy(), bary_out.view(h, w, 3).numpy(), best.view(h, w).numpy()


# ---------------------------------------------------------------- views

def camera(az, el):
    d = np.array([np.cos(el) * np.sin(az), np.sin(el), np.cos(el) * np.cos(az)])
    right = np.cross([0, 1, 0], d)
    right /= np.linalg.norm(right)
    up = np.cross(d, right)
    return d, right, up


def project(P, cam, centre, scale):
    d, right, up = cam
    q = P - centre
    return np.stack([VIEW / 2 + (q @ right) * scale, VIEW / 2 - (q @ up) * scale], -1), -(q @ d)


def render(V, F, N, C, cam, centre, scale):
    """The model's flat colour in a soft light, with the depth and coverage the projection needs."""
    xy, z = project(V, cam, centre, scale)
    tri, bary, depth = raster(xy[F], z[F], VIEW, VIEW)
    hit = tri >= 0
    col = np.tile(BACKGROUND, (VIEW, VIEW, 1))
    t = tri[hit]
    b = bary[hit][..., None]
    c = (C[F[t]] * b).sum(1)
    n = (N[F[t]] * b).sum(1)
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
    key = np.array([-0.4, 0.75, 0.5]) + 0.6 * cam[0]
    key /= np.linalg.norm(key)
    lit = 0.62 + 0.38 * np.clip(n @ key, 0, 1)
    col[hit] = np.clip(c * lit[:, None], 0, 1)
    return col, hit, depth


def srgb(c):
    return np.clip(c, 0, 1) ** (1 / 2.2)


def lin(c):
    return np.clip(c, 0, 1) ** 2.2


# ---------------------------------------------------------------- atlas

def unwrap(prims):
    """One atlas for the model: xatlas over all primitives, split back per primitive."""
    V = np.concatenate([p["pos"] for p in prims])
    F = np.concatenate([p["idx"] + o for p, o in zip(prims, np.cumsum([0] + [len(p["pos"]) for p in prims[:-1]]))])
    vmap, idx, uv = xatlas.parametrize(V.astype(np.float32), F.astype(np.uint32))
    starts = np.cumsum([0] + [len(p["idx"]) for p in prims])
    owner = np.searchsorted(np.cumsum([len(p["pos"]) for p in prims]), vmap, side="right")
    base = np.concatenate([[0], np.cumsum([len(p["pos"]) for p in prims])])
    out = []
    for k, p in enumerate(prims):
        faces = idx[starts[k]:starts[k + 1]]
        used = np.unique(faces)
        if (owner[used] != k).any():
            raise SystemExit("xatlas joined vertices across primitives")
        remap = np.full(len(vmap), -1)
        remap[used] = np.arange(len(used))
        local = vmap[used] - base[k]
        nrm = p["nrm"] if p["nrm"] is not None else vertex_normals(p["pos"], p["idx"])
        ao = p["ao"][local] if p.get("ao") is not None else None
        out.append({**p, "pos": p["pos"][local], "nrm": nrm[local], "col": p["col"][local], "ao": ao, "uv": uv[used], "idx": remap[faces]})
    return out


def vertex_normals(V, F):
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    out = np.zeros_like(V)
    for k in range(3):
        np.add.at(out, F[:, k], n)
    return out / (np.linalg.norm(out, axis=1, keepdims=True) + 1e-9)


# The brushwork's scale (pixels of a view), how hard it is pushed, and how far the painting's broad colour may move the
# model's own: with ControlNet holding the silhouette and edges, stronger impasto brushwork and warm/cool shift are carried.
DETAIL_SIGMA, DETAIL_GAIN, SHIFT_GAIN = 10, 2.2, 0.85


def departure(painting, render, hit):
    """What a painting adds to its render, as a per-pixel factor on the model's colour: the painting's own detail over its
    broad tone, times a damped share of its broad shift from the render (each blurred within the silhouette only)."""
    m = hit.astype(np.float32)
    w = ndimage.gaussian_filter(m, DETAIL_SIGMA) + 1e-4
    broad = lambda img: np.stack([ndimage.gaussian_filter(img[..., c] * m, DETAIL_SIGMA) / w for c in range(3)], -1)
    pl, rl = lin(painting), render
    detail = np.clip(pl / (broad(pl) + 1e-3), 0.55, 1.65) ** DETAIL_GAIN
    shift = np.clip(broad(pl) / (broad(rl) + 1e-3), 0.55, 1.65) ** SHIFT_GAIN
    factor = detail * shift
    inside = ndimage.binary_erosion(hit, iterations=6)
    if not inside.any():
        inside = hit
    return factor / np.exp(np.log(factor[inside]).mean(0))


def bake_atlas(prims, size, views, centre, scale, radius):
    """Each texel's colour: the model's own, times the departures of the views that see it, weighted by how face-on."""
    V = np.concatenate([p["pos"] for p in prims])
    N = np.concatenate([p["nrm"] for p in prims])
    C = np.concatenate([p["col"] for p in prims])
    UV = np.concatenate([p["uv"] for p in prims])
    off = np.cumsum([0] + [len(p["pos"]) for p in prims[:-1]])
    F = np.concatenate([p["idx"] + o for p, o in zip(prims, off)])
    # glTF puts UV (0, 0) at the image's top left.
    uvxy = np.stack([UV[:, 0] * size, UV[:, 1] * size], -1)
    tri, bary, _ = raster(uvxy[F], np.zeros((len(F), 3)), size, size)
    hit = tri >= 0
    t, b = tri[hit], bary[hit][..., None]
    P = (V[F[t]] * b).sum(1)
    Nt = (N[F[t]] * b).sum(1)
    Nt /= np.linalg.norm(Nt, axis=1, keepdims=True) + 1e-9
    acc = np.zeros((len(P), 3))
    wsum = np.zeros(len(P))
    for cam, painting, depth, inner in views:
        xy, z = project(P, cam, centre, scale)
        px = np.clip(np.round(xy).astype(int), 0, VIEW - 1)
        seen = (z <= depth[px[:, 1], px[:, 0]] + radius * 0.01) & inner[px[:, 1], px[:, 0]]
        w = np.clip(Nt @ cam[0], 0, 1) ** 2 * seen
        acc += np.log(painting[px[:, 1], px[:, 0]]) * w[:, None]
        wsum += w
    flat = (C[F[t]] * b).sum(1)
    factor = np.exp(np.where(wsum[:, None] > 1e-4, acc / np.maximum(wsum, 1e-4)[:, None], 0))
    col = flat * factor
    img = np.zeros((size, size, 3))
    img[hit] = col
    # Bleed the charts' colour outward so mips and bilinear never fetch the empty gutter.
    _, near = ndimage.distance_transform_edt(~hit, return_indices=True)
    img = img[near[0], near[1]]
    return (srgb(img) * 255 + 0.5).astype(np.uint8)


# ---------------------------------------------------------------- SDXL + ControlNet

def controls(flat, hit, depth):
    """The view's depth (near light, far dark, background black) and its edges, as the ControlNets read them."""
    d = np.where(hit, depth, np.nan)
    lo, hi = np.nanmin(d), np.nanmax(d)
    near = np.where(hit, 1.0 - (depth - lo) / max(hi - lo, 1e-6) * 0.8, 0.0)
    depth_img = Image.fromarray((np.stack([near] * 3, -1) * 255).astype(np.uint8))
    grey = (srgb(flat).mean(-1) * 255).astype(np.uint8)
    edges = cv2.Canny(grey, 40, 120) | cv2.Canny((hit * 255).astype(np.uint8), 50, 150)
    return [depth_img, Image.fromarray(np.stack([edges] * 3, -1))]


def painter():
    from diffusers import StableDiffusionXLControlNetImg2ImgPipeline, ControlNetModel, AutoencoderKL
    dev = device()
    dtype = torch.float16 if dev == "cuda" else torch.float32
    nets = [ControlNetModel.from_pretrained(name, revision=rev, torch_dtype=dtype, variant="fp16") for name, rev, _ in CONTROLNETS]
    vae = AutoencoderKL.from_pretrained(VAE, torch_dtype=dtype)
    return StableDiffusionXLControlNetImg2ImgPipeline.from_pretrained(
        MODEL, controlnet=nets, vae=vae, torch_dtype=dtype, variant="fp16"
    ).to(dev)


def main(glb_dir, files, out, models):
    files = json.load(open(files))
    os.makedirs(out, exist_ok=True)
    rpath = f"{out}/recipes.json"
    recipes = json.load(open(rpath)) if os.path.exists(rpath) else {}
    loaded = []
    pipe = lambda: loaded[0] if loaded else (loaded.append(painter()) or loaded[0])
    for model in models:
        what, sizes = subject(model)
        g0, prims0 = load(f"{glb_dir}/{files[f'model/{model}/lod0']}")
        V = np.concatenate([p["pos"] for p in prims0])
        F = np.concatenate([p["idx"] + o for p, o in zip(prims0, np.cumsum([0] + [len(p["pos"]) for p in prims0[:-1]]))])
        N = np.concatenate([p["nrm"] if p["nrm"] is not None else vertex_normals(p["pos"], p["idx"]) for p in prims0])
        C = np.concatenate([p["col"] for p in prims0])
        centre = (V.min(0) + V.max(0)) / 2
        radius = np.linalg.norm(V - centre, axis=1).max()
        scale = VIEW / 2 * 0.92 / radius
        views, sheet = [], []
        for k, (az, el) in enumerate(VIEWS):
            cam = camera(az, el)
            flat, hit, depth = render(V, F, N, C, cam, centre, scale)
            init = Image.fromarray((srgb(flat) * 255).astype(np.uint8))
            cached = f"{out}/paintings/{model}.v{k}.s{STRENGTH}.png"
            if os.path.exists(cached):
                painted = Image.open(cached).convert("RGB")
            else:
                g = torch.Generator("cpu").manual_seed(SEED + k)
                painted = pipe()(
                    prompt=f"{STYLE}, {what}",
                    negative_prompt=NEG,
                    image=init,
                    control_image=controls(flat, hit, depth),
                    controlnet_conditioning_scale=[s for _, _, s in CONTROLNETS],
                    strength=STRENGTH,
                    guidance_scale=GUIDANCE,
                    num_inference_steps=STEPS,
                    generator=g,
                ).images[0].resize((VIEW, VIEW), Image.LANCZOS)
                os.makedirs(os.path.dirname(cached), exist_ok=True)
                painted.save(cached)
            pa = np.asarray(painted).astype(np.float32) / 255
            inner = ndimage.binary_erosion(hit, iterations=5)
            if not inner.any():
                inner = hit
            views.append((cam, departure(pa, flat, hit), depth, inner))
            sheet.append(np.concatenate([np.asarray(init), np.asarray(painted)], 1))
            print(model, "view", k, flush=True)
        Image.fromarray(np.concatenate(sheet, 0)).resize((1024, 512 * len(VIEWS))).save(f"{out}/{model}.views.png")
        for lod, size in enumerate(sizes):
            g, prims = load(f"{glb_dir}/{files[f'model/{model}/lod{lod}']}")
            prims = unwrap(prims)
            atlas = bake_atlas(prims, size, views, centre, scale, radius)
            normal_jpg = bake_normal_atlas(atlas)
            buf = io.BytesIO()
            Image.fromarray(atlas).save(buf, "JPEG", quality=90)
            write(g, prims, buf.getvalue(), f"{out}/{model}_lod{lod}.glb", normal_jpg=normal_jpg)
            Image.fromarray(atlas).save(f"{out}/{model}_lod{lod}.atlas.jpg", quality=90)
            print(model, "lod", lod, size, flush=True)
        recipes[model] = {"from": {f"lod{l}": files[f"model/{model}/lod{l}"] for l in range(len(sizes))},
                          "views": [[round(float(a), 4), round(float(e), 4)] for a, e in VIEWS], "view_px": VIEW,
                          "prompt": f"{STYLE}, {what}", "negative": NEG, "strength": STRENGTH, "steps": STEPS,
                          "guidance": GUIDANCE, "seed": SEED, "model": MODEL, "vae": VAE,
                          "controlnets": [{"model": n, "revision": r, "scale": s} for n, r, s in CONTROLNETS],
                          "atlas_px": list(sizes), "unwrap": "xatlas 0.0.10"}
        json.dump(recipes, open(rpath, "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:])
