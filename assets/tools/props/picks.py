"""Which build ships for each logical id, with its source record (assets-pack manifest shape) and note."""
import hashlib, json, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PACK = json.load(open(os.path.join(ROOT, "..", "assets-pack", "out", "manifest.json")))
HY = {"model": "tencent/Hunyuan3D-2", "model_revision": "9cd649ba6913f7a852e3286bad86bfa9a2d83dcf"}


def script_sha(name):
    return hashlib.sha256(open(os.path.join(ROOT, "scripts", name), "rb").read()).hexdigest()


def proc(script, builder, **params):
    return {"procedural": {"script": f"scripts/{script}", "script_sha256": script_sha(script), "builder": builder, "params": params}}


def hy_source(cand, sdxl_job, ref_seed, extra):
    hy = json.load(open(f"{ROOT}/work/hy/{cand}.json"))
    sd = json.load(open(f"{ROOT}/work/sdxl/{sdxl_job}.json"))
    return {"generated": {**HY, "prompt": sd["prompt"], "negative": sd["negative"], "seed": hy["seed"],
                          "steps": hy["params"]["num_inference_steps"],
                          "params": {"hunyuan": hy["params"], "hunyuan_code": hy["code_commit"], "hunyuan_subfolder": hy["subfolder"],
                                     "reference": {"model": sd["model"], "model_revision": sd["model_revision"], "vae": sd["vae"],
                                                   "vae_revision": sd["vae_revision"], "scheduler": sd["scheduler"], "seed": ref_seed,
                                                   "steps": sd["steps"], "guidance": sd["guidance"], "width": sd["width"], "height": sd["height"],
                                                   "cutout": "rembg 2.0.62 u2net, hard alpha"}, **extra}}}


def old_car_source(car, extra):
    """The sedan, convertible and pickup reuse the art pack's Hunyuan shapes; their prompt/seed come from its manifest."""
    src = json.loads(json.dumps(PACK[f"model/{car}/lod0"]["source"]))
    p = src["generated"]["params"]
    for k in ("classify", "face_labels", "body", "wheels"):
        p.pop(k, None)
    p.update(extra)
    return src


CAR_NOTE = ("Y up, metres, origin on the ground at the centre of the body's footprint, forward +Z (as the hero car), +X is the "
            "car's left. Wheel nodes wheel_FL/FR/RL/RR are pivoted at their hubs (spin about local X, steer about Y). Recolour "
            "`paint`; drive brake lights with `taillight` emissiveStrength. Materials cut from geometry only (hero pipeline).")


def car_extra(car):
    a = json.load(open(f"{ROOT}/work/align/{car}.json"))
    return {"align": {k: a[k] for k in ("end", "seen_side", "iou", "yaw", "pitch", "mirror_yaw_deg", "scale", "raw_dims", "target")},
            "body": "mirror-symmetrised (seen half kept), scaled to real size, wheel blobs flattened into dark backdrops, quadric-"
                    "decimated, materials from soft geometric regions + crisp convex regions (scripts/specs_traffic.py), islands cleaned",
            "wheels": "procedural 5-spoke alloy and tyre (hero wheel.py, lighter LODs)"}


def picks():
    P = {}
    for t, desc in (("tower-a", "art-deco setbacks, stepped crown and spire, 80 m"), ("tower-b", "curtain-wall slab, 57.8 m"),
                    ("tower-c", "octagonal tower with a lit crown band and antenna, 46 m")):
        P[t] = dict(build=t, lods=[0, 1, 2], license="CC0", source=proc("towers.py", t.replace("-", "_")),
                    note=f"{desc}. `window` is emissive (lit cells from its emissive texture, 16x16 cells of one bay x one floor, "
                         "1.6 x 3.6 m); `facade` body; `trim` dark metal. Row 0 of the texture is all lit (crown bands).")
    for name, script, fn in (("street-lamp", "props.py", "street_lamp"), 
                             ("hangar", "props.py", "hangar"), ("lighthouse", "props.py", "lighthouse"),
                             ("sailboat", "props.py", "sailboat"), ("castle-tower", "props_b.py", "castle_tower"),
                             ("windmill", "props_b.py", "windmill"), ("cypress", "props_b.py", "cypress"),
                             ("colosseum", "props_b.py", "colosseum")):
        b = json.load(open(f"{ROOT}/work/build/{name}.json"))
        P[name] = dict(build=name, lods=[0, 1, 2], license="CC0", source=proc(script, fn), note=b["note"])
    for name in ("mesa-a", "mesa-b", "cliff-coast-a", "cliff-coast-b"):
        b = json.load(open(f"{ROOT}/work/build/{name}.json"))
        P[name] = dict(build=name, lods=[0, 1, 2], license="CC0", source=proc("landforms.py", name), note=b["note"])
    b = json.load(open(f"{ROOT}/work/build/broken-arch-proc.json"))
    P["broken-arch"] = dict(build="broken-arch-proc", lods=[0, 1, 2], license="CC0", source=proc("arch.py", "broken_arch"),
                            note=b["note"] + "; picked over two Hunyuan arches (work/build/broken-arch-hy3, -hy4), which came out intact and baroque")
    from specs_traffic import SPECS
    for car in ("car-sedan", "car-convertible", "car-pickup"):
        P[car] = dict(build=car, lods=[0, 1], license="CC0", source=old_car_source(car, car_extra(car)), note=CAR_NOTE,
                      extra={"paint_rgb": SPECS[car]["paint"]})
    P["car-boxtruck"] = dict(build="car-boxtruck", lods=[0, 1], license="CC0",
                             source=hy_source("boxtruck12_s1234", "boxtruck", 12, car_extra("car-boxtruck")), note=CAR_NOTE,
                             extra={"paint_rgb": SPECS["car-boxtruck"]["paint"]})
    return P


PICKS = picks()
