"""Traffic build specs (car frame: +X left, +Y up, +Z forward, metres). Boxes are picked from the gridded orthographic
elevations (work/elev/) and x-sections (section.py) of each aligned clay. Regions are given for the +X half and mirrored
unless mirror=False; later regions override earlier ones."""
INF = float("inf")
REAR = ([0, 0, -1], 0.35)
FRONT = ([0, 0, 1], 0.3)
SIDE = ([1, 0, 0], 0.5)


def box(mat, lo, hi, **kw):
    return dict(mat=mat, box=(lo, hi), **kw)


def line_plane(z0, y0, z1, y1, keep_front):
    """Plane through the side-elevation line (z0, y0)-(z1, y1), keeping the side toward -Z (keep_front=False) or +Z."""
    import numpy as np
    d = np.array([z1 - z0, y1 - y0])
    n = np.array([d[1], -d[0]])            # (nz, ny)
    if (n[0] > 0) != keep_front:
        n = -n
    n = -n                                  # inside: n.p <= d
    return ([0.0, float(n[1]), float(n[0])], float(n[1] * y0 + n[0] * z0))


SEDAN = dict(
    paint=[0.55, 0.53, 0.5], rim_r=0.178, under_y=0.33, taubin=8,
    wheels=dict(front=dict(radius=0.31, width=0.2, x_out_max=0.84), rear=dict(radius=0.31, width=0.2, x_out_max=0.84)),
    regions=[
        # greenhouse: side glass between the slanted A and C pillars, black B pillar
        box("glass", [0.5, 0.95, -0.92], [INF, 1.29, 0.95], facing=SIDE,
            planes=[line_plane(0.50, 1.30, 0.90, 0.95, keep_front=False), line_plane(-0.86, 1.30, -0.98, 0.95, keep_front=True)]),
        box("trim", [0.5, 0.95, -0.12], [INF, 1.30, -0.03], facing=SIDE, only=["glass", "paint"]),
        box("glass", [-0.66, 0.99, 0.48], [0.66, 1.345, 1.0], facing=([0, 0.79, 0.62], 0.55), mirror=False),
        box("glass", [-0.62, 0.99, -1.25], [0.62, 1.33, -0.95], facing=([0, 0.35, -0.94], 0.45), mirror=False),
        # front: grille, quad headlamps, wrap-around bumper
        box("trim", [-0.40, 0.56, 1.9], [0.40, 0.81, INF], facing=FRONT, mirror=False),
        box("headlight", [0.44, 0.61, 1.9], [0.75, 0.79, INF], facing=FRONT),
        box("trim", [-INF, 0.37, 1.97], [INF, 0.56, INF], mirror=False),
        # rear: wide lamp clusters with a segment line, black centre panel, bumper
        box("taillight", [0.40, 0.60, -INF], [0.83, 0.79, -2.05], facing=REAR),
        box("trim", [0.40, 0.69, -INF], [0.83, 0.70, -2.05], facing=REAR, push=0.003),
        box("trim", [-0.40, 0.60, -INF], [0.40, 0.79, -2.05], facing=REAR, mirror=False),
        box("trim", [-INF, 0.36, -INF], [INF, 0.56, -1.97], mirror=False),
        # sides: sills, bodyside rubbing strip, mirrors
        box("trim", [0.6, -INF, -1.75], [INF, 0.29, 1.95], facing=([1, 0, 0], 0.25)),
        box("trim", [0.6, 0.47, -2.0], [INF, 0.52, 2.1], facing=SIDE, push=0.0),
        box("trim", [0.80, 0.86, 0.68], [INF, 1.12, 1.02]),
        # straight lower edges: everything under the sill line, and the front valance under the bumper
        box("trim", [-INF, -INF, -INF], [INF, 0.27, INF], mirror=False),
        box("trim", [-INF, -INF, 1.9], [INF, 0.37, INF], mirror=False),
        box("trim", [-INF, -INF, -INF], [INF, 0.36, -1.97], mirror=False),
    ],
)

CONVERTIBLE = dict(
    paint=[0.5, 0.06, 0.07], rim_r=0.178, under_y=0.3, taubin=8, glass_blend=True,
    wheels=dict(front=dict(radius=0.30, width=0.21, x_out_max=0.85), rear=dict(radius=0.30, width=0.21, x_out_max=0.85)),
    regions=[
        # open cockpit (seats, dash, door cards) in dark trim; the windscreen sheet in glass with a black frame and cowl
        box("trim", [-0.70, 0.2, -0.64], [0.70, 0.99, 0.47], only=["paint"], mirror=False),
        box("glass", [-0.74, 0.93, 0.20], [0.74, 1.26, 0.78], only=["paint"], mirror=False),
        box("trim", [-INF, 1.185, 0.15], [INF, INF, 0.5], only=["glass"], mirror=False),
        box("trim", [0.655, 0.9, 0.15], [INF, INF, 0.8], only=["glass"]),
        box("trim", [-INF, 0.9, 0.62], [INF, 0.985, 0.8], only=["glass", "paint"], mirror=False),
        # front: flush lamps either side of a slim grille, bumper and valance
        box("headlight", [0.30, 0.59, 1.85], [0.70, 0.71, INF], facing=FRONT),
        box("trim", [-0.25, 0.58, 1.85], [0.25, 0.70, INF], facing=FRONT, mirror=False),
        box("trim", [-INF, 0.33, 1.95], [INF, 0.54, INF], mirror=False),
        box("trim", [-INF, -INF, 1.85], [INF, 0.33, INF], mirror=False),
        # rear: lamp band with a black centre panel, bumper
        box("taillight", [0.36, 0.58, -INF], [0.84, 0.73, -1.98], facing=REAR),
        box("trim", [0.36, 0.652, -INF], [0.84, 0.66, -1.98], facing=REAR, push=0.003),
        box("trim", [-0.36, 0.58, -INF], [0.36, 0.73, -1.98], facing=REAR, mirror=False),
        box("trim", [-INF, 0.32, -INF], [INF, 0.52, -1.95], mirror=False),
        box("trim", [-INF, -INF, -INF], [INF, 0.32, -1.9], mirror=False),
        # sides: sills, a thin rubbing strip, mirrors
        box("trim", [-INF, -INF, -INF], [INF, 0.25, INF], mirror=False),
        box("trim", [0.6, 0.46, -1.95], [INF, 0.50, 1.95], facing=SIDE),
        box("trim", [0.78, 0.86, 0.38], [INF, 1.12, 0.66]),
    ],
)

PICKUP = dict(
    paint=[0.12, 0.09, 0.09], rim_r=0.19, under_y=0.6, taubin=8,
    wheels=dict(front=dict(radius=0.36, width=0.22, x_out_max=0.87), rear=dict(radius=0.36, width=0.22, x_out_max=0.87)),
    regions=[
        box("glass", [0.5, 1.21, -0.10], [INF, 1.60, 1.05], facing=SIDE, planes=[line_plane(0.70, 1.60, 1.00, 1.22, keep_front=False)]),
        box("glass", [-0.68, 1.22, 0.66], [0.68, 1.645, 1.12], facing=([0, 0.75, 0.66], 0.5), mirror=False),
        box("glass", [-0.60, 1.25, -0.3], [0.60, 1.58, 0.0], facing=([0, 0, -1], 0.6), mirror=False),
        # front: grille between square lamps, chunky bumper
        box("trim", [-0.48, 0.76, 1.95], [0.48, 1.02, INF], facing=FRONT, mirror=False),
        box("headlight", [0.52, 0.80, 1.95], [0.77, 0.98, INF], facing=FRONT),
        box("trim", [-INF, 0.48, 2.02], [INF, 0.74, INF], mirror=False),
        # rear: vertical lamps at the bed corners, bumper, dark bed floor
        box("taillight", [0.70, 0.74, -INF], [INF, 1.10, -2.05], facing=REAR),
        box("trim", [0.70, 0.915, -INF], [INF, 0.925, -2.05], facing=REAR, push=0.003),
        box("trim", [-INF, 0.48, -INF], [INF, 0.70, -2.12], mirror=False),
        box("trim", [-0.82, 0.6, -2.1], [0.82, 0.86, -0.3], facing=([0, 1, 0], 0.7), mirror=False),
        # running gear and sills under the body line, mirrors
        box("trim", [-INF, -INF, -INF], [INF, 0.60, INF], mirror=False),
        box("trim", [0.84, 1.08, 0.70], [INF, 1.36, 1.05]),
    ],
)
BOXTRUCK = dict(
    paint=[0.62, 0.62, 0.6], rim_r=0.25, under_y=1.0, taubin=8, well=0.2, axles_z=dict(front=2.42, rear=-2.0),
    wheels=dict(front=dict(radius=0.48, width=0.26, x_out_max=1.06), rear=dict(radius=0.48, width=0.26, x_out_max=1.12)),
    regions=[
        # cab glass: door windows behind the slanted A pillar, windscreen
        box("glass", [0.6, 1.76, 1.25], [INF, 2.24, 2.4], facing=SIDE, planes=[line_plane(2.12, 2.26, 2.55, 1.80, keep_front=False)]),
        box("glass", [-0.88, 1.80, 2.15], [0.88, 2.28, 2.75], facing=([0, 0.7, 0.71], 0.5), mirror=False),
        # front: grille between rectangular lamps, bumper, everything under the cab
        box("trim", [-0.55, 1.05, 3.2], [0.55, 1.46, INF], facing=FRONT, mirror=False),
        box("headlight", [0.60, 1.18, 3.2], [0.88, 1.40, INF], facing=FRONT),
        box("trim", [-INF, 0.70, 3.25], [INF, 1.03, INF], mirror=False),
        box("trim", [-INF, -INF, 1.1], [INF, 0.95, 3.25], mirror=False),
        # rear: lamps on the box's lower frame, underride bar, chassis and tank under the box, a rub rail
        box("taillight", [0.82, 1.06, -INF], [1.1, 1.36, -3.42], facing=REAR),
        box("trim", [-INF, -INF, -INF], [INF, 1.0, 1.1], mirror=False),
        box("trim", [0.82, 1.20, -INF], [1.1, 1.21, -3.42], facing=REAR, push=0.003),
        box("trim", [0.9, 1.0, -3.5], [INF, 1.12, 1.1], facing=SIDE),
        box("trim", [-0.012, 1.15, -INF], [0.012, 3.1, -3.42], facing=REAR, mirror=False, push=0.004),
        box("trim", [0.95, 1.6, 1.8], [INF, 2.25, 2.3]),
    ],
)
SPECS = {"car-sedan": SEDAN, "car-convertible": CONVERTIBLE, "car-pickup": PICKUP, "car-boxtruck": BOXTRUCK}
