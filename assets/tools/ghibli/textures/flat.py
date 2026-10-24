"""Paint a ground set from its palette: flat gouache regions with brush-stroke edges, bright as the concept's earth.

Where an SDXL repaint of the cartoon set failed, or carried the set's dark mean colour over, the set is synthesised:
broad periodic noise, pushed by brush strokes, is cut into the palette's colours by quantile, so each region is one flat
wash whose edges are strokes; a faint fine stroke texture lies inside each region. The normal is the strokes' gentle
relief, the arm matt and unoccluded.

usage: flat.py <manifest.json> <out_dir> [set ...]  -> <out_dir>/<sha256>.webp + <out_dir>/manifest.json (fragment)
"""
import hashlib, io, json, os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brush

# set -> palette (sRGB, darkest to lightest, each with its share), region scale px, edge stroke (length, width, weight),
# fine stroke amount (sRGB levels), roughness, seed
SETS = {
    # The concept's desert floor is red-orange earth, held back from t28's orange sand (saturation 0.70 there) but not the
    # olive of t29, with patches of scrub green.
    "sand-desert": dict(palette=[("#8E5A44", 0.25), ("#A46C52", 0.35), ("#B07E62", 0.25), ("#727248", 0.15)], scale=110,
                        edge=(140, 20, 0.3), fine=7, rough=0.95, seed=31),
    "sand-beach": dict(palette=[("#CDBB98", 0.25), ("#DBCCAA", 0.4), ("#E7DCC0", 0.35)], scale=120, edge=(120, 18, 0.3),
                       fine=5, rough=0.95, seed=33),
    # Measured against the concepts' land (saturation 0.38, luminance 0.27), the greens are lighter and held back.
    "grass": dict(palette=[("#5E7A48", 0.25), ("#6E8A52", 0.4), ("#80985C", 0.25), ("#94A46C", 0.1)], scale=90,
                  edge=(60, 12, 0.3), fine=8, rough=0.95, seed=35),
    "forest-floor": dict(palette=[("#4E6A3C", 0.35), ("#5E7A44", 0.4), ("#7A7E4C", 0.25)], scale=80, edge=(60, 16, 0.3),
                         fine=8, rough=0.95, seed=37),
    "field-soil": dict(palette=[("#8E5F38", 0.3), ("#A87448", 0.45), ("#BF8C5A", 0.25)], scale=100, edge=(160, 16, 0.3),
                       fine=8, rough=0.96, seed=39),
    "rock-granite": dict(palette=[("#8E949A", 0.3), ("#A9AEB2", 0.45), ("#C4C6C4", 0.25)], scale=90, edge=(70, 20, 0.3),
                         fine=7, rough=0.9, seed=41),
    "ruins-stone": dict(palette=[("#B89A72", 0.3), ("#CDB088", 0.45), ("#DDC5A0", 0.25)], scale=90, edge=(60, 18, 0.3),
                        fine=6, rough=0.9, seed=43),
    "asphalt": dict(palette=[("#2B2826", 0.35), ("#302D2A", 0.45), ("#36322E", 0.2)], scale=180, edge=(200, 16, 0.3),
                    fine=2, rough=0.9, seed=45),
}
LUMA = np.array([0.2126, 0.7152, 0.0722])


def hexrgb(h):
    return np.array([int(h[k:k + 2], 16) for k in (1, 3, 5)], np.float32)


def paint(spec, n):
    rng = np.random.default_rng(spec["seed"])
    length, width, w = spec["edge"]
    t = brush.periodic(rng, n, spec["scale"]) + w * brush.strokes(rng, n, length * n / 2048, width * n / 2048)
    shares = np.cumsum([s for _, s in spec["palette"]])[:-1]
    cuts = np.quantile(t, shares)
    idx = np.searchsorted(cuts, t)
    cols = np.stack([hexrgb(h) for h, _ in spec["palette"]])
    fine = brush.strokes(rng, n, 24 * n / 2048, 3 * n / 2048)
    a = cols[idx] + spec["fine"] * np.clip(fine, -2.5, 2.5)[..., None] / 2.5
    return np.clip(a, 0, 255).astype(np.uint8), fine


def encode(img, enc):
    b = io.BytesIO()
    img = img.resize((enc["size"], enc["size"]), Image.LANCZOS)
    img.save(b, "WEBP", lossless=True, method=enc["method"]) if enc.get("lossless") else img.save(b, "WEBP", quality=enc["quality"], method=enc["method"])
    return b.getvalue()


def main(manifest, out, names):
    m = json.load(open(manifest))
    os.makedirs(out, exist_ok=True)
    frag = {}
    script = os.path.relpath(os.path.abspath(__file__), os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    for name in names:
        spec = SETS[name]
        n = m[f"tex/{name}/albedo"]["encode"]["size"]
        alb, fine = paint(spec, n)
        h = fine / np.abs(fine).max()
        dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / 2
        dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / 2
        k = 0.05 / (np.sqrt((dx ** 2 + dy ** 2).mean()) + 1e-8)
        nv = np.stack([-dx * k, dy * k, np.ones_like(h)], -1)
        nv /= np.linalg.norm(nv, axis=-1, keepdims=True)
        normal = Image.fromarray(((nv * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8))
        arm = Image.fromarray((np.stack([np.ones_like(h), np.full_like(h, spec["rough"]), np.zeros_like(h)], -1) * 255 + 0.5).astype(np.uint8))
        source = {"procedural": {"script": script, "builder": "flat", "params": spec}}
        for kind, img in (("albedo", Image.fromarray(alb)), ("normal", normal), ("arm", arm)):
            old = m[f"tex/{name}/{kind}"]
            data = encode(img, old["encode"])
            sha = hashlib.sha256(data).hexdigest()
            open(f"{out}/{sha}.webp", "wb").write(data)
            frag[f"tex/{name}/{kind}"] = {**{k: v for k, v in old.items() if k not in ("bytes", "file", "sha256", "source")},
                                          "bytes": len(data), "file": f"{sha}.webp", "sha256": sha, "source": source}
        print(name, "mean", alb.reshape(-1, 3).mean(0).round(1), flush=True)
    json.dump(dict(sorted(frag.items())), open(f"{out}/manifest.json", "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3:] or list(SETS))
