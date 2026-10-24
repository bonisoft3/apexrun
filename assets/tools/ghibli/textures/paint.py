"""Repaint each ground set as a Ghibli background's gouache: opaque, layered, soft brushwork.

The cartoon set is the starting image (its shapes and mean colour carry over), flattened
into colour regions first so SDXL img2img paints brush shapes rather than grain. The
pipeline is the cartoon pass's (cartoon/textures/paint.py), with its own prompts.

usage: paint.py <orig_dir> <manifest.orig.json> <raw_out_dir> [set[:seed] ...]
  -> <raw_out_dir>/<set>.s<seed>.{png,json}
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "cartoon", "textures"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import paint

paint.STYLE = ("flat seamless ground texture seen from directly above, painted in opaque gouache in the style of "
               "Studio Ghibli background art, soft visible brush strokes, uniform coverage, no objects")
paint.NEG = ("flowers, blossoms, petals, leaves, branches, twigs, plants, objects, photo, photorealistic, noise, grain, speckles, "
             "film grain, text, watermark, logo, perspective, horizon, sky, people, animals, blurry, lowres, 3d render, "
             "plastic, miniature, model railway, pattern, wallpaper, decorative")

# set -> (material phrase, strength, seed, mean shift radii (spatial, colour), negative extra)
paint.SETS = {  # strengths lower than the material repaint: the brush, not new content
    "asphalt": ("painted road surface, flat dark blue-grey asphalt in gouache, a few soft lighter brush strokes", 0.55, 3, (1, 1), "stripes, lines, cracks, puddles"),
    "cobble": ("painted cobblestone street, rounded setts in warm greys with soft painted joints", 0.55, 3, (1, 1), "gaps, loose stones"),
    "field-soil": ("painted ploughed field, warm brown earth laid in soft parallel brush strokes", 0.55, 3, (1, 1), "tiles, scales, grid"),
    "forest-floor": ("painted forest floor, deep moss greens in soft broad layered gouache strokes", 0.45, 21, (1, 1), "twigs, branches"),
    "grass": ("painted lush meadow grass, layered green brush strokes, lighter yellow-green dabs over deep green shade", 0.55, 3, (1, 1), "flowers, rocks, dirt"),
    "rock-canyon": ("painted red sandstone rock face, soft horizontal strata in warm opaque gouache", 0.45, 21, (1, 1), "plants"),
    "rock-granite": ("painted grey granite rock, soft broad facets, cool shade and warm light", 0.55, 3, (1, 1), "plants"),
    "ruins-stone": ("painted old sandstone block wall, soft worn blocks, warm ochre", 0.55, 3, (1, 1), "plants"),
    "sand-beach": ("painted pale golden beach sand, soft warm brush strokes, gentle ripples", 0.55, 3, (1, 1), "shells, footprints"),
    "sand-desert": ("painted warm orange desert ground, smooth broad horizontal gouache brush strokes, calm and even", 0.45, 21, (1, 1), "objects, shells, footprints"),
    "snow": ("painted fresh snow, soft white with pale blue shade strokes", 0.55, 3, (1, 1), "rocks, footprints"),
}
import numpy as np
from PIL import Image
import brush


def strokes(length, width, amount):
    """The set seeded with brushwork SDXL can read, `amount` sRGB levels either way."""
    def pre(img):
        t = brush.strokes(np.random.default_rng(17), img.size[0], length, width)
        a = np.asarray(img).astype(np.float32) + amount * np.clip(t, -2.5, 2.5)[..., None] / 2.5
        return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    return pre


# set -> stroke length and width px, levels
STROKES = {"asphalt": (60, 6, 14), "cobble": (24, 6, 20), "field-soil": (90, 8, 26), "forest-floor": (60, 14, 24),
           "grass": (40, 5, 40), "rock-canyon": (140, 18, 22), "rock-granite": (50, 10, 30), "ruins-stone": (40, 8, 22),
           "sand-beach": (80, 8, 20), "sand-desert": (120, 16, 18), "snow": (80, 10, 18)}
paint.PRE = {k: (strokes(*v), f"stroke noise {v[0]}x{v[1]} px at three angles, patch-picked (160 px), +-{v[2]} sRGB levels (seed 17)") for k, v in STROKES.items()}
# SDXL paints near-black inputs poorly: lifted first, as the cartoon pass does.
_asphalt_strokes, _asphalt_note = paint.PRE["asphalt"]
paint.PRE["asphalt"] = (lambda img: _asphalt_strokes(paint.stretch(img)), "per-channel contrast doubled, lifted to mid grey; " + _asphalt_note)

if __name__ == "__main__":
    paint.main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:] or list(paint.SETS))
