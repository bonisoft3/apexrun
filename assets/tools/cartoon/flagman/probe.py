"""Measure in Babylon (glTF loader, node.rotation Euler as the game sets it) where arm_R's grip goes for a Z rotation.

usage: probe.py <glb url> -> work/probe.json"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import ev

ROOT = ev.ROOT
url = sys.argv[1]
ANGLES = [0.0, -1.5708, 1.5708, -3.14159, 3.14159]
jobs = []
for a in ANGLES:
    jobs.append(ev.job(url, f"{ROOT}/work/probe_{a:+.2f}.png", "coconut-beach", width=320, height=240,
                       models=[{"url": url, "nodeEuler": {"arm_R": [0, 0, a]}}],
                       probe=[{"node": "arm_R", "local": [0, 0, 0]}, {"node": "flag", "local": [0, 0, 0]},
                              {"node": "flag", "local": [0, -0.72, 0]}, {"node": "flagman", "local": [0, 0, 1]}]))
ev.render(jobs, "probe")
res = json.load(open(f"{ROOT}/work/jobs/probe.results.json"))
out = {f"{a:+.4f}": r["probe"] for a, r in zip(ANGLES, res)}
json.dump(out, open(f"{ROOT}/work/probe.json", "w"), indent=1)
print(json.dumps(out, indent=1))
