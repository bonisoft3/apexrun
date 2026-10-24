"""glTF material dicts for the props: flat PBR colours (linear), optional textures by image index, emissive strength."""


def pbr(name, rgb, metal=0.0, rough=0.8, alpha=None, emissive=None, strength=None, tex=None, emissive_tex=None,
        double=False, mask=None, clearcoat=None):
    m = {"name": name, "pbrMetallicRoughness": {"baseColorFactor": [float(c) for c in rgb] + [1.0 if alpha is None else alpha],
                                                "metallicFactor": metal, "roughnessFactor": rough}}
    if tex is not None:
        m["pbrMetallicRoughness"]["baseColorTexture"] = {"image": tex}
    if emissive is not None:
        m["emissiveFactor"] = [float(c) for c in emissive]
    if emissive_tex is not None:
        m["emissiveTexture"] = {"image": emissive_tex}
    ext = {}
    if strength is not None:
        ext["KHR_materials_emissive_strength"] = {"emissiveStrength": strength}
    if clearcoat is not None:
        ext["KHR_materials_clearcoat"] = {"clearcoatFactor": 1.0, "clearcoatRoughnessFactor": clearcoat}
    if ext:
        m["extensions"] = ext
    if alpha is not None:
        m["alphaMode"] = "BLEND"
    if mask is not None:
        m["alphaMode"] = "MASK"; m["alphaCutoff"] = mask
    if double:
        m["doubleSided"] = True
    return m


def srgb(h):
    """'#rrggbb' -> linear rgb."""
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
