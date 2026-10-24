"""Each stage's hero landmark, the set piece the chase camera pulls back for: SDF solids meshed by marching cubes.

usage: landmarks.py [name ...]   -> work/build/<name>_lod{0,1,2}.glb + work/build/<name>.json (contract of props.py)
A model is a list of (sdf, material, fillet) components, smoothly unioned; every surface point takes the material of the
nearest component, then `paint` may relabel by height and facing (a grass cap on what faces up). Meshes are marching
cubes, decimated per LOD and projected back onto the field; the base is cut flat 2 m under the ground. No UVs and no
textures: the painted surface is baked afterwards (ghibli/bake)."""
import os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "cartoon", "flagman"))
import geo
import toon
from figure import ellipsoid, union
from mats import pbr, srgb
from props import build_all

SKIRT = -2.0
BUDGET = (24000, 6000, 1600)


def sub(a, b, k=0.0):
    """a minus b, the cut's edge softened by k."""
    return lambda P: toon.smax(a(P), -b(P), k) if k else np.maximum(a(P), -b(P))


def cyl_z(c, r, half):
    """Cylinder along Z through c, radius r, half length `half`."""
    c = np.asarray(c, float)
    return lambda P: np.maximum(np.hypot(P[:, 0] - c[0], P[:, 1] - c[1]) - r, np.abs(P[:, 2] - c[2]) - half)


def cyl_x(c, r, half):
    c = np.asarray(c, float)
    return lambda P: np.maximum(np.hypot(P[:, 2] - c[2], P[:, 1] - c[1]) - r, np.abs(P[:, 0] - c[0]) - half)


def gable(c, half_x, half_z, rise):
    """A pitched roof over the box footprint (half_x, half_z) at c (eaves height), ridge along X, `rise` m high."""
    c = np.asarray(c, float)
    s = rise / half_z
    n = 1 / np.hypot(1, s)

    def f(P):
        q = P - c
        slope = (q[:, 1] + s * np.abs(q[:, 2]) - rise) * n
        return np.maximum.reduce([slope, -q[:, 1], np.abs(q[:, 0]) - half_x])
    return f


def pyramid(c, half, rise):
    """A four-sided roof on a square of half side `half` at c, `rise` m high."""
    c = np.asarray(c, float)
    s = rise / half
    n = 1 / np.hypot(1, s)
    return lambda P: np.maximum((P[:, 1] - c[1] + s * np.maximum(np.abs(P[:, 0] - c[0]), np.abs(P[:, 2] - c[2])) - rise) * n,
                                c[1] - P[:, 1])


def mesh(comps, box, h, paint=None):
    """comps: [(sdf, material, fillet)] -> per LOD [(V, F, material per face)]."""
    f = union([(g, k) for g, _, k in comps], 0.1)
    f0 = f
    f = lambda P: np.maximum(f0(P), SKIRT - P[:, 1])
    mats = {}
    for g, m, _ in comps:
        mats.setdefault(m, []).append(g)
    near = {m: (lambda gs: (lambda P: np.min([g(P) for g in gs], 0)))(gs) for m, gs in mats.items()}
    V, F = toon.extract(f, np.asarray(box[0], float), np.asarray(box[1], float), h)
    out = []
    for target in BUDGET:
        v, fc = toon.decimate(V, F, target, planar=False)
        v = toon.project(f, v, h * 0.25, reach=h)
        C = v[fc].mean(1)
        names = list(near)
        labels = np.array(names, dtype=object)[np.argmin([near[k](C) for k in names], 0)]
        if paint:
            N = np.cross(v[fc[:, 1]] - v[fc[:, 0]], v[fc[:, 2]] - v[fc[:, 0]])
            N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
            labels = paint(C, N, labels)
        out.append((v, fc, labels))
    return out


def model(parts, materials, note):
    def build(lod):
        V, F, M = parts()[lod]
        m = geo.Mesh()
        for name in dict.fromkeys(M):
            m.add(name, V, F[M == name], np.zeros((len(V), 2)), crease=50.0)
        used = [x for x in materials if x["name"] in set(M)]
        return [(None, m, None)], used, [], note
    return build


def cached(fn):
    memo = []
    return lambda: memo[0] if memo else memo.append(fn()) or memo[0]


# ---------------------------------------------------------------- natural arches

DESERT = [pbr("talus", srgb("#cf7f4a"), 0.0, 0.95), pbr("rock_red", srgb("#b8442a"), 0.0, 0.92)]
COAST = [pbr("rock", srgb("#a0957c"), 0.0, 0.93), pbr("grass", srgb("#5e8c40"), 0.0, 0.95)]


def natural_arch(span, rise, leg, crown, ribs, talus, seed):
    """A rock arch springing from a tall fluted butte on its west side to a lower one on its east (in the XY plane), its
    span thinner and uneven, scree at both feet."""
    g = np.random.default_rng(seed)
    a = span / 2
    west, east = rise * 1.15, rise * 0.62
    comps = [(toon.tube([[-a - leg * 0.4, SKIRT - 1, 0], [-a - leg * 0.2, west * 0.6, 0.4], [-a, west, 0]],
                        [leg * 1.25, leg, leg * 0.8], ribs=ribs + 6, depth=0.14, ref=(1, 0, 0), fade=0.5), "rock", 0.0),
             (toon.tube([[a + leg * 0.3, SKIRT - 1, 0], [a + leg * 0.1, east * 0.6, -0.3], [a, east, 0]],
                        [leg, leg * 0.8, leg * 0.62], ribs=ribs + 2, depth=0.14, ref=(1, 0, 0), fade=0.5), "rock", 0.0)]
    th = np.linspace(np.pi, 0, 11)
    base = west + (east - west) * (1 - np.cos(th[::-1] * 0 + (np.pi - th))) / 2
    arc = np.stack([a * np.cos(th), base * 0.92 + 0.42 * a * np.sin(th) + g.uniform(-0.5, 0.5, 11), g.uniform(-0.8, 0.8, 11)], 1)
    u = np.abs(np.linspace(-1, 1, len(arc)))
    radii = crown * (1 + 0.25 * g.uniform(-1, 1, len(arc))) + (leg * 0.7 - crown) * u ** 2
    comps.append((toon.tube(arc, radii, ribs=ribs, depth=0.12, ref=(0, 0, 1), fade=0.5), "rock", 1.5))
    for s, k in ((-1, 1.2), (1, 0.9)):
        comps.append((ellipsoid([s * (a + leg * 0.4), 0.0, 0], [talus * 1.3 * k, talus * 0.45 * k, talus * k]), "talus", 2.5))
    return comps, a + leg * 1.6 + talus * 1.6, west + leg + 2


def rock_arch():
    comps, w, top = natural_arch(span=34.0, rise=30.0, leg=8.0, crown=3.4, ribs=14, talus=9.0, seed=3)
    comps = [(g, "rock_red" if m == "rock" else m, k) for g, m, k in comps]
    return mesh(comps, ([-w - 4, SKIRT - 3, -16], [w + 4, top + 4, 16]), 0.22)


def sea_arch():
    comps, w, top = natural_arch(span=26.0, rise=16.0, leg=8.5, crown=4.8, ribs=18, talus=7.0, seed=7)
    comps = [(g, "rock", k) for g, m, k in comps]
    crest = top - 3.2

    def paint(C, N, labels):
        return np.where((N[:, 1] > 0.55) & (C[:, 1] > crest - 4), "grass", labels).astype(object)
    return mesh(comps, ([-w - 4, SKIRT - 3, -16], [w + 4, top + 4, 16]), 0.22, paint)


# ---------------------------------------------------------------- chapels and towers on a knoll

STYLES = {
    # an alpine ridge chapel: white walls, a steep red-brown roof, a slim tower under a copper onion dome
    "alpine": dict(wall="#efe9dc", roof="#8a3a2a", dome="#5f9a86", knoll="rock", knoll_c="#8c8a80", tower=4.2, tall=18.0,
                   nave=(7.0, 4.6, 7.5), pitch=6.5, top="onion"),
    # a Tuscan hill chapel: ochre walls, terracotta roof, a square campanile with a low pyramid roof
    "tuscan": dict(wall="#e2c08c", roof="#b5562f", dome="#b5562f", knoll="grass", knoll_c="#6f8a4a", tower=5.0, tall=24.0,
                   nave=(8.0, 5.2, 8.0), pitch=3.6, top="pyramid"),
    # a harbour clock tower: white walls, a green copper spire
    "harbour": dict(wall="#f2efe6", roof="#4f8c7c", dome="#4f8c7c", knoll="rock", knoll_c="#9a9384", tower=5.0, tall=26.0,
                    nave=(6.5, 4.5, 6.0), pitch=4.0, top="spire"),
    # a kasbah: mud-brick walls and a crenellated watchtower
    "adobe": dict(wall="#c98a5a", roof="#b07448", dome="#b07448", knoll="rock", knoll_c="#a86a44", tower=6.0, tall=22.0,
                  nave=(10.0, 7.0, 7.0), pitch=0.0, top="crenel"),
}


def chapel(style):
    s = STYLES[style]
    hx, hz, eave = s["nave"]
    t, tall = s["tower"] / 2, s["tall"]
    knoll_h = 6.0
    base = knoll_h - 0.6
    comps = [(ellipsoid([0, 0, 0], [17, knoll_h, 14]), "knoll", 1.5)]
    sunk = 3.0                                                                             # walls run down into the knoll
    nave = toon.rbox([0, base + (eave - sunk) / 2, 0], [hx, (eave + sunk) / 2, hz], 0.25)
    for z in (-hz * 0.45, hz * 0.45):                                                      # windows down each side
        for x in (-hx * 0.4, 0.0, hx * 0.4):
            nave = sub(nave, toon.rbox([x, base + eave * 0.55, np.sign(z) * hz], [0.45, 1.1, 0.5], 0.2))
    comps.append((nave, "wall", 0.0))
    comps.append((toon.rbox([-hx, base + 1.4, 0], [0.4, 1.4, 0.9], 0.2), "dark", 0.0))         # the door, in the west end
    if s["pitch"]:
        comps.append((gable([0, base + eave - 0.05, 0], hx + 0.6, hz + 0.7, s["pitch"]), "roof", 0.0))
    else:
        for x in np.arange(-hx + 0.6, hx, 1.6):                                             # a crenellated parapet
            for z in (-hz + 0.3, hz - 0.3):
                comps.append((toon.rbox([x, base + eave + 0.5, z], [0.4, 0.5, 0.3], 0.08), "wall", 0.0))
    tx = hx + t - 0.4
    tower = toon.rbox([tx, base + (tall - sunk) / 2, 0], [t, (tall + sunk) / 2, t], 0.2)
    bell = base + tall - 3.0
    tower = sub(tower, toon.rbox([tx, bell, 0], [t * 0.45, 1.5, t + 1], 0.3))                # belfry openings
    tower = sub(tower, toon.rbox([tx, bell, 0], [t + 1, 1.5, t * 0.45], 0.3))
    comps.append((tower, "wall", 0.0))
    comps.append((toon.rbox([tx, bell, 0], [t * 0.4, 1.4, t * 0.4], 0.1), "dark", 0.0))
    comps.append((toon.rbox([tx, base + tall - 6.2, 0], [t + 0.15, 0.15, t + 0.15], 0.05), "wall", 0.0))   # string course
    top = base + tall
    if s["top"] == "onion":
        comps.append((ellipsoid([tx, top + 1.6, 0], [t * 1.05, 1.9, t * 1.05]), "dome", 0.3))
        comps.append((toon.capsule([tx, top + 2.8, 0], [tx, top + 5.0, 0], lambda u: 0.55 * (1 - u) + 0.08), "dome", 0.3))
    elif s["top"] == "pyramid":
        comps.append((pyramid([tx, top - 0.05, 0], t + 0.5, 2.6), "roof", 0.0))
    elif s["top"] == "spire":
        comps.append((pyramid([tx, top - 0.05, 0], t + 0.3, 8.0), "dome", 0.0))
        for z in (-1, 1):
            comps.append((cyl_z([tx, top - 4.6, z * t], 1.0, 0.25), "dark", 0.0))          # clock faces
    else:
        for dx in (-1, 1):
            for dz in (-1, 0, 1):
                comps.append((toon.rbox([tx + dx * (t - 0.4), top + 0.6, dz * (t - 0.4)], [0.4, 0.6, 0.4], 0.08), "wall", 0.0))
                comps.append((toon.rbox([tx + dz * (t - 0.4), top + 0.6, dx * (t - 0.4)], [0.4, 0.6, 0.4], 0.08), "wall", 0.0))
    materials = [pbr("wall", srgb(s["wall"]), 0.0, 0.9), pbr("roof", srgb(s["roof"]), 0.0, 0.85),
                 pbr("dome", srgb(s["dome"]), 0.0, 0.7), pbr("dark", srgb("#2e2a2c"), 0.0, 0.9),
                 pbr("knoll", srgb(s["knoll_c"]), 0.0, 0.95)]
    return comps, ([-22, SKIRT - 3, -18], [22, top + 12, 18]), materials


def chapel_mesh(style):
    comps, box, _ = chapel(style)
    return mesh(comps, box, 0.12)


# ---------------------------------------------------------------- the aqueduct

STONE = [pbr("stone", srgb("#cdb48a"), 0.0, 0.92), pbr("moss", srgb("#6f8a4a"), 0.0, 0.95)]


def aqueduct():
    """Two tiers of round arches along X, the channel on top; its east end has fallen away."""
    L, d = 46.0, 2.6
    low_bay, low_h, high_bay, high_h = 9.2, 15.0, 4.6, 8.0
    body = toon.rbox([0, (SKIRT + low_h + high_h + 2.2) / 2, 0], [L, (low_h + high_h + 2.2 - SKIRT) / 2, d], 0.12)
    for x in np.arange(-L + low_bay / 2, L, low_bay):
        body = sub(body, cyl_z([x, low_h - 4.6 - 0.3, 0], 3.3, d + 1))
        body = sub(body, toon.rbox([x, (SKIRT - 1 + low_h - 4.9) / 2, 0], [3.3, (low_h - 4.9 - SKIRT + 1) / 2, d + 1], 0.0))
    y2 = low_h + 0.8
    for x in np.arange(-L + high_bay / 2, L, high_bay):
        body = sub(body, cyl_z([x, y2 + high_h - 3.0, 0], 1.55, d + 1))
        body = sub(body, toon.rbox([x, y2 + (high_h - 3.0) / 2, 0], [1.55, (high_h - 3.0) / 2, d + 1], 0.0))
    g = np.random.default_rng(5)
    fall = lambda P: (P[:, 0] - 26.0) + 0.9 * (P[:, 1] - 4.0) + 1.6 * np.sin(P[:, 1] * 0.9 + P[:, 2])   # the broken end
    body = sub(body, lambda P: -fall(P))
    comps = [(body, "stone", 0.0)]
    for k in range(7):                                                                     # fallen blocks
        x = 28 + g.uniform(0, 14)
        comps.append((toon.rbox([x, 0.1, g.uniform(-6, 6)], [g.uniform(0.6, 1.2), 0.6, g.uniform(0.5, 1.0)], 0.12,
                                toon.rot_y(g.uniform(0, 3))), "stone", 0.0))
    top = low_h + high_h + 2.2

    def paint(C, N, labels):
        return np.where((N[:, 1] > 0.7) & (C[:, 1] > top - 0.6), "moss", labels).astype(object)
    return mesh(comps, ([-L - 3, SKIRT - 3, -10], [L + 3, top + 3, 10]), 0.14, paint)


ARCH_NOTE = "; closed solid cut flat at y = -2 m, no UVs and no textures"
BUILDERS = {
    "rock-arch": model(cached(rock_arch), DESERT, "the desert's great rock arch, 41 m: a thin, uneven red sandstone span "
                                                  "from a tall fluted butte to a lower one, scree at their feet" + ARCH_NOTE),
    "sea-arch": model(cached(sea_arch), COAST, "the coast's sea arch, 25 m: a low fluted grey rock span between two thick "
                                               "stacks, a grass cap on its crest" + ARCH_NOTE),
    "chapel-alpine": model(cached(lambda: chapel_mesh("alpine")), chapel("alpine")[2],
                           "an alpine ridge chapel on a rock knoll, 28 m: white walls, a steep red-brown roof, a slim tower "
                           "under a copper onion dome; the door at -X, the tower at +X" + ARCH_NOTE),
    "chapel-tuscan": model(cached(lambda: chapel_mesh("tuscan")), chapel("tuscan")[2],
                           "a Tuscan hill chapel on a grass knoll, 32 m: ochre walls, terracotta roof, a square campanile "
                           "under a low pyramid roof; the door at -X, the tower at +X" + ARCH_NOTE),
    "clock-tower": model(cached(lambda: chapel_mesh("harbour")), chapel("harbour")[2],
                         "a harbour clock tower on a rock knoll, 39 m: white walls, a green copper spire over clock faces; "
                         "the door at -X, the tower at +X" + ARCH_NOTE),
    "kasbah": model(cached(lambda: chapel_mesh("adobe")), chapel("adobe")[2],
                    "a mud-brick kasbah on a rock knoll, 29 m: crenellated walls and watchtower; the door at -X, the tower "
                    "at +X" + ARCH_NOTE),
    "aqueduct": model(cached(aqueduct), STONE, "a Roman aqueduct, 25 m, 87 m long along X: two tiers of round arches "
                                               "under the channel, moss on top, its east end fallen with blocks on the "
                                               "ground" + ARCH_NOTE),
}

if __name__ == "__main__":
    build_all(BUILDERS, sys.argv[1:] or list(BUILDERS))
