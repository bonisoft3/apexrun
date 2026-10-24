"""Orthographic elevations (rear, front, side, top) of a glb with a metric grid in car (glTF) coordinates.

usage: elev.py <glb url under hero-car> <out prefix> [falsecolour]   -> <prefix>_{rear,front,side,top}.png
Babylon's glTF loader (left-handed scene) negates Z, so the car's rear (glTF -Z) sits at Babylon +Z; labels are glTF."""
import json, os, subprocess, sys
import cv2
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from materials import FALSE

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
env = json.load(open(f"{ROOT}/work/env.json"))
url, prefix = sys.argv[1], sys.argv[2]
fc = len(sys.argv) > 3
W, Hp = 1400, 600
VIEWS = {  # name: camera pos, target, ortho half-height, (image-right axis in glTF, sign), centre
    "rear": ([0, 0.55, 12], [0, 0.55, 0], 0.75, (0, -1), (0.0, 0.55)),
    "front": ([0, 0.55, -12], [0, 0.55, 0], 0.75, (0, 1), (0.0, 0.55)),
    "side": ([-12, 0.55, 0], [0, 0.55, 0], 1.03, (2, 1), (0.0, 0.55)),
    "top": ([-0.001, 12, 0], [0, 0, 0], 1.03, (2, 1), (0.0, 0.0)),
}
jobs = []
for k, (pos, tgt, oh, _, _) in VIEWS.items():
    jobs.append(dict(out=os.path.abspath(f"{prefix}_{k}.png"), **env, models=[{"url": url}], width=W, height=Hp,
                     camera={"pos": pos, "target": tgt, "ortho": oh},
                     **({"falseColor": FALSE} if fc else {})))
json.dump(jobs, open(f"{prefix}_jobs.json", "w"))
subprocess.run(["node", "render.mjs", os.path.abspath(f"{prefix}_jobs.json")], cwd=f"{ROOT}/web", check=True, stdout=subprocess.DEVNULL)
for j, (k, (pos, tgt, oh, (axis, sgn), (c0, c1))) in zip(jobs, VIEWS.items()):
    img = cv2.imread(j["out"])
    o = j["camera"]["ortho"]
    ppm = Hp / (2 * o)
    cx, cy = W / 2, Hp / 2
    # image right/up in car metres
    for v in np.arange(-3, 3.01, 0.1):
        x = int(cx + v * ppm)
        if 0 <= x < W:
            cv2.line(img, (x, 0), (x, Hp), (0, 200, 255) if abs(v * 10 % 5) < 1e-6 else (90, 90, 90), 1)
            if abs(v * 10 % 5) < 1e-6:
                cv2.putText(img, f"{'xyz'[axis]}={sgn * v:+.1f}", (x + 2, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 255), 1)
    for wv in np.round(np.arange(-3, 3.01, 0.1), 1):
        v = wv - (tgt[1] if k != "top" else 0)
        y = int(round(cy - v * ppm))
        major = abs(round(wv * 10) % 5) == 0
        if 0 <= y < Hp:
            cv2.line(img, (0, y), (W, y), (0, 200, 255) if major else (90, 90, 90), 1)
            lab = f"y={wv:.1f}" if k != "top" else f"x={wv:+.1f}"
            if major:
                cv2.putText(img, lab, (2, y - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 255), 1)
    cv2.imwrite(j["out"], img)
    print(j["out"])
