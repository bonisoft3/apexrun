"""Finish a gouache painting into the set's albedo, normal and arm: the cartoon pass's
finish (cartoon/textures/finish.py) with matt paint and a gentle relief, so brushwork
reads as paint rather than as material.

usage: finish.py <orig_dir> <manifest.orig.json> <raw_dir> <out_dir> set:seed ...
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "cartoon", "textures"))
import finish

# set -> roughness, spread (fraction of the source's sRGB std), normal slope (rms gradient), bilateral sigma colour
finish.FINISH = {
    "asphalt":      (0.90, 0.55, 0.05, 14),
    "cobble":       (0.85, 0.9, 0.10, 16),
    "field-soil":   (0.95, 0.9, 0.08, 12),
    "forest-floor": (0.95, 0.9, 0.08, 14),
    "grass":        (0.95, 0.9, 0.08, 12),
    "rock-canyon":  (0.90, 1.0, 0.10, 16),
    "rock-granite": (0.90, 1.0, 0.10, 16),
    "ruins-stone":  (0.90, 0.9, 0.10, 16),
    "sand-beach":   (0.95, 0.9, 0.06, 10),
    "sand-desert":  (0.95, 0.9, 0.06, 12),
    "snow":         (0.80, 0.9, 0.06, 10),
}

if __name__ == "__main__":
    finish.main(*sys.argv[1:5], sys.argv[5:])
