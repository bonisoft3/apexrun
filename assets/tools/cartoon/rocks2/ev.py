"""Headless Babylon 9.31.0 WebGPU renders of prop GLBs under a pack stage (its .env, sky dome and extracted sun).

usage (library): job(url, out, stage, camera=..., false=...) -> dict; render(jobs, name)"""
import json, os, subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PACK = json.load(open(f"{ROOT}/web/pack/manifest.json"))
# the ground each stage lays (apps/apexrun shell/engine/art.js STAGE_ART); coastal-cliffs is lit by coconut-beach's sky
GROUNDS = {"desert-canyons": "sand-desert", "alpine-peaks": "snow", "ancient-ruins": "grass", "coconut-beach": "grass"}
FALSE_PALETTE = ["#d03030", "#40c0ff", "#ffd000", "#30b050", "#a060ff", "#ff8020", "#ffffff", "#606060", "#ff40c0",
                 "#80ff80", "#8a5a2a", "#00e0c0", "#202020", "#c0c0ff", "#ffff90", "#a0a0a0"]


def stage_env(stage):
    e = PACK[f"sky/{stage}.env"]
    j = {"env": "/web/pack/" + e["file"], "skyJpg": "/web/pack/" + PACK[f"sky/{stage}.jpg"]["file"], "exposure": e["object_exposure"]}
    if max(e["sun_light_rgb"]) > 0:
        rgb = e["sun_light_rgb"]
        k = max(rgb)
        j["sun"] = {"dir": e["sun_dir"], "intensity": k, "color": "#%02x%02x%02x" % tuple(int(min(255, 255 * (c / k) ** (1 / 2.2))) for c in rgb)}
    # the game's toon bands (renderer.js TOON_LIT / TOON_SHADE): lit toward the sun warmed to white, shade toward the sky
    # (the game also mixes in the painted horizon's hue); the game divides its exposure out of both, so here the toon
    # render runs at exposure 1 with the tints as they land on screen
    sun = [c / max(e["sun_light_rgb"]) for c in e["sun_light_rgb"]] if max(e["sun_light_rgb"]) > 0 else [1, 1, 1]
    sky = [c / max(e["irradiance_up"]) for c in e["irradiance_up"]]
    u = 1.0
    j["toonParams"] = {"sun": [(c + 0.55 * (1 - c)) * 1.15 * u for c in sun], "shade": [c * 0.6 * u for c in sky], "rim": [0, 0, 0],
                       "level": max(e["sun_light_rgb"]) or max(e["irradiance_up"])}
    return j


def ground(stage, size=600, tile=150):
    g = GROUNDS[stage]
    return {"size": size, "tile": tile, "tex": {k: "/web/pack/" + PACK[f"tex/{g}/{k}"]["file"] for k in ("albedo", "normal", "arm")}}


def false_colors(names):
    return {n: FALSE_PALETTE[i % len(FALSE_PALETTE)] for i, n in enumerate(names)}


def job(url, out, stage, camera=None, false=None, models=None, width=1280, height=800, ground_size=600, exposure=None, toon=True,
        tile=None, **extra):
    env = stage_env(stage)
    tp = env.pop("toonParams")
    j = dict(out=os.path.abspath(out), **env, ground=ground(stage, ground_size, tile or ground_size / 4), width=width, height=height,
             models=models or [{"url": url}], camera=camera or {})
    if toon:
        j["toon"] = tp
        j["exposure"] = 1.0
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
