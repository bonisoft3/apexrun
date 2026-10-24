"""Content-address every registered item into out/<sha256>.<ext> and write out/manifest.json."""
import glob, hashlib, json, os, shutil, sys
sys.path.insert(0, os.path.dirname(__file__))
from items import ROOT, ITEMS

os.makedirs(f"{ROOT}/out", exist_ok=True)
manifest, used = {}, set()
for f in sorted(glob.glob(f"{ITEMS}/*.json")):
    it = json.load(open(f))
    path = os.path.join(ROOT, it.pop("path"))
    data = open(path, "rb").read()
    sha = hashlib.sha256(data).hexdigest()
    ext = os.path.splitext(path)[1].lstrip(".")
    name = f"{sha}.{ext}"
    dst = f"{ROOT}/out/{name}"
    if not os.path.exists(dst):
        shutil.copyfile(path, dst)
    used.add(name)
    lid = it.pop("id")
    manifest[lid] = {"file": name, "sha256": sha, "bytes": len(data), **it}
stale = [f for f in os.listdir(f"{ROOT}/out") if f not in used and f != "manifest.json"]
for f in stale:
    os.remove(f"{ROOT}/out/{f}")
total = sum(m["bytes"] for m in manifest.values())
json.dump(manifest, open(f"{ROOT}/out/manifest.json", "w"), indent=1, sort_keys=True)
by = {}
for m in manifest.values():
    by[m["kind"]] = by.get(m["kind"], 0) + m["bytes"]
print(json.dumps({"items": len(manifest), "bytes": total, "by_kind": by, "removed_stale": len(stale)}))
