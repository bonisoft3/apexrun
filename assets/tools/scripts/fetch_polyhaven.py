"""Fetch the selected Poly Haven assets into raw/polyhaven/<id>/ and record every URL in raw/polyhaven/fetched.json."""
import hashlib, json, os, sys, time
import requests
sys.path.insert(0, os.path.dirname(__file__))
from selection import HDRIS, TEXTURES, MODELS

ROOT = os.path.join(os.path.dirname(__file__), "..", "raw", "polyhaven")
H = {"User-Agent": "apex-outrun-assets/0.1 (davi@davi.eng.br)"}
RES = "2k"

def api(ph):
    r = requests.get(f"https://api.polyhaven.com/files/{ph}", headers=H, timeout=60)
    r.raise_for_status()
    return r.json()

def get(url, dest, md5=None, size=None):
    if os.path.exists(dest) and (size is None or os.path.getsize(dest) == size):
        return os.path.getsize(dest)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    r = requests.get(url, headers=H, timeout=600)
    r.raise_for_status()
    b = r.content
    if md5 and hashlib.md5(b).hexdigest() != md5:
        raise RuntimeError(f"md5 mismatch {url}")
    if size and len(b) != size:
        raise RuntimeError(f"size mismatch {url}: {len(b)} != {size}")
    open(dest, "wb").write(b)
    return len(b)

log, total = {}, 0
for stage, ph in HDRIS.items():
    f = api(ph)["hdri"][RES]["hdr"]
    total += get(f["url"], f"{ROOT}/{ph}/{ph}_{RES}.hdr", f.get("md5"), f["size"])
    log[ph] = {"kind": "hdri", "res": RES, "files": {"hdr": f["url"]}}
    print(ph, flush=True)
MAPS = {"diff": ("Diffuse", "jpg"), "nor_gl": ("nor_gl", "png"), "arm": ("arm", "png")}
for name, ph in TEXTURES.items():
    a, files = api(ph), {}
    for key, (field, ext) in MAPS.items():
        f = a[field][RES][ext]
        total += get(f["url"], f"{ROOT}/{ph}/{ph}_{key}_{RES}.{ext}", f.get("md5"), f["size"])
        files[key] = f["url"]
    log[ph] = {"kind": "texture", "res": RES, "files": files}
    print(ph, flush=True)
for ph in sorted({m['ph'] for m in MODELS.values()}):
    g = api(ph)["gltf"][RES]["gltf"]
    d = f"{ROOT}/{ph}"
    total += get(g["url"], f"{d}/{os.path.basename(g['url'])}", g.get("md5"), g["size"])
    files = {"gltf": g["url"]}
    for rel, f in g["include"].items():
        total += get(f["url"], f"{d}/{rel}", f.get("md5"), f["size"])
        files[rel] = f["url"]
    # the glTF exports omit the foliage opacity maps; fetch them beside the model
    a = api(ph)
    for key in [k for k in a if k.lower().endswith("alpha")]:
        f = a[key][RES]["jpg"]
        rel = f"textures/{ph}_{key.lower()}_{RES}.jpg"
        total += get(f["url"], f"{d}/{rel}", f.get("md5"), f["size"])
        files[rel] = f["url"]
    log[ph] = {"kind": "model", "res": RES, "files": files}
    print(ph, flush=True)
json.dump({"fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "bytes": total, "assets": log},
          open(f"{ROOT}/fetched.json", "w"), indent=1)
print("total bytes", total)
