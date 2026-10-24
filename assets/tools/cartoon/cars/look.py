"""Quick look at built cars: beauty front 3/4, rear 3/4, side, wheel-arch and tail-light close-ups, false-colour rear 3/4.
usage: look.py <glb url under the cars root> <out.jpg> [stage]
Babylon's glTF loader maps glTF (x, y, z) to (x, y, -z): the car's rear (glTF -Z) sits at Babylon +Z."""
import json, os, struct, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
import ev
from materials import FALSE

ROOT = ev.ROOT


def glb_info(path):
    b = open(path, "rb").read()
    jl = struct.unpack_from("<I", b, 12)[0]
    g = json.loads(b[20:20 + jl])
    lo, hi = [9] * 3, [-9] * 3
    for n in g["nodes"]:
        t = n.get("translation", [0, 0, 0])
        for p in g["meshes"][n["mesh"]]["primitives"]:
            a = g["accessors"][p["attributes"]["POSITION"]]
            lo = [min(lo[i], a["min"][i] + t[i]) for i in range(3)]; hi = [max(hi[i], a["max"][i] + t[i]) for i in range(3)]
    hubs = {n["name"]: n["translation"] for n in g["nodes"] if n["name"].startswith("wheel_")}
    return lo, hi, hubs


def cams(path):
    lo, hi, hubs = glb_info(path)
    L, H = hi[2] - lo[2], hi[1]
    rl = hubs["wheel_RL"]
    s = L / 4.6
    return {
        "front34": {"pos": [-0.75 * L, 0.35 * L, -L], "target": [0, 0.45 * H, 0], "fov": 40},
        "rear34": {"pos": [0.62 * L, 0.36 * L, 0.95 * L], "target": [0, 0.45 * H, 0.1 * L], "fov": 40},
        "side": {"pos": [-1.45 * L, 0.2 * L, 0], "target": [0, 0.45 * H, 0], "fov": 40},
        "arch": {"pos": [rl[0] + 1.7 * s, rl[1] + 0.7 * s, -rl[2] + 1.3 * s], "target": [rl[0], rl[1] + 0.12 * s, -rl[2]], "fov": 38},
        "tail": {"pos": [0.9 * s, 0.55 * H + 0.5 * s, -lo[2] + 1.6 * s], "target": [0.25 * s, 0.5 * H, -lo[2]], "fov": 38},
    }


def jobs(url, prefix, stage="coconut-beach", views=None, false=True, w=900, h=560):
    path = f"{ROOT}{url}"
    out = []
    for k, c in cams(path).items():
        if views and k not in views:
            continue
        out.append(ev.job(url, f"{prefix}_{k}.png", stage, camera=c, width=w, height=h))
    if false:
        c = cams(path)["rear34"]
        out.append(ev.job(url, f"{prefix}_rear34_f.png", stage, camera=c, false=FALSE, width=w, height=h))
    return out


if __name__ == "__main__":
    url, out = sys.argv[1], sys.argv[2]
    stage = sys.argv[3] if len(sys.argv) > 3 else "coconut-beach"
    prefix = os.path.splitext(out)[0]
    js = jobs(url, prefix, stage)
    ev.render(js, os.path.basename(prefix))
    subprocess.run([sys.executable, f"{os.path.dirname(__file__)}/grid.py", out, "3"] + [j["out"] for j in js], check=True,
                   env={**os.environ, "CW": "640"})
    print(out)
