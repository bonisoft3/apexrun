"""Headless Babylon 9.31.0 WebGPU renders of prop GLBs under a pack stage (its .env, sky dome and extracted sun).

usage (library): job(url, out, stage, camera=..., false=...) -> dict; render(jobs, name)"""
import json, os, subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PACK = json.load(open(f"{ROOT}/../../assets-pack/out/manifest.json"))
GROUNDS = {"metropolis-night": "asphalt", "coconut-beach": "sand-beach", "tulip-gardens": "grass", "ancient-ruins": "ruins-stone",
           "desert-canyons": "sand-desert", "wilderness-run": "grass"}
FALSE_PALETTE = ["#d03030", "#40c0ff", "#ffd000", "#30b050", "#a060ff", "#ff8020", "#ffffff", "#606060", "#ff40c0",
                 "#80ff80", "#8a5a2a", "#00e0c0", "#202020", "#c0c0ff", "#ffff90", "#a0a0a0"]


def stage_env(stage):
    e = PACK[f"sky/{stage}.env"]
    j = {"env": "/web/pack/" + e["file"], "skyJpg": "/web/pack/" + PACK[f"sky/{stage}.jpg"]["file"], "exposure": e["object_exposure"]}
    if max(e["sun_light_rgb"]) > 0:
        rgb = e["sun_light_rgb"]
        k = max(rgb)
        j["sun"] = {"dir": e["sun_dir"], "intensity": k, "color": "#%02x%02x%02x" % tuple(int(min(255, 255 * (c / k) ** (1 / 2.2))) for c in rgb)}
    return j


def ground(stage, size=600, tile=150):
    g = GROUNDS.get(stage, "asphalt")
    return {"size": size, "tile": tile, "tex": {k: "/web/pack/" + PACK[f"tex/{g}/{k}"]["file"] for k in ("albedo", "normal", "arm")}}


def false_colors(names):
    return {n: FALSE_PALETTE[i % len(FALSE_PALETTE)] for i, n in enumerate(names)}


def job(url, out, stage, camera=None, false=None, models=None, width=1280, height=800, ground_size=600, exposure=None, **extra):
    j = dict(out=os.path.abspath(out), **stage_env(stage), ground=ground(stage, ground_size), width=width, height=height,
             models=models or [{"url": url}], camera=camera or {})
    if exposure is not None:
        j["exposure"] = exposure
    if false:
        j["falseColor"] = false
    j.update(extra)
    return j


def render(jobs, name):
    os.makedirs(f"{ROOT}/work/jobs", exist_ok=True)
    path = f"{ROOT}/work/jobs/{name}.json"
    json.dump(jobs, open(path, "w"), indent=1)
    subprocess.run(["node", "render.mjs", path], cwd=f"{ROOT}/web", check=True, stdout=subprocess.DEVNULL)
