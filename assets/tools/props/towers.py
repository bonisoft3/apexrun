"""Downtown towers for the night city: tower-a (art-deco setbacks and spire), tower-b (slab), tower-c (octagonal crown).

usage: towers.py   -> work/build/tower-{a,b,c}_lod{0,1,2}.glb + work/build/towers.json
Windows: material `window`, a 256 px texture of 8 x 8 cells (lit warm / lit cool / dark glass, dark mullions) tiled by UV
at one cell per bay (about 3 m) and per floor (3.6 m); its emissive texture is the lit cells only. Each facade face draws
from its own whole-cell UV offset so neighbouring faces do not repeat. Body material `facade`; trims `trim` (dark metal);
crown lights on tower-c use `window`'s emissive so one material drives all night lighting."""
import io, json, os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import geo
from mats import pbr

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CELLS, PX = 16, 32
FLOOR, BAY = 3.6, 1.6


def window_textures(seed):
    """-> (albedo PNG bytes, emissive PNG bytes, lit fraction). Lit cells cluster along floors (offices on, offices off)."""
    rng = np.random.default_rng(seed)
    n = CELLS * PX
    alb = np.zeros((n, n, 3), np.float32)
    emi = np.zeros((n, n, 3), np.float32)
    lit_count = 0
    for r in range(CELLS):
        floor_on = r == 0 or rng.random() < 0.45
        for c in range(CELLS):
            on = r == 0 or rng.random() < (0.6 if floor_on else 0.08)
            y0, x0 = r * PX, c * PX
            # image rows grow with height up the facade: spandrel band first, then glass, then the frame
            alb[y0:y0 + PX, x0:x0 + PX] = 0.05
            glass = (slice(y0 + 10, y0 + PX - 3), slice(x0 + 3, x0 + PX - 3))
            if on:
                warm = r == 0 or rng.random() < 0.7
                k = 1.0 if r == 0 else 0.7 + 0.3 * rng.random()
                col = np.array([1.0, 0.72, 0.38] if warm else [0.62, 0.8, 1.0]) * k
                alb[glass] = col * 0.12   # the light is emitted; under the night sky's exposure a lit albedo floodlit the walls
                emi[glass] = col
                if r and rng.random() < 0.35:   # a blind drawn down from the top of some lit windows
                    h = int(17 * (0.2 + 0.4 * rng.random()))
                    bl = (slice(y0 + PX - 3 - h, y0 + PX - 3), glass[1])
                    alb[bl] = col * 0.08; emi[bl] = col * 0.35
                lit_count += 1
            else:
                g = 0.025 + 0.03 * rng.random()
                alb[glass] = [g * 0.8, g * 0.95, g * 1.4]
    # row 0 is all lit: crown bands map onto it
    def png(a):
        b = io.BytesIO()
        Image.fromarray((np.clip(a, 0, 1) ** (1 / 2.2) * 255 + 0.5).astype(np.uint8)).save(b, "PNG", optimize=True)
        return b.getvalue()
    return png(alb), png(emi), lit_count / CELLS ** 2


class Builder:
    def __init__(self, lod, seed):
        self.m = geo.Mesh()
        self.lod = lod
        self.rng = np.random.default_rng(seed)

    def win_quad(self, p0, along, length, y0, y1, normal):
        """Window quad on a vertical plane: starts at p0 (x, z), runs `length` along the unit XZ vector `along`."""
        a = np.array([along[0], 0, along[1]], float)
        b0 = np.array([p0[0], y0, p0[1]], float)
        V = np.array([b0, b0 + a * length, b0 + a * length + [0, y1 - y0, 0], b0 + [0, y1 - y0, 0]])
        nrm = np.cross(V[1] - V[0], V[3] - V[0])
        F = np.array([[0, 1, 2], [0, 2, 3]]) if nrm @ [normal[0], 0, normal[1]] > 0 else np.array([[0, 2, 1], [0, 3, 2]])
        nb = max(1, round(length / BAY))
        du, dv = self.rng.integers(0, CELLS, 2)
        u = np.array([0, nb, nb, 0], float) * (length / nb) / (length / nb)  # whole bays
        v = np.array([0, 0, 1, 1], float) * (y1 - y0) / FLOOR
        UV = np.stack([(u + du) / CELLS, (v + dv) / CELLS], 1)
        self.m.add("window", V, F, UV, crease=10)
        return nb

    def tier_rect(self, w, d, y0, y1, pier=1.2, recess=0.35, fins=True, cornice=0.9, cornice_out=0.3, mat="facade"):
        """A rectangular tier: window walls between corner piers, a cornice slab on top."""
        hw, hd = w / 2, d / 2
        sides = [((-hw + pier, hd - recess), (1, 0), w - 2 * pier, (0, 1)),
                 ((hw - pier, -hd + recess), (-1, 0), w - 2 * pier, (0, -1)),
                 ((hw - recess, hd - pier), (0, -1), d - 2 * pier, (1, 0)),
                 ((-hw + recess, -hd + pier), (0, 1), d - 2 * pier, (-1, 0))]
        top = y1 - cornice
        for p0, al, L, nrm in sides:
            nb = self.win_quad(p0, al, L, y0, top, nrm)
            if fins and self.lod == 0:
                for k in range(2, nb - 1, 2):
                    t = k * L / nb
                    cx = p0[0] + al[0] * t + nrm[0] * recess / 2
                    cz = p0[1] + al[1] * t + nrm[1] * recess / 2
                    sz = [0.18 if al[0] else recess, top - y0, recess if al[0] else 0.18]
                    V, F, UV = geo.box([cx, (y0 + top) / 2, cz], sz, faces="xXzZ")
                    self.m.add("trim", V, F, UV)
        for sx in (-1, 1):
            for sz in (-1, 1):
                V, F, UV = geo.box([sx * (hw - pier / 2), (y0 + top) / 2, sz * (hd - pier / 2)], [pier, top - y0, pier], faces="xXzZ")
                self.m.add(mat, V, F, UV)
        V, F, UV = geo.box([0, top + cornice / 2, 0], [w + 2 * cornice_out, cornice, d + 2 * cornice_out])
        self.m.add(mat, V, F, UV)

    def slab(self, c, s, mat="facade", faces="xXyYzZ"):
        V, F, UV = geo.box(c, s, faces=faces)
        self.m.add(mat, V, F, UV)


def tower_a(lod):
    """Art-deco setbacks: podium, three tiers, stepped crown and spire. 80 m."""
    b = Builder(lod, 101)
    b.tier_rect(28, 28, 0, 9.0, pier=2.0, recess=0.6, fins=True, cornice=1.6, cornice_out=0.2)   # podium: storefront band
    b.tier_rect(22, 22, 9.0, 45.0, pier=1.6, recess=0.4)
    b.tier_rect(17, 17, 45.0, 59.4, pier=1.4, recess=0.4)
    b.tier_rect(12, 12, 59.4, 67.2, pier=1.2, recess=0.35, fins=lod == 0)
    if lod < 2:
        b.slab([0, 68.4, 0], [9.6, 2.4, 9.6]); b.slab([0, 70.4, 0], [7.0, 1.6, 7.0]); b.slab([0, 71.8, 0], [4.6, 1.2, 4.6])
        if lod == 0:
            for k in range(4):  # deco ribs climbing the crown
                a = k * np.pi / 2
                R = geo.rot_y(a)
                V, F, UV = geo.box([0, 69.8, 5.0], [0.6, 5.2, 0.5])
                b.m.add("facade", V @ R.T, F, UV)
    else:
        b.slab([0, 69.6, 0], [8.0, 4.8, 8.0])
    segs = (8, 6, 4)[lod]
    V, F, UV = geo.cylinder([0, 72.4, 0], [0, 80.0, 0], 0.9, 0.06, segs=segs)
    b.m.add("trim", V, F, UV)
    return b.m


def tower_b(lod):
    """Slab: a long curtain-wall block, blank end walls with a window strip, recessed lobby on pilotis, rooftop plant. 55 m."""
    b = Builder(lod, 202)
    W, D, H = 40.0, 14.0, 52.0
    # lobby: recessed glass box on columns
    b.win_quad((-W / 2 + 2.5, D / 2 - 2.5), (1, 0), W - 5, 0, 5.4, (0, 1))
    b.win_quad((W / 2 - 2.5, -D / 2 + 2.5), (-1, 0), W - 5, 0, 5.4, (0, -1))
    b.slab([W / 2 - 1.25, 2.7, 0], [2.5, 5.4, D], faces="xXzZ"); b.slab([-W / 2 + 1.25, 2.7, 0], [2.5, 5.4, D], faces="xXzZ")
    if lod < 2:
        for x in np.linspace(-W / 2 + 6, W / 2 - 6, 5 if lod == 0 else 3):
            for z in (-D / 2 + 1.0, D / 2 - 1.0):
                V, F, UV = geo.cylinder([x, 0, z], [x, 5.4, z], 0.45, segs=(10, 6)[lod], caps=False)
                b.m.add("trim", V, F, UV)
    b.slab([0, 5.4 + 0.4, 0], [W + 0.4, 0.8, D + 0.4])
    y0 = 6.2
    # long faces: full curtain wall with a floor band per floor (LOD0) between solid end walls
    for sz in (1, -1):
        p0 = (-W / 2 + 0.6, sz * (D / 2 - 0.25)) if sz > 0 else (W / 2 - 0.6, -D / 2 + 0.25)
        b.win_quad(p0, (sz, 0), W - 1.2, y0, H, (0, sz))
        if lod == 0:
            for k in range(int((H - y0) / FLOOR)):
                y = y0 + k * FLOOR
                b.slab([0, y + 0.15, sz * (D / 2 - 0.05)], [W - 1.2, 0.3, 0.4], mat="trim", faces="yYzZ")
    # end walls: solid, with a centred vertical window strip
    for sx in (1, -1):
        b.slab([sx * (W / 2 - 0.3), (y0 + H) / 2, 0], [0.6, H - y0, D], faces="xX")
        b.win_quad((sx * (W / 2 + 0.01), sx * 1.5), (0, -sx), 3.0, y0, H - 0.5, (sx, 0))
    b.slab([0, H + 0.5, 0], [W + 0.6, 1.0, D + 0.6])
    if lod < 2:
        b.slab([-6, H + 3.0, 0], [12, 4.0, 8])        # plant room
        b.slab([8, H + 2.0, 1], [5, 2.0, 5], mat="trim")
        if lod == 0:
            V, F, UV = geo.cylinder([12, H + 1, -2.5], [12, H + 4.0, -2.5], 1.6, segs=12)
            b.m.add("trim", V, F, UV)
            for x in np.linspace(-11, -1, 4):
                b.slab([x, H + 5.4, 0], [1.6, 0.8, 1.6], mat="trim")
    return b.m


def tower_c(lod):
    """Octagonal tower with a lit crown ring and an antenna. 38 m to the roof, 46 m to the antenna tip."""
    b = Builder(lod, 303)
    S, ch = 18.0, 4.0   # square side, chamfer
    h = S / 2
    oct_ = np.array([(-h + ch, -h), (h - ch, -h), (h, -h + ch), (h, h - ch), (h - ch, h), (-h + ch, h), (-h, h - ch), (-h, -h + ch)])
    # base: two dark granite floors
    V, F, UV = geo.prism(oct_ * 1.06, 0, 7.2)
    b.m.add("trim", V, F, UV)
    y0, y1 = 7.2, 36.0
    rec = 0.4
    n = len(oct_)
    for i in range(n):
        a, c = oct_[i], oct_[(i + 1) % n]
        e = (c - a) / np.linalg.norm(c - a)
        out = np.array([e[1], -e[0]])
        if (a + c) @ out < 0:
            out = -out
        L = np.linalg.norm(c - a)
        if i % 2 == 0:  # the four long faces: windows between edge piers
            p0 = a + e * 0.9 - out * rec
            b.win_quad(p0, e, L - 1.8, y0, y1, out)
            for t in (0.45, L - 0.45):
                cx, cz = a + e * t
                V, F, UV = geo.box([0, (y0 + y1) / 2, 0], [0.9, y1 - y0, 0.9], faces="xXzZ")
                ang = np.arctan2(e[0], e[1])
                b.m.add("facade", V @ geo.rot_y(ang - np.pi / 2).T + [cx, 0, cz], F, UV)
        else:           # chamfers: solid with a slim window slot
            mid = (a + c) / 2
            V, F, UV = geo.box([0, (y0 + y1) / 2, 0], [L, y1 - y0, 0.8], faces="Z")
            ang = np.arctan2(out[0], out[1])
            b.m.add("facade", V @ geo.rot_y(ang).T + [mid[0] - out[0] * 0.4, 0, mid[1] - out[1] * 0.4], F, UV)
            b.win_quad(mid - e * 0.7 + out * 0.01, e, 1.4, y0, y1, out)
    # floor bands
    if lod == 0:
        for k in range(1, int((y1 - y0) / (2 * FLOOR)) + 1):
            y = y0 + k * 2 * FLOOR
            V, F, UV = geo.prism(oct_ * 1.012, y - 0.25, y + 0.05)
            b.m.add("facade", V, F, UV)
    V, F, UV = geo.prism(oct_ * 1.05, y1, y1 + 0.8)
    b.m.add("facade", V, F, UV)
    # crown: a lit band, a set-back drum and a ring
    V, F, UV = geo.prism(oct_ * 0.8, y1 + 0.8, y1 + 4.4, caps=False)
    UV = np.column_stack([UV[:, 0] / BAY / CELLS, 0.3 / CELLS + (UV[:, 1] - (y1 + 0.8)) / 3.6 * 0.6 / CELLS])  # row 0: all lit
    b.m.add("window", V, F, UV, crease=10)
    V, F, UV = geo.prism(oct_ * 0.84, y1 + 4.4, y1 + 5.2)
    b.m.add("facade", V, F, UV)
    if lod < 2:
        V, F, UV = geo.prism(oct_ * 0.45, y1 + 5.2, y1 + 7.2)
        b.m.add("trim", V, F, UV)
    segs = (8, 6, 4)[lod]
    V, F, UV = geo.cylinder([0, y1 + 5.2, 0], [0, 46.0, 0], 0.35, 0.05, segs=segs)
    b.m.add("trim", V, F, UV)
    return b.m


FACADES = {"tower-a": (0.30, 0.26, 0.21), "tower-b": (0.20, 0.21, 0.23), "tower-c": (0.11, 0.12, 0.13)}
BUILD = {"tower-a": tower_a, "tower-b": tower_b, "tower-c": tower_c}
SEEDS = {"tower-a": 7, "tower-b": 8, "tower-c": 9}
EMISSIVE_STRENGTH = 1.6


def materials(name):
    return [pbr("facade", FACADES[name], 0.0, 0.75),
            pbr("window", (1, 1, 1), 0.0, 0.12, tex=0, emissive=(1, 1, 1), emissive_tex=1, strength=EMISSIVE_STRENGTH),
            pbr("trim", (0.05, 0.05, 0.055), 0.6, 0.45)]


if __name__ == "__main__":
    os.makedirs(f"{ROOT}/work/build", exist_ok=True)
    rec = {}
    for name, fn in BUILD.items():
        alb, emi, lit = window_textures(SEEDS[name])
        rec[name] = {"lit_fraction": lit, "lods": []}
        for lod in (0, 1, 2):
            m = fn(lod)
            path = f"{ROOT}/work/build/{name}_lod{lod}.glb"
            size = geo.write(path, [(name, m, None)], materials(name), [(alb, "image/png"), (emi, "image/png")])
            lo, hi = m.bounds()
            rec[name]["lods"].append(dict(lod=lod, path=os.path.relpath(path, ROOT), tris=m.tris(), bytes=size, bounds_m=[lo.tolist(), hi.tolist()],
                                          nodes=[name], materials=[x["name"] for x in materials(name) if x["name"] in m.parts]))
            print(name, lod, m.tris(), size, np.round(lo, 2).tolist(), np.round(hi, 2).tolist())
    for name, r in rec.items():
        json.dump({"name": name, **r, "note": ""}, open(f"{ROOT}/work/build/{name}.json", "w"), indent=1)
