"""What the pack takes from Poly Haven (CC0), keyed by logical id."""

# Stage mood -> HDRI. Pure skies keep the game's own ground on the visible dome.
HDRIS = {
    "coconut-beach": "qwantani_sunset_puresky",
    "desert-canyons": "rustig_koppie_puresky",
    "gateway-pass": "qwantani_dusk_2_puresky",
    "alpine-peaks": "kloofendal_48d_partly_cloudy_puresky",
    "wilderness-run": "kloofendal_overcast_puresky",
    "tulip-gardens": "sunflowers_puresky",
    "ancient-ruins": "table_mountain_2_puresky",
    "sunset-highway": "the_sky_is_on_fire",
    "metropolis-night": "shanghai_bund",
}

TEXTURES = {
    "asphalt": "asphalt_track",
    "sand-beach": "aerial_beach_01",
    "sand-desert": "gravelly_sand",
    "snow": "snow_02",
    "forest-floor": "forest_leaves_02",
    "grass": "leafy_grass",
    "rock-canyon": "cliff_side",
    "rock-granite": "rock_boulder_dry",
    "ruins-stone": "large_sandstone_blocks_01",
    "field-soil": "farm_soil",
    "palm-bark": "palm_bark",
    "cobble": "cobblestone_floor_08",
}

# Model spec: ph = Poly Haven id; nodes = root nodes kept (None = all); compose = [(root node, (x, y, z), yaw deg)]
# re-placing kit pieces; budget = LOD0 triangles (LOD1/LOD2 take 25 % / 6 %); tex = LOD0 texture size;
# solid_tex = LOD0 size for non-foliage materials (default min(tex, 1024)); origin "base" centres on the trunk foot (trees), "bbox" on the footprint.
def M(ph, budget, stages, nodes=None, compose=None, tex=1024, origin="bbox", solid_tex=None):
    return dict(ph=ph, budget=budget, stages=stages, nodes=nodes, compose=compose, tex=tex, origin=origin,
                solid_tex=solid_tex or min(tex, 1024))

GRASS = [("grass_medium_01_tall_a_LOD0", (0, 0, 0), 0), ("grass_medium_01_tall_b_LOD0", (0.12, 0, 0.05), 40),
         ("grass_medium_01_mid_a_LOD0", (-0.1, 0, 0.08), 90), ("grass_medium_01_large_a_LOD0", (0.02, 0, -0.12), 150),
         ("grass_medium_01_mid_c_LOD0", (-0.09, 0, -0.08), 210), ("grass_medium_01_tall_c_LOD0", (0.06, 0, 0.14), 300)]
BERMUDA = [(f"grass_bermuda_01_{n}", ((i * 0.37) % 0.3 - 0.15, 0, (i * 0.61) % 0.3 - 0.15), i * 47)
           for i, n in enumerate(["medium_a", "medium_b", "medium_c", "medium_d", "medium_e", "medium_f", "seedling_a",
                                  "seedling_b", "seedling_c", "seedling_d", "single_a", "single_b", "small_a", "small_e"])]

MODELS = {
    "tree-jacaranda": M("jacaranda_tree", 40000, ["tulip-gardens", "ancient-ruins"], tex=2048, origin="base"),
    "tree-quiver": M("quiver_tree_01", 16000, ["desert-canyons"], tex=2048, origin="base"),
    "deadwood-quiver": M("dead_quiver_trunk", 8000, ["desert-canyons", "sunset-highway"]),
    "deadwood-log": M("dead_tree_trunk", 10000, ["wilderness-run", "alpine-peaks"]),
    "stump": M("tree_stump_01", 6000, ["wilderness-run", "alpine-peaks"]),
    "barrier-concrete": M("concrete_road_barrier", 4000, ["road", "metropolis-night", "sunset-highway"]),
    "hydrant": M("fire_hydrant", 3000, ["metropolis-night"], nodes=["fire_hydrant", "fire_hydrant_cap_01", "fire_hydrant_cap_02", "fire_hydrant_cap_03", "fire_hydrant_chain"], tex=512),
    "utility-box": M("utility_box_02", 2000, ["metropolis-night"], tex=512),
    "trash-can": M("metal_trash_can", 3000, ["metropolis-night"], nodes=["metal_trash_can", "metal_trash_can_handle_left", "metal_trash_can_handle_right"], tex=512),
}
