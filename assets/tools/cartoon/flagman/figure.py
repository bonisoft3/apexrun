"""The flagman's shapes: SDF parts with their materials, and the explicit flag (pole + cloth).

Frame: glTF, Y up, metres, he faces +Z, so his right hand side is -X; origin on the ground between the feet.
A part is a list of (sdf, material); the solid is their smooth union and each surface point takes the material of the
nearest component. PAINT regions then recolour bands of the suit (vest, belt, stripes, armbands)."""
import numpy as np
import toon

# Right shoulder joint, the arm_R node origin; the grip (flag node origin) in arm_R space.
SHOULDER = np.array([-0.30, 1.38, 0.0])
GRIP = np.array([0.0, -0.60, 0.0])
POLE_R = 0.017
POLE_TOP, POLE_TIP = 0.07, -0.72     # flag space, along the pole (+Y toward the shoulder)
CLOTH_Y = (-0.12, -0.70)             # hoist edge along the pole, flag space
CLOTH_FLY = 0.90                     # cloth width away from the pole, toward flag-space -X
CHEQUER = (6, 4)                     # squares along fly x hoist
SUB = 3                              # quads per square side


def ellipsoid(c, r, R=None):
    """Ellipsoid of half-axes r about c, axes rotated by R (columns = the axes in world); iq's k0 (k0 - 1) / k1 bound."""
    c, r = np.asarray(c, float), np.asarray(r, float)
    R = np.eye(3) if R is None else R

    def f(P):
        q = (P - c) @ R
        k0 = np.linalg.norm(q / r, axis=1)
        k1 = np.linalg.norm(q / (r * r), axis=1)
        return k0 * (k0 - 1) / np.maximum(k1, 1e-12)
    return f


def scaled(f, c, s):
    c = np.asarray(c, float)
    return lambda P: s * f(c + (P - c) / s)


def sphere(c, r):
    c = np.asarray(c, float)
    return lambda P: np.linalg.norm(P - c, axis=1) - r


def torus_y(c, R, r):
    c = np.asarray(c, float)

    def f(P):
        q = P - c
        return np.hypot(np.hypot(q[:, 0], q[:, 2]) - R, q[:, 1]) - r
    return f


def plane(n, d):
    """Half-space n.p <= d (n unit, outward)."""
    n = np.asarray(n, float) / np.linalg.norm(n)
    return lambda P: P @ n - d


def taper(r0, r1):
    return lambda t: r0 + (r1 - r0) * t


def inter(a, b, k):
    return lambda P: toon.smax(a(P), b(P), k)


def union(parts, k):
    """Smooth union of [(sdf, k_join)] in order: each joins what came before with its own fillet."""
    def f(P):
        d = parts[0][0](P)
        for g, kj in parts[1:]:
            d = toon.smin(d, g(P), kj if kj is not None else k)
        return d
    return f


# ---------------------------------------------------------------- body (root node "flagman")

def body():
    comps = []          # (sdf, material, fillet into the union)
    add = lambda f, m, k=0.02: comps.append((f, m, k))
    for s in (-1, 1):
        x = 0.125 * s
        boot = union([(ellipsoid([x, 0.065, 0.07], [0.092, 0.078, 0.145]), None),
                      (ellipsoid([x, 0.075, -0.035], [0.082, 0.085, 0.088]), 0.03),
                      (toon.capsule([x, 0.06, -0.005], [x, 0.235, -0.005], 0.097), 0.03)], 0.03)
        add(boot, "boot", 0.0)
        add(toon.capsule([x * 0.92, 0.86, 0.0], [x, 0.19, 0.0], taper(0.112, 0.09)), "suit", 0.015)
    add(ellipsoid([0, 0.87, 0.0], [0.20, 0.125, 0.14]), "suit", 0.05)                       # pelvis
    add(ellipsoid([0, 1.045, 0.015], [0.212, 0.19, 0.165]), "stripe", 0.06)                  # belly (the vest)
    add(ellipsoid([0, 1.24, -0.005], [0.212, 0.205, 0.152]), "stripe", 0.06)                 # chest
    add(sphere([-0.255, 1.36, 0.0], 0.088), "suit", 0.05)                                    # right deltoid
    add(sphere([0.255, 1.36, 0.0], 0.088), "suit", 0.05)                                     # left deltoid
    add(torus_y([0, 1.425, 0.0], 0.075, 0.026), "suit", 0.02)                                # collar
    add(toon.capsule([0, 1.40, -0.01], [0, 1.55, 0.0], 0.064), "skin", 0.015)                # neck
    # left arm, hand on the hip
    ls, le, lw = np.array([0.30, 1.38, 0.0]), np.array([0.43, 1.13, -0.07]), np.array([0.285, 0.975, 0.0])
    add(sphere(ls, 0.086), "suit", 0.03)
    add(toon.capsule(ls, le, taper(0.078, 0.066)), "suit", 0.03)
    add(toon.capsule(le, lw, taper(0.066, 0.054)), "suit", 0.025)
    cuff_a = lw + 0.02 * (lw - le) / np.linalg.norm(lw - le)
    add(toon.capsule(le + 0.74 * (lw - le), cuff_a, taper(0.066, 0.08)), "glove", 0.0)
    add(ellipsoid([0.235, 0.925, 0.012], [0.07, 0.082, 0.078]), "glove", 0.02)
    # head, 1.08x about the chin for cartoon proportions
    n0 = len(comps)
    H = np.array([0.0, 1.64, 0.0])
    add(ellipsoid(H, [0.15, 0.165, 0.155]), "skin", 0.02)
    add(ellipsoid([0, 1.565, 0.03], [0.128, 0.095, 0.128]), "skin", 0.05)                   # jaw
    for s in (-1, 1):
        add(ellipsoid([0.15 * s, 1.625, -0.005], [0.026, 0.046, 0.034]), "skin", 0.012)     # ears
    add(sphere([0, 1.603, 0.168], 0.038), "skin", 0.012)                                     # nose
    for s in (-1, 1):                                                                        # moustache
        add(ellipsoid([0.045 * s, 1.562, 0.152], [0.052, 0.021, 0.03], toon.rot_z(-0.28 * s) @ toon.rot_y(0.5 * s)), "hair", 0.006)
    for s in (-1, 1):                                                                        # shades
        add(ellipsoid([0.056 * s, 1.655, 0.142], [0.056, 0.036, 0.026], toon.rot_y(0.38 * s)), "shades", 0.004)
    add(toon.capsule([-0.03, 1.664, 0.158], [0.03, 1.664, 0.158], 0.011), "shades", 0.004)
    for s in (-1, 1):                                                                        # temples to the ears
        add(toon.capsule([0.108 * s, 1.662, 0.112], [0.148 * s, 1.655, 0.03], 0.011), "shades", 0.004)
    dome = inter(ellipsoid(H + [0, 0.004, -0.004], [0.163, 0.177, 0.168]), plane([0, -1, 0.12], -1.672), 0.008)
    add(dome, "cap", 0.004)
    add(sphere([0, 1.815, -0.004], 0.016), "cap", 0.006)                                     # button
    brim = inter(ellipsoid([0, 1.688, 0.15], [0.135, 0.013, 0.15], toon.rot_x(0.16)), plane([0, 0, -1], -0.07), 0.006)
    add(brim, "cap", 0.01)
    comps[n0:] = [(scaled(g, [0, 1.50, 0], 1.08), m, k) for g, m, k in comps[n0:]]
    f = union([(c[0], c[2]) for c in comps], 0.02)
    groups = {}
    for g, m, _ in comps:
        groups.setdefault(m, []).append(g)
    mat_fields = {m: (lambda gs: (lambda P: np.min([g(P) for g in gs], 0)))(gs) for m, gs in groups.items()}
    paint = [  # (cuts, material, onto labels): the region is where every cut is > 0
        ([lambda P: P[:, 1] - 0.875, lambda P: 0.935 - P[:, 1]], "boot", {"suit", "stripe"}),                               # belt
        ([lambda P: 0.024 - np.abs(P[:, 2]), lambda P: np.abs(P[:, 0]) - 0.16, lambda P: P[:, 1] - 0.24,
          lambda P: 0.86 - P[:, 1]], "stripe", {"suit"}),                                                                  # leg stripes
        (band(ls, le, 0.38, 0.62, 0.11), "stripe", {"suit"}),                                                              # left armband
    ]
    return dict(f=f, mats=mat_fields, paint=paint, box=([-0.6, -0.05, -0.4], [0.6, 1.95, 0.5]), base="suit")


def band(a, b, t0, t1, rad):
    """Cuts of a band around the segment a-b between parameters t0 and t1, within rad of its axis."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    ab = b - a
    L = np.linalg.norm(ab)
    t = lambda P: (P - a) @ ab / (L * L)
    return [lambda P: (t(P) - t0) * L, lambda P: (t1 - t(P)) * L,
            lambda P: rad - np.linalg.norm(P - a - t(P)[:, None] * ab, axis=1)]


# ---------------------------------------------------------------- right arm (node "arm_R"), arm_R space

def arm():
    e, w = np.array([0, -0.29, 0.0]), np.array([0, -0.49, 0.0])
    comps = [(sphere([0, 0, 0], 0.088), "suit", 0.0),
             (toon.capsule([0, 0, 0], e, taper(0.078, 0.067)), "suit", 0.03),
             (toon.capsule(e, w, taper(0.066, 0.054)), "suit", 0.025),
             (toon.capsule([0, -0.45, 0], [0, -0.53, 0], taper(0.066, 0.08)), "glove", 0.0),
             (ellipsoid(GRIP + [0, 0, 0.004], [0.072, 0.086, 0.08]), "glove", 0.02),
             (ellipsoid(GRIP + [0.04, 0.02, 0.055], [0.024, 0.036, 0.026], toon.rot_z(0.3)), "glove", 0.012)]   # thumb
    f = union([(c[0], c[2]) for c in comps], 0.02)
    groups = {}
    for g, m, _ in comps:
        groups.setdefault(m, []).append(g)
    mat_fields = {m: (lambda gs: (lambda P: np.min([g(P) for g in gs], 0)))(gs) for m, gs in groups.items()}
    paint = [([lambda P: P[:, 1] + 0.205, lambda P: -0.135 - P[:, 1], lambda P: 0.12 - np.hypot(P[:, 0], P[:, 2])],
              "stripe", {"suit"})]
    return dict(f=f, mats=mat_fields, paint=paint, box=([-0.2, -0.8, -0.2], [0.2, 0.2, 0.2]), base="suit")


# ---------------------------------------------------------------- flag (node "flag"), flag space: grip at origin

def pole(segments=12):
    """Lathed pole: a rounded knob at the tip, a cap at the top. -> (V, F, N)."""
    prof = [(0.0, POLE_TIP - 0.026)]
    for a in np.linspace(-np.pi / 2, np.pi / 2, 7)[1:]:
        prof.append((0.026 * np.cos(a), POLE_TIP + 0.026 * np.sin(a)))
    prof += [(POLE_R, POLE_TIP + 0.04), (POLE_R, POLE_TOP - 0.01), (0.011, POLE_TOP), (0.0, POLE_TOP + 0.002)]
    prof = np.array(prof)
    th = np.linspace(0, 2 * np.pi, segments, endpoint=False)
    R, ys = prof[1:-1, 0][:, None] * np.ones((1, segments)), prof[1:-1, 1]
    V, F = toon.lathe_grid(R, ys, th)
    V[-2, 1], V[-1, 1] = prof[0, 1], prof[-1, 1]
    N = toon.lathe_normal_fn(prof)(V)
    N[-2], N[-1] = [0, -1, 0], [0, 1, 0]
    return V, F, N


def cloth():
    """Chequered cloth: CHEQUER squares of SUB x SUB quads, each square its own vertices so its colour is flat.
    -> (V, F, colour, uv), one layer facing +Z (the material is double sided)."""
    nx, ny = CHEQUER
    x0, x1 = -POLE_R, -POLE_R - CLOTH_FLY
    y0, y1 = CLOTH_Y
    V, F, C, UV = [], [], [], []
    for i in range(nx):
        for j in range(ny):
            u = np.linspace(i / nx, (i + 1) / nx, SUB + 1)
            v = np.linspace(j / ny, (j + 1) / ny, SUB + 1)
            U, W = np.meshgrid(u, v, indexing="ij")
            base = sum(len(x) for x in V)
            V.append(np.stack([x0 + (x1 - x0) * U, y0 + (y1 - y0) * W, np.zeros_like(U)], -1).reshape(-1, 3))
            UV.append(np.stack([U, W], -1).reshape(-1, 2))
            k = (SUB + 1)
            a = np.arange(SUB)[:, None] * k + np.arange(SUB)[None]
            a = a.ravel() + base
            quad = np.stack([a, a + k, a + k + 1, a + 1], 1)
            F.append(np.concatenate([quad[:, [0, 1, 2]], quad[:, [0, 2, 3]]]))
            c = 0.9 if (i + j) % 2 == 0 else 0.025
            C.append(np.full(((SUB + 1) ** 2, 3), c))
    V, F, C, UV = np.vstack(V), np.vstack(F), np.vstack(C), np.vstack(UV)
    n = np.cross(V[F[0, 1]] - V[F[0, 0]], V[F[0, 2]] - V[F[0, 0]])
    if n[2] < 0:
        F = F[:, ::-1]
    return V, F, C, UV
