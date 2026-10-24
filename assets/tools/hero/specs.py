"""Per-candidate build specs (car frame: +X left, +Y up, +Z forward, metres). Boxes are picked from the orthographic
elevations (work/elev/) and sections (scripts/section.py) of the aligned clay, against the SDXL reference.
Regions are listed for the +X half and mirrored; later regions override earlier ones."""
INF = float("inf")
REAR = ([0, 0, -1], 0.35)    # facing: rear-facing faces
FRONT = ([0, 0, 1], 0.3)
SIDE = ([1, 0, 0], 0.55)
TOP = ([0, 1, 0], 0.55)


def box(mat, lo, hi, **kw):
    return dict(mat=mat, box=(lo, hi), **kw)


def strakes(z0, z1, y0, n, slot, pitch, push):
    return [box("trim", [0.6, y0 + k * pitch, z0], [INF, y0 + k * pitch + slot, z1], facing=SIDE, push=push) for k in range(n)]


def lid_gaps(x0, x1, z0, z1, gap, push):
    """Panel gaps outlining a pop-up headlamp lid on the bonnet."""
    return [box("trim", [x0, 0.4, z0], [x1, INF, z0 + gap], facing=TOP, push=push),
            box("trim", [x0, 0.4, z1 - gap], [x1, INF, z1], facing=TOP, push=push),
            box("trim", [x0, 0.4, z0], [x0 + gap, INF, z1], facing=TOP, push=push),
            box("trim", [x1 - gap, 0.4, z0], [x1, INF, z1], facing=TOP, push=push)]


SPECS = {
    "rear2_s1234": dict(
        wheels=dict(front=dict(radius=0.315, width=0.225, x_out_max=0.955), rear=dict(radius=0.33, width=0.255, x_out_max=0.96)),
        # windscreen sheet centre surface y = a + b z + d z^2 + c x^2, within the z span and half width
        windscreen=dict(a=1.078, b=-0.25, d=-0.2, c=-0.15, tol=0.035, z=(-0.33, 0.72), x_max=0.76),
        # twin tips each side: (x, y) centres, radius, from z0 (inside the valance) to z1 (just behind the bumper face)
        wipers=dict(spans=[(-0.06, -0.58, 0.70), (0.40, -0.02, 0.74)]),  # parked blades (x0, x1, z) on the cowl
        exhausts=dict(centres=[(0.355, 0.265), (0.455, 0.265)], radius=0.04, z0=-1.98, z1=-2.195),
        under_y=0.35,
        taubin=12,
        # biharmonic refills: lettering on the deck above the plate; the noisy cowl ridge and vent between screen and bonnet
        debadge=[([-0.2, 0.68, -2.0], [0.2, 0.78, -1.75]), ([-0.70, 0.74, 0.665], [0.70, 0.9, 0.86])],
        regions=[
            # cockpit opening, then the folded-roof boot (the hump behind the seats, above the deck): dark leather
            box("interior", [-0.71, 0.2, -0.98], [0.71, 1.0, 0.5], only=["paint", "trim"], mirror=False),
            box("interior", [-0.72, 0.78, -1.55], [0.72, 1.0, -0.97], only=["paint", "trim"], mirror=False),
            box("interior", [-0.71, 0.2, 0.49], [0.71, 0.83, 0.68], only=["paint", "trim"], mirror=False),  # dash under the screen
            # windscreen frame (top bar, pillars) and the black cowl strip where the screen meets the bonnet
            box("trim", [-INF, 0.95, -0.36], [INF, INF, -0.23], only=["glass", "paint"], mirror=False),
            box("paint", [0.70, 0.7, -INF], [INF, INF, INF], only=["glass"]),
            box("trim", [0.625, 0.845, -0.36], [0.70, INF, 0.64], only=["glass", "paint", "trim"]),
            box("trim", [-INF, 0.7, 0.575], [INF, INF, INF], only=["glass"], mirror=False),
            box("paint", [-INF, 0.7, 0.64], [INF, INF, INF], only=["glass", "trim"], mirror=False),
            # rear: lamp housings, red lamps, amber indicators, plate recess with a blank plate, black lower valance
            box("trim", [-INF, -INF, -INF], [INF, 0.495, -1.7], facing=REAR, mirror=False),
            box("trim", [0.285, 0.495, -INF], [0.875, 0.655, -1.8], facing=REAR),
            box("taillight", [0.30, 0.51, -INF], [0.69, 0.64, -1.8], facing=REAR),
            box("indicator", [0.705, 0.51, -INF], [0.86, 0.64, -1.8], facing=REAR),
            *[box("trim", [0.30, y, -INF], [0.86, y + 0.006, -1.8], facing=REAR, push=0.003) for y in (0.553, 0.594)],
            box("trim", [-0.27, 0.495, -INF], [0.27, 0.645, -1.8], facing=REAR, mirror=False),
            box("plate", [-0.24, 0.525, -INF], [0.24, 0.625, -1.8], facing=REAR, mirror=False),
            box("trim", [0.27, 0.15, -INF], [0.56, 0.37, -1.9]),  # Hunyuan's exhaust blobs: replaced by procedural tips
            # front: grille, indicators, black lip
            box("trim", [-INF, -INF, 1.7], [INF, 0.24, INF], facing=FRONT, mirror=False),
            box("trim", [-0.55, 0.27, 1.8], [0.55, 0.40, INF], facing=FRONT, mirror=False),
            box("indicator", [0.62, 0.33, 1.8], [0.82, 0.40, INF], facing=FRONT),
            # sills
            box("trim", [0.6, -INF, -1.0], [INF, 0.2, 0.9], facing=([1, 0, 0], 0.25)),
            *strakes(-0.88, -0.08, 0.31, 5, 0.022, 0.052, 0.012),
            *lid_gaps(0.42, 0.80, 1.52, 1.98, 0.007, 0.006),
        ],
    ),
}
