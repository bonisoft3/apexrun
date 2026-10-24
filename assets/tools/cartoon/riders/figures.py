"""The two riders of the hero car (DESIGN.md "Ghibli gouache"): SDF parts with their materials.

Frame: glTF, the car's own (Y up, metres, the nose on +Z); each figure is built in its seat's frame (origin on the seat
cushion under the hips, facing +Z) and placed at SEATS. The girl drives from the left seat (glTF +X, the steering
wheel's side), both hands on the wheel; the boy rides in the right seat, his outer arm on the door, waving with it at a moment.
Parts that move are their own nodes, built about their pivot: in the wind, the girl's long hair and ribbon tails and the
boy's neckerchief tail; as gestures, the boy's outer arm (resting on the door, or waving) and his head."""
import os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "flagman"))
import toon
from figure import ellipsoid, inter, plane, sphere, taper, torus_y, union

SEATS = {"girl": np.array([0.36, 0.5, -0.74]), "boy": np.array([-0.36, 0.5, -0.74])}
WHEEL = np.array([0.0, 0.36, 0.52])          # the steering wheel's centre in the girl's seat frame
WHEEL_TILT = 1.2


def capsule(a, b, r):
    return toon.capsule(np.asarray(a, float), np.asarray(b, float), r)


def ring(c, R, r, tilt):
    """A ring of radius R, tube r, about c, its axis tilted `tilt` rad from +Y toward +Z."""
    c = np.asarray(c, float)
    M = toon.rot_x(tilt)
    def f(P):
        q = (P - c) @ M
        return np.hypot(np.hypot(q[:, 0], q[:, 2]) - R, q[:, 1]) - r
    return f


def solid(comps, box, base, paint=()):
    """comps: [(sdf, material, fillet)] -> the part dict the builder meshes."""
    f = union([(g, k) for g, _, k in comps], 0.015)
    groups = {}
    for g, m, _ in comps:
        groups.setdefault(m, []).append(g)
    mats = {m: (lambda gs: (lambda P: np.min([g(P) for g in gs], 0)))(gs) for m, gs in groups.items()}
    return dict(f=f, mats=mats, paint=list(paint), box=box, base=base)


def face(add, hair):
    """A Ghibli face on a head centred at (0, 0.64, 0.02): big dark eyes set wide and low, a soft brow, a button nose,
    a small mouth, rosy cheeks; ears."""
    add(ellipsoid([0, 0.64, 0.02], [0.11, 0.12, 0.108]), "skin", 0.02)
    add(ellipsoid([0, 0.585, 0.04], [0.086, 0.068, 0.086]), "skin", 0.04)                    # jaw and cheeks
    for s in (-1, 1):
        add(ellipsoid([0.108 * s, 0.632, 0.012], [0.018, 0.03, 0.022]), "skin", 0.01)       # ears
        add(ellipsoid([0.041 * s, 0.636, 0.117], [0.016, 0.024, 0.01]), "eye", 0.002)       # eyes
        add(capsule([0.024 * s, 0.672, 0.118], [0.058 * s, 0.668, 0.108], 0.0055), hair, 0.002)   # brows
        add(ellipsoid([0.066 * s, 0.598, 0.1], [0.024, 0.015, 0.012]), "cheek", 0.002)       # cheeks
    add(sphere([0, 0.608, 0.128], 0.011), "skin", 0.008)                                      # nose
    add(ellipsoid([0, 0.574, 0.115], [0.016, 0.006, 0.008]), "mouth", 0.002)                  # mouth


def girl():
    comps = []
    add = lambda g, m, k=0.015: comps.append((g, m, k))
    add(ellipsoid([0, 0.07, 0.04], [0.17, 0.1, 0.17]), "dress", 0.0)                        # skirt over the lap
    add(ellipsoid([0, 0.27, -0.01], [0.145, 0.2, 0.105]), "dress", 0.04)                     # bodice
    add(torus_y([0, 0.44, 0.0], 0.058, 0.022), "collar", 0.012)                              # round white collar
    add(ellipsoid([0, 0.425, 0.06], [0.07, 0.025, 0.035]), "collar", 0.01)
    for s in (-1, 1):
        sh, el, ha = np.array([0.15 * s, 0.39, -0.01]), np.array([0.19 * s, 0.25, 0.17]), np.array([0.14 * s, 0.39, 0.47])
        add(sphere(sh, 0.062), "dress", 0.03)                                                # puffed sleeve
        add(capsule(sh, el, taper(0.042, 0.036)), "skin", 0.02)
        add(capsule(el, ha, taper(0.036, 0.03)), "skin", 0.02)
        add(ellipsoid(ha + [0, 0.005, 0.015], [0.034, 0.042, 0.03]), "skin", 0.015)          # hand on the rim
        add(ellipsoid(ha + [0.012 * s, 0.03, 0.02], [0.012, 0.022, 0.012], toon.rot_z(0.4 * s)), "skin", 0.006)   # thumb
    add(capsule([0, 0.43, 0.0], [0, 0.53, 0.012], 0.038), "skin", 0.015)                    # neck
    face(add, "hair")
    crown = inter(ellipsoid([0, 0.672, -0.006], [0.124, 0.112, 0.124]), plane([0, -1, 0], -0.6), 0.01)
    add(crown, "hair", 0.006)
    add(ellipsoid([0, 0.705, 0.074], [0.1, 0.042, 0.06]), "hair", 0.01)                      # fringe
    bob = inter(ellipsoid([0, 0.6, -0.028], [0.132, 0.115, 0.112]), plane([0, 0, 1], 0.035), 0.01)
    add(bob, "hair", 0.01)
    for k in range(9):                                                                       # shaped locks at the bob's hem
        a = np.pi * (0.1 + 0.8 * k / 8)
        x, z = 0.128 * np.cos(a), -0.105 * np.sin(a) - 0.02
        add(capsule([x, 0.6, z], [x * 1.08, 0.515, z * 1.05], taper(0.026, 0.012)), "hair", 0.012)
    add(ellipsoid([0, 0.738, -0.092], [0.022, 0.02, 0.018]), "ribbon", 0.004)                # bow knot
    for s in (-1, 1):
        add(ellipsoid([0.04 * s, 0.742, -0.098], [0.04, 0.024, 0.014], toon.rot_z(-0.3 * s)), "ribbon", 0.004)
    add(ring(WHEEL, 0.17, 0.014, WHEEL_TILT), "wheel", 0.0)
    add(capsule(WHEEL, WHEEL + [0, -0.12, 0.2], 0.022), "wheel", 0.0)                         # column
    return solid(comps, ([-0.36, -0.06, -0.3], [0.36, 0.86, 0.82]), "dress")


def girl_hair():
    """Long locks from the back of her head, streaming back; pivot at the nape."""
    comps = []
    for k, (dx, dy, end) in enumerate(((0.0, 0.0, 0.42), (0.06, -0.02, 0.36), (-0.06, -0.015, 0.38), (0.03, 0.03, 0.3), (-0.03, 0.035, 0.32))):
        comps.append((capsule([dx * 0.5, dy, 0.0], [dx, dy - 0.07, -end], taper(0.05, 0.012)), "hair", 0.02))
    return solid(comps, ([-0.16, -0.18, -0.5], [0.16, 0.12, 0.08]), "hair")


def girl_ribbon():
    """Two ribbon tails from the bow, fluttering back; pivot at the knot."""
    comps = [(capsule([0.0, 0.0, 0.0], [0.03 * s, -0.04, -0.2], taper(0.014, 0.008)), "ribbon", 0.01) for s in (-1, 1)]
    return solid(comps, ([-0.08, -0.1, -0.26], [0.08, 0.04, 0.04]), "ribbon")


def boy():
    comps = []
    add = lambda g, m, k=0.015: comps.append((g, m, k))
    add(ellipsoid([0, 0.07, 0.04], [0.17, 0.1, 0.17]), "trousers", 0.0)
    add(ellipsoid([0, 0.27, -0.01], [0.165, 0.21, 0.118]), "jacket", 0.04)
    add(torus_y([0, 0.445, -0.004], 0.07, 0.028), "jacket", 0.015)                         # turned-up collar
    for s in (-1, 1):
        add(ellipsoid([0.045 * s, 0.43, 0.075], [0.045, 0.03, 0.02], toon.rot_z(0.5 * s)), "jacket", 0.008)   # collar points
    add(ellipsoid([0, 0.428, 0.085], [0.046, 0.032, 0.036]), "scarf", 0.01)                 # neckerchief knot
    add(ellipsoid([0, 0.37, 0.1], [0.06, 0.055, 0.022]), "scarf", 0.01)                     # its triangle on his chest
    # inner arm (toward the girl, glTF +X), hand on his knee
    sh, el, ha = np.array([0.165, 0.39, -0.01]), np.array([0.2, 0.2, 0.08]), np.array([0.12, 0.12, 0.2])
    add(sphere(sh, 0.06), "jacket", 0.03)
    add(capsule(sh, el, taper(0.048, 0.042)), "jacket", 0.02)
    add(capsule(el, ha, taper(0.042, 0.036)), "jacket", 0.02)
    add(ellipsoid(ha, [0.036, 0.03, 0.044]), "skin", 0.012)
    add(sphere([-0.165, 0.39, -0.01], 0.06), "jacket", 0.03)                               # outer shoulder (the arm waves)
    add(capsule([0, 0.43, 0.0], [0, 0.5, 0.008], 0.04), "skin", 0.015)
    paint = [([lambda P: 0.012 - np.abs(P[:, 0]), lambda P: P[:, 2] - 0.05, lambda P: 0.36 - P[:, 1]], "trim", {"jacket"}),   # placket
             ([lambda P: P[:, 1] - 0.08, lambda P: 0.115 - P[:, 1], lambda P: P[:, 2] + 0.05], "trim", {"jacket"})]           # hem band
    return solid(comps, ([-0.3, -0.06, -0.25], [0.3, 0.84, 0.32]), "jacket", paint)


HEAD_PIVOT = np.array([0.0, 0.5, 0.008])


def boy_head():
    """His head, turning on his neck: face, messy tufts; built in his seat's frame, moved to the pivot."""
    comps = []
    add = lambda g, m, k=0.015: comps.append(((lambda g: (lambda P: g(P + HEAD_PIVOT)))(g), m, k))
    add(capsule([0, 0.49, 0.008], [0, 0.55, 0.012], 0.04), "skin", 0.015)
    face(add, "hairB")
    crown = inter(ellipsoid([0, 0.67, -0.01], [0.12, 0.1, 0.12]), plane([0, -1, 0], -0.61), 0.01)
    add(crown, "hairB", 0.006)
    add(inter(ellipsoid([0, 0.62, -0.04], [0.118, 0.09, 0.1]), plane([0, 0, 1], -0.01), 0.01), "hairB", 0.01)
    rng = np.random.default_rng(5)
    for k in range(11):                                                                      # messy tufts
        a = 2 * np.pi * k / 11 + rng.uniform(-0.2, 0.2)
        base = np.array([0.085 * np.sin(a), 0.72, 0.085 * np.cos(a) - 0.01])
        tip = base + np.array([0.06 * np.sin(a), 0.035 + rng.uniform(0, 0.03), 0.06 * np.cos(a) - 0.02])
        add(capsule(base, tip, taper(0.03, 0.01)), "hairB", 0.015)
    for x in (-0.05, -0.01, 0.035):                                                          # fringe tufts
        add(capsule([x, 0.705, 0.07], [x + 0.012, 0.67, 0.11], taper(0.025, 0.009)), "hairB", 0.01)
    return solid(comps, ([-0.22, -0.08, -0.26], [0.22, 0.34, 0.24]), "skin")


def boy_scarf():
    """The neckerchief's tail streaming back over his shoulder; pivot at the knot's back."""
    comps = [(capsule([0, 0, 0], [0.03, -0.02, -0.18], taper(0.03, 0.022)), "scarf", 0.0),
             (capsule([0.03, -0.02, -0.18], [0.07, -0.06, -0.36], taper(0.022, 0.012)), "scarf", 0.02)]
    return solid(comps, ([-0.06, -0.1, -0.42], [0.12, 0.05, 0.05]), "scarf")


def boy_wave():
    """His outer arm raised, waving: sleeve, open hand; pivot at the shoulder, the arm up along +Y and out along -X."""
    el, wr = np.array([-0.2, 0.15, 0.06]), np.array([-0.27, 0.38, 0.1])
    comps = [(capsule([0, 0, 0], el, taper(0.048, 0.042)), "jacket", 0.0),
             (capsule(el, wr, taper(0.042, 0.036)), "jacket", 0.02),
             (ellipsoid(wr + [0, 0.06, 0], [0.038, 0.055, 0.02]), "skin", 0.012)]
    for k, a in enumerate((-0.35, -0.12, 0.1, 0.32)):                                        # fingers spread
        d = np.array([np.sin(a), np.cos(a), 0]) * 0.045
        comps.append((capsule(wr + [0, 0.1, 0] + d * 0.2, wr + [0, 0.1, 0] + d, 0.009), "skin", 0.006))
    comps.append((capsule(wr + [0.03, 0.06, 0], wr + [0.07, 0.09, 0.005], 0.01), "skin", 0.006))   # thumb
    return solid(comps, ([-0.42, -0.1, -0.1], [0.14, 0.62, 0.22]), "jacket")


def boy_rest():
    """His outer arm at rest on the door: the elbow out on the door top, the forearm along it, the hand gripping its
    outer edge, fingers curled over the outside; pivot at the shoulder."""
    el, wr = np.array([-0.195, -0.01, -0.05]), np.array([-0.235, -0.02, 0.19])
    ha = np.array([-0.265, -0.035, 0.235])
    comps = [(capsule([0, 0, 0], el, taper(0.048, 0.042)), "jacket", 0.0),
             (capsule(el, wr, taper(0.042, 0.036)), "jacket", 0.02),
             (ellipsoid(ha, [0.04, 0.026, 0.045]), "skin", 0.012)]
    for z in (-0.03, -0.01, 0.01, 0.03):                                                     # fingers over the edge
        a, b = ha + [-0.025, 0.012, z], ha + [-0.065, -0.085, z]
        comps.append((capsule(a, b, 0.0095), "skin", 0.006))
    comps.append((capsule(ha + [0.025, -0.005, 0.0], ha + [0.04, -0.05, 0.01], 0.01), "skin", 0.006))   # thumb inside
    return solid(comps, ([-0.4, -0.16, -0.15], [0.1, 0.1, 0.34]), "jacket")


# node -> (builder, figure, pivot in its seat frame, flutter axis, flutter amplitude in rad). Every builder but a
# figure's body builds about its pivot. The wave, the resting arm and the head are gestures the renderer poses, not flutter.
NODES = {
    "girl": (girl, "girl", np.zeros(3), None, 0.0),
    "girl_hair": (girl_hair, "girl", np.array([0.0, 0.6, -0.1]), "x", 0.22),
    "girl_ribbon": (girl_ribbon, "girl", np.array([0.0, 0.735, -0.1]), "x", 0.4),
    "boy": (boy, "boy", np.zeros(3), None, 0.0),
    "boy_scarf": (boy_scarf, "boy", np.array([0.02, 0.43, 0.05]), "x", 0.35),
    "boy_wave": (boy_wave, "boy", np.array([-0.165, 0.39, -0.01]), None, 0.0),
    "boy_rest": (boy_rest, "boy", np.array([-0.165, 0.39, -0.01]), None, 0.0),
    "boy_head": (boy_head, "boy", HEAD_PIVOT, None, 0.0),
}
