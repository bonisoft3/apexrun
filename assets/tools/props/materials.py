"""Hand PBR materials of the hero car, in glTF form; order defines the material index."""
NAMES = ["paint", "glass", "interior", "trim", "chrome", "taillight", "headlight", "indicator", "rubber", "rim", "plate"]
IDX = {n: i for i, n in enumerate(NAMES)}


def materials(paint_lin=(0.55, 0.012, 0.01)):
    def pbr(name, rgb, metal, rough, **extra):
        a = extra.pop("alpha", 1.0)
        return {"name": name, "pbrMetallicRoughness": {"baseColorFactor": list(rgb) + [a], "metallicFactor": metal, "roughnessFactor": rough}, **extra}
    return [
        pbr("paint", paint_lin, 0.1, 0.35, extensions={"KHR_materials_clearcoat": {"clearcoatFactor": 1.0, "clearcoatRoughnessFactor": 0.03}}),
        pbr("glass", (0.03, 0.035, 0.04), 0.0, 0.03, alpha=0.28, alphaMode="BLEND"),
        pbr("interior", (0.035, 0.03, 0.027), 0.0, 0.55),
        pbr("trim", (0.018, 0.018, 0.019), 0.0, 0.5),
        pbr("chrome", (0.95, 0.94, 0.92), 1.0, 0.07),
        pbr("taillight", (0.42, 0.01, 0.008), 0.0, 0.12, emissiveFactor=[1.0, 0.04, 0.02],
            extensions={"KHR_materials_emissive_strength": {"emissiveStrength": 0.6}}),
        pbr("headlight", (0.85, 0.85, 0.82), 0.0, 0.08, emissiveFactor=[1.0, 0.96, 0.85],
            extensions={"KHR_materials_emissive_strength": {"emissiveStrength": 0.25}}),
        pbr("indicator", (0.75, 0.32, 0.02), 0.0, 0.12, emissiveFactor=[1.0, 0.45, 0.02],
            extensions={"KHR_materials_emissive_strength": {"emissiveStrength": 0.15}}),
        pbr("rubber", (0.022, 0.022, 0.022), 0.0, 0.88),
        pbr("rim", (0.78, 0.78, 0.8), 1.0, 0.22),
        pbr("plate", (0.5, 0.5, 0.48), 0.0, 0.45),
    ]

# flat false colours for the material map render
FALSE = {"paint": "#d03030", "glass": "#40c0ff", "interior": "#8a5a2a", "trim": "#303030", "chrome": "#ffffff",
         "taillight": "#ff00a0", "headlight": "#ffff60", "indicator": "#ff9000", "rubber": "#101010", "rim": "#a0a0c0",
         "plate": "#60ff60"}
