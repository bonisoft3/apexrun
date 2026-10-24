"""Which build ships for each logical id, with its procedural source record (assets-pack manifest shape)."""
import hashlib, json, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
GAME = "/Users/davi/code/trash/.worktrees/apex-outrun/apps/apexrun/assets/manifest.json"
IDS = ["tree-fir-a", "tree-fir-b", "tree-pine-young", "tree-broadleaf-a", "tree-broadleaf-b", "shrub-b", "shrub-tropical",
       "shrub-desert", "fern", "grass-tuft", "grass-beach", "palm-a", "palm-b", "palm-c"]


def script_sha(name):
    return hashlib.sha256(open(os.path.join(ROOT, "scripts", name), "rb").read()).hexdigest()


def picks():
    import plants
    game = json.load(open(GAME))
    P = {}
    for name in IDS:
        b = json.load(open(f"{ROOT}/work/build/{name}.json"))
        fn = plants.BUILDERS[name].__name__
        params = {"conifer": plants.CONIFERS, "broadleaf": plants.BROADLEAF, "shrub": plants.SHRUBS, "grass": plants.GRASS,
                  "palm": plants.PALMS}.get(fn, {}).get(name, {})
        P[name] = dict(build=name, lods=[0, 1, 2], license="CC0",
                       source={"procedural": {"script": "scripts/plants.py", "script_sha256": script_sha("plants.py"),
                                              "kit_sha256": script_sha("kit.py"), "builder": fn, "params": params}},
                       note=b["note"] + "; COLOR_0 (VEC3, linear) multiplies baseColor: height gradient x baked per-vertex AO",
                       extra={"stages": game[f"model/{name}/lod0"]["stages"]})
    return P


PICKS = picks()
