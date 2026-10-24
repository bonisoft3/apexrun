"""Minimal glTF 2.0 reader (world-space primitives) and GLB writer (plain core glTF + EXT_texture_webp, KHR_materials_clearcoat, KHR_materials_emissive_strength)."""
import base64, io, json, os, struct
import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

class Prim:
    def __init__(self, material, pos, nor, uv, idx, node=""):
        self.material, self.pos, self.nor, self.uv, self.idx, self.node = material, pos, nor, uv, idx, node
    @property
    def tris(self):
        return len(self.idx)

def _quat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])

def _local(n):
    if "matrix" in n:
        return np.array(n["matrix"], np.float64).reshape(4, 4).T
    m = np.eye(4)
    s = np.diag(n.get("scale", [1, 1, 1]))
    m[:3, :3] = _quat(n.get("rotation", [0, 0, 0, 1])) @ s
    m[:3, 3] = n.get("translation", [0, 0, 0])
    return m

def load(path):
    """-> (gltf json, dir, buffers, list[(root node name, Prim)]) with positions/normals in world space and KHR_texture_transform applied to UVs."""
    d = os.path.dirname(path)
    if path.endswith(".glb"):
        b = open(path, "rb").read()
        jl = struct.unpack_from("<I", b, 12)[0]
        g = json.loads(b[20:20 + jl])
        bins = [b[20 + jl + 8:]]
    else:
        g = json.load(open(path))
        bins = []
        for buf in g["buffers"]:
            u = buf["uri"]
            bins.append(base64.b64decode(u.split(",", 1)[1]) if u.startswith("data:") else open(os.path.join(d, u), "rb").read())

    def acc(i):
        a = g["accessors"][i]
        bv = g["bufferViews"][a["bufferView"]]
        dt = np.dtype(CT[a["componentType"]])
        n = NC[a["type"]]
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = bv.get("byteStride", 0) or dt.itemsize * n
        raw = np.frombuffer(bins[bv["buffer"]], np.uint8, count=stride * (a["count"] - 1) + dt.itemsize * n, offset=off)
        arr = np.lib.stride_tricks.as_strided(raw, (a["count"], dt.itemsize * n), (stride, 1)).copy().view(dt).reshape(a["count"], n)
        if a.get("normalized"):
            arr = arr.astype(np.float32) / np.iinfo(dt).max
        if "sparse" in a:
            raise NotImplementedError("sparse accessor")
        return arr

    def uv_xform(mi):
        if mi is None:
            return None
        m = g["materials"][mi]
        pbr = m.get("pbrMetallicRoughness", {})
        t = pbr.get("baseColorTexture") or m.get("normalTexture")
        return (t or {}).get("extensions", {}).get("KHR_texture_transform")

    out = []
    def walk(ni, parent, root):
        n = g["nodes"][ni]
        w = parent @ _local(n)
        if "mesh" in n:
            for p in g["meshes"][n["mesh"]]["primitives"]:
                if p.get("mode", 4) != 4:
                    raise NotImplementedError("non-triangle primitive")
                pos = acc(p["attributes"]["POSITION"]).astype(np.float64)
                pos = pos @ w[:3, :3].T + w[:3, 3]
                nor = acc(p["attributes"]["NORMAL"]).astype(np.float64) if "NORMAL" in p["attributes"] else None
                if nor is not None:
                    nor = nor @ np.linalg.inv(w[:3, :3]).T
                    nor /= np.linalg.norm(nor, axis=1, keepdims=True) + 1e-12
                uv = acc(p["attributes"]["TEXCOORD_0"]).astype(np.float64) if "TEXCOORD_0" in p["attributes"] else None
                tt = uv_xform(p.get("material"))
                if tt and uv is not None:
                    o, r, s = tt.get("offset", [0, 0]), tt.get("rotation", 0.0), tt.get("scale", [1, 1])
                    c, si = np.cos(r), np.sin(r)
                    uv = np.stack([uv[:, 0] * s[0], uv[:, 1] * s[1]], 1)
                    uv = np.stack([c * uv[:, 0] + si * uv[:, 1], -si * uv[:, 0] + c * uv[:, 1]], 1) + o
                idx = acc(p["indices"]).reshape(-1, 3).astype(np.int64) if "indices" in p else np.arange(len(pos)).reshape(-1, 3)
                if np.linalg.det(w[:3, :3]) < 0:
                    idx = idx[:, ::-1]
                out.append((root, Prim(p.get("material"), pos, nor, uv, idx, n.get("name", ""))))
        for c in n.get("children", []):
            walk(c, w, root)
    for r in g["scenes"][g.get("scene", 0)].get("nodes", []):
        walk(r, np.eye(4), g["nodes"][r].get("name", str(r)))
    return g, d, bins, out

def image_bytes(g, d, bins, tex_index):
    """Raw encoded bytes of a glTF texture's image."""
    t = g["textures"][tex_index]
    src = t.get("source")
    if src is None:
        src = t["extensions"]["EXT_texture_webp"]["source"]
    im = g["images"][src]
    if "uri" in im:
        return open(os.path.join(d, im["uri"]), "rb").read()
    bv = g["bufferViews"][im["bufferView"]]
    return bins[bv["buffer"]][bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]

def write_glb(path, meshes, materials, images, generator="apex-outrun-assets"):
    """meshes: list of (name, [Prim]) or (name, [Prim], translation) each becoming one root node.
    materials: list of glTF material dicts whose texture slots name image indices as {"image": i}.
    images: list of (bytes, mime)."""
    body = bytearray()
    views, accs = [], []
    def add_view(data, target=None):
        while len(body) % 4:
            body.append(0)
        views.append({"buffer": 0, "byteOffset": len(body), "byteLength": len(data), **({"target": target} if target else {})})
        body.extend(data)
        return len(views) - 1
    def add_acc(arr, comp, typ, target, minmax=False):
        v = add_view(arr.tobytes(), target)
        a = {"bufferView": v, "componentType": comp, "count": int(arr.shape[0]), "type": typ}
        if minmax:
            a["min"] = arr.min(0).tolist(); a["max"] = arr.max(0).tolist()
        accs.append(a)
        return len(accs) - 1
    gmeshes, nodes = [], []
    for name, prims, *tr in meshes:
        gp = []
        for p in prims:
            attrs = {"POSITION": add_acc(p.pos.astype(np.float32), 5126, "VEC3", 34962, True)}
            if p.nor is not None:
                attrs["NORMAL"] = add_acc(p.nor.astype(np.float32), 5126, "VEC3", 34962)
            if p.uv is not None:
                attrs["TEXCOORD_0"] = add_acc(p.uv.astype(np.float32), 5126, "VEC2", 34962)
            if getattr(p, "color", None) is not None:  # linear RGB multiplier of baseColor; VEC3, since a VEC4 colour makes
                # Babylon's loader flag the mesh hasVertexAlpha and draw it alpha-blended (unsorted, no depth write)
                attrs["COLOR_0"] = add_acc(np.asarray(p.color, np.float32), 5126, "VEC3", 34962)
            ix = p.idx.reshape(-1)
            ix = ix.astype(np.uint16) if len(p.pos) < 65536 else ix.astype(np.uint32)
            ia = add_acc(ix, 5123 if ix.dtype == np.uint16 else 5125, "SCALAR", 34963)
            gp.append({"attributes": attrs, "indices": ia, "material": p.material, "mode": 4})
        gmeshes.append({"name": name, "primitives": gp})
        nodes.append({"name": name, "mesh": len(gmeshes) - 1, **({"translation": [float(t) for t in tr[0]]} if tr else {})})
    gimages, gtex, used = [], [], set()
    for data, mime in images:
        v = add_view(data)
        gimages.append({"bufferView": v, "mimeType": mime})
    for i, (_, mime) in enumerate(images):
        if mime == "image/webp":
            gtex.append({"sampler": 0, "extensions": {"EXT_texture_webp": {"source": i}}}); used.add("EXT_texture_webp")
        else:
            gtex.append({"sampler": 0, "source": i})
    def fix(o):
        if isinstance(o, dict):
            if "image" in o and len(o) <= 3:
                o = dict(o); o["index"] = o.pop("image")
            return {k: fix(v) for k, v in o.items()}
        if isinstance(o, list):
            return [fix(x) for x in o]
        return o
    mats = [fix(m) for m in materials]
    for m in mats:
        used.update(m.get("extensions", {}).keys())
    while len(body) % 4:
        body.append(0)
    g = {"asset": {"version": "2.0", "generator": generator}, "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}],
         "nodes": nodes, "meshes": gmeshes, "materials": mats, "accessors": accs, "bufferViews": views,
         "buffers": [{"byteLength": len(body)}]}
    if gimages:
        g["images"], g["textures"] = gimages, gtex
        g["samplers"] = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]
    if used:
        g["extensionsUsed"] = sorted(used)
        if "EXT_texture_webp" in used:
            g["extensionsRequired"] = ["EXT_texture_webp"]
    js = json.dumps(g, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(body))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(body), 0x004E4942) + bytes(body)
    open(path, "wb").write(out)
    return len(out)
