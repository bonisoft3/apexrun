//! ApexRun-specific Kazuo Oga gouache toon shader (`TOON_WGSL`), `.seed-assets` glTF 2.0
//! model library (`ArtPackLibrary`), and static/dynamic 3D stage & vehicle mesh builders.

use omnishell_bevy_presenter::{
    decode_image_rgba8, linear_to_srgb, parse_glb_chunks, read_f32_slice, read_index_slice,
    AccessorMeta, BufferViewMeta, DecodedImage, GpuVertex, PoseBuffer, PropAtlasBuilder,
    BODY_PIVOT_Y, MAX_TRAFFIC_CARS, PROP_ATLAS_DIM, TRAFFIC_STRIDE,
};
use omnishell_winio::{parse_json, JsonVal};

pub const TOON_WGSL: &str = r#"
#ifdef STK_TOON
let toonL: f32 = dot(diffuseBase, vec3f(0.2126, 0.7152, 0.0722)) / max(uniforms.toonLevel, 0.001);
var toonBand: f32 = smoothstep(0.08, 0.30, toonL) * 0.4 + smoothstep(0.42, 0.62, toonL) * 0.35 + smoothstep(0.75, 0.95, toonL) * 0.25;
#ifdef STK_PAINTED
toonBand = PAINTED_FLOOR + (1.0 - PAINTED_FLOOR) * toonBand;
#endif
var toonCol: vec3f = surfaceAlbedo * mix(uniforms.toonShade, uniforms.toonSun, toonBand);
#ifdef STK_LEAVES
let leafMass: f32 = 1.0 - smoothstep(0.3, 0.8, stkCells(fragmentInputs.vPositionW * LEAF_PER_METRE));
toonCol *= mix(LEAF_COOL, LEAF_WARM, leafMass * (0.4 + 0.6 * toonBand)) * mix(LEAF_GAP, 1.0, leafMass);
#endif
#ifdef STK_BRUSH
toonCol *= stkBrushTone(fragmentInputs.vPositionW, normalW, distance(scene.vEyePosition.xyz, fragmentInputs.vPositionW));
toonCol *= mix(GRADE_FOOT, vec3f(1.0), smoothstep(0.0, GRADE_METRES, fragmentInputs.vStkLift)) * mix(vec3f(1.0), GRADE_TOP, max(normalW.y, 0.0));
toonCol *= 1.0 - CONTOUR * smoothstep(0.6, 0.92, 1.0 - abs(dot(normalW, viewDirectionW)));
#endif
#ifdef STK_PATCH
let stkPatchGrain: f32 = stkGrain(vec3f(fragmentInputs.vPositionW.x, 0.0, fragmentInputs.vPositionW.z) * PATCH_PER_METRE);
let stkSlope: f32 = 1.0 - smoothstep(0.52, 0.90, max(normalW.y, 0.0));
let stkStrata: f32 = 0.5 + 0.5 * sin(fragmentInputs.vPositionW.y * 1.45 + stkPatchGrain * 3.8);
let stkScreeTint: vec3f = mix(vec3f(0.42, 0.39, 0.36), vec3f(0.58, 0.53, 0.48), stkStrata);
toonCol = mix(toonCol * (0.8 + 0.4 * stkPatchGrain), mix(toonCol, stkScreeTint, 0.48) * (0.72 + 0.46 * stkStrata), stkSlope);
#endif
let toonEdge: f32 = 1.0 - max(dot(normalW, viewDirectionW), 0.0);
toonCol += uniforms.toonRim * smoothstep(0.8, 0.95, toonEdge) * (1.0 - smoothstep(0.5, 0.85, normalW.y));
toonCol += finalEmissive;
finalColor = vec4f(toonCol, finalColor.a);
#endif
"#;

const ART_MANIFEST_JSON: &str = include_str!("../../assets/manifest.json");

#[derive(Clone)]
struct ParsedGlbPrimitive {
    material_name: String,
    positions: Vec<[f32; 3]>,
    normals: Vec<[f32; 3]>,
    colors: Vec<[f32; 4]>,
    vertex_ao: Vec<[f32; 3]>,
    uvs: Vec<[f32; 2]>,
    indices: Vec<u32>,
    stk_flags: [f32; 4],
}

#[derive(Clone)]
struct ParsedGlbNode {
    name: String,
    translation: [f32; 3],
    primitives: Vec<ParsedGlbPrimitive>,
}

#[derive(Clone)]
struct ParsedGlbModel {
    nodes: Vec<ParsedGlbNode>,
}

struct ArtPackLibrary {
    models: std::collections::HashMap<String, ParsedGlbModel>,
    atlas_rgba: Vec<u8>,
}


#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct StaticChunkC {
    pub z_min: f32,
    pub z_max: f32,
    pub index_offset: u32,
    pub index_count: u32,
}

/// Partitions a triangle index buffer into spatial Z-chunks of 120m along the highway
/// so the GPU main pass and shadow cascade pass can cull off-screen chunks in O(chunks).
pub fn partition_indices_into_z_chunks(
    vertices: &[GpuVertex],
    indices: &mut [u32],
) -> Vec<StaticChunkC> {
    let tri_count = indices.len() / 3;
    if tri_count == 0 {
        return Vec::new();
    }
    const CHUNK_METRES: f32 = 120.0;
    let mut tris: Vec<(i32, f32, f32, [u32; 3])> = Vec::with_capacity(tri_count);
    for t in 0..tri_count {
        let i0 = indices[t * 3];
        let i1 = indices[t * 3 + 1];
        let i2 = indices[t * 3 + 2];
        let z0 = vertices[i0 as usize].pos[2];
        let z1 = vertices[i1 as usize].pos[2];
        let z2 = vertices[i2 as usize].pos[2];
        let z_min = z0.min(z1).min(z2);
        let z_max = z0.max(z1).max(z2);
        let z_mid = (z0 + z1 + z2) * (1.0 / 3.0);
        // Large spanning ribbons settle into the bucket of their centroid, with exact [z_min, z_max] bounds preserved.
        let bucket = (z_mid / CHUNK_METRES).floor() as i32;
        tris.push((bucket, z_min, z_max, [i0, i1, i2]));
    }
    tris.sort_by_key(|t| t.0);

    let mut chunks = Vec::new();
    let mut cur_bucket = tris[0].0;
    let mut cur_z_min = f32::INFINITY;
    let mut cur_z_max = f32::NEG_INFINITY;
    let mut cur_start = 0u32;

    for (ti, &(b, z0, z1, tri)) in tris.iter().enumerate() {
        let idx_base = (ti * 3) as u32;
        if b != cur_bucket {
            chunks.push(StaticChunkC {
                z_min: cur_z_min,
                z_max: cur_z_max,
                index_offset: cur_start,
                index_count: idx_base - cur_start,
            });
            cur_bucket = b;
            cur_z_min = f32::INFINITY;
            cur_z_max = f32::NEG_INFINITY;
            cur_start = idx_base;
        }
        cur_z_min = cur_z_min.min(z0);
        cur_z_max = cur_z_max.max(z1);
        indices[ti * 3] = tri[0];
        indices[ti * 3 + 1] = tri[1];
        indices[ti * 3 + 2] = tri[2];
    }
    let total_idx = (tri_count * 3) as u32;
    if total_idx > cur_start {
        chunks.push(StaticChunkC {
            z_min: cur_z_min,
            z_max: cur_z_max,
            index_offset: cur_start,
            index_count: total_idx - cur_start,
        });
    }
    chunks
}

pub fn apex_art_atlas_rgba() -> (*const u8, u32, u32) {
    let lib = ArtPackLibrary::global();
    (
        lib.atlas_rgba.as_ptr(),
        PROP_ATLAS_DIM as u32,
        PROP_ATLAS_DIM as u32,
    )
}

pub fn manifest_file_cstr(logical_id: &str) -> *const std::ffi::c_char {
    static FILES: std::sync::OnceLock<std::collections::HashMap<String, std::ffi::CString>> =
        std::sync::OnceLock::new();
    let map = FILES.get_or_init(|| {
        let mut out = std::collections::HashMap::new();
        if let Ok(JsonVal::Obj(entries)) = parse_json(ART_MANIFEST_JSON) {
            for (id, meta) in entries {
                if let Some(file_name) = meta.get("file").and_then(|v| v.as_str()) {
                    if let Ok(cstr) = std::ffi::CString::new(file_name) {
                        out.insert(id, cstr);
                    }
                }
            }
        }
        out
    });
    map.get(logical_id)
        .unwrap_or_else(|| panic!("Missing manifest entry for {logical_id}"))
        .as_ptr()
}

fn locate_seed_assets_dir() -> Option<std::path::PathBuf> {
    if let Ok(env_dir) = std::env::var("APEXRUN_ASSETS_DIR") {
        let p = std::path::PathBuf::from(env_dir);
        if p.is_dir() {
            return Some(p);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(macos_dir) = exe.parent() {
            let bundle_res = macos_dir.join("../Resources/seed-assets");
            if bundle_res.is_dir() {
                return Some(bundle_res);
            }
            let flat_bundle_res = macos_dir.join("seed-assets");
            if flat_bundle_res.is_dir() {
                return Some(flat_bundle_res);
            }
        }
    }
    let workspace_seed = std::path::PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../.seed-assets"
    ));
    if workspace_seed.is_dir() {
        return Some(workspace_seed);
    }
    None
}

fn surface_overlay_offset(model_key: &str, mat_name: &str) -> f32 {
    match (model_key, mat_name) {
        ("castle-tower", "dark") | ("castle-tower", "wood") => 0.08,
        ("castle-tower", "iron") => 0.14,
        ("windmill", "door") | ("windmill", "dark") => 0.08,
        ("lighthouse", "door") | ("lighthouse", "trim") => 0.08,
        ("hangar", "glass") => 0.08,
        ("colosseum", "shade") | ("colosseum", "shade_deep") => 0.08,
        ("tower-a", "window") | ("tower-b", "window") | ("tower-c", "window") => 0.06,
        _ => 0.0,
    }
}


fn parse_art_glb_model(
    glb_bytes: &[u8],
    model_key: &str,
    pack_into_atlas: bool,
    atlas: &mut PropAtlasBuilder,
) -> Result<ParsedGlbModel, String> {
    let (json_str, bin) = parse_glb_chunks(glb_bytes)?;
    let root = parse_json(json_str)?;

    let views: Vec<BufferViewMeta> = root
        .get("bufferViews")
        .and_then(|v| v.as_arr())
        .ok_or("Missing bufferViews")?
        .iter()
        .map(|bv| BufferViewMeta {
            byte_offset: bv.get("byteOffset").and_then(|v| v.as_f64()).unwrap_or(0.0) as usize,
            byte_length: bv.get("byteLength").and_then(|v| v.as_f64()).unwrap_or(0.0) as usize,
        })
        .collect();

    let accessors: Vec<AccessorMeta> = root
        .get("accessors")
        .and_then(|v| v.as_arr())
        .ok_or("Missing accessors")?
        .iter()
        .map(|a| AccessorMeta {
            buffer_view: a.get("bufferView").and_then(|v| v.as_f64()).unwrap_or(0.0) as usize,
            byte_offset: a.get("byteOffset").and_then(|v| v.as_f64()).unwrap_or(0.0) as usize,
            component_type: a.get("componentType").and_then(|v| v.as_f64()).unwrap_or(0.0) as u32,
            count: a.get("count").and_then(|v| v.as_f64()).unwrap_or(0.0) as usize,
            acc_type: a
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("SCALAR")
                .to_string(),
        })
        .collect();

    let texture_sources: Vec<Option<usize>> = root
        .get("textures")
        .and_then(|v| v.as_arr())
        .map(|arr| {
            arr.iter()
                .map(|t| {
                    t.get("source")
                        .or_else(|| {
                            t.get("extensions")
                                .and_then(|e| e.get("EXT_texture_webp"))
                                .and_then(|w| w.get("source"))
                        })
                        .and_then(|v| v.as_f64())
                        .map(|x| x as usize)
                })
                .collect()
        })
        .unwrap_or_default();

    let image_slices: Vec<Option<&[u8]>> = root
        .get("images")
        .and_then(|v| v.as_arr())
        .map(|arr| {
            arr.iter()
                .map(|im| {
                    let bv_idx = im.get("bufferView").and_then(|v| v.as_f64())? as usize;
                    let bv = views.get(bv_idx)?;
                    if bv.byte_offset + bv.byte_length > bin.len() {
                        return None;
                    }
                    Some(&bin[bv.byte_offset..bv.byte_offset + bv.byte_length])
                })
                .collect()
        })
        .unwrap_or_default();

    #[derive(Clone)]
    struct ParsedMatMeta {
        name: String,
        factor: [f32; 4],
        tex_image_idx: Option<usize>,
        atlas_tile: Option<usize>,
        is_painted: bool,
    }

    let mut decoded_images: Vec<Option<DecodedImage>> = vec![None; image_slices.len()];

    let materials: Vec<ParsedMatMeta> = root
        .get("materials")
        .and_then(|v| v.as_arr())
        .map(|arr| {
            arr.iter()
                .map(|m| {
                    let name = m
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("mat")
                        .to_string();
                    let pbr = m.get("pbrMetallicRoughness");
                    let mut factor = pbr
                        .and_then(|p| p.get("baseColorFactor"))
                        .and_then(|c| c.as_arr())
                        .map(|c| {
                            [
                                c.first().and_then(|x| x.as_f64()).unwrap_or(0.8) as f32,
                                c.get(1).and_then(|x| x.as_f64()).unwrap_or(0.8) as f32,
                                c.get(2).and_then(|x| x.as_f64()).unwrap_or(0.8) as f32,
                                c.get(3).and_then(|x| x.as_f64()).unwrap_or(1.0) as f32,
                            ]
                        })
                        .unwrap_or([0.8, 0.8, 0.8, 1.0]);
                    match name.as_str() {
                        "cactus" => factor = [0.156, 0.227, 0.080, 1.0],
                        "cactus_tip" => factor = [0.328, 0.386, 0.156, 1.0],
                        _ => {}
                    }
                    if let Some(em) = m.get("emissiveFactor").and_then(|c| c.as_arr()) {
                        let er = em.first().and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
                        let eg = em.get(1).and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
                        let eb = em.get(2).and_then(|x| x.as_f64()).unwrap_or(0.0) as f32;
                        if er + eg + eb > 0.05
                            && matches!(
                                name.as_str(),
                                "lamp" | "taillight" | "headlight" | "indicator"
                            )
                        {
                            factor = [
                                er.max(factor[0]),
                                eg.max(factor[1]),
                                eb.max(factor[2]),
                                1.0,
                            ];
                        }
                    }
                    let tex_image_idx = pbr
                        .and_then(|p| p.get("baseColorTexture"))
                        .and_then(|t| t.get("index"))
                        .and_then(|v| v.as_f64())
                        .map(|ti| ti as usize)
                        .and_then(|ti| texture_sources.get(ti).copied().flatten());
                    let mut atlas_tile = None;
                    let alpha_mode = m
                        .get("alphaMode")
                        .and_then(|v| v.as_str())
                        .unwrap_or("OPAQUE");
                    if let Some(ii) = tex_image_idx {
                        if let Some(Some(raw_bytes)) = image_slices.get(ii) {
                            if decoded_images[ii].is_none() {
                                decoded_images[ii] = decode_image_rgba8(raw_bytes);
                            }
                            if pack_into_atlas && alpha_mode == "OPAQUE" {
                                if let Some(ref img) = decoded_images[ii] {
                                    atlas_tile = atlas.insert_image(raw_bytes, img);
                                }
                            }
                        }
                    }
                    let is_painted = m
                        .get("extras")
                        .and_then(|e| e.get("painted"))
                        .and_then(|p| match p {
                            JsonVal::Bool(b) => Some(*b),
                            _ => None,
                        })
                        .unwrap_or(false);
                    ParsedMatMeta {
                        name,
                        factor,
                        tex_image_idx,
                        atlas_tile,
                        is_painted,
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    let meshes = root
        .get("meshes")
        .and_then(|v| v.as_arr())
        .ok_or("Missing meshes")?;
    let nodes_json = root
        .get("nodes")
        .and_then(|v| v.as_arr())
        .ok_or("Missing nodes")?;

    let mut parsed_nodes = Vec::with_capacity(nodes_json.len());
    for (ni, n) in nodes_json.iter().enumerate() {
        let name = n
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("node_{}", ni));
        let t = n
            .get("translation")
            .and_then(|v| v.as_arr())
            .map(|arr| {
                [
                    -(arr.first().and_then(|x| x.as_f64()).unwrap_or(0.0) as f32),
                    arr.get(1).and_then(|x| x.as_f64()).unwrap_or(0.0) as f32,
                    arr.get(2).and_then(|x| x.as_f64()).unwrap_or(0.0) as f32,
                ]
            })
            .unwrap_or([0.0, 0.0, 0.0]);

        let mut primitives = Vec::new();
        if let Some(mesh_idx) = n.get("mesh").and_then(|v| v.as_f64()).map(|x| x as usize) {
            if let Some(mesh) = meshes.get(mesh_idx) {
                if let Some(prims) = mesh.get("primitives").and_then(|v| v.as_arr()) {
                    for prim in prims {
                        let Some(attrs) = prim.get("attributes") else {
                            continue;
                        };
                        let pos_idx = attrs
                            .get("POSITION")
                            .and_then(|v| v.as_f64())
                            .map(|x| x as usize)
                            .ok_or("Missing POSITION accessor")?;
                        let pos_acc = accessors.get(pos_idx).ok_or("Invalid POSITION accessor")?;
                        let v_count = pos_acc.count;
                        let pos_raw = read_f32_slice(bin, &views, pos_acc, 3)?;
                        let norm_raw = if let Some(ni) =
                            attrs.get("NORMAL").and_then(|v| v.as_f64()).map(|x| x as usize)
                        {
                            let norm_acc = accessors.get(ni).ok_or("Invalid NORMAL accessor")?;
                            read_f32_slice(bin, &views, norm_acc, 3)?
                        } else {
                            [0.0, 1.0, 0.0].repeat(v_count)
                        };
                        let uv_raw = if let Some(ui) = attrs
                            .get("TEXCOORD_0")
                            .and_then(|v| v.as_f64())
                            .map(|x| x as usize)
                        {
                            let uv_acc = accessors.get(ui).ok_or("Invalid TEXCOORD_0 accessor")?;
                            read_f32_slice(bin, &views, uv_acc, 2)?
                        } else {
                            vec![0.0; v_count * 2]
                        };
                        let col_raw_opt = if let Some(ci) =
                            attrs.get("COLOR_0").and_then(|v| v.as_f64()).map(|x| x as usize)
                        {
                            let col_acc = accessors.get(ci).ok_or("Invalid COLOR_0 accessor")?;
                            let comps = if col_acc.acc_type == "VEC4" { 4 } else { 3 };
                            Some((read_f32_slice(bin, &views, col_acc, comps)?, comps))
                        } else {
                            None
                        };

                        let ind_idx = prim
                            .get("indices")
                            .and_then(|v| v.as_f64())
                            .map(|x| x as usize)
                            .ok_or("Missing indices accessor")?;
                        let ind_acc = accessors.get(ind_idx).ok_or("Invalid indices accessor")?;
                        let mut ind_data = read_index_slice(bin, &views, ind_acc)?;
                        // Reverse triangle winding after X-axis handedness flip
                        for tri in ind_data.as_chunks_mut::<3>().0 {
                            tri.swap(1, 2);
                        }

                        let mat_idx =
                            prim.get("material").and_then(|v| v.as_f64()).unwrap_or(0.0) as usize;
                        let mat_meta = materials.get(mat_idx).cloned().unwrap_or(ParsedMatMeta {
                            name: "mat".to_string(),
                            factor: [0.8, 0.8, 0.8, 1.0],
                            tex_image_idx: None,
                            atlas_tile: None,
                            is_painted: false,
                        });
                        let mat_name = mat_meta.name;
                        let factor = mat_meta.factor;
                        let is_painted = mat_meta.is_painted;
                        let atlas_tile = mat_meta.atlas_tile;
                        let tex_img = mat_meta
                            .tex_image_idx
                            .and_then(|ii| decoded_images.get(ii).and_then(|opt| opt.as_ref()));

                        // renderer.js MATERIAL_LIFT per-model brightness boost for dark baked foliage
                        let mat_lift: f32 = match (model_key, mat_name.as_str()) {
                            ("cypress", "foliage") => 1.5,
                            ("tree-broadleaf-a", "foliage") | ("tree-broadleaf-b", "foliage") => 1.3,
                            _ => 1.0,
                        };

                        let z_off = surface_overlay_offset(model_key, &mat_name);
                        let is_sway = matches!(
                            mat_name.as_str(),
                            "frond" | "frond_dry" | "grass" | "leaf" | "flag"
                        );
                        let is_foliage = matches!(
                            mat_name.as_str(),
                            "frond" | "frond_dry" | "grass" | "leaf" | "foliage"
                        );
                        let is_car_lacquer = matches!(
                            mat_name.as_str(),
                            "paint" | "glass" | "chrome" | "rim"
                        );
                        let is_lamp = matches!(
                            mat_name.as_str(),
                            "lamp" | "taillight" | "headlight" | "indicator"
                        );
                        let is_window = mat_name == "window";
                        let surface_role = if is_window {
                            10.0
                        } else if is_lamp {
                            9.0
                        } else if is_car_lacquer {
                            8.0
                        } else if is_foliage {
                            6.0
                        } else {
                            0.0
                        };
                        let sway_amt = if is_sway { 1.0 } else { 0.0 };
                        // For car lacquer (role 8.0), stk_flags.w encodes sub-material:
                        //   0.0 = clearcoat paint, 1.0 = mirror chrome / rim, 2.0 = automotive glass.
                        // For stage props, 2.0 encodes STK_PAINTED (baked gouache shade floor 0.34, no double brush),
                        // and `((tile_id + 1) * 4.0)` encodes the GPU 4096x4096 Mega-Atlas tile index!
                        let base_brush_amt = if is_car_lacquer {
                            if mat_name == "chrome" || mat_name == "rim" {
                                1.0
                            } else if mat_name == "glass" {
                                2.0
                            } else {
                                0.0
                            }
                        } else if is_lamp || is_window {
                            0.0
                        } else if is_painted {
                            2.0
                        } else {
                            1.0
                        };
                        let brush_amt = if let Some(tile_id) = atlas_tile {
                            if !is_car_lacquer {
                                base_brush_amt + ((tile_id + 1) as f32) * 4.0
                            } else {
                                base_brush_amt
                            }
                        } else {
                            base_brush_amt
                        };

                        let mut positions = Vec::with_capacity(v_count);
                        let mut normals = Vec::with_capacity(v_count);
                        let mut vertex_ao = Vec::with_capacity(v_count);
                        let mut uvs = Vec::with_capacity(v_count);

                        for i in 0..v_count {
                            let nx = -norm_raw[i * 3];
                            let ny = norm_raw[i * 3 + 1];
                            let nz = norm_raw[i * 3 + 2];
                            let px = -pos_raw[i * 3] + nx * z_off;
                            let py = pos_raw[i * 3 + 1] + ny * z_off;
                            let pz = pos_raw[i * 3 + 2] + nz * z_off;
                            let u = uv_raw[i * 2];
                            let v = uv_raw[i * 2 + 1];

                            let ao = if let Some((ref c_slice, comps)) = col_raw_opt {
                                [
                                    c_slice[i * comps],
                                    c_slice[i * comps + 1],
                                    c_slice[i * comps + 2],
                                ]
                            } else {
                                [1.0, 1.0, 1.0]
                            };

                            positions.push([px, py, pz]);
                            normals.push([nx, ny, nz]);
                            vertex_ao.push(ao);
                            uvs.push([u, v]);
                        }

                        let final_v_count = positions.len();
                        let mut colors = Vec::with_capacity(final_v_count);
                        let mut srgb_ao = Vec::with_capacity(final_v_count);
                        for i in 0..final_v_count {
                            let u = uvs[i][0];
                            let v = uvs[i][1];
                            let ao = vertex_ao[i];
                            let ao_srgb = [
                                linear_to_srgb(ao[0]),
                                linear_to_srgb(ao[1]),
                                linear_to_srgb(ao[2]),
                            ];
                            let fac_srgb = [
                                linear_to_srgb(factor[0]),
                                linear_to_srgb(factor[1]),
                                linear_to_srgb(factor[2]),
                            ];

                            let rgba = if atlas_tile.is_some() && !is_car_lacquer {
                                // Per-pixel GPU Mega-Atlas sampling in `stage_fs`: vertex color carries `factor * ao * lift`
                                [
                                    (fac_srgb[0] * ao_srgb[0] * mat_lift).clamp(0.0, 1.4),
                                    (fac_srgb[1] * ao_srgb[1] * mat_lift).clamp(0.0, 1.4),
                                    (fac_srgb[2] * ao_srgb[2] * mat_lift).clamp(0.0, 1.4),
                                    1.0,
                                ]
                            } else if let Some(img) = tex_img {
                                let tex_c = img.sample_srgb(u, v);
                                [
                                    (tex_c[0] * fac_srgb[0] * ao_srgb[0] * mat_lift).clamp(0.0, 1.4),
                                    (tex_c[1] * fac_srgb[1] * ao_srgb[1] * mat_lift).clamp(0.0, 1.4),
                                    (tex_c[2] * fac_srgb[2] * ao_srgb[2] * mat_lift).clamp(0.0, 1.4),
                                    1.0,
                                ]
                            } else if model_key == "flagman" && mat_name == "flag" {
                                let cell =
                                    ((u * 4.0).floor() as i32) + ((v * 3.0).floor() as i32);
                                if cell.rem_euclid(2) == 0 {
                                    [0.96, 0.95, 0.92, 1.0]
                                } else {
                                    [0.12, 0.12, 0.14, 1.0]
                                }
                            } else {
                                [
                                    (fac_srgb[0] * ao_srgb[0] * mat_lift).clamp(0.0, 1.4),
                                    (fac_srgb[1] * ao_srgb[1] * mat_lift).clamp(0.0, 1.4),
                                    (fac_srgb[2] * ao_srgb[2] * mat_lift).clamp(0.0, 1.4),
                                    1.0,
                                ]
                            };
                            colors.push(rgba);
                            srgb_ao.push(ao_srgb);
                        }

                        primitives.push(ParsedGlbPrimitive {
                            material_name: mat_name,
                            positions,
                            normals,
                            colors,
                            vertex_ao: srgb_ao,
                            uvs,
                            indices: ind_data,
                            stk_flags: [surface_role, sway_amt, 1.0, brush_amt],
                        });
                    }
                }
            }
        }

        parsed_nodes.push(ParsedGlbNode {
            name,
            translation: t,
            primitives,
        });
    }

    Ok(ParsedGlbModel {
        nodes: parsed_nodes,
    })
}

impl ArtPackLibrary {
    fn global() -> &'static Self {
        static INSTANCE: std::sync::OnceLock<ArtPackLibrary> = std::sync::OnceLock::new();
        INSTANCE.get_or_init(|| {
            let mut models = std::collections::HashMap::new();
            let mut atlas = PropAtlasBuilder::new();
            let Some(seed_dir) = locate_seed_assets_dir() else {
                return ArtPackLibrary {
                    models,
                    atlas_rgba: atlas.rgba,
                };
            };
            let Ok(manifest_root) = parse_json(ART_MANIFEST_JSON) else {
                return ArtPackLibrary {
                    models,
                    atlas_rgba: atlas.rgba,
                };
            };
            let JsonVal::Obj(entries) = manifest_root else {
                return ArtPackLibrary {
                    models,
                    atlas_rgba: atlas.rgba,
                };
            };
            for (logical_id, meta) in entries {
                // Desktop stage props use `/lod0` (and `/lod1` for cars/riders which use 0 atlas tiles).
                // Skipping `/lod1` and `/lod2` for stage props keeps total unique atlas textures at 35
                // (inside the 64-tile 8192x8192 atlas) so `tree-*` and `windmill` do not overflow.
                if !logical_id.starts_with("model/")
                    || logical_id.ends_with("/lod2")
                    || (logical_id.ends_with("/lod1")
                        && !logical_id.starts_with("model/car-")
                        && !logical_id.starts_with("model/riders/"))
                {
                    continue;
                }
                #[cfg(test)]
                if !logical_id.ends_with("/lod0")
                    || (!logical_id.starts_with("model/car-")
                        && !logical_id.starts_with("model/riders/")
                        && !logical_id.starts_with("model/flagman/")
                        && !logical_id.starts_with("model/tree-")
                        && !logical_id.starts_with("model/shrub-")
                        && !logical_id.starts_with("model/rock-"))
                {
                    continue;
                }
                let Some(file_name) = meta.get("file").and_then(|v| v.as_str()) else {
                    continue;
                };
                let file_path = seed_dir.join(file_name);
                let Ok(bytes) = std::fs::read(&file_path) else {
                    continue;
                };
                let parts: Vec<&str> = logical_id.split('/').collect();
                let model_key = parts.get(1).copied().unwrap_or("");
                let pack_into_atlas = !model_key.starts_with("car-");
                if let Ok(parsed) = parse_art_glb_model(&bytes, model_key, pack_into_atlas, &mut atlas) {
                    models.insert(logical_id, parsed);
                }
            }
            ArtPackLibrary {
                models,
                atlas_rgba: atlas.rgba,
            }
        })
    }

    fn get(&self, logical_id: &str) -> Option<&ParsedGlbModel> {
        self.models.get(logical_id)
    }
}

fn push_glb_model_instance(
    verts: &mut Vec<GpuVertex>,
    indices: &mut Vec<u32>,
    model: &ParsedGlbModel,
    pos: [f32; 3],
    yaw: f32,
    scale: f32,
    tint_override: Option<[f32; 4]>,
) {
    let (sy, cy) = yaw.sin_cos();
    for node in &model.nodes {
        let tx = node.translation[0];
        let ty = node.translation[1];
        let tz = node.translation[2];
        for prim in &node.primitives {
            let base = verts.len() as u32;
            for i in 0..prim.positions.iter().len() {
                let lx = (prim.positions[i][0] + tx) * scale;
                let ly = (prim.positions[i][1] + ty) * scale;
                let lz = (prim.positions[i][2] + tz) * scale;
                let wx = pos[0] + lx * cy + lz * sy;
                let wy = pos[1] + ly;
                let wz = pos[2] - lx * sy + lz * cy;

                let nx = prim.normals[i][0];
                let ny = prim.normals[i][1];
                let nz = prim.normals[i][2];
                let wnx = nx * cy + nz * sy;
                let wnz = -nx * sy + nz * cy;

                let color = if let Some(tint) = tint_override {
                    let ao = prim.vertex_ao[i];
                    let has_atlas = prim.stk_flags[3] >= 3.5;
                    if has_atlas {
                        // Preserve painted gouache atlas chromaticity while applying subtle stage variation
                        let c = prim.colors[i];
                        [
                            (c[0] * (0.76 + 0.32 * tint[0])).clamp(0.0, 1.4),
                            (c[1] * (0.76 + 0.32 * tint[1])).clamp(0.0, 1.4),
                            (c[2] * (0.76 + 0.32 * tint[2])).clamp(0.0, 1.4),
                            1.0,
                        ]
                    } else {
                        [tint[0] * ao[0], tint[1] * ao[1], tint[2] * ao[2], 1.0]
                    }
                } else {
                    prim.colors[i]
                };
                let mut stk = prim.stk_flags;
                stk[2] = ly.max(0.0);

                verts.push(GpuVertex {
                    pos: [wx, wy, wz],
                    normal: [wnx, ny, wnz],
                    color,
                    uv: prim.uvs[i],
                    stk_flags: stk,
                });
            }
            let prim_v_count = prim.positions.len() as u32;
            for &idx in &prim.indices {
                assert!(idx < prim_v_count, "GLB primitive index out of bounds");
                indices.push(base.checked_add(idx).expect("vertex index overflow"));
            }
        }
    }
}


#[allow(clippy::too_many_arguments)]
fn push_tapered_cylinder(
    verts: &mut Vec<GpuVertex>,
    indices: &mut Vec<u32>,
    p0: [f32; 3],
    p1: [f32; 3],
    r0: f32,
    r1: f32,
    segs: usize,
    color: [f32; 4],
    stk_flags: [f32; 4],
) {
    let dx = p1[0] - p0[0];
    let dy = p1[1] - p0[1];
    let dz = p1[2] - p0[2];
    let len = (dx * dx + dy * dy + dz * dz).sqrt().max(1e-5);
    let ax = [dx / len, dy / len, dz / len];
    let up = if ax[1].abs() > 0.9 {
        [1.0, 0.0, 0.0]
    } else {
        [0.0, 1.0, 0.0]
    };
    let mut ux = ax[1] * up[2] - ax[2] * up[1];
    let mut uy = ax[2] * up[0] - ax[0] * up[2];
    let mut uz = ax[0] * up[1] - ax[1] * up[0];
    let ulen = (ux * ux + uy * uy + uz * uz).sqrt().max(1e-5);
    ux /= ulen;
    uy /= ulen;
    uz /= ulen;
    let vx = ax[1] * uz - ax[2] * uy;
    let vy = ax[2] * ux - ax[0] * uz;
    let vz = ax[0] * uy - ax[1] * ux;

    let n_segs = segs.max(6);
    let base = verts.len() as u32;
    for k in 0..n_segs {
        let a = (k as f32) * std::f32::consts::TAU / (n_segs as f32);
        let (sa, ca) = a.sin_cos();
        let rx = ca * ux + sa * vx;
        let ry = ca * uy + sa * vy;
        let rz = ca * uz + sa * vz;
        let u_coord = (k as f32) / (n_segs as f32);
        verts.push(GpuVertex {
            pos: [p0[0] + r0 * rx, p0[1] + r0 * ry, p0[2] + r0 * rz],
            normal: [rx, ry, rz],
            color: [color[0] * 0.86, color[1] * 0.86, color[2] * 0.86, color[3]],
            uv: [u_coord, 0.0],
            stk_flags,
        });
        verts.push(GpuVertex {
            pos: [p1[0] + r1 * rx, p1[1] + r1 * ry, p1[2] + r1 * rz],
            normal: [rx, ry, rz],
            color,
            uv: [u_coord, 1.0],
            stk_flags,
        });
    }
    for k in 0..n_segs {
        let k1 = (k + 1) % n_segs;
        let i0 = base + (2 * k) as u32;
        let i1 = i0 + 1;
        let j0 = base + (2 * k1) as u32;
        let j1 = j0 + 1;
        indices.extend_from_slice(&[i0, j0, j1, i0, j1, i1]);
    }
    if r1 > 1e-4 {
        let cap_center = verts.len() as u32;
        verts.push(GpuVertex {
            pos: p1,
            normal: ax,
            color,
            uv: [0.5, 0.5],
            stk_flags,
        });
        for k in 0..n_segs {
            let k1 = (k + 1) % n_segs;
            let i1 = base + (2 * k + 1) as u32;
            let j1 = base + (2 * k1 + 1) as u32;
            indices.extend_from_slice(&[cap_center, i1, j1]);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn push_oriented_box(
    verts: &mut Vec<GpuVertex>,
    indices: &mut Vec<u32>,
    center: [f32; 3],
    half_extents: [f32; 3],
    yaw: f32,
    pitch: f32,
    roll: f32,
    color: [f32; 4],
    stk_flags: [f32; 4],
) {
    let (sy, cy) = yaw.sin_cos();
    let (sp, cp) = pitch.sin_cos();
    let (sr, cr) = roll.sin_cos();

    let transform_dir = |lx: f32, ly: f32, lz: f32| -> [f32; 3] {
        // Roll around Z, pitch around X, yaw around Y
        let x1 = lx * cr - ly * sr;
        let y1 = lx * sr + ly * cr;
        let z1 = lz;

        let x2 = x1;
        let y2 = y1 * cp - z1 * sp;
        let z2 = y1 * sp + z1 * cp;

        let wx = x2 * cy + z2 * sy;
        let wy = y2;
        let wz = -x2 * sy + z2 * cy;
        [wx, wy, wz]
    };

    let hx = half_extents[0];
    let hy = half_extents[1];
    let hz = half_extents[2];

    let faces: [([f32; 3], [[f32; 3]; 4]); 6] = [
        // +Y top
        ([0.0, 1.0, 0.0], [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]]),
        // -Y bottom
        ([0.0, -1.0, 0.0], [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]]),
        // +Z front
        ([0.0, 0.0, 1.0], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]),
        // -Z rear
        ([0.0, 0.0, -1.0], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]),
        // +X right
        ([1.0, 0.0, 0.0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]),
        // -X left
        ([-1.0, 0.0, 0.0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]),
    ];

    for (n_local, corners) in faces {
        let base = verts.len() as u32;
        let n_world = transform_dir(n_local[0], n_local[1], n_local[2]);
        for (ci, c) in corners.iter().enumerate() {
            let offset = transform_dir(c[0], c[1], c[2]);
            let uv = match ci {
                0 => [0.0, 0.0],
                1 => [1.0, 0.0],
                2 => [1.0, 1.0],
                _ => [0.0, 1.0],
            };
            verts.push(GpuVertex {
                pos: [center[0] + offset[0], center[1] + offset[1], center[2] + offset[2]],
                normal: n_world,
                color,
                uv,
                stk_flags,
            });
        }
        indices.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    }
}

fn push_palm_tree(
    verts: &mut Vec<GpuVertex>,
    indices: &mut Vec<u32>,
    pos: [f32; 3],
    yaw: f32,
    scale: f32,
) {
    let s = scale.clamp(0.6, 2.2);
    let trunk_col = [0.46, 0.33, 0.22, 1.0];
    let frond_col = [0.20, 0.56, 0.24, 1.0];
    let frond_tip_col = [0.34, 0.68, 0.28, 1.0];

    // 3-segment curved trunk
    let lean_x = yaw.sin() * 0.35 * s;
    let lean_z = yaw.cos() * 0.35 * s;
    push_oriented_box(
        verts,
        indices,
        [pos[0], pos[1] + 1.1 * s, pos[2]],
        [0.24 * s, 1.15 * s, 0.24 * s],
        yaw,
        0.06,
        0.0,
        trunk_col,
        [0.0, 0.0, 1.0, 1.0],
    );
    push_oriented_box(
        verts,
        indices,
        [pos[0] + lean_x * 0.5, pos[1] + 3.1 * s, pos[2] + lean_z * 0.5],
        [0.20 * s, 1.05 * s, 0.20 * s],
        yaw,
        0.11,
        0.0,
        trunk_col,
        [0.0, 0.0, 3.0, 1.0],
    );
    let crown = [pos[0] + lean_x, pos[1] + 4.9 * s, pos[2] + lean_z];
    push_oriented_box(
        verts,
        indices,
        [crown[0], crown[1] - 0.4 * s, crown[2]],
        [0.17 * s, 0.75 * s, 0.17 * s],
        yaw,
        0.15,
        0.0,
        trunk_col,
        [0.0, 0.0, 4.5, 1.0],
    );

    // 7 arching palm fronds with wind sway (`stk_flags[1] = 1.0`)
    for f in 0..7 {
        let angle = yaw + (f as f32) * (std::f32::consts::TAU / 7.0);
        let dx = angle.sin();
        let dz = angle.cos();
        let inner = [
            crown[0] + dx * 1.15 * s,
            crown[1] + 0.25 * s,
            crown[2] + dz * 1.15 * s,
        ];
        push_oriented_box(
            verts,
            indices,
            inner,
            [0.42 * s, 0.07 * s, 1.25 * s],
            angle,
            -0.22,
            0.0,
            frond_col,
            [6.0, 1.0, 5.2, 1.0],
        );
        let outer = [
            crown[0] + dx * 2.55 * s,
            crown[1] - 0.18 * s,
            crown[2] + dz * 2.55 * s,
        ];
        push_oriented_box(
            verts,
            indices,
            outer,
            [0.32 * s, 0.05 * s, 0.95 * s],
            angle,
            0.38,
            0.0,
            frond_tip_col,
            [6.0, 1.35, 5.0, 1.0],
        );
    }
}

fn parse_hex_rgb(hex: &str) -> [f32; 4] {
    let clean = hex.trim_start_matches('#');
    if let Ok(n) = u32::from_str_radix(clean, 16) {
        [
            ((n >> 16) & 255) as f32 / 255.0,
            ((n >> 8) & 255) as f32 / 255.0,
            (n & 255) as f32 / 255.0,
            1.0,
        ]
    } else {
        [0.24, 0.48, 0.22, 1.0]
    }
}

/// Build the monumental Roman/Tuscan masonry viaduct gateway spanning the highway (`PROP_BUILDERS.arch`):
/// deeply rooted battered stone piers (`y = -2.5m`), outer buttresses, interlocking wide voussoirs,
/// solid spandrel walls, and a continuous upper roadway cornice deck with parapet battlements.
fn push_voussoir_stone_arch(
    verts: &mut Vec<GpuVertex>,
    indices: &mut Vec<u32>,
    pos: [f32; 3],
    yaw: f32,
    scale: f32,
) {
    let stone = [0.769, 0.745, 0.659, 1.0]; // #C4BEA8 warm travertine ashlar
    let shade = [0.620, 0.596, 0.518, 1.0]; // #9E9884 weathered rusticated masonry
    let cornice_light = [0.839, 0.808, 0.729, 1.0]; // #D6CEBA sunlit cornice
    let plinth_dark = [0.502, 0.482, 0.416, 1.0]; // #807B6A deep foundation stone
    let (sy, cy) = yaw.sin_cos();
    let place = |lx: f32, ly: f32, lz: f32| -> [f32; 3] {
        let sx = lx * scale;
        let sy_pos = ly * scale;
        let sz = lz * scale;
        [
            pos[0] + sx * cy + sz * sy,
            pos[1] + sy_pos,
            pos[2] - sx * sy + sz * cy,
        ]
    };

    for side in [-1.0f32, 1.0] {
        let x = side * 12.2;
        // 1. Deeply rooted bedrock footing (extends down to y = -2.6m so piers never float on slopes)
        push_oriented_box(
            verts,
            indices,
            place(x, -0.7, 0.0),
            [2.95 * scale, 1.90 * scale, 3.25 * scale],
            yaw,
            0.0,
            0.0,
            plinth_dark,
            [0.0, 0.0, 0.2, 1.0],
        );
        // 2. Stepped rusticated plinth base
        push_oriented_box(
            verts,
            indices,
            place(x, 2.1, 0.0),
            [2.50 * scale, 1.25 * scale, 2.80 * scale],
            yaw,
            0.0,
            0.0,
            shade,
            [0.0, 0.0, 2.1, 1.0],
        );
        // 3. Monumental ashlar main pier column
        push_oriented_box(
            verts,
            indices,
            place(x, 9.6, 0.0),
            [2.05 * scale, 6.40 * scale, 2.35 * scale],
            yaw,
            0.0,
            0.0,
            stone,
            [0.0, 0.0, 9.6, 1.0],
        );
        // 4. Outer battered masonry wing buttress anchoring the gateway into the mountain cut
        push_oriented_box(
            verts,
            indices,
            place(side * 15.2, 5.4, 0.0),
            [1.75 * scale, 7.20 * scale, 1.95 * scale],
            yaw,
            0.0,
            0.0,
            shade,
            [0.0, 0.0, 5.4, 1.0],
        );
        push_oriented_box(
            verts,
            indices,
            place(side * 15.4, 12.9, 0.0),
            [1.95 * scale, 0.45 * scale, 2.15 * scale],
            yaw,
            0.0,
            0.0,
            cornice_light,
            [0.0, 0.0, 12.9, 1.0],
        );
        // 5. Moulded Roman impost capital at arch springline
        push_oriented_box(
            verts,
            indices,
            place(x, 15.8, 0.0),
            [2.45 * scale, 0.55 * scale, 2.65 * scale],
            yaw,
            0.0,
            0.0,
            cornice_light,
            [0.0, 0.0, 15.8, 1.0],
        );
    }

    let deck_y = 23.4f32;
    // 6. 17 wide interlocking bevelled voussoirs + solid spandrel masonry wall infill above the arch ring
    for k in 0..=16 {
        let a = (std::f32::consts::PI * k as f32) / 16.0;
        let vx = a.cos() * 11.8;
        let vy = 15.8 + a.sin() * 6.4;
        let rot_z = a - std::f32::consts::FRAC_PI_2;
        let is_keystone = k == 8;
        let col = if is_keystone {
            plinth_dark
        } else if k % 2 == 0 {
            stone
        } else {
            shade
        };
        let half_tangent = if is_keystone { 1.55 } else { 1.42 };
        let radial_h = if is_keystone { 1.65 } else { 1.38 };
        let depth_z = if is_keystone { 2.62 } else { 2.42 };
        push_oriented_box(
            verts,
            indices,
            place(vx, vy, 0.0),
            [half_tangent * scale, radial_h * scale, depth_z * scale],
            yaw,
            0.0,
            rot_z,
            col,
            [0.0, 0.0, vy, 1.0],
        );

        // Solid spandrel wall column connecting this voussoir up to the viaduct roadway deck
        let spandrel_bot = vy + 0.75;
        let spandrel_h = deck_y - spandrel_bot;
        if spandrel_h > 0.25 {
            push_oriented_box(
                verts,
                indices,
                place(vx, spandrel_bot + spandrel_h * 0.5, 0.0),
                [1.38 * scale, (spandrel_h * 0.52) * scale, 2.08 * scale],
                yaw,
                0.0,
                0.0,
                if k % 3 == 0 { shade } else { stone },
                [0.0, 0.0, spandrel_bot + spandrel_h * 0.5, 1.0],
            );
        }
    }

    // 7. Continuous upper viaduct cornice deck & parapet battlements spanning the entire gateway
    push_oriented_box(
        verts,
        indices,
        place(0.0, deck_y + 0.55, 0.0),
        [16.6 * scale, 0.72 * scale, 2.75 * scale],
        yaw,
        0.0,
        0.0,
        cornice_light,
        [0.0, 0.0, deck_y + 0.55, 1.0],
    );
    push_oriented_box(
        verts,
        indices,
        place(0.0, deck_y + 1.65, 0.0),
        [16.2 * scale, 0.58 * scale, 2.30 * scale],
        yaw,
        0.0,
        0.0,
        stone,
        [0.0, 0.0, deck_y + 1.65, 1.0],
    );
    // Crenellated merlons along the upper parapet
    for m_idx in -5..=5 {
        let mx = (m_idx as f32) * 2.75;
        push_oriented_box(
            verts,
            indices,
            place(mx, deck_y + 2.55, 0.0),
            [0.88 * scale, 0.42 * scale, 2.38 * scale],
            yaw,
            0.0,
            0.0,
            shade,
            [0.0, 0.0, deck_y + 2.55, 1.0],
        );
    }
}

fn fork_labels_for_stage(stage_id: &str) -> (&'static str, &'static str) {
    match stage_id {
        "coconut-beach" => ("DESERT CANYONS", "GATEWAY PASS"),
        "desert-canyons" => ("ALPINE PEAKS", "WILDERNESS RUN"),
        "gateway-pass" => ("WILDERNESS RUN", "TULIP GARDENS"),
        "alpine-peaks" => ("SUNSET HIGHWAY", "ANCIENT RUINS"),
        "wilderness-run" => ("ANCIENT RUINS", "METROPOLIS NIGHT"),
        "tulip-gardens" => ("METROPOLIS NIGHT", "COASTAL CLIFFS"),
        "sunset-highway" => ("MARINA BAY [A]", "DESERT OASIS [B]"),
        "ancient-ruins" => ("DESERT OASIS [B]", "GRAND CASTLE [C]"),
        "metropolis-night" => ("GRAND CASTLE [C]", "COLOSSEUM [D]"),
        "coastal-cliffs" => ("COLOSSEUM [D]", "AERODROME [E]"),
        _ => ("FINISH LINE", "FINISH LINE"),
    }
}

/// 5×7 uppercase bitmap font rows (bit 4 is leftmost column, bit 0 is rightmost column).
fn glyph_5x7(ch: char) -> [u8; 7] {
    match ch.to_ascii_uppercase() {
        'A' => [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
        'B' => [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
        'C' => [0b01111, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b01111],
        'D' => [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
        'E' => [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
        'F' => [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
        'G' => [0b01111, 0b10000, 0b10000, 0b10011, 0b10001, 0b10001, 0b01111],
        'H' => [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
        'I' => [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111],
        'J' => [0b00111, 0b00010, 0b00010, 0b00010, 0b10010, 0b10010, 0b01100],
        'K' => [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
        'L' => [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
        'M' => [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
        'N' => [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
        'O' | '0' => [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
        'P' => [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
        'Q' => [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
        'R' => [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
        'S' | '5' => [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
        'T' => [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
        'U' => [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
        'V' => [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
        'W' => [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
        'X' => [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
        'Y' => [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
        'Z' | '2' => [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
        '1' => [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
        '3' => [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
        '4' => [0b10010, 0b10010, 0b10010, 0b11111, 0b00010, 0b00010, 0b00010],
        '<' => [0b00011, 0b00110, 0b01100, 0b11000, 0b01100, 0b00110, 0b00011],
        '>' => [0b11000, 0b01100, 0b00110, 0b00011, 0b00110, 0b01100, 0b11000],
        '◀' => [0b00001, 0b00011, 0b00111, 0b01111, 0b00111, 0b00011, 0b00001],
        '▶' => [0b10000, 0b11000, 0b11100, 0b11110, 0b11100, 0b11000, 0b10000],
        '[' => [0b01110, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b01110],
        ']' => [0b01110, 0b00010, 0b00010, 0b00010, 0b00010, 0b00010, 0b01110],
        '!' => [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100],
        '-' => [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
        _ => [0; 7],
    }
}

/// Emit crisp 3D extruded block-letter text on a signboard face (`renderer.js` `_gantrySignMaterial` / `_checkpointSignMaterial`).
#[allow(clippy::too_many_arguments)]
fn push_sign_text(
    verts: &mut Vec<GpuVertex>,
    indices: &mut Vec<u32>,
    origin: [f32; 3],
    yaw: f32,
    center_local: [f32; 3],
    max_width: f32,
    char_height: f32,
    text: &str,
    color: [f32; 4],
) {
    let chars: Vec<char> = text.chars().collect();
    if chars.is_empty() {
        return;
    }
    let total_cols = (chars.len() * 6).saturating_sub(1).max(1) as f32;
    let natural_px_w = char_height / 7.0;
    let px_w = natural_px_w.min(max_width / total_cols);
    let px_h = char_height / 7.0;
    let total_w = total_cols * px_w;
    let start_x = center_local[0] - total_w * 0.5;
    let top_y = center_local[1] + char_height * 0.5;
    let lz = center_local[2];

    let (sy, cy) = yaw.sin_cos();
    let place = |lx: f32, ly: f32, z_off: f32| -> [f32; 3] {
        [
            origin[0] + lx * cy + z_off * sy,
            origin[1] + ly,
            origin[2] - lx * sy + z_off * cy,
        ]
    };

    for (c_idx, &ch) in chars.iter().enumerate() {
        let rows = glyph_5x7(ch);
        let char_x0 = start_x + (c_idx as f32) * 6.0 * px_w;
        for (r_idx, &row_bits) in rows.iter().enumerate() {
            if row_bits == 0 {
                continue;
            }
            let mut col = 0usize;
            while col < 5 {
                if (row_bits & (1 << (4 - col))) != 0 {
                    let run_start = col;
                    while col < 5 && (row_bits & (1 << (4 - col))) != 0 {
                        col += 1;
                    }
                    let run_len = (col - run_start) as f32;
                    let cx = char_x0 + ((run_start as f32) + run_len * 0.5) * px_w;
                    let cy_pt = top_y - ((r_idx as f32) + 0.5) * px_h;
                    push_oriented_box(
                        verts,
                        indices,
                        place(cx, cy_pt, lz),
                        [run_len * px_w * 0.52, px_h * 0.52, 0.04],
                        yaw,
                        0.0,
                        0.0,
                        color,
                        [9.0, 0.0, cy_pt, 0.0],
                    );
                } else {
                    col += 1;
                }
            }
        }
    }
}

/// Build the Sega Route Fork Gantry (`bForkGantry` in `renderer.js` lines 1894-1926):
/// steel pillars + overhead truss beam + cyan Left & orange Right destination sign boards
/// with 3D scenario name lettering (`◀ DESERT CANYONS` / `GATEWAY PASS ▶`).
fn push_fork_gantry(
    verts: &mut Vec<GpuVertex>,
    indices: &mut Vec<u32>,
    pos: [f32; 3],
    yaw: f32,
    half_w: f32,
    left_label: &str,
    right_label: &str,
) {
    let steel = [0.216, 0.278, 0.310, 1.0]; // #37474F
    let cyan_board = [0.0, 0.722, 0.831, 1.0]; // #00B8D4
    let orange_board = [1.0, 0.427, 0.0, 1.0]; // #FF6D00
    let dark_ink = [0.043, 0.051, 0.071, 1.0]; // #0B0D12
    let hw = half_w.max(8.0);
    let pillar_x = hw + 3.0;
    let (sy, cy) = yaw.sin_cos();
    let place = |lx: f32, ly: f32, lz: f32| -> [f32; 3] {
        [pos[0] + lx * cy + lz * sy, pos[1] + ly, pos[2] - lx * sy + lz * cy]
    };

    for side in [-1.0f32, 1.0] {
        push_oriented_box(
            verts,
            indices,
            place(side * pillar_x, 4.5, 0.0),
            [0.35, 4.5, 0.35],
            yaw,
            0.0,
            0.0,
            steel,
            [0.0, 0.0, 4.5, 1.0],
        );
    }
    push_oriented_box(
        verts,
        indices,
        place(0.0, 8.2, 0.0),
        [pillar_x * 1.08, 0.45, 0.45],
        yaw,
        0.0,
        0.0,
        steel,
        [0.0, 0.0, 8.2, 1.0],
    );

    let board_hw = hw * 0.45;
    let board_hh = 1.1;
    let board_y = 8.5;

    // Left branch sign board (`_gantrySignMaterial`: #00B8D4 fill, single centered `◀ LABEL` in #0B0D12)
    let lx_left = -hw * 0.55;
    push_oriented_box(
        verts,
        indices,
        place(lx_left, board_y, -0.55),
        [board_hw, board_hh, 0.10],
        yaw,
        0.0,
        0.0,
        cyan_board,
        [9.0, 0.0, board_y, 0.0],
    );
    let clean_left = left_label.split('[').next().unwrap_or(left_label).trim().to_uppercase();
    let left_text = format!("◀ {}", clean_left);
    push_sign_text(
        verts,
        indices,
        pos,
        yaw,
        [lx_left, board_y, -0.68],
        board_hw * 1.84,
        0.92,
        &left_text,
        dark_ink,
    );

    // Right branch sign board (`_gantrySignMaterial`: #FF6D00 fill, single centered `LABEL ▶` in #0B0D12)
    let lx_right = hw * 0.55;
    push_oriented_box(
        verts,
        indices,
        place(lx_right, board_y, -0.55),
        [board_hw, board_hh, 0.10],
        yaw,
        0.0,
        0.0,
        orange_board,
        [9.0, 0.0, board_y, 0.0],
    );
    let clean_right = right_label.split('[').next().unwrap_or(right_label).trim().to_uppercase();
    let right_text = format!("{} ▶", clean_right);
    push_sign_text(
        verts,
        indices,
        pos,
        yaw,
        [lx_right, board_y, -0.68],
        board_hw * 1.84,
        0.92,
        &right_text,
        dark_ink,
    );
}

/// Build the branch Checkpoint Arch (`_checkpointArch` in `renderer.js` lines 1975-2033)
/// with 3D `CHECKPOINT` + destination scenario name lettering.
fn push_checkpoint_arch(
    verts: &mut Vec<GpuVertex>,
    indices: &mut Vec<u32>,
    pos: [f32; 3],
    yaw: f32,
    span: f32,
    is_left: bool,
    branch_label: &str,
) {
    let cream = [0.91, 0.886, 0.816, 1.0]; // #E8E2D0
    let dark_ink = [0.078, 0.078, 0.078, 1.0]; // #141414
    let accent = if is_left {
        [0.0, 0.722, 0.831, 1.0]
    } else {
        [1.0, 0.427, 0.0, 1.0]
    };
    let s = span.max(5.0);
    let (sy, cy) = yaw.sin_cos();
    let place = |lx: f32, ly: f32, lz: f32| -> [f32; 3] {
        [pos[0] + lx * cy + lz * sy, pos[1] + ly, pos[2] - lx * sy + lz * cy]
    };
    for side in [-1.0f32, 1.0] {
        push_oriented_box(
            verts,
            indices,
            place(side * s, 3.75, 0.0),
            [0.35, 3.75, 0.35],
            yaw,
            0.0,
            0.0,
            cream,
            [0.0, 0.0, 3.75, 1.0],
        );
    }
    let sign_y = 7.2;
    let sign_hw = s + 0.35;
    let sign_hh = 1.15;
    push_oriented_box(
        verts,
        indices,
        place(0.0, sign_y, -0.32),
        [sign_hw + 0.12, sign_hh + 0.12, 0.12],
        yaw,
        0.0,
        0.0,
        accent,
        [9.0, 0.0, sign_y, 0.0],
    );
    push_oriented_box(
        verts,
        indices,
        place(0.0, sign_y, -0.40),
        [sign_hw, sign_hh, 0.12],
        yaw,
        0.0,
        0.0,
        cream,
        [9.0, 0.0, sign_y, 0.0],
    );
    let clean_branch = branch_label.split('[').next().unwrap_or(branch_label).trim();
    push_sign_text(
        verts,
        indices,
        pos,
        yaw,
        [0.0, sign_y + 0.44, -0.54],
        sign_hw * 1.75,
        0.58,
        "CHECKPOINT",
        dark_ink,
    );
    push_sign_text(
        verts,
        indices,
        pos,
        yaw,
        [0.0, sign_y - 0.38, -0.54],
        sign_hw * 1.85,
        0.78,
        clean_branch,
        dark_ink,
    );
}

/// Build the Gold Finish Gantry (`bFinishGantry` in `renderer.js` lines 1930-1955).
fn push_finish_gantry(
    verts: &mut Vec<GpuVertex>,
    indices: &mut Vec<u32>,
    pos: [f32; 3],
    yaw: f32,
    half_w: f32,
) {
    let gold = [1.0, 0.843, 0.0, 1.0]; // #FFD700
    let dark_ink = [0.06, 0.06, 0.08, 1.0];
    let hw = half_w.max(6.0) + 3.5;
    let (sy, cy) = yaw.sin_cos();
    let place = |lx: f32, ly: f32, lz: f32| -> [f32; 3] {
        [pos[0] + lx * cy + lz * sy, pos[1] + ly, pos[2] - lx * sy + lz * cy]
    };
    for side in [-1.0f32, 1.0] {
        push_oriented_box(
            verts,
            indices,
            place(side * hw, 5.0, 0.0),
            [0.42, 5.0, 0.42],
            yaw,
            0.0,
            0.0,
            gold,
            [9.0, 0.0, 5.0, 0.0],
        );
    }
    push_oriented_box(
        verts,
        indices,
        place(0.0, 8.6, 0.0),
        [hw * 1.05, 1.15, 0.6],
        yaw,
        0.0,
        0.0,
        gold,
        [9.0, 0.0, 8.6, 0.0],
    );
    push_sign_text(
        verts,
        indices,
        pos,
        yaw,
        [0.0, 8.6, -0.64],
        hw * 1.7,
        0.95,
        "GOAL! FINISH",
        dark_ink,
    );
}

/// Build procedural stage props (`powerPole`, `streetLamp`, `column`, `brokenArch`, `turbine`, `dune`, `pool`, `runwayLight`).
fn push_procedural_prop(
    verts: &mut Vec<GpuVertex>,
    indices: &mut Vec<u32>,
    kind: &str,
    pos: [f32; 3],
    yaw: f32,
    scale: f32,
) {
    let s = scale.clamp(0.4, 3.0);
    let (sy, cy) = yaw.sin_cos();
    let place = |lx: f32, ly: f32, lz: f32| -> [f32; 3] {
        let sx = lx * s;
        let sy_p = ly * s;
        let sz = lz * s;
        [pos[0] + sx * cy + sz * sy, pos[1] + sy_p, pos[2] - sx * sy + sz * cy]
    };
    if kind.contains("powerPole") {
        let wood = [0.28, 0.20, 0.14, 1.0];
        let insulator = [0.76, 0.84, 0.88, 1.0];
        push_tapered_cylinder(verts, indices, place(0.0, 0.0, 0.0), place(0.0, 10.6, 0.0), 0.19 * s, 0.12 * s, 10, wood, [0.0, 0.0, 5.5, 1.0]);
        push_oriented_box(verts, indices, place(0.0, 9.6, 0.0), [1.45 * s, 0.09 * s, 0.09 * s], yaw, 0.0, 0.0, wood, [0.0, 0.0, 9.6, 1.0]);
        for ix in [-1.15f32, 0.0, 1.15] {
            push_tapered_cylinder(verts, indices, place(ix, 9.68, 0.0), place(ix, 9.95, 0.0), 0.055 * s, 0.038 * s, 8, insulator, [0.0, 0.0, 9.8, 1.0]);
        }
    } else if kind.contains("streetLamp") {
        let steel = [0.26, 0.30, 0.35, 1.0];
        let lamp = [1.0, 0.86, 0.52, 1.0];
        push_tapered_cylinder(verts, indices, place(0.0, 0.0, 0.0), place(0.0, 0.65, 0.0), 0.22 * s, 0.15 * s, 10, steel, [0.0, 0.0, 0.4, 1.0]);
        push_tapered_cylinder(verts, indices, place(0.0, 0.65, 0.0), place(0.0, 8.6, 0.0), 0.13 * s, 0.08 * s, 10, steel, [0.0, 0.0, 4.5, 1.0]);
        push_tapered_cylinder(verts, indices, place(0.0, 8.4, 0.0), place(-1.85, 8.85, 0.0), 0.075 * s, 0.055 * s, 8, steel, [0.0, 0.0, 8.7, 1.0]);
        push_oriented_box(verts, indices, place(-1.95, 8.88, 0.0), [0.36 * s, 0.08 * s, 0.22 * s], yaw, 0.0, 0.0, steel, [0.0, 0.0, 8.8, 1.0]);
        push_oriented_box(verts, indices, place(-1.95, 8.76, 0.0), [0.30 * s, 0.07 * s, 0.18 * s], yaw, 0.0, 0.0, lamp, [9.0, 0.0, 4.2, 0.0]);
    } else if kind.contains("column") || kind.contains("brokenArch") {
        let marble = [0.85, 0.81, 0.72, 1.0];
        push_oriented_box(verts, indices, place(0.0, 0.35, 0.0), [1.1 * s, 0.35 * s, 1.1 * s], yaw, 0.0, 0.0, marble, [0.0, 0.0, 0.4, 1.0]);
        push_tapered_cylinder(verts, indices, place(0.0, 0.7, 0.0), place(0.0, 8.2, 0.0), 0.72 * s, 0.62 * s, 14, marble, [0.0, 0.0, 4.5, 1.0]);
        push_oriented_box(verts, indices, place(0.0, 8.5, 0.0), [1.05 * s, 0.32 * s, 1.05 * s], yaw, 0.0, 0.0, marble, [0.0, 0.0, 8.5, 1.0]);
        if kind.contains("brokenArch") {
            push_tapered_cylinder(verts, indices, place(3.8, 0.0, 0.0), place(3.8, 6.2, 0.0), 0.72 * s, 0.64 * s, 14, marble, [0.0, 0.0, 3.5, 1.0]);
            push_oriented_box(verts, indices, place(1.2, 8.6, 0.0), [2.1 * s, 0.62 * s, 0.75 * s], yaw, 0.0, -0.18, marble, [0.0, 0.0, 8.6, 1.0]);
        }
    } else if kind.contains("turbine") {
        let white = [0.94, 0.95, 0.96, 1.0];
        let hub_shade = [0.84, 0.86, 0.89, 1.0];
        // Tall tapered cylindrical tubular steel tower (`PROP_BUILDERS.turbine` in `stage_look.js`)
        push_tapered_cylinder(verts, indices, place(0.0, 0.0, 0.0), place(0.0, 40.0, 0.0), 1.10 * s, 0.48 * s, 14, white, [0.0, 0.0, 20.0, 1.0]);
        // Streamlined nacelle housing + nose cone spinner at y = 40.5
        push_tapered_cylinder(verts, indices, place(0.0, 40.5, 1.8), place(0.0, 40.5, -1.2), 0.82 * s, 0.68 * s, 12, white, [0.0, 0.0, 40.5, 1.0]);
        push_tapered_cylinder(verts, indices, place(0.0, 40.5, -1.2), place(0.0, 40.5, -2.3), 0.68 * s, 0.08 * s, 12, hub_shade, [0.0, 0.0, 40.5, 1.0]);
        // 3 long tapered aerodynamic airfoil blades
        for b in 0..3 {
            let a = (b as f32) * (std::f32::consts::TAU / 3.0) + 0.35;
            let root = place(a.cos() * 0.55, 40.5 + a.sin() * 0.55, -1.55);
            let mid = place(a.cos() * 8.5, 40.5 + a.sin() * 8.5, -1.65);
            let tip = place(a.cos() * 17.5, 40.5 + a.sin() * 17.5, -1.72);
            push_tapered_cylinder(verts, indices, root, mid, 0.44 * s, 0.28 * s, 8, white, [0.0, 0.0, 40.5, 1.0]);
            push_tapered_cylinder(verts, indices, mid, tip, 0.28 * s, 0.06 * s, 8, white, [0.0, 0.0, 40.5, 1.0]);
        }
    } else if kind.contains("dune") {
        let sand = [0.85, 0.71, 0.48, 1.0];
        push_tapered_cylinder(verts, indices, place(0.0, -0.5, 0.0), place(0.0, 3.8, 0.0), 16.0 * s, 3.2 * s, 16, sand, [4.0, 0.0, 2.2, 1.0]);
    } else if kind.contains("pool") {
        let water = [0.09, 0.56, 0.72, 1.0];
        push_tapered_cylinder(verts, indices, place(0.0, 0.0, 0.0), place(0.0, 0.14, 0.0), 8.5 * s, 8.2 * s, 18, water, [3.0, 0.0, 0.1, 0.0]);
    } else if kind.contains("runwayLight") {
        let glow = [0.25, 0.88, 1.0, 1.0];
        push_tapered_cylinder(verts, indices, place(0.0, 0.0, 0.0), place(0.0, 0.38, 0.0), 0.20 * s, 0.14 * s, 8, glow, [9.0, 0.0, 0.3, 0.0]);
    } else {
        push_palm_tree(verts, indices, pos, yaw, s);
    }
}

/// Build a Ghibli gouache wildflower/poppy/tulip patch (`_scatterMesh` `flower` / `poppies` in `renderer.js` lines 3245-3250).
/// Grounded strictly on the terrain (`lift = 0.0`) with basal leaf rosettes and multi-petal cup blossoms.
fn push_flower_cluster(
    verts: &mut Vec<GpuVertex>,
    indices: &mut Vec<u32>,
    pos: [f32; 3],
    yaw: f32,
    scale: f32,
    tint: [f32; 4],
    is_poppies: bool,
) {
    let s = scale.clamp(0.45, 1.35);
    let leaf_dark = [0.16, 0.38, 0.14, 1.0];
    let leaf_mid = [0.24, 0.50, 0.19, 1.0];
    let count = if is_poppies { 7 } else { 5 };
    let (sy, cy) = yaw.sin_cos();

        // Grounded basal foliage rosette (`lift = 0.0`, rooted `-0.02m` in soil so flowers never levitate)
    for l in 0..6 {
        let la = (l as f32) * (std::f32::consts::TAU / 6.0) + yaw * 0.7;
        let (lsa, lca) = la.sin_cos();
        let tip_r = (0.34 + 0.08 * ((l % 2) as f32)) * s;
        let tip_h = (0.14 + 0.05 * ((l % 3) as f32)) * s;
        let p0 = [pos[0], pos[1] - 0.02 * s, pos[2]];
        let p1 = [
            pos[0] + (lsa * cy + lca * sy) * tip_r,
            pos[1] + tip_h,
            pos[2] + (-lsa * sy + lca * cy) * tip_r,
        ];
        push_tapered_cylinder(verts, indices, p0, p1, 0.09 * s, 0.015 * s, 5, leaf_dark, [6.0, 0.6, tip_h, 2.0]);
    }

    // 2. Stems and sculpted multi-faceted cup blossoms with warm golden centers
    for k in 0..count {
        let a = (k as f32 / count as f32) * std::f32::consts::TAU + (k as f32 * 1.37).sin() * 0.35;
        let r = (0.08 + 0.24 * (((k * 7 + 3) % count) as f32 / count as f32).sqrt()) * s;
        let lx = a.sin() * r;
        let lz = a.cos() * r;
        let wx = pos[0] + lx * cy + lz * sy;
        let wz = pos[2] - lx * sy + lz * cy;
        let h = (0.20 + 0.20 * (((k * 5 + 1) % count) as f32 / count as f32)) * s;
        let lean_x = a.sin() * 0.06 * s;
        let lean_z = a.cos() * 0.06 * s;
        let stem_base = [wx - lean_x, pos[1] - 0.03, wz - lean_z];
        let stem_top = [wx + lean_x, pos[1] + h, wz + lean_z];
        push_tapered_cylinder(verts, indices, stem_base, stem_top, 0.030 * s, 0.018 * s, 5, leaf_mid, [6.0, 0.85, h * 0.5, 2.0]);

        let shade = 0.88 + 0.20 * ((k % 3) as f32 / 2.0);
        let head_col = [
            (tint[0] * shade).min(1.0),
            (tint[1] * shade).min(1.0),
            (tint[2] * shade).min(1.0),
            1.0,
        ];
        let cup_r = (if is_poppies { 0.135 } else { 0.115 }) * s;
        let cup_h = cup_r * 0.78;
        let cup_top = [stem_top[0], stem_top[1] + cup_h, stem_top[2]];
        push_tapered_cylinder(verts, indices, stem_top, cup_top, cup_r * 0.38, cup_r, 7, head_col, [6.0, 1.0, h + cup_h, 2.0]);
    }
}

/// Build low overlapping snow bank mounds (`_scatterMesh` `drift` in `renderer.js` lines 3251-3258).
fn push_snow_drift(
    verts: &mut Vec<GpuVertex>,
    indices: &mut Vec<u32>,
    pos: [f32; 3],
    yaw: f32,
    scale: f32,
    tint: [f32; 4],
) {
    let s = scale.clamp(0.5, 1.6);
    let (sy, cy) = yaw.sin_cos();
    for (k, lz_off) in [-0.95f32, -0.30, 0.35, 0.95].iter().enumerate() {
        let lx = ((k as f32 * 1.9).sin()) * 0.08 * s;
        let lz = lz_off * s;
        let wx = pos[0] + lx * cy + lz * sy;
        let wz = pos[2] - lx * sy + lz * cy;
        let w = (0.68 + 0.16 * (k % 2) as f32) * s;
        let h = (0.22 + 0.06 * ((k + 1) % 2) as f32) * s;
        push_oriented_box(
            verts,
            indices,
            [wx, pos[1] + h * 0.7, wz],
            [w, h, w * 1.05],
            yaw,
            0.0,
            0.0,
            tint,
            [4.0, 0.0, h, 1.0],
        );
    }
}

/// Extract static 3D stage geometry (track ribbons + instanced 3D art-pack props/foliage) directly
/// from the binary `.glb` bundle produced by `stage_gltf.js` and `.seed-assets/`.
pub fn build_static_stage_geometry(glb_bytes: &[u8]) -> Result<(Vec<GpuVertex>, Vec<u32>), String> {
    let (json_str, bin) = parse_glb_chunks(glb_bytes)?;
    let root = parse_json(json_str)?;

    let views: Vec<BufferViewMeta> = root
        .get("bufferViews")
        .and_then(|v| v.as_arr())
        .ok_or("Missing bufferViews")?
        .iter()
        .map(|bv| BufferViewMeta {
            byte_offset: bv.get("byteOffset").and_then(|v| v.as_f64()).unwrap_or(0.0) as usize,
            byte_length: bv.get("byteLength").and_then(|v| v.as_f64()).unwrap_or(0.0) as usize,
        })
        .collect();

    let accessors: Vec<AccessorMeta> = root
        .get("accessors")
        .and_then(|v| v.as_arr())
        .ok_or("Missing accessors")?
        .iter()
        .map(|a| AccessorMeta {
            buffer_view: a.get("bufferView").and_then(|v| v.as_f64()).unwrap_or(0.0) as usize,
            byte_offset: a.get("byteOffset").and_then(|v| v.as_f64()).unwrap_or(0.0) as usize,
            component_type: a.get("componentType").and_then(|v| v.as_f64()).unwrap_or(0.0) as u32,
            count: a.get("count").and_then(|v| v.as_f64()).unwrap_or(0.0) as usize,
            acc_type: a
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("SCALAR")
                .to_string(),
        })
        .collect();

    let mat_colors: Vec<[f32; 4]> = root
        .get("materials")
        .and_then(|v| v.as_arr())
        .map(|arr| {
            arr.iter()
                .map(|m| {
                    m.get("pbrMetallicRoughness")
                        .and_then(|p| p.get("baseColorFactor"))
                        .and_then(|c| c.as_arr())
                        .map(|c| {
                            [
                                c.first().and_then(|x| x.as_f64()).unwrap_or(0.5) as f32,
                                c.get(1).and_then(|x| x.as_f64()).unwrap_or(0.5) as f32,
                                c.get(2).and_then(|x| x.as_f64()).unwrap_or(0.5) as f32,
                                c.get(3).and_then(|x| x.as_f64()).unwrap_or(1.0) as f32,
                            ]
                        })
                        .unwrap_or([0.5, 0.5, 0.5, 1.0])
                })
                .collect()
        })
        .unwrap_or_default();

    let stage_id = root
        .get("scenes")
        .and_then(|s| s.as_arr())
        .and_then(|a| a.first())
        .and_then(|sc| sc.get("name"))
        .and_then(|n| n.as_str())
        .ok_or("Missing scene name in stage GLB")?;

    let meshes = root.get("meshes").and_then(|v| v.as_arr()).ok_or("Missing meshes")?;
    let nodes = root.get("nodes").and_then(|v| v.as_arr()).ok_or("Missing nodes")?;
    let art_lib = ArtPackLibrary::global();

    let mut vertices = Vec::with_capacity(262_144);
    let mut indices = Vec::with_capacity(524_288);
    let mut power_poles: Vec<[f32; 4]> = Vec::new();

    for node in nodes {
        let name = node.get("name").and_then(|v| v.as_str()).unwrap_or("");
        if let Some(inst) = node
            .get("extensions")
            .and_then(|e| e.get("EXT_mesh_gpu_instancing"))
            .and_then(|i| i.get("attributes"))
        {
            let trans_idx = inst
                .get("TRANSLATION")
                .and_then(|v| v.as_f64())
                .map(|v| v as usize)
                .ok_or("Missing TRANSLATION accessor")?;
            let rot_idx = inst
                .get("ROTATION")
                .and_then(|v| v.as_f64())
                .map(|v| v as usize)
                .ok_or("Missing ROTATION accessor")?;
            let scale_idx = inst
                .get("SCALE")
                .and_then(|v| v.as_f64())
                .map(|v| v as usize)
                .ok_or("Missing SCALE accessor")?;

            let trans_acc = accessors.get(trans_idx).ok_or("Invalid TRANSLATION accessor")?;
            let rot_acc = accessors.get(rot_idx).ok_or("Invalid ROTATION accessor")?;
            let scale_acc = accessors.get(scale_idx).ok_or("Invalid SCALE accessor")?;

            let translations = read_f32_slice(bin, &views, trans_acc, 3)?;
            let rotations = read_f32_slice(bin, &views, rot_acc, 4)?;
            let scales = read_f32_slice(bin, &views, scale_acc, 3)?;
            let kind = node
                .get("extras")
                .and_then(|e| e.get("kind"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let count = trans_acc.count;

            // Resolve real art-pack `.glb` model if available (`lod0` across Desktop stage props)
            let parts: Vec<&str> = kind.split(':').collect();
            let resolved_model = if parts.first() == Some(&"prop") {
                let explicit_id = parts.get(2).copied().or_else(|| match parts.get(1).copied() {
                    Some("column") => Some("column"),
                    Some("brokenArch") => Some("broken-arch"),
                    Some("lighthouse") => Some("lighthouse"),
                    Some("sailboat") => Some("sailboat"),
                    Some("windmill") => Some("windmill"),
                    Some("castleTower") => Some("castle-tower"),
                    Some("colosseum") => Some("colosseum"),
                    Some("hangar") => Some("hangar"),
                    Some("cypress") => Some("cypress"),
                    Some("pine") => Some("tree-pine-young"),
                    Some("broadleaf") => Some("tree-broadleaf-a"),
                    Some("cactus") => Some("cactus"),
                    Some("mesa") => Some("mesa-a"),
                    Some("cliff") => Some("cliff-coast-a"),
                    _ => None,
                });
                explicit_id.and_then(|model_id| {
                    art_lib
                        .get(&format!("model/{}/lod0", model_id))
                        .or_else(|| art_lib.get(&format!("model/{}/lod1", model_id)))
                })
            } else {
                None
            };

            let scatter_model_and_tint = if parts.first() == Some(&"scatter") {
                let s_kind = parts.get(1).copied().unwrap_or("bush");
                let hex = parts.get(2).copied().unwrap_or("#2F6B2E");
                let tint = parse_hex_rgb(hex);
                let is_arid = matches!(stage_id, "desert-canyons" | "ancient-ruins" | "destination-oasis" | "sunset-highway");
                let is_alpine = matches!(stage_id, "alpine-heights" | "wilderness-run" | "destination-castle");
                let mdl = match s_kind {
                    "flower" | "poppies" | "drift" => None,
                    "cactus" => art_lib.get("model/cactus/lod0").or_else(|| art_lib.get("model/cactus/lod1")),
                    "tuft" => {
                        if stage_id == "coconut-beach" || stage_id == "destination-marina" {
                            art_lib.get("model/grass-beach/lod0").or_else(|| art_lib.get("model/grass-tuft/lod0"))
                        } else {
                            art_lib.get("model/grass-tuft/lod0").or_else(|| art_lib.get("model/grass-beach/lod0"))
                        }
                    }
                    "stone" => {
                        if is_arid {
                            art_lib.get("model/rock-sand-a/lod0").or_else(|| art_lib.get("model/rock-granite-a/lod0"))
                        } else {
                            art_lib.get("model/rock-granite-a/lod0").or_else(|| art_lib.get("model/rock-lime-a/lod0"))
                        }
                    }
                    _ => {
                        if is_arid {
                            art_lib.get("model/shrub-desert/lod0").or_else(|| art_lib.get("model/shrub-b/lod0"))
                        } else if is_alpine {
                            art_lib.get("model/fern/lod0").or_else(|| art_lib.get("model/shrub-a/lod0"))
                        } else if stage_id == "coconut-beach" || stage_id == "destination-marina" {
                            art_lib.get("model/shrub-tropical/lod0").or_else(|| art_lib.get("model/shrub-b/lod0"))
                        } else {
                            art_lib.get("model/shrub-b/lod0").or_else(|| art_lib.get("model/shrub-tropical/lod0"))
                        }
                    }
                };
                Some((s_kind, mdl, tint))
            } else {
                None
            };

            for i in 0..count {
                let pos = [
                    translations[i * 3],
                    translations[i * 3 + 1],
                    translations[i * 3 + 2],
                ];
                let qy = rotations[i * 4 + 1];
                let qz = rotations[i * 4 + 2];
                let qw = rotations[i * 4 + 3];
                let q_yaw = if qy.abs() >= qz.abs() { qy } else { qz };
                let yaw = 2.0 * q_yaw.atan2(qw);
                let sc = scales[i * 3].max(0.15);

                if kind.contains("powerPole") {
                    power_poles.push([pos[0], pos[1], pos[2], yaw]);
                }

                if let Some(glb_model) = resolved_model {
                    push_glb_model_instance(&mut vertices, &mut indices, glb_model, pos, yaw, sc, None);
                } else if let Some((s_kind @ ("flower" | "poppies"), _, tint)) = scatter_model_and_tint {
                    push_flower_cluster(
                        &mut vertices,
                        &mut indices,
                        pos,
                        yaw,
                        sc,
                        tint,
                        s_kind == "poppies",
                    );
                } else if let Some(("drift", _, tint)) = scatter_model_and_tint {
                    push_snow_drift(&mut vertices, &mut indices, pos, yaw, sc, tint);
                } else if let Some((s_kind, Some(default_mdl), tint)) = scatter_model_and_tint {
                    let chosen_mdl = if s_kind == "stone" {
                        let is_arid = matches!(stage_id, "desert-canyons" | "ancient-ruins" | "destination-oasis" | "sunset-highway");
                        let is_lime = matches!(stage_id, "ancient-ruins" | "destination-castle" | "gateway-pass" | "coastal-cliffs");
                        let sand_ids = ["model/rock-sand-a/lod0", "model/rock-sand-b/lod0", "model/rock-sand-c/lod0", "model/rock-sand-d/lod0", "model/rock-sand-e/lod0", "model/rock-sand-f/lod0"];
                        let lime_ids = ["model/rock-lime-a/lod0", "model/rock-lime-b/lod0", "model/rock-lime-c/lod0", "model/rock-lime-d/lod0"];
                        let gran_ids = ["model/rock-granite-a/lod0", "model/rock-granite-b/lod0", "model/rock-granite-c/lod0", "model/rock-granite-d/lod0", "model/rock-granite-e/lod0"];
                        let pool: &[&str] = if is_arid {
                            &sand_ids
                        } else if is_lime && (i % 2 == 0) {
                            &lime_ids
                        } else {
                            &gran_ids
                        };
                        art_lib.get(pool[i % pool.len()]).unwrap_or(default_mdl)
                    } else {
                        default_mdl
                    };
                    push_glb_model_instance(
                        &mut vertices,
                        &mut indices,
                        chosen_mdl,
                        pos,
                        yaw,
                        sc,
                        if s_kind == "stone" { None } else { Some(tint) },
                    );
                } else if kind == "prop:forkGantry" {
                    let (left_label, right_label) = fork_labels_for_stage(stage_id);
                    push_fork_gantry(
                        &mut vertices,
                        &mut indices,
                        pos,
                        yaw,
                        sc,
                        left_label,
                        right_label,
                    );
                } else if kind == "prop:checkpointArchL" {
                    let (left_label, _) = fork_labels_for_stage(stage_id);
                    push_checkpoint_arch(&mut vertices, &mut indices, pos, yaw, sc, true, left_label);
                } else if kind == "prop:checkpointArchR" {
                    let (_, right_label) = fork_labels_for_stage(stage_id);
                    push_checkpoint_arch(
                        &mut vertices,
                        &mut indices,
                        pos,
                        yaw,
                        sc,
                        false,
                        right_label,
                    );
                } else if kind == "prop:finishGantry" {
                    push_finish_gantry(&mut vertices, &mut indices, pos, yaw, sc);
                } else if kind.contains("arch") && !kind.contains("brokenArch") {
                    push_voussoir_stone_arch(&mut vertices, &mut indices, pos, yaw, sc);
                } else if kind.starts_with("prop:") {
                    push_procedural_prop(&mut vertices, &mut indices, kind, pos, yaw, sc);
                } else {
                    let col = if let Some((_, _, tint)) = scatter_model_and_tint {
                        tint
                    } else {
                        [0.26, 0.56, 0.25, 1.0]
                    };
                    push_oriented_box(
                        &mut vertices,
                        &mut indices,
                        [pos[0], pos[1] + 0.35 * sc, pos[2]],
                        [0.55 * sc, 0.35 * sc, 0.55 * sc],
                        yaw,
                        0.0,
                        0.0,
                        col,
                        [6.0, 0.6, 0.8, 1.0],
                    );
                }
            }
            continue;
        }

        // Ribbon mesh node
        let Some(mesh_idx) = node.get("mesh").and_then(|v| v.as_f64()).map(|v| v as usize) else {
            continue;
        };
        let Some(mesh) = meshes.get(mesh_idx) else {
            continue;
        };
        let Some(prims) = mesh.get("primitives").and_then(|v| v.as_arr()) else {
            continue;
        };

        // `bWater` already covers `SHORE - 2m .. SHORE + 1400m` with 14 tessellated 3D Gerstner
        // ocean bands and dynamic shoreward surf breakers; skip the legacy flat 2-vertex `bFoam` strip.
        if name == "bFoam" {
            continue;
        }

        let surface_role = match name {
            "bRoad" | "bForkRoadL" | "bForkRoadR" => 1.0,
            "bRumbleL" | "bRumbleR" | "bForkRumbleL" | "bForkRumbleR" => 2.0,
            "bWater" => 3.0,
            "bTerrainL" | "bTerrainR" | "bForkDivider" => 4.0,
            "bPromenade" | "bSeaWall" | "bSeaWallFace" | "bSeaWallBack" => 5.0,
            "bCarpetL" | "bCarpetR" => 7.0,
            _ => 0.0,
        };
        let uv_u_offset = if matches!(name, "bForkRoadL" | "bForkRoadR") {
            2.0
        } else {
            0.0
        };

        for prim in prims {
            let Some(attrs) = prim.get("attributes") else {
                continue;
            };
            let pos_idx = attrs
                .get("POSITION")
                .and_then(|v| v.as_f64())
                .map(|v| v as usize)
                .ok_or("Missing POSITION accessor")?;
            let norm_idx = attrs
                .get("NORMAL")
                .and_then(|v| v.as_f64())
                .map(|v| v as usize)
                .ok_or("Missing NORMAL accessor")?;
            let uv_idx = attrs.get("TEXCOORD_0").and_then(|v| v.as_f64()).map(|v| v as usize);
            let ind_idx = prim
                .get("indices")
                .and_then(|v| v.as_f64())
                .map(|v| v as usize)
                .ok_or("Missing indices accessor")?;
            let mat_idx = prim.get("material").and_then(|v| v.as_f64()).unwrap_or(0.0) as usize;

            let pos_acc = accessors.get(pos_idx).ok_or("Invalid POSITION accessor")?;
            let norm_acc = accessors.get(norm_idx).ok_or("Invalid NORMAL accessor")?;
            let ind_acc = accessors.get(ind_idx).ok_or("Invalid indices accessor")?;

            let pos_data = read_f32_slice(bin, &views, pos_acc, 3)?;
            let norm_data = read_f32_slice(bin, &views, norm_acc, 3)?;
            let uv_data = if let Some(u) = uv_idx {
                let uv_acc = accessors.get(u).ok_or("Invalid TEXCOORD_0 accessor")?;
                read_f32_slice(bin, &views, uv_acc, 2)?
            } else {
                vec![0.0; pos_acc.count * 2]
            };
            let ind_data = read_index_slice(bin, &views, ind_acc)?;
            let color = mat_colors.get(mat_idx).copied().unwrap_or([0.5, 0.5, 0.5, 1.0]);

            let base_v = vertices.len() as u32;
            let v_count = pos_acc.count;
            for i in 0..v_count {
                vertices.push(GpuVertex {
                    pos: [pos_data[i * 3], pos_data[i * 3 + 1], pos_data[i * 3 + 2]],
                    normal: [norm_data[i * 3], norm_data[i * 3 + 1], norm_data[i * 3 + 2]],
                    color,
                    uv: [uv_data[i * 2] + uv_u_offset, uv_data[i * 2 + 1]],
                    stk_flags: [surface_role, 0.0, 1.0, 1.0],
                });
            }
            for idx in ind_data {
                if idx >= v_count as u32 {
                    return Err("Stage GLB index out of bounds".to_string());
                }
                indices.push(base_v.checked_add(idx).ok_or("Stage vertex index overflow")?);
            }
        }
    }

    // String catenary overhead power wires (`_hangWires` in `renderer.js` lines 3293-3315)
    if power_poles.len() >= 2 {
        power_poles.sort_by(|a, b| a[2].partial_cmp(&b[2]).unwrap_or(std::cmp::Ordering::Equal));
        let wire_col = [0.16, 0.15, 0.14, 1.0];
        let wire_points: [[f32; 2]; 3] = [[-0.62, 8.4], [0.62, 8.4], [0.0, 9.0]];
        for n in 1..power_poles.len() {
            let a = power_poles[n - 1];
            let b = power_poles[n];
            let dist_xz = ((b[0] - a[0]).powi(2) + (b[2] - a[2]).powi(2)).sqrt();
            if dist_xz > 120.0 || dist_xz < 2.0 {
                continue;
            }
            for &[lx, ly] in &wire_points {
                let from = [
                    a[0] + lx * a[3].cos(),
                    a[1] + ly,
                    a[2] - lx * a[3].sin(),
                ];
                let to = [
                    b[0] + lx * b[3].cos(),
                    b[1] + ly,
                    b[2] - lx * b[3].sin(),
                ];
                for k in 0..8 {
                    let t0 = (k as f32) / 8.0;
                    let t1 = ((k + 1) as f32) / 8.0;
                    let p0 = [
                        from[0] + (to[0] - from[0]) * t0,
                        from[1] + (to[1] - from[1]) * t0 - 0.7 * 4.0 * t0 * (1.0 - t0),
                        from[2] + (to[2] - from[2]) * t0,
                    ];
                    let p1 = [
                        from[0] + (to[0] - from[0]) * t1,
                        from[1] + (to[1] - from[1]) * t1 - 0.7 * 4.0 * t1 * (1.0 - t1),
                        from[2] + (to[2] - from[2]) * t1,
                    ];
                    let dx = p1[0] - p0[0];
                    let dy = p1[1] - p0[1];
                    let dz = p1[2] - p0[2];
                    let seg_len = (dx * dx + dy * dy + dz * dz).sqrt().max(0.01);
                    let w_yaw = dx.atan2(dz);
                    let w_pitch = -(dy / seg_len).clamp(-1.0, 1.0).asin();
                    push_oriented_box(
                        &mut vertices,
                        &mut indices,
                        [0.5 * (p0[0] + p1[0]), 0.5 * (p0[1] + p1[1]), 0.5 * (p0[2] + p1[2])],
                        [0.025, 0.025, seg_len * 0.52],
                        w_yaw,
                        w_pitch,
                        0.0,
                        wire_col,
                        [0.0, 0.0, 8.4, 0.0],
                    );
                }
            }
        }
    }

    Ok((vertices, indices))
}

#[allow(clippy::too_many_arguments)]
fn push_art_vehicle(
    verts: &mut Vec<GpuVertex>,
    indices: &mut Vec<u32>,
    car_model: &ParsedGlbModel,
    riders_model: Option<&ParsedGlbModel>,
    pos: [f32; 3],
    yaw: f32,
    road_pitch: f32,
    road_roll: f32,
    body_pitch: f32,
    body_roll: f32,
    wheel_steer: f32,
    wheel_spin: f32,
    paint_rgb: [f32; 3],
    braking: bool,
    nitro_flame: f32,
    wind_time: f32,
    passenger_arm: f32,
    passenger_head_yaw: f32,
) {
    let (sy, cy) = yaw.sin_cos();
    let (srp, crp) = (-road_pitch).sin_cos();
    let (srr, crr) = road_roll.sin_cos();
    let (sbp, cbp) = (-body_pitch).sin_cos();
    let (sbr, cbr) = body_roll.sin_cos();

    // Transform a point in the car root's unsprung frame to world space
    let root_to_world = |rx: f32, ry: f32, rz: f32| -> [f32; 3] {
        // Road roll (Z), road pitch (X), yaw (Y)
        let x1 = rx * crr - ry * srr;
        let y1 = rx * srr + ry * crr;
        let z1 = rz;

        let x2 = x1;
        let y2 = y1 * crp - z1 * srp;
        let z2 = y1 * srp + z1 * crp;

        [
            pos[0] + x2 * cy + z2 * sy,
            pos[1] + y2,
            pos[2] - x2 * sy + z2 * cy,
        ]
    };

    let root_dir_to_world = |nx: f32, ny: f32, nz: f32| -> [f32; 3] {
        let x1 = nx * crr - ny * srr;
        let y1 = nx * srr + ny * crr;
        let z1 = nz;
        let x2 = x1;
        let y2 = y1 * crp - z1 * srp;
        let z2 = y1 * srp + z1 * crp;
        [x2 * cy + z2 * sy, y2, -x2 * sy + z2 * cy]
    };

    // Transform a point in the sprung chassis frame (pivoting around BODY_PIVOT_Y) to world space
    let chassis_to_world = |cx: f32, cy_pt: f32, cz: f32| -> [f32; 3] {
        let py = cy_pt - BODY_PIVOT_Y;
        let x1 = cx * cbr - py * sbr;
        let y1 = cx * sbr + py * cbr;
        let z1 = cz;

        let x2 = x1;
        let y2 = (y1 * cbp - z1 * sbp) + BODY_PIVOT_Y;
        let z2 = y1 * sbp + z1 * cbp;
        root_to_world(x2, y2, z2)
    };

    let chassis_dir_to_world = |nx: f32, ny: f32, nz: f32| -> [f32; 3] {
        let x1 = nx * cbr - ny * sbr;
        let y1 = nx * sbr + ny * cbr;
        let z1 = nz;
        let x2 = x1;
        let y2 = y1 * cbp - z1 * sbp;
        let z2 = y1 * sbp + z1 * cbp;
        root_dir_to_world(x2, y2, z2)
    };

    // 0. Road-hugging under-car contact shadow & tire ambient occlusion quad (`role == 11.0`)
    {
        let sh_base = verts.len() as u32;
        let sh_norm = root_dir_to_world(0.0, 1.0, 0.0);
        let sh_corners = [
            (-1.38f32, -2.58f32, [0.0f32, 0.0f32]),
            ( 1.38f32, -2.58f32, [1.0f32, 0.0f32]),
            ( 1.38f32,  2.58f32, [1.0f32, 1.0f32]),
            (-1.38f32,  2.58f32, [0.0f32, 1.0f32]),
        ];
        for &(rx, rz, uv) in &sh_corners {
            verts.push(GpuVertex {
                pos: root_to_world(rx, 0.016, rz),
                normal: sh_norm,
                color: [0.0, 0.0, 0.0, 1.0],
                uv,
                stk_flags: [11.0, 0.0, 0.0, 0.0],
            });
        }
        indices.extend_from_slice(&[
            sh_base,
            sh_base + 2,
            sh_base + 1,
            sh_base,
            sh_base + 3,
            sh_base + 2,
        ]);
    }

    // 1. Emit car nodes (`body` on sprung chassis, `wheel_*` on unsprung root)
    for node in &car_model.nodes {
        let is_wheel = node.name.starts_with("wheel_");
        let is_front_wheel = node.name == "wheel_FL" || node.name == "wheel_FR";
        let hub = node.translation;
        let (sspin, cspin) = wheel_spin.sin_cos();
        let (ssteer, csteer) = if is_front_wheel {
            wheel_steer.sin_cos()
        } else {
            (0.0, 1.0)
        };

        for prim in &node.primitives {
            let base = verts.len() as u32;
            let is_paint = prim.material_name == "paint";
            let is_tail = prim.material_name == "taillight";

            for i in 0..prim.positions.len() {
                let p = prim.positions[i];
                let n = prim.normals[i];

                let (wp, wn) = if is_wheel {
                    // Spin around X, steer around Y, translate to wheel hub
                    let x1 = p[0];
                    let y1 = p[1] * cspin - p[2] * sspin;
                    let z1 = p[1] * sspin + p[2] * cspin;
                    let rx = x1 * csteer + z1 * ssteer + hub[0];
                    let ry = y1 + hub[1];
                    let rz = -x1 * ssteer + z1 * csteer + hub[2];

                    let nx1 = n[0];
                    let ny1 = n[1] * cspin - n[2] * sspin;
                    let nz1 = n[1] * sspin + n[2] * cspin;
                    let rnx = nx1 * csteer + nz1 * ssteer;
                    let rny = ny1;
                    let rnz = -nx1 * ssteer + nz1 * csteer;

                    (root_to_world(rx, ry, rz), root_dir_to_world(rnx, rny, rnz))
                } else {
                    (
                        chassis_to_world(p[0] + hub[0], p[1] + hub[1], p[2] + hub[2]),
                        chassis_dir_to_world(n[0], n[1], n[2]),
                    )
                };

                let color = if is_paint {
                    let ao = prim.vertex_ao[i];
                    [
                        paint_rgb[0] * ao[0],
                        paint_rgb[1] * ao[1],
                        paint_rgb[2] * ao[2],
                        1.0,
                    ]
                } else if is_tail && (braking || nitro_flame > 0.5) {
                    [1.0, 0.16, 0.10, 1.0]
                } else {
                    prim.colors[i]
                };

                verts.push(GpuVertex {
                    pos: wp,
                    normal: wn,
                    color,
                    uv: prim.uvs[i],
                    stk_flags: prim.stk_flags,
                });
            }
            let prim_v_count = prim.positions.len() as u32;
            for &idx in &prim.indices {
                assert!(idx < prim_v_count, "GLB primitive index out of bounds");
                indices.push(base.checked_add(idx).expect("vertex index overflow"));
            }
        }
    }

    // 2. Emit riders (`girl`, `girl_hair`, `girl_ribbon`, `boy`, `boy_scarf`, `boy_wave`/`boy_rest`, `boy_head`)
    if let Some(riders) = riders_model {
        let waving = passenger_arm < 1.05;
        for node in &riders.nodes {
            if node.name == "boy_wave" && !waving {
                continue;
            }
            if node.name == "boy_rest" && waving {
                continue;
            }
            let t = node.translation;
            // Local node rotation (wind flutter on hair/ribbon/scarf, head glance on boy_head)
            let (rx_ang, ry_ang, rz_ang) = match node.name.as_str() {
                "girl_hair" => ((wind_time * 8.0).sin() * 0.14, 0.0, 0.0),
                "girl_ribbon" => ((wind_time * 8.0 + 1.9).sin() * 0.22, 0.0, 0.0),
                "boy_scarf" => (0.0, (wind_time * 8.0 + 3.8).sin() * 0.18, 0.0),
                "boy_head" => (0.0, -passenger_head_yaw, 0.0),
                "boy_wave" => (0.0, 0.0, -passenger_arm),
                _ => (0.0, 0.0, 0.0),
            };
            let (sx, cx) = rx_ang.sin_cos();
            let (sy_n, cy_n) = ry_ang.sin_cos();
            let (sz, cz) = rz_ang.sin_cos();

            for prim in &node.primitives {
                let base = verts.len() as u32;
                for i in 0..prim.positions.len() {
                    let p = prim.positions[i];
                    let n = prim.normals[i];
                    // Rotate around Z, X, Y in node-local space, then add node translation `t`
                    let x1 = p[0] * cz - p[1] * sz;
                    let y1 = p[0] * sz + p[1] * cz;
                    let z1 = p[2];
                    let y2 = y1 * cx - z1 * sx;
                    let z2 = y1 * sx + z1 * cx;
                    let x3 = x1 * cy_n + z2 * sy_n + t[0];
                    let y3 = y2 + t[1];
                    let z3 = -x1 * sy_n + z2 * cy_n + t[2];

                    let wp = chassis_to_world(x3, y3, z3);
                    let wn = chassis_dir_to_world(n[0], n[1], n[2]);

                    verts.push(GpuVertex {
                        pos: wp,
                        normal: wn,
                        color: prim.colors[i],
                        uv: prim.uvs[i],
                        stk_flags: prim.stk_flags,
                    });
                }
                for &idx in &prim.indices {
                    indices.push(base + idx);
                }
            }
        }
    }

    // 3. Nitro exhaust jets (`EXHAUST_X = ±0.36, EXHAUST_Y = 0.26, rearZ = -2.18`)
    //    Sculpted conical Mach-diamond afterburner plumes tucked cleanly into the twin exhaust pipes:
    if nitro_flame > 0.05 {
        let nf = nitro_flame.clamp(0.0, 1.0);
        let pulse_a = (wind_time * 48.0).sin();
        let pulse_b = (wind_time * 74.0 + 1.3).cos();
        for (pipe_idx, ex) in [-0.36f32, 0.36].iter().copied().enumerate() {
            let phase = (pipe_idx as f32) * 1.57;
            let p_nozzle = chassis_to_world(ex, 0.26, -2.17);
            let p_core_mid = chassis_to_world(ex, 0.26, -2.17 - (0.24 + 0.04 * pulse_a) * nf);
            let p_core_tip = chassis_to_world(ex, 0.26, -2.17 - (0.50 + 0.07 * pulse_b) * nf);
            let p_outer_mid = chassis_to_world(
                ex + (wind_time * 36.0 + phase).sin() * 0.015 * nf,
                0.26 + (wind_time * 29.0 + phase).cos() * 0.012 * nf,
                -2.18 - (0.42 + 0.06 * pulse_a) * nf,
            );
            let p_outer_tip = chassis_to_world(
                ex + (wind_time * 31.0 + phase).cos() * 0.025 * nf,
                0.27 + (wind_time * 25.0 + phase).sin() * 0.020 * nf,
                -2.18 - (0.86 + 0.12 * pulse_b) * nf,
            );
            // Blazing white-yellow Mach diamond core
            push_tapered_cylinder(
                verts,
                indices,
                p_nozzle,
                p_core_mid,
                0.048 * nf,
                0.062 * nf,
                10,
                [1.0, 0.96, 0.82, 1.0],
                [9.0, 0.0, 2.5, 0.0],
            );
            push_tapered_cylinder(
                verts,
                indices,
                p_core_mid,
                p_core_tip,
                0.062 * nf,
                0.008 * nf,
                10,
                [1.0, 0.84, 0.38, 1.0],
                [9.0, 0.0, 3.5, 0.0],
            );
            // Outer golden-orange to crimson-amber supersonic flame envelope
            push_tapered_cylinder(
                verts,
                indices,
                p_nozzle,
                p_outer_mid,
                0.064 * nf,
                0.088 * nf,
                10,
                [1.0, 0.62, 0.16, 1.0],
                [9.0, 0.0, 4.2, 0.0],
            );
            push_tapered_cylinder(
                verts,
                indices,
                p_outer_mid,
                p_outer_tip,
                0.088 * nf,
                0.012 * nf,
                10,
                [0.98, 0.32, 0.08, 1.0],
                [9.0, 0.0, 4.8, 0.0],
            );
        }
    }

    // 4. Rear-wheel drift sparks & painted gouache tire smoke puffs (`role == 13.0`) when drifting
    if body_roll.abs() > 0.05 {
        let spark_col = if body_roll.abs() > 0.14 {
            [0.35, 0.92, 1.0, 1.0] // Turbo-charged cyan-gold sparks
        } else {
            [1.0, 0.76, 0.22, 1.0] // Warm amber sparks
        };
        let puff_intensity = ((body_roll.abs() - 0.04) * 8.0).clamp(0.18, 1.0);
        for wx in [-0.78f32, 0.78] {
            for s_idx in 0..4 {
                let sf = s_idx as f32;
                let t = (wind_time * 16.0 + sf * 0.25 + wx).fract();
                let sx = wx + body_roll.signum() * t * 0.45;
                let sy_p = 0.08 + t * (0.28 - 0.22 * t);
                let sz = -1.42 - t * 1.1;
                let sp_pos = root_to_world(sx, sy_p, sz);
                push_oriented_box(
                    verts,
                    indices,
                    sp_pos,
                    [0.035, 0.035, 0.12],
                    yaw,
                    road_pitch,
                    t * 4.0,
                    spark_col,
                    [9.0, 0.0, 3.5, 0.0],
                );
            }
            for p_idx in 0..5 {
                let pf = p_idx as f32;
                let age = (wind_time * 5.2 + pf * 0.20 + wx * 0.37).fract();
                let radius = (0.26 + age * 0.85) * (0.65 + 0.35 * puff_intensity);
                let px = wx + body_roll.signum() * age * 0.95 + (pf * 2.1 + wind_time * 3.0).sin() * 0.14;
                let py = 0.22 + age * 0.68;
                let pz = -1.58 - age * 3.8;
                let p_center = root_to_world(px, py, pz);
                let p_base = verts.len() as u32;
                let alpha = (1.0 - age) * (0.45 + 0.40 * puff_intensity);
                let puff_col = [0.94, 0.92, 0.88, alpha];
                let corners = [
                    (-radius, -radius * 0.78, [0.0f32, 0.0f32]),
                    ( radius, -radius * 0.78, [1.0f32, 0.0f32]),
                    ( radius,  radius * 0.78, [1.0f32, 1.0f32]),
                    (-radius,  radius * 0.78, [0.0f32, 1.0f32]),
                ];
                for &(cx, cy_off, uv) in &corners {
                    verts.push(GpuVertex {
                        pos: [
                            p_center[0] + cx * cy,
                            p_center[1] + cy_off,
                            p_center[2] - cx * sy,
                        ],
                        normal: [0.0, 1.0, 0.0],
                        color: puff_col,
                        uv,
                        stk_flags: [13.0, age, radius, puff_intensity],
                    });
                }
                indices.extend_from_slice(&[
                    p_base,
                    p_base + 1,
                    p_base + 2,
                    p_base,
                    p_base + 2,
                    p_base + 3,
                ]);
            }
        }
    }
}

fn push_cumulus_cloud_banks(
    verts: &mut Vec<GpuVertex>,
    indices: &mut Vec<u32>,
    pose: &PoseBuffer,
) {
    // Sunlit stages have `HERO_HEADLIGHTS_ON (35) < 0.5`
    if pose.floats[35] > 0.5 {
        return;
    }
    let eye = pose.camera_eye();
    let wind_time = pose.floats[2];
    let stage_seed = (pose.stage_num() as u32).wrapping_mul(2654435761) ^ 0x5A17_C3D9;
    let banks: [(f32, usize, f32, [f32; 2], [f32; 2], [f32; 2], f32); 3] = [
        (1300.0, 4, 2.4, [150.0, 280.0], [200.0, 380.0], [95.0, 185.0], 1.8),
        (2200.0, 5, 2.5, [210.0, 380.0], [310.0, 560.0], [145.0, 275.0], 1.1),
        (3400.0, 5, 2.6, [290.0, 510.0], [430.0, 780.0], [205.0, 385.0], 0.6),
    ];

    let mut s = stage_seed;
    let mut next_u01 = || -> f32 {
        s = s.wrapping_add(0x6D2B79F5);
        let mut t = s ^ (s >> 15);
        t = t.wrapping_mul(1 | s);
        t = (t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t))) ^ t;
        ((t ^ (t >> 14)) as f32) / 4294967296.0
    };

    for (b_idx, &(dist, count, span, y_range, w_range, h_range, drift)) in banks.iter().enumerate() {
        for i in 0..count {
            let u_ang = next_u01();
            let u_y = next_u01();
            let u_w = next_u01();
            let u_h = next_u01();
            let base_ang = ((i as f32 + 0.15 + u_ang * 0.7) / (count as f32) - 0.5) * span;
            let ang = base_ang + (wind_time * drift) / dist;
            let (sa, ca) = ang.sin_cos();
            let cx = eye[0] + sa * dist;
            let cy = y_range[0] + u_y * (y_range[1] - y_range[0]);
            let cz = eye[2] + ca * dist;
            let half_w = 0.5 * (w_range[0] + u_w * (w_range[1] - w_range[0]));
            let half_h = 0.5 * (h_range[0] + u_h * (h_range[1] - h_range[0]));
            // Billboard tangent right vector perpendicular to view ray `(sa, 0, ca)`
            let rx = ca;
            let rz = -sa;
            let base = verts.len() as u32;
            let seed_phase = (b_idx as f32) * 1.7 + (i as f32) * 0.83;
            let corners = [
                (-half_w, -half_h, [0.0f32, 0.0f32]),
                ( half_w, -half_h, [1.0f32, 0.0f32]),
                ( half_w,  half_h, [1.0f32, 1.0f32]),
                (-half_w,  half_h, [0.0f32, 1.0f32]),
            ];
            for &(ox, oy, uv) in &corners {
                verts.push(GpuVertex {
                    pos: [cx + ox * rx, cy + oy, cz + ox * rz],
                    normal: [-sa, 0.18, -ca],
                    color: [0.98, 0.95, 0.86, 1.0],
                    uv,
                    stk_flags: [12.0, seed_phase, half_h, b_idx as f32],
                });
            }
            indices.extend_from_slice(&[
                base,
                base + 1,
                base + 2,
                base,
                base + 2,
                base + 3,
            ]);
        }
    }
}

fn push_art_flagman(
    verts: &mut Vec<GpuVertex>,
    indices: &mut Vec<u32>,
    flagman_model: &ParsedGlbModel,
    pos: [f32; 3],
    yaw: f32,
    arm_angle: f32,
    flag_angle: f32,
) {
    let (sy, cy) = yaw.sin_cos();
    let arm_rot_z = -arm_angle;
    let flag_rot_z = -flag_angle;
    let (sa, ca) = arm_rot_z.sin_cos();
    let (sf, cf) = flag_rot_z.sin_cos();

    let shoulder = [0.30f32, 1.38f32, 0.0f32];
    let hand_rel = [0.0f32, -0.60f32, 0.0f32];

    for node in &flagman_model.nodes {
        for prim in &node.primitives {
            let base = verts.len() as u32;
            for i in 0..prim.positions.len() {
                let p = prim.positions[i];
                let n = prim.normals[i];

                let (mx, my, mz, nx, ny, nz) = match node.name.as_str() {
                    "arm_R" => {
                        let rx = p[0] * ca - p[1] * sa + shoulder[0];
                        let ry = p[0] * sa + p[1] * ca + shoulder[1];
                        let rz = p[2] + shoulder[2];
                        let rnx = n[0] * ca - n[1] * sa;
                        let rny = n[0] * sa + n[1] * ca;
                        (rx, ry, rz, rnx, rny, n[2])
                    }
                    "flag" => {
                        // Rotate in flag frame by `flag_rot_z`, add `hand_rel`, then rotate by `arm_rot_z` and add `shoulder`
                        let fx = p[0] * cf - p[1] * sf + hand_rel[0];
                        let fy = p[0] * sf + p[1] * cf + hand_rel[1];
                        let fz = p[2] + hand_rel[2];
                        let rx = fx * ca - fy * sa + shoulder[0];
                        let ry = fx * sa + fy * ca + shoulder[1];
                        let rz = fz + shoulder[2];
                        let fnx = n[0] * cf - n[1] * sf;
                        let fny = n[0] * sf + n[1] * cf;
                        let rnx = fnx * ca - fny * sa;
                        let rny = fnx * sa + fny * ca;
                        (rx, ry, rz, rnx, rny, n[2])
                    }
                    _ => (
                        p[0] + node.translation[0],
                        p[1] + node.translation[1],
                        p[2] + node.translation[2],
                        n[0],
                        n[1],
                        n[2],
                    ),
                };

                let wx = pos[0] + mx * cy + mz * sy;
                let wy = pos[1] + my;
                let wz = pos[2] - mx * sy + mz * cy;
                let wnx = nx * cy + nz * sy;
                let wnz = -nx * sy + nz * cy;

                verts.push(GpuVertex {
                    pos: [wx, wy, wz],
                    normal: [wnx, ny, wnz],
                    color: prim.colors[i],
                    uv: prim.uvs[i],
                    stk_flags: prim.stk_flags,
                });
            }
            let prim_v_count = prim.positions.len() as u32;
            for &idx in &prim.indices {
                assert!(idx < prim_v_count, "GLB primitive index out of bounds");
                indices.push(base.checked_add(idx).expect("vertex index overflow"));
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn push_sports_car(
    verts: &mut Vec<GpuVertex>,
    indices: &mut Vec<u32>,
    pos: [f32; 3],
    yaw: f32,
    pitch: f32,
    roll: f32,
    wheel_steer: f32,
    wheel_spin: f32,
    body_color: [f32; 4],
    _is_hero: bool,
    nitro_flame: f32,
    braking: bool,
) {
    let (sy, cy) = yaw.sin_cos();
    let local_to_world = |lx: f32, ly: f32, lz: f32| -> [f32; 3] {
        let py = ly - BODY_PIVOT_Y;
        let x1 = lx * roll.cos() - py * roll.sin();
        let y1 = (lx * roll.sin() + py * roll.cos()) + BODY_PIVOT_Y;
        let y2 = y1 * pitch.cos() - lz * pitch.sin();
        let z2 = y1 * pitch.sin() + lz * pitch.cos();
        [
            pos[0] + x1 * cy + z2 * sy,
            pos[1] + y2,
            pos[2] - x1 * sy + z2 * cy,
        ]
    };
    let chassis_c = local_to_world(0.0, 0.42, 0.0);
    push_oriented_box(
        verts,
        indices,
        chassis_c,
        [0.96, 0.24, 2.05],
        yaw,
        pitch,
        roll,
        body_color,
        [8.0, 0.0, 1.2, 0.0],
    );
    let tail_col = if braking || nitro_flame > 0.5 {
        [1.0, 0.18, 0.08, 1.0]
    } else {
        [0.85, 0.10, 0.08, 1.0]
    };
    for lx in [-0.68f32, 0.68] {
        let tc = local_to_world(lx, 0.49, -2.09);
        push_oriented_box(
            verts,
            indices,
            tc,
            [0.09, 0.08, 0.03],
            yaw,
            pitch,
            roll,
            tail_col,
            [9.0, 0.0, 2.0, 0.0],
        );
    }
    let _ = (wheel_steer, wheel_spin);
}

/// Build the per-frame dynamic 3D geometry (Hero `car-hero/lod0` + `riders/lod0`, Rival car,
/// civilian Traffic `car-sedan`/`car-convertible`/`car-pickup`/`car-boxtruck`, and `flagman/lod0`)
/// from the 186-float `PoseBuffer`.
pub fn build_dynamic_frame_geometry(pose: &PoseBuffer) -> (Vec<GpuVertex>, Vec<u32>) {
    let art_lib = ArtPackLibrary::global();
    let mut verts = Vec::with_capacity(131_072);
    let mut indices = Vec::with_capacity(262_144);
    let wind_time = pose.floats[2];
    let cam_z = pose.camera_eye()[2];

    // 1. Hero Car (`model/car-hero/lod0` + `model/riders/lod0`)
    if let Some(hero_car) = art_lib.get("model/car-hero/lod0") {
        let riders = art_lib.get("model/riders/lod0");
        push_art_vehicle(
            &mut verts,
            &mut indices,
            hero_car,
            riders,
            pose.hero_pos(),
            pose.hero_yaw(),
            pose.floats[24],
            pose.floats[25],
            pose.hero_body_pitch(),
            pose.hero_body_roll(),
            pose.hero_wheel_steer(),
            pose.hero_wheel_spin(),
            [0.835, 0.0, 0.0], // #D50000 Rosso Corsa Red
            false,
            pose.floats[34],
            wind_time,
            pose.floats[36],
            pose.floats[37],
        );
    } else {
        push_sports_car(
            &mut verts,
            &mut indices,
            pose.hero_pos(),
            pose.hero_yaw(),
            pose.floats[24] + pose.hero_body_pitch(),
            pose.hero_body_roll(),
            pose.hero_wheel_steer(),
            pose.hero_wheel_spin(),
            [0.90, 0.12, 0.14, 1.0],
            true,
            pose.floats[34],
            false,
        );
    }

    // 2. Rival Car (`RIVAL_ACTIVE = 42`, painted #FFB300 Giallo Modena Yellow)
    if pose.floats[42] > 0.5 {
        let r_pos = [pose.floats[43], pose.floats[44], pose.floats[45]];
        let dist = (r_pos[2] - cam_z).abs();
        if dist < 280.0 {
            let rival_car = art_lib
                .get("model/car-hero/lod0")
                .or_else(|| art_lib.get("model/car-convertible/lod0"));
            if let Some(rc) = rival_car {
                let riders = art_lib.get("model/riders/lod0");
                push_art_vehicle(
                    &mut verts,
                    &mut indices,
                    rc,
                    riders,
                    r_pos,
                    pose.floats[46],
                    pose.floats[47],
                    pose.floats[48],
                    0.0,
                    0.0,
                    0.0,
                    pose.floats[49],
                    [1.0, 0.702, 0.0], // #FFB300
                    false,
                    0.0,
                    wind_time + 3.7,
                    1.15,
                    0.0,
                );
            }
        }
    }

    // 3. Civilian Traffic Cars & AI Karts (12 slots at `90..186`) using the 4 80s pack bodies and fixed per-ID paint colors
    let traffic_colors: [[f32; 3]; 9] = [
        [0.898, 0.224, 0.208], // 0: #E53935 Red
        [0.118, 0.533, 0.898], // 1: #1E88E5 Blue
        [0.263, 0.627, 0.278], // 2: #43A047 Green
        [0.984, 0.549, 0.000], // 3: #FB8C00 Orange
        [0.992, 0.847, 0.208], // 4: #FDD835 Yellow
        [0.557, 0.141, 0.667], // 5: #8E24AA Purple (`gnu` & traffic slot 5)
        [0.960, 0.960, 0.960], // 6: #FFFFFF White
        [0.259, 0.259, 0.259], // 7: #424242 Charcoal
        [0.000, 0.537, 0.482], // 8: #00897B Emerald (`suzanne`)
    ];
    let traffic_model_ids = [
        "model/car-sedan/lod0",
        "model/car-convertible/lod0",
        "model/car-pickup/lod0",
        "model/car-boxtruck/lod0",
    ];

    for i in 0..MAX_TRAFFIC_CARS {
        let base = 90 + i * TRAFFIC_STRIDE;
        if pose.floats[base] > 0.5 {
            let pos = [pose.floats[base + 2], pose.floats[base + 3], pose.floats[base + 4]];
            if (pos[2] - cam_z).abs() > 260.0 {
                continue;
            }
            let code = pose.floats[base + 1].round().max(0.0) as usize;
            let type_idx = (code & 7) % traffic_model_ids.len();
            let color_idx = (code >> 3) % traffic_colors.len();
            let yaw = pose.floats[base + 5];
            let spin = pose.floats[base + 6];
            let road_pitch = pose.floats[base + 7];
            let braking = pose.floats[base] > 1.5;

            if let Some(t_model) = art_lib.get(traffic_model_ids[type_idx]) {
                push_art_vehicle(
                    &mut verts,
                    &mut indices,
                    t_model,
                    None,
                    pos,
                    yaw,
                    road_pitch,
                    0.0,
                    0.0,
                    0.0,
                    0.0,
                    spin,
                    traffic_colors[color_idx],
                    braking,
                    0.0,
                    wind_time,
                    1.15,
                    0.0,
                );
            } else {
                let c = traffic_colors[color_idx];
                push_sports_car(
                    &mut verts,
                    &mut indices,
                    pos,
                    yaw,
                    road_pitch,
                    0.0,
                    0.0,
                    spin,
                    [c[0], c[1], c[2], 1.0],
                    false,
                    0.0,
                    braking,
                );
            }
        }
    }

    // 4. Starting-Grid Flagman (`MARSHAL_X = 54..57`, `model/flagman/lod0`)
    let mx = pose.floats[54];
    let my = pose.floats[55];
    let mz = pose.floats[56];
    let myaw = pose.floats[57];
    if (mx.abs() + mz.abs()) > 0.01 && (mz - cam_z).abs() < 120.0 {
        if let Some(flagman) = art_lib.get("model/flagman/lod0") {
            push_art_flagman(
                &mut verts,
                &mut indices,
                flagman,
                [mx, my, mz],
                myaw,
                pose.marshal_arm(),
                pose.marshal_flag(),
            );
        }
    }

    // 5. World-Anchored 3D Cumulus Cloud Banks (`role == 12.0`)
    push_cumulus_cloud_banks(&mut verts, &mut indices, pose);

    (verts, indices)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn art_pack_library_loads_glb_models_and_builds_detailed_vehicle_mesh() {
        let lib = ArtPackLibrary::global();
        let hero = lib
            .get("model/car-hero/lod0")
            .expect("model/car-hero/lod0 must load from .seed-assets");
        assert!(
            hero.nodes.len() >= 5,
            "car-hero/lod0 should have chassis + 4 wheel nodes"
        );
        let riders = lib
            .get("model/riders/lod0")
            .expect("model/riders/lod0 must load from .seed-assets");
        assert!(
            riders.nodes.len() >= 3,
            "riders/lod0 should have driver/passenger/hair/head nodes"
        );
        let flagman = lib
            .get("model/flagman/lod0")
            .expect("model/flagman/lod0 must load from .seed-assets");
        assert!(
            flagman.nodes.iter().any(|n| n.name == "arm_R"),
            "flagman/lod0 should contain arm_R node"
        );
        // Verify that pine trees, bushes, and rocks all have valid GPU Mega-Atlas tiles (< 64)
        for id in [
            "model/tree-fir-a/lod0",
            "model/tree-fir-b/lod0",
            "model/tree-pine-young/lod0",
            "model/shrub-b/lod0",
            "model/shrub-tropical/lod0",
            "model/shrub-desert/lod0",
            "model/rock-granite-a/lod0",
            "model/rock-lime-a/lod0",
            "model/rock-sand-a/lod0",
        ] {
            let mdl = lib.get(id).unwrap_or_else(|| panic!("{id} must load"));
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            {
                let has_atlas = mdl.nodes.iter().any(|n| n.primitives.iter().any(|p| p.stk_flags[3] >= 3.5));
                assert!(has_atlas, "{id} must have a valid GPU Mega-Atlas tile (stk_flags[3] >= 3.5)");
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios")))]
            {
                let is_painted = mdl.nodes.iter().any(|n| n.primitives.iter().any(|p| p.stk_flags[3] >= 1.5));
                assert!(is_painted, "{id} must carry painted gouache material flags (stk_flags[3] >= 1.5)");
            }
        }

        let mut pose = PoseBuffer::default();
        pose.floats[27] = 0.12; // hero body roll (drifting)
        pose.floats[42] = 1.0; // rival active
        pose.floats[54] = -5.8; // marshal X
        pose.floats[56] = 10.5; // marshal Z
        pose.floats[90] = 1.0; // traffic slot 0 active
        pose.floats[91] = 2.0 + 3.0 * 8.0; // pickup, orange
        let (verts, indices) = build_dynamic_frame_geometry(&pose);
        assert!(
            verts.len() > 2_000 && indices.len() > 6_000,
            "detailed .glb vehicle & flagman meshes should exceed 2,000 vertices (got {} verts, {} indices)",
            verts.len(),
            indices.len()
        );
        let cloud_verts = verts.iter().filter(|v| (v.stk_flags[0] - 12.0).abs() < 0.01).count();
        let puff_verts = verts.iter().filter(|v| (v.stk_flags[0] - 13.0).abs() < 0.01).count();
        assert_eq!(cloud_verts, 14 * 4, "3-bank 3D cumulus cloud cards should emit 14 quads (56 vertices)");
        assert!(puff_verts >= 40, "drifting hero car should emit gouache drift smoke puff quads");

        pose.floats[35] = 1.0; // headlights on (night stage)
        let (night_verts, _) = build_dynamic_frame_geometry(&pose);
        let night_clouds = night_verts.iter().filter(|v| (v.stk_flags[0] - 12.0).abs() < 0.01).count();
        assert_eq!(night_clouds, 0, "night stages must suppress cumulus cloud cards");
    }

    #[test]
    fn partition_indices_into_z_chunks_conserves_triangles_and_bounds() {
        let mk_v = |z: f32| GpuVertex {
            pos: [0.0, 0.0, z],
            normal: [0.0, 1.0, 0.0],
            color: [1.0, 1.0, 1.0, 1.0],
            uv: [0.0, 0.0],
            stk_flags: [0.0; 4],
        };
        let verts = vec![
            mk_v(-395.0),
            mk_v(-380.0),
            mk_v(-360.0), // tri 0: negative lead-in bucket
            mk_v(500.0),
            mk_v(510.0),
            mk_v(520.0), // tri 1: out-of-order far bucket
            mk_v(-10.0),
            mk_v(15.0),
            mk_v(260.0), // tri 2: large spanning ribbon across buckets
            mk_v(-390.0),
            mk_v(-375.0),
            mk_v(-350.0), // tri 3: same negative lead-in bucket as tri 0
        ];
        let orig_indices: Vec<u32> = (0..12).collect();
        let mut indices = orig_indices.clone();
        let chunks = partition_indices_into_z_chunks(&verts, &mut indices);
        assert_eq!(chunks.len(), 3, "4 triangles across 3 buckets should produce 3 chunks");

        let mut expected_tris: Vec<[u32; 3]> = orig_indices
            .chunks_exact(3)
            .map(|t| [t[0], t[1], t[2]])
            .collect();
        let mut actual_tris: Vec<[u32; 3]> = indices
            .chunks_exact(3)
            .map(|t| [t[0], t[1], t[2]])
            .collect();
        expected_tris.sort_unstable();
        actual_tris.sort_unstable();
        assert_eq!(actual_tris, expected_tris, "triangle multiset must be conserved");

        let mut cursor = 0u32;
        for ch in &chunks {
            assert_eq!(ch.index_offset, cursor, "chunks must be contiguous");
            assert!(ch.index_count > 0 && ch.index_count % 3 == 0);
            let start = ch.index_offset as usize;
            let end = start + ch.index_count as usize;
            for &vi in &indices[start..end] {
                let z = verts[vi as usize].pos[2];
                assert!(
                    z >= ch.z_min && z <= ch.z_max,
                    "vertex z={z} outside chunk bounds [{}, {}]",
                    ch.z_min,
                    ch.z_max
                );
            }
            cursor += ch.index_count;
        }
        assert_eq!(cursor as usize, indices.len());
    }
}


