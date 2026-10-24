"""Evidence renders (headless Babylon 9.31.0, WebGPU) and contact sheets, from out/manifest.json (the shipped bytes).

usage: evidence.py jobs <category|all>   -> renders/<category>/jobs.json
       evidence.py contact               -> renders/contact_<category>.png
Render with: (cd web && node render.mjs ../renders/<category>/jobs.json)
"""
import glob, json, os, sys
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(__file__))
from items import ROOT

GROUND = {"coconut-beach": "sand-beach", "desert-canyons": "sand-desert", "gateway-pass": "grass", "alpine-peaks": "snow",
          "wilderness-run": "forest-floor", "tulip-gardens": "field-soil", "ancient-ruins": "ruins-stone",
          "sunset-highway": "asphalt", "metropolis-night": "cobble", "road": "asphalt", "traffic": "asphalt"}
ENV_OF = {"road": "sunset-highway", "traffic": "coconut-beach"}


def manifest():
    return json.load(open(f"{ROOT}/out/manifest.json"))


def url(m, lid):
    return "/out/" + m[lid]["file"]


def stage_env(m, stage):
    stage = ENV_OF.get(stage, stage)
    e = m[f"sky/{stage}.env"]
    peak = e["sun_peak_ratio"]
    sl = e["sun_light_rgb"]
    mx = max(sl)
    sun = {"dir": e["sun_dir"], "intensity": mx, "color": "#%02x%02x%02x" % tuple(int(255 * c / mx) for c in sl)} if mx > 0.05 * sum(e["irradiance_up"]) / 3 else None
    exp = e["object_exposure"]
    return dict(env=url(m, f"sky/{stage}.env"), skyJpg=url(m, f"sky/{stage}.jpg"), exposure=exp, sun=sun), stage


def tex(m, name):
    return {k: url(m, f"tex/{name}/{k}") for k in ("albedo", "normal", "arm")}


def category(lid, rec):
    if rec["kind"] in ("hdri-env", "sky"):
        return "hdri"
    if rec["kind"] == "texture":
        return "textures"
    name = lid.split("/")[1]
    if name.startswith("car-"):
        return "traffic"
    if name.startswith("palm-") or rec["source"].get("generated"):
        return "generated"
    if name.startswith(("tree", "shrub", "fern", "grass", "deadwood", "stump")):
        return "vegetation"
    if name.startswith(("rock", "boulder", "cliff", "mesa")):
        return "rocks"
    return "props"


def jobs(cat):
    m = manifest()
    out = {}
    def add(c, j):
        os.makedirs(f"{ROOT}/renders/{c}", exist_ok=True)
        j["out"] = f"../renders/{c}/{j.pop('name')}.png"
        out.setdefault(c, []).append(j)
    stages = sorted({k.split("/")[1][:-4] for k in m if k.startswith("sky/") and k.endswith(".env")})
    if cat in ("hdri", "all"):
        for s in stages:
            env, _ = stage_env(m, s)
            add("hdri", dict(name=s, **env, camera={"beta": 82, "alpha": -90, "dist": 1.0, "fov": 60}, spheres=[
                {"pos": [-2.4, 0.5, 0], "d": 1, "metal": 1, "rough": 0.03}, {"pos": [-0.8, 0.5, 0], "d": 1, "color": "#d8d8d8", "rough": 0.9},
                {"pos": [0.8, 0.5, 0], "d": 1, "color": "#b01818", "rough": 0.25}, {"pos": [2.4, 0.5, 0], "d": 1, "metal": 1, "rough": 0.35}],
                ground={"size": 40, "tile": 10, "tex": tex(m, GROUND[s])}))
    if cat in ("textures", "all"):
        for name in sorted({k.split("/")[1] for k in m if k.startswith("tex/")}):
            env, _ = stage_env(m, "wilderness-run")  # overcast: soft light shows the material, not the sun
            add("textures", dict(name=name, **env, camera={"beta": 68, "alpha": -90, "dist": 1.6},
                                 spheres=[{"pos": [0, 0.9, 0], "d": 1.8, "tile": 2, "tex": tex(m, name)}],
                                 ground={"size": 8, "tile": 2, "tex": tex(m, name)}))
    models = sorted({k.split("/")[1] for k in m if k.startswith("model/")})
    for name in models:
        l0 = m[f"model/{name}/lod0"]
        c = category(f"model/{name}/lod0", l0)
        if cat not in (c, "all"):
            continue
        st = l0.get("stages", ["traffic"])[0]
        env, st = stage_env(m, st)
        g = {"size": 400, "tile": 100, "tex": tex(m, GROUND.get(st, "asphalt"))}
        add(c, dict(name=name, **env, models=[{"url": url(m, f"model/{name}/lod0")}], ground=g,
                    camera={"alpha": -55 if c != "traffic" else -40, "beta": 76 if c != "traffic" else 72, "dist": 1.5}))
        add(c, dict(name=name + "__lods", width=1536, height=640, **env, ground=g, camera={"alpha": -90, "beta": 80, "dist": 0.8},
                    models=[{"url": url(m, f"model/{name}/lod{i}"), "pos": [(i - 1) * span(l0), 0, 0]} for i in range(3)]))
    for c, js in out.items():
        json.dump(js, open(f"{ROOT}/renders/{c}/jobs.json", "w"), indent=1)
        print(c, len(js))


def span(rec):
    b = rec.get("bounds_m")
    if b:
        return max(b[1][0] - b[0][0], b[1][2] - b[0][2]) * 1.15 + 0.2
    return 6.0 if "car" in rec.get("lods", [""])[0] else 3.0


def contact():
    m = manifest()
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 15)
    except OSError:
        font = ImageFont.load_default()
    for d in sorted(glob.glob(f"{ROOT}/renders/*/jobs.json")):
        c = os.path.basename(os.path.dirname(d))
        if c == "test":
            continue
        res = json.load(open(d.replace("jobs.json", "jobs.results.json")))
        mains = [r for r in res if "__lods" not in r["out"]]
        cell_w, cell_h = 512, 384
        lod_h = 160
        has_lods = any("__lods" in r["out"] for r in res)
        cols = 4
        rows = (len(mains) + cols - 1) // cols
        H = cell_h + 22 + (lod_h if has_lods else 0)
        sheet = Image.new("RGB", (cols * cell_w, rows * H), (20, 20, 22))
        dr = ImageDraw.Draw(sheet)
        for i, r in enumerate(mains):
            x, y = (i % cols) * cell_w, (i // cols) * H
            name = os.path.basename(r["out"])[:-4]
            im = Image.open(os.path.join(ROOT, "web", r["out"])).convert("RGB").resize((cell_w, cell_h), Image.LANCZOS)
            sheet.paste(im, (x, y + 22))
            label = name
            if c not in ("hdri", "textures"):
                tris = [m[f"model/{name}/lod{k}"]["tris"] for k in range(3)]
                kb = sum(m[f"model/{name}/lod{k}"]["bytes"] for k in range(3)) / 1e6
                label = f"{name}  {tris[0]:,}/{tris[1]:,}/{tris[2]:,} tris  {kb:.1f} MB"
            elif c == "textures":
                kb = sum(m[f"tex/{name}/{k}"]["bytes"] for k in ("albedo", "normal", "arm")) / 1e6
                label = f"{name}  ({m[f'tex/{name}/albedo']['source']['polyhaven']['id']})  {kb:.1f} MB"
            else:
                e = m[f"sky/{name}.env"]
                label = f"{name}  ({e['source']['polyhaven']['id']})  env {e['bytes'] / 1e6:.1f} MB"
            dr.text((x + 6, y + 3), label, fill=(235, 235, 235), font=font)
            lp = os.path.join(ROOT, "web", r["out"].replace(".png", "__lods.png"))
            if has_lods and os.path.exists(lp):
                li = Image.open(lp).convert("RGB")
                li = li.resize((cell_w, int(cell_w * li.height / li.width)), Image.LANCZOS)
                sheet.paste(li.crop((0, (li.height - lod_h) // 2, cell_w, (li.height - lod_h) // 2 + lod_h)), (x, y + 22 + cell_h))
        sheet.save(f"{ROOT}/renders/contact_{c}.png", optimize=True)
        print(c, sheet.size)


if __name__ == "__main__":
    {"jobs": lambda: jobs(sys.argv[2] if len(sys.argv) > 2 else "all"), "contact": contact}[sys.argv[1]]()
