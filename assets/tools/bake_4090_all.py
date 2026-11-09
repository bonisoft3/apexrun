"""End-to-end 2025 gouache asset builder & RTX 4090 baker.

1. Builds procedural 3D botanical meshes (`cartoon/plants/plants.py`) and geological landforms (`props/landforms.py`).
2. Runs multi-view SDXL + ControlNet (Depth + Canny) gouache painting and 2048/1024/512 xatlas projection (`ghibli/bake/bake.py`)
   with tangent-space impasto normal maps (`normalTexture`) and ray-traced multi-bounce hemisphere + ground-plane AO (`COLOR_0`).
3. Writes content-addressed `<sha256>.glb` blobs into `WORK/out_blobs/` and a manifest patch `WORK/manifest_patch.json`.
"""
import hashlib, json, os, shutil, struct, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from workdir import WORK

PLANT_MODELS = [
    "palm-a", "palm-b", "palm-c",
    "tree-broadleaf-a", "tree-broadleaf-b",
    "tree-fir-a", "tree-fir-b", "tree-pine-young",
    "shrub-b", "shrub-tropical", "shrub-desert",
    "fern", "grass-tuft", "grass-beach",
]
LANDFORM_MODELS = [
    "cliff-coast-a", "cliff-coast-b",
    "mesa-a", "mesa-b",
]
BAKE_MODELS = [
    "palm-a", "palm-b", "palm-c",
    "tree-broadleaf-a", "tree-broadleaf-b",
    "tree-fir-a", "tree-fir-b", "tree-pine-young",
    "shrub-b", "shrub-tropical", "shrub-desert",
    "cliff-coast-a", "cliff-coast-b",
    "mesa-a", "mesa-b",
]


def sha256_file(path: str) -> str:
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def glb_info(path: str) -> tuple[int, list[str], list]:
    b = open(path, "rb").read()
    jl = struct.unpack_from("<I", b, 12)[0]
    g = json.loads(b[20:20 + jl])
    tris = sum(g["accessors"][pr["indices"]]["count"] // 3 for me in g["meshes"] for pr in me["primitives"])
    mats = [m["name"] for m in g.get("materials", [])]
    nodes = [n.get("name") for n in g.get("nodes", [])]
    return int(tris), mats, nodes


def main():
    models_to_bake = sys.argv[1:] if len(sys.argv) > 1 else BAKE_MODELS
    raw_dir = os.path.join(WORK, "gouache_2025", "raw")
    bake_dir = os.path.join(WORK, "gouache_2025", "baked")
    blobs_dir = os.path.join(WORK, "gouache_2025", "blobs")
    os.makedirs(raw_dir, exist_ok=True)
    os.makedirs(bake_dir, exist_ok=True)
    os.makedirs(blobs_dir, exist_ok=True)

    # 1. Build procedural botanical & landform meshes
    subprocess.run([sys.executable, os.path.join(HERE, "cartoon", "plants", "plants.py")], check=True)
    subprocess.run([sys.executable, os.path.join(HERE, "props", "landforms.py")], check=True)

    files_map = {}
    meta_by_model = {}

    for m in PLANT_MODELS:
        rec = json.load(open(os.path.join(HERE, "cartoon", "work", "build", f"{m}.json")))
        meta_by_model[m] = ("cartoon/plants/plants.py", rec)
        for lod_rec in rec["lods"]:
            lod = lod_rec["lod"]
            src = os.path.join(HERE, "cartoon", lod_rec["path"])
            h = sha256_file(src)
            dst_name = f"{h}.glb"
            shutil.copyfile(src, os.path.join(raw_dir, dst_name))
            files_map[f"model/{m}/lod{lod}"] = dst_name

    for m in LANDFORM_MODELS:
        rec = json.load(open(os.path.join(HERE, "work", "build", f"{m}.json")))
        meta_by_model[m] = ("props/landforms.py", rec)
        for lod_rec in rec["lods"]:
            lod = lod_rec["lod"]
            src = os.path.join(HERE, lod_rec["path"])
            h = sha256_file(src)
            dst_name = f"{h}.glb"
            shutil.copyfile(src, os.path.join(raw_dir, dst_name))
            files_map[f"model/{m}/lod{lod}"] = dst_name

    files_json = os.path.join(raw_dir, "files.json")
    json.dump(files_map, open(files_json, "w"), indent=1, sort_keys=True)

    # 2. Run SDXL + ControlNet multi-view gouache bake on the GPU
    if models_to_bake:
        subprocess.run(
            [sys.executable, os.path.join(HERE, "ghibli", "bake", "bake.py"), raw_dir, files_json, bake_dir, *models_to_bake],
            check=True,
        )

    bake_recipes_path = os.path.join(bake_dir, "recipes.json")
    bake_recipes = json.load(open(bake_recipes_path)) if os.path.exists(bake_recipes_path) else {}
    bake_script_sha = sha256_file(os.path.join(HERE, "ghibli", "bake", "bake.py"))
    kit_sha = sha256_file(os.path.join(HERE, "cartoon", "plants", "kit.py"))
    plants_sha = sha256_file(os.path.join(HERE, "cartoon", "plants", "plants.py"))
    landforms_sha = sha256_file(os.path.join(HERE, "props", "landforms.py"))

    patch = {}
    all_models = [m for m in (PLANT_MODELS + LANDFORM_MODELS) if (m in models_to_bake or m in ("fern", "grass-tuft", "grass-beach"))]
    for m in all_models:
        script_rel, rec = meta_by_model[m]
        is_baked = m in bake_recipes
        for lod_rec in rec["lods"]:
            lod = lod_rec["lod"]
            key = f"model/{m}/lod{lod}"
            if is_baked:
                glb_path = os.path.join(bake_dir, f"{m}_lod{lod}.glb")
            else:
                glb_path = os.path.join(raw_dir, files_map[key])
            h = sha256_file(glb_path)
            fname = f"{h}.glb"
            shutil.copyfile(glb_path, os.path.join(blobs_dir, fname))
            tris, mats, nodes = glb_info(glb_path)
            note = rec["note"]
            if is_baked:
                note = f"{note}; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture"
            entry = {
                "file": fname,
                "sha256": h,
                "bytes": os.path.getsize(glb_path),
                "tris": tris,
                "bounds_m": lod_rec["bounds_m"],
                "materials": mats,
                "nodes": nodes,
                "note": note,
                "script": script_rel,
                "script_sha256": plants_sha if "plants.py" in script_rel else landforms_sha,
                "kit_sha256": kit_sha if "plants.py" in script_rel else None,
            }
            if is_baked:
                br = bake_recipes[m]
                entry["baked"] = {
                    "atlas_px": br["atlas_px"],
                    "controlnets": br.get("controlnets", []),
                    "from": br["from"][f"lod{lod}"],
                    "guidance": br["guidance"],
                    "model": br["model"],
                    "negative": br["negative"],
                    "prompt": br["prompt"],
                    "script": "tools/ghibli/bake/bake.py",
                    "script_sha256": bake_script_sha,
                    "seed": br["seed"],
                    "steps": br["steps"],
                    "strength": br["strength"],
                    "unwrap": br["unwrap"],
                    "vae": br["vae"],
                    "view_px": br["view_px"],
                    "views": br["views"],
                }
            patch[key] = entry

    patch_path = os.path.join(blobs_dir, "manifest_patch.json")
    json.dump(patch, open(patch_path, "w"), indent=2, sort_keys=True)
    print(f"Wrote {len(patch)} entries to {patch_path}")

    manifest_path = os.path.abspath(os.path.join(HERE, "..", "manifest.json"))
    if os.path.exists(manifest_path):
        manifest = json.load(open(manifest_path))
        for k, v in patch.items():
            cur = manifest.setdefault(k, {})
            cur["file"] = v["file"]
            cur["sha256"] = v["sha256"]
            cur["bytes"] = v["bytes"]
            cur["tris"] = v["tris"]
            cur["bounds_m"] = v["bounds_m"]
            cur["materials"] = v["materials"]
            cur["nodes"] = v["nodes"]
            cur["note"] = v["note"]
            src = cur.setdefault("source", {})
            proc = src.setdefault("procedural", {})
            proc["script"] = v["script"]
            proc["script_sha256"] = v["script_sha256"]
            if v.get("kit_sha256"):
                proc["kit_sha256"] = v["kit_sha256"]
            if "baked" in v:
                src["baked"] = v["baked"]
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=2, sort_keys=True)
            f.write("\n")
        print(f"Merged {len(patch)} entries into {manifest_path}")


if __name__ == "__main__":
    main()
