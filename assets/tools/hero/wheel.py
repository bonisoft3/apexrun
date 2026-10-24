"""Procedural wheel: low-profile tyre with tread grooves, five-spoke machined alloy with a dished lip, lug nuts and a dark
barrel/brake backdrop seen through the spoke windows. Local frame: hub at the origin, axle along X, outer face toward +X."""
import numpy as np
from meshkit import Parts, lathe

LODS = {0: dict(tyre_segs=56, spoke_cols=3, win_cols=4, rings=6, nut_segs=6),
        1: dict(tyre_segs=22, spoke_cols=1, win_cols=2, rings=2, nut_segs=0)}
SPOKES = 5


def tyre_profile(R, W, rim_r, lod):
    s = R - rim_r
    h = W / 2
    side = [(rim_r - 0.004, 0.43 * h), (rim_r + 0.18 * s, 0.47 * h), (rim_r + 0.5 * s, 0.50 * h), (rim_r + 0.8 * s, 0.48 * h),
            (R - 0.016, 0.44 * h), (R - 0.005, 0.40 * h)]
    if lod == 0:
        # three circumferential grooves across the tread
        tread = [(R, 0.36 * h), (R, 0.30 * h), (R - 0.008, 0.29 * h), (R - 0.008, 0.21 * h), (R, 0.20 * h), (R, 0.05 * h),
                 (R - 0.008, 0.04 * h)]
    else:
        tread = [(R, 0.30 * h)]
    half = side + tread
    mirror = [(r, -x) for r, x in reversed(half)]
    if lod == 0:
        mirror = mirror[1:]  # the centre groove floor is shared
    return half + mirror


def build(R, W, rim_r, lod):
    o = LODS[lod]
    P = Parts()
    # tyre: outer bead -> tread -> inner bead; lathe() faces outward for this walking order
    V, F = lathe(tyre_profile(R, W, rim_r, lod), o["tyre_segs"])
    P.add("rubber", V, F, crease=50)
    h = W / 2
    r_out = rim_r - 0.024     # where spokes meet the lip
    r_hub = 0.075             # solid hub disc
    r_cap = 0.042             # centre cap
    x_lip = 0.45 * h
    x_out = 0.36 * h          # spoke root at the lip (dished in)
    x_hub = 0.52 * h          # hub face, proud of the lip plane
    x_floor = -0.05 * h       # brake/barrel backdrop seen through the windows
    # lip: from the tyre bead over the flange and down into the dish, then the barrel back to the inner side
    lip = [(rim_r + 0.012, 0.40 * h), (rim_r + 0.013, 0.455 * h), (rim_r + 0.004, 0.475 * h), (rim_r - 0.010, 0.47 * h),
           (rim_r - 0.018, 0.45 * h), (r_out, x_out)]
    lip_segs = SPOKES * (o["spoke_cols"] + o["win_cols"])
    V, F = lathe(lip, lip_segs)
    P.add("rim", V, F[:, ::-1], crease=35)
    barrel = [(r_out - 0.004, x_floor + 0.002), (r_out - 0.004, -0.46 * h), (rim_r + 0.012, -0.46 * h)]
    V, F = lathe(barrel, lip_segs)
    P.add("trim", V, F[:, ::-1], crease=35)
    # spoke face: polar grid whose columns follow the spoke edges; window cells drop to the floor with walls
    sector = 2 * np.pi / SPOKES
    rs = np.linspace(r_cap, r_out, o["rings"] + 2)
    rs = np.unique(np.concatenate([rs, [r_hub]]))
    ns, nw = o["spoke_cols"], o["win_cols"]

    def spoke_half_angle(r):
        w = np.interp(r, [r_hub, r_out], [0.095, 0.062])
        return (w / 2) / r

    cols = []  # (theta function of r, u in [-1, 1] for spoke columns else None)
    for k in range(SPOKES):
        c = k * sector
        for i in range(ns):
            u = -1 + 2 * i / ns
            cols.append((lambda r, c=c, u=u: c + u * spoke_half_angle(r), u, True))
        for i in range(nw):
            t = i / nw
            cols.append((lambda r, c=c, t=t: c + spoke_half_angle(r) + t * (sector - 2 * spoke_half_angle(r)), None, False))
    nc = len(cols)

    def theta(j, r):
        return cols[j % nc][0](r) + (2 * np.pi if j >= nc else 0)

    def xf(r, j):
        u = cols[j % nc][1]
        base = np.interp(r, [r_cap, r_hub, r_out], [x_hub, x_hub - 0.006, x_out])
        if u is not None and r > r_hub:
            base += 0.012 * (1 - u * u) * np.interp(r, [r_hub, r_out], [1, 0.4])
        return base

    def pt(r, j, x):
        a = theta(j, r)
        return [x, r * np.cos(a), r * np.sin(a)]

    def is_win(i, j):
        return (not cols[j % nc][2]) and rs[i] >= r_hub - 1e-9

    front, floor, walls = [], [], []
    for i in range(len(rs) - 1):
        r0, r1 = rs[i], rs[i + 1]
        for j in range(nc):
            # corner u for crown: column j spans [j, j+1]; the right edge belongs to column j+1's u
            a = pt(r0, j, xf(r0, j)); b = pt(r0, j + 1, xf(r0, j + 1)); c = pt(r1, j + 1, xf(r1, j + 1)); d = pt(r1, j, xf(r1, j))
            if is_win(i, j):
                fa, fb, fc, fd = (pt(r0, j, x_floor), pt(r0, j + 1, x_floor), pt(r1, j + 1, x_floor), pt(r1, j, x_floor))
                floor.append([fa, fb, fc, fd])
                inside = np.mean([fa, fb, fc, fd], 0)
                cell = []
                if not is_win(i, j - 1):
                    cell.append([a, d, fd, fa])
                if not is_win(i, j + 1):
                    cell.append([c, b, fb, fc])
                if i == 0 or not is_win(i - 1, j):
                    cell.append([b, a, fa, fb])
                if i == len(rs) - 2 or not is_win(i + 1, j):
                    cell.append([d, c, fc, fd])
                for q in cell:  # wind each wall to face into its window
                    q = np.asarray(q)
                    n = np.cross(q[1] - q[0], q[2] - q[0])
                    walls.append(q if n @ (inside - q.mean(0)) < 0 else q[::-1])
            else:
                front.append([a, b, c, d])

    def quads(qs, flip=False):
        Q = np.asarray(qs, float).reshape(-1, 3)
        n = len(qs)
        idx = np.arange(n)[:, None] * 4
        F = np.concatenate([idx + [0, 1, 2], idx + [0, 2, 3]])
        return Q, (F[:, ::-1] if flip else F)

    # quads above are wound a->b->c->d with theta increasing then r increasing; seen from +X that is clockwise
    P.add("rim", *quads(front, flip=True), crease=30)
    P.add("trim", *quads(floor, flip=True), crease=30)
    P.add("rim", *quads(walls), crease=30)
    # centre cap
    cap = [(0.0, x_hub + 0.016), (0.022, x_hub + 0.013), (0.036, x_hub + 0.006), (r_cap, x_hub)]
    V, F = lathe(cap, lip_segs)
    P.add("rim", V, F, crease=35)
    # lug nuts
    if o["nut_segs"]:
        for k in range(SPOKES):
            a = (k + 0.5) * sector
            cy, cz = 0.058 * np.cos(a), 0.058 * np.sin(a)
            V, F = lathe([(0.0, x_hub + 0.014), (0.009, x_hub + 0.014), (0.009, x_hub - 0.002)], 6)
            V[:, 1] += cy; V[:, 2] += cz
            P.add("chrome", V, F, crease=35)
    return P


def check_orientation(P):
    """Outward-normal sanity: tread faces point away from the axle, the spoke front faces +X."""
    from meshkit import face_normals
    V, F, _ = P.by["rubber"][0]
    n, _ = face_normals(V, F)
    c = V[F].mean(1)
    radial = c.copy(); radial[:, 0] = 0
    top = np.linalg.norm(radial, axis=1) > np.linalg.norm(radial, axis=1).max() - 0.002
    if (n[top] * radial[top]).sum(1).mean() <= 0:
        raise RuntimeError("tyre tread normals point inward")
    V, F, _ = P.by["rim"][0]
    for V, F, _ in P.by["rim"]:
        pass
    Vf, Ff, _ = P.by["rim"][1]
    n, _ = face_normals(Vf, Ff)
    if n[:, 0].mean() <= 0.5:
        raise RuntimeError(f"spoke faces do not face +X (mean nx {n[:, 0].mean():.2f})")
