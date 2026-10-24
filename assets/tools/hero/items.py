"""Work items: every producing script registers its outputs here; pack.py content-addresses them."""
import json, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ITEMS = f"{ROOT}/work/items"

def register(logical_id, path, kind, source, **extra):
    os.makedirs(ITEMS, exist_ok=True)
    rec = {"id": logical_id, "path": os.path.relpath(os.path.abspath(path), ROOT), "kind": kind,
           "source": source, "license": "CC0", **extra}
    json.dump(rec, open(f"{ITEMS}/{logical_id.replace('/', '__')}.json", "w"), indent=1)
    return rec

def polyhaven_source(ph_id, res, url):
    return {"polyhaven": {"id": ph_id, "res": res, "url": url}}
