"""Cartoon wheel: a balloon tyre (smooth sidewalls, round shoulders, no tread) on the chunky five-spoke alloy of wheel.py,
tessellated finely enough at every LOD that the silhouette reads round. Local frame: hub at the origin, axle along X, outer
face toward +X."""
import numpy as np
import wheel

LODS = {0: dict(tyre_segs=64, arc=5, spoke_cols=3, win_cols=5, rings=4, nut_segs=8),
        1: dict(tyre_segs=40, arc=3, spoke_cols=2, win_cols=4, rings=2, nut_segs=0),
        2: dict(tyre_segs=24, arc=1, spoke_cols=1, win_cols=2, rings=1, nut_segs=0)}


def balloon_profile(R, W, rim_r, arc):
    """(radius, axial) walk: outer bead -> bulging sidewall -> round shoulder -> flat tread -> mirror."""
    h = W / 2
    s = R - rim_r
    rr = min(0.42 * s, 0.6 * h)                       # shoulder radius
    side = [(rim_r - 0.004, 0.42 * h), (rim_r + 0.15 * s, 0.50 * h)]
    k = np.linspace(0, np.pi / 2, arc + 1)
    # sidewall bulge to full width, then the shoulder quarter-circle centred at (R - rr, h - rr)
    side += [(R - rr - (R - rr - rim_r - 0.15 * s) * (1 - t), h * (0.5 + 0.5 * np.sin(t * np.pi / 2))) for t in (0.5, 1.0)]
    side += [(R - rr + rr * np.sin(a), h - rr + rr * np.cos(a)) for a in k[1:]]
    return side + [(r, -x) for r, x in reversed(side)]


def build(R, W, rim_r, lod):
    o = LODS[lod]
    wheel.LODS[f"cartoon{lod}"] = o
    wheel.tyre_profile = lambda R_, W_, rim_, _lod: balloon_profile(R_, W_, rim_, o["arc"])
    return wheel.build(R, W, rim_r, f"cartoon{lod}")
