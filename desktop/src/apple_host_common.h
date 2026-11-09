// Shared Apple Native Host Infrastructure (`macos_host.m` + `ios_host.m`):
//   - C-ABI structs (`GpuVertexC`, `SceneUniformsC`, `MacHudSnapshotC`, `StagePaletteC`) & Rust FFI externs
//   - Metal 3D shader source (`kApexMetalShaderSource`: `sky_vs`, `sky_fs`, `stage_vs`, `stage_fs`)
//   - Left-handed camera matrix math (`mat4_perspective`, `mat4_look_at_lh`, `mat4_mul`)
//   - CoreAudio 48 kHz stereo `AudioQueue` output stream (`start_coreaudio_stream`)
//   - Seed asset locator (`locateSeedAssetsDirectory`) & `CGImage` unpremultiplied texture loader (`apexLoadSeedTexture`)
//   - Shared Metal pipeline setup (`apexSetupMetalPipelines`) & 2-pass scene encoder (`apexEncodeSceneRenderPass`)

#ifndef APEX_APPLE_HOST_COMMON_H
#define APEX_APPLE_HOST_COMMON_H

#import <AudioToolbox/AudioToolbox.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <JavaScriptCore/JavaScriptCore.h>
#import <Metal/Metal.h>
#import <MetalKit/MetalKit.h>
#import <QuartzCore/QuartzCore.h>
#include <math.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

typedef struct {
    float pos[3];
    float normal[3];
    float color[4];
    float uv[2];
    float stk_flags[4];
} GpuVertexC;

typedef struct {
    float view_proj[16];
    float sun_view_proj[16];
    float camera_eye[4];   // xyz = eye, w = tanHalfFov
    float sun_dir[4];      // xyz = sunDir (native world), w = skyTurn
    float haze_params[4];  // [stageHaze, hazeDensity, windTime, aspect]
    float cam_forward[4];  // xyz = forward, w = nitroActive
    float cam_right[4];    // xyz = right, w = speedBlur
    float cam_up[4];       // xyz = up, w = hasSun (1.0 or 0.0)
    float horizon_col[4];  // rgb = horizonSrgb, w = hasSkyTex (1.0 or 0.0)
    float toon_sun[4];     // rgb = toonSun (sRGB), w = hasFarTex
    float toon_shade[4];   // rgb = toonShade (sRGB), w = hasMidTex
    float sun_col[4];      // rgb = sunColor (sRGB), w = groundTile
} SceneUniformsC;

typedef struct {
    uint32_t show_title_card;
    uint32_t show_pause_card;
    uint32_t show_result_card;
    uint32_t is_paused;
    uint32_t is_muted;
    uint32_t gear;
    uint32_t nitro_state;
    uint32_t nitro_charges;
    uint32_t pyramid_node_index;
    float nitro_ratio;
    float tacho_ratio;
    float route_progress;
    float rival_fill;
    float volume;
    float eq_bands[6];
    char stage_label[64];
    char checkpoint_code[32];
    char score_label[32];
    char timer_label[32];
    char speed_label[32];
    char rpm_label[32];
    char nitro_label[32];
    char velo_mode_label[32];
    char drift_label[64];
    char matrix_fork_label[64];
    char branch_left_label[64];
    char branch_right_label[64];
    char rival_header_label[32];
    char rival_gap_label[32];
    char radar_label[32];
    char gforce_label[32];
    char slipstream_label[32];
    char station_label[64];
    char rival_label[64];
    char telemetry_label[96];
    char banner_label[64];
    char result_summary[128];
} MacHudSnapshotC;

typedef struct {
    const char *sky_file;
    const char *far_file;
    const char *mid_file;
    const char *ground_file;
    float ground_tile;
    float turn;
    float sun_dir[3];    // Native left-handed world [-sx_three, sy_three, sz_three]
    float horizon_srgb[3];
    float toon_sun[3];   // sRGB cel-shading sun highlight
    float toon_shade[3]; // sRGB cel-shading sky shadow
    float sun_col[3];
    float has_sun;
} StagePaletteC;

typedef struct {
    float z_min;
    float z_max;
    uint32_t index_offset;
    uint32_t index_count;
} StaticChunkC;

extern bool apexrun_rust_init(const char **sim_js_ptr, size_t *sim_js_len);
extern void apexrun_rust_get_winio_spec_json(const char **json_ptr, size_t *json_len);
extern void apexrun_rust_get_static_mesh(
    const GpuVertexC **verts_out,
    size_t *vert_count_out,
    const uint32_t **indices_out,
    size_t *index_count_out
);
extern void apexrun_rust_get_static_chunks(
    const StaticChunkC **chunks_out,
    size_t *chunk_count_out
);
extern bool apexrun_rust_load_stage_glb(const uint8_t *glb_bytes, size_t glb_len);
extern void apexrun_rust_on_action(const char *action_cstr, float float_arg);
extern void apexrun_rust_sync_frame(
    const float *pose_floats,
    const char *stage_state_cstr,
    const char *track_name_cstr,
    int32_t off_road,
    int32_t on_curb,
    const char *events_cstr,
    const GpuVertexC **dyn_verts_out,
    size_t *dyn_vert_count_out,
    const uint32_t **dyn_indices_out,
    size_t *dyn_index_count_out,
    MacHudSnapshotC *hud_out
);
extern void apexrun_rust_render_audio(float *out_stereo, size_t frames);
extern void apexrun_rust_get_stage_palette(const char *stage_id_cstr, StagePaletteC *out_palette);
extern const uint8_t *apexrun_rust_get_prop_atlas(uint32_t *out_width, uint32_t *out_height);

static inline StagePaletteC stagePaletteForId(NSString *stageId) {
    StagePaletteC pal = {0};
    const char *cstr = (stageId.length > 0) ? stageId.UTF8String : "coconut-beach";
    apexrun_rust_get_stage_palette(cstr, &pal);
    return pal;
}

static NSString *const kApexMetalShaderSource = @""
"#include <metal_stdlib>\n"
"using namespace metal;\n"
"\n"
"struct GpuVertex {\n"
"    packed_float3 pos;\n"
"    packed_float3 normal;\n"
"    packed_float4 color;\n"
"    packed_float2 uv;\n"
"    packed_float4 stk_flags;\n"
"};\n"
"\n"
"struct SceneUniforms {\n"
"    float4x4 viewProj;\n"
"    float4x4 sunViewProj;\n"
"    float4 cameraEye;   // xyz = eye, w = tanHalfFov\n"
"    float4 sunDir;      // xyz = sunDir, w = skyTurn\n"
"    float4 hazeParams;  // x = stageHaze, y = hazeDensity, z = windTime, w = aspect\n"
"    float4 camForward;  // xyz = forward, w = nitroActive\n"
"    float4 camRight;    // xyz = right, w = speedBlur\n"
"    float4 camUp;       // xyz = up, w = hasSun\n"
"    float4 horizonCol;  // rgb = horizonSrgb, w = hasSkyTex\n"
"    float4 toonSun;     // rgb = toonSun, w = hasFarTex\n"
"    float4 toonShade;   // rgb = toonShade, w = hasMidTex\n"
"    float4 sunCol;      // rgb = sunColor, w = groundTile\n"
"};\n"
"\n"
"float stkHash21(float2 p) {\n"
"    float3 p3 = fract(float3(p.xyx) * 0.1031);\n"
"    p3 += dot(p3, p3.yzx + 33.33);\n"
"    return fract((p3.x + p3.y) * p3.z);\n"
"}\n"
"\n"
"float stkCells(float2 p) {\n"
"    float2 i = floor(p);\n"
"    float2 f = fract(p);\n"
"    float best = 1.0;\n"
"    for (int y = -1; y <= 1; y++) {\n"
"        for (int x = -1; x <= 1; x++) {\n"
"            float2 n = float2(float(x), float(y));\n"
"            float h = stkHash21(i + n);\n"
"            float2 c = n + float2(h, fract(h * 17.3)) * 0.7 - f;\n"
"            best = min(best, dot(c, c));\n"
"        }\n"
"    }\n"
"    return smoothstep(0.05, 0.55, sqrt(best));\n"
"}\n"
"\n"
"float stkBrushTone(float3 worldPos, float3 normalW) {\n"
"    float3 an = abs(normalW);\n"
"    float2 uv = (an.x > an.y && an.x > an.z) ? worldPos.zy :\n"
"                (an.z > an.y) ? worldPos.xy : worldPos.xz;\n"
"    float2 st = uv * float2(1.4, 5.2);\n"
"    float n1 = sin(st.x * 3.7 + cos(st.y * 1.9)) * 0.5 + 0.5;\n"
"    float n2 = stkHash21(floor(st * 2.0));\n"
"    return mix(n1, n2, 0.35) - 0.5;\n"
"}\n"
"\n"
"// Contrast-preserving filmic highlight shoulder: keeps darks & midtones rich while rolling off HDR > 1.0\n"
"float3 stkFilmicShoulder(float3 x) {\n"
"    float3 c = max(x, float3(0.0));\n"
"    float3 toe = pow(c, float3(1.08));\n"
"    return toe / (float3(1.0) + max(toe - float3(0.72), float3(0.0)) * 0.78);\n"
"}\n"
"\n"
"// Deterministic projected roadside palm-trunk & swaying frond-canopy shadow mask on road/verge\n"
"float stkRoadsideTreeShadow(float3 worldPos, float3 sunDir, float windT) {\n"
"    if (sunDir.y < 0.04) return 1.0;\n"
"    // Cast ray from road point toward sun to see if it intersects the left/right palm tree avenue\n"
"    float zProj = worldPos.z - worldPos.x * (sunDir.z / sign(sunDir.x) / max(abs(sunDir.x), 0.18));\n"
"    float cellZ = zProj * 0.11;\n"
"    float trunkIdx = floor(cellZ);\n"
"    float fz = fract(cellZ) - 0.5;\n"
"    float h = stkHash21(float2(trunkIdx, 3.7));\n"
"    // Slanted palm trunk shadow band across the lanes\n"
"    float trunkShadow = smoothstep(0.095, 0.018, abs(fz - (h - 0.5) * 0.18)) * smoothstep(22.0, 2.0, abs(worldPos.x));\n"
"    // Dappled swaying frond-rosette shadow canopy\n"
"    float2 canopyUv = float2(worldPos.x * 0.22 + sin(windT * 2.2 + trunkIdx) * 0.12, zProj * 0.24);\n"
"    float frondRosette = stkCells(canopyUv) * 0.65 + stkCells(canopyUv * 2.1 + 3.4) * 0.35;\n"
"    float sideReach = smoothstep(5.0, -13.5, worldPos.x * sign(sunDir.x));\n"
"    float canopyShadow = smoothstep(0.46, 0.76, frondRosette) * sideReach;\n"
"    return 1.0 - clamp(max(trunkShadow * 0.64, canopyShadow * 0.54), 0.0, 0.68);\n"
"}\n"
"\n"
"// Sample equirectangular painted sky dome along a 3D world direction (`dirW`)\n"
"float3 stkSampleSkyEnv(\n"
"    float3 dirW,\n"
"    constant SceneUniforms &u,\n"
"    texture2d<float> skyTex,\n"
"    sampler skySampler\n"
") {\n"
"    float3 dThree = float3(-dirW.x, max(dirW.y, -0.15), dirW.z);\n"
"    float3 horizonCol = u.horizonCol.rgb;\n"
"    if (u.horizonCol.w < 0.5) {\n"
"        return mix(horizonCol, u.toonSun.rgb, clamp(dThree.y * 0.6 + 0.3, 0.0, 1.0));\n"
"    }\n"
"    float vSky = acos(clamp(dThree.y, -1.0, 1.0)) / 3.14159265;\n"
"    float phi = atan2(-dThree.z, dThree.x) + u.sunDir.w;\n"
"    float uSky = fract(phi / 6.2831853 + 0.5);\n"
"    float3 texSky = skyTex.sample(skySampler, float2(uSky, clamp(vSky, 0.002, 0.998))).rgb;\n"
"    float3 env = mix(horizonCol, texSky, smoothstep(-0.04, 0.22, dThree.y));\n"
"    if (u.camUp.w > 0.5) {\n"
"        float sunAlign = clamp(dot(normalize(dirW), normalize(u.sunDir.xyz)), 0.0, 1.0);\n"
"        env += u.sunCol.rgb * pow(sunAlign, 6.0) * 0.45;\n"
"    }\n"
"    return env;\n"
"}\n"
"\n"
"struct SkyOut {\n"
"    float4 position [[position]];\n"
"    float2 uv;\n"
"};\n"
"\n"
"vertex SkyOut sky_vs(uint vid [[vertex_id]]) {\n"
"    float2 positions[3] = { float2(-1.0, -1.0), float2(3.0, -1.0), float2(-1.0, 3.0) };\n"
"    SkyOut out;\n"
"    out.position = float4(positions[vid], 0.9999, 1.0);\n"
"    out.uv = positions[vid] * 0.5 + 0.5;\n"
"    return out;\n"
"}\n"
"\n"
"fragment float4 sky_fs(\n"
"    SkyOut in [[stage_in]],\n"
"    constant SceneUniforms &u [[buffer(0)]],\n"
"    texture2d<float> skyTex [[texture(0)]],\n"
"    texture2d<float> farTex [[texture(1)]],\n"
"    texture2d<float> midTex [[texture(2)]],\n"
"    sampler skySampler [[sampler(0)]]\n"
") {\n"
"    float ndcX = in.uv.x * 2.0 - 1.0;\n"
"    float ndcY = in.uv.y * 2.0 - 1.0;\n"
"    float tanHalfFov = max(u.cameraEye.w, 0.35);\n"
"    float aspect = max(u.hazeParams.w, 1.0);\n"
"    float3 worldRay = normalize(u.camForward.xyz + u.camRight.xyz * (ndcX * aspect * tanHalfFov) + u.camUp.xyz * (ndcY * tanHalfFov));\n"
"    // Three.js right-handed direction (-X relative to native left-handed world)\n"
"    float3 dThree = float3(-worldRay.x, worldRay.y, worldRay.z);\n"
"    float3 sunDirW = normalize(u.sunDir.xyz);\n"
"    float cosSun = clamp(dot(worldRay, sunDirW), 0.0, 1.0);\n"
"    bool isGoldenHour = (u.camUp.w > 0.5 && u.sunDir.y < 0.18);\n"
"    float3 horizonCol = isGoldenHour\n"
"        ? mix(float3(0.58, 0.46, 0.48), float3(0.96, 0.56, 0.24), pow(cosSun, 1.6))\n"
"        : u.horizonCol.rgb;\n"
"    float3 col = horizonCol;\n"
"\n"
"    // Sample Kazuo Oga 2048x1024 painted gouache sky dome (`SKY_GLSL` in renderer.js)\n"
"    if (u.horizonCol.w > 0.5) {\n"
"        float vSky = acos(clamp(dThree.y, -1.0, 1.0)) / 3.14159265;\n"
"        float phi = atan2(-dThree.z, dThree.x) + u.sunDir.w;\n"
"        float uSky = fract(phi / 6.2831853 + 0.5);\n"
"        float3 texSky = skyTex.sample(skySampler, float2(uSky, clamp(vSky, 0.002, 0.998))).rgb;\n"
"        float elev = clamp(dThree.y, 0.0, 1.0);\n"
"        if (isGoldenHour) {\n"
"            // Dramatic dusky twilight slate-indigo upper sky + warm golden cloud undersides (`2026-10-16-stitch-outrun-vision.png`)\n"
"            float cloudLuma = dot(texSky, float3(0.299, 0.587, 0.114));\n"
"            float3 duskSlate = mix(float3(0.20, 0.25, 0.38), float3(0.42, 0.38, 0.52), smoothstep(0.38, 0.78, cloudLuma));\n"
"            float3 warmCloudRim = float3(0.98, 0.62, 0.30) * smoothstep(0.52, 0.85, cloudLuma) * pow(cosSun, 2.2) * (1.0 - smoothstep(0.05, 0.42, elev));\n"
"            float3 gradedSky = mix(texSky * float3(0.96, 0.68, 0.46), duskSlate + warmCloudRim, smoothstep(0.02, 0.26, elev));\n"
"            col = mix(horizonCol, gradedSky, smoothstep(0.0, 0.09, elev));\n"
"        } else {\n"
"            col = mix(horizonCol, texSky, smoothstep(0.0, 0.09, elev));\n"
"        }\n"
"    }\n"
"\n"
"    // Golden-hour Mie atmospheric scattering + HDR sun disc & corona\n"
"    if (u.camUp.w > 0.5) {\n"
"        float disc = smoothstep(0.9982, 0.9995, cosSun);\n"
"        float innerCorona = pow(cosSun, 56.0) * 1.10;\n"
"        float mieScatter = pow(cosSun, 7.0) * 0.42 * exp(-max(dThree.y, 0.0) * 4.5);\n"
"        float aboveH = smoothstep(-0.03, 0.04, dThree.y);\n"
"        float3 warmAmber = float3(1.0, 0.56, 0.18);\n"
"        col += (u.sunCol.rgb * (disc * 2.2 + innerCorona) + warmAmber * mieScatter) * aboveH;\n"
"    }\n"
"\n"
"    // Cylindrical horizon backdrops (`BACKDROP_GLSL` far & mid layers in renderer.js)\n"
"    // Anchored strictly in world-space azimuth `uCyl` and world-space elevation `cylElev`\n"
"    // so distant mountains stay rock-steady on the horizon when steering left or right.\n"
"    float horizLen = max(length(float2(dThree.x, dThree.z)), 1e-4);\n"
"    float cylElev = dThree.y / horizLen;\n"
"    float uCyl = fract(atan2(dThree.x, dThree.z) / 6.2831853 + 0.5);\n"
"    float backdropMask = 0.0;\n"
"    float sunWrap = (u.camUp.w > 0.5) ? pow(cosSun, 2.6) : 0.0;\n"
"    if (u.toonSun.w > 0.5) {\n"
"        float vFar = (cylElev - (-0.065)) / 0.255;\n"
"        if (vFar > 0.0 && vFar < 1.0) {\n"
"            float uFar = fract(uCyl * 2.0);\n"
"            float4 farS = farTex.sample(skySampler, float2(uFar, clamp(1.0 - vFar, 0.002, 0.998)));\n"
"            float farA = farS.a * (1.0 - smoothstep(0.86, 0.99, vFar));\n"
"            float3 farBase = isGoldenHour ? (farS.rgb * mix(float3(0.56, 0.48, 0.62), float3(0.92, 0.62, 0.42), sunWrap)) : farS.rgb;\n"
"            float3 farRim = u.sunCol.rgb * smoothstep(0.45, 0.92, vFar) * sunWrap * 0.28;\n"
"            float3 farRgb = mix(horizonCol, farBase + farRim, 0.48 + 0.30 * vFar);\n"
"            col = mix(col, farRgb, farA);\n"
"            backdropMask = max(backdropMask, farA * 0.65);\n"
"        }\n"
"    }\n"
"    if (u.toonShade.w > 0.5) {\n"
"        float vMid = (cylElev - (-0.055)) / 0.195;\n"
"        if (vMid > 0.0 && vMid < 1.0) {\n"
"            float uMid = fract(uCyl * 3.0);\n"
"            float4 midS = midTex.sample(skySampler, float2(uMid, clamp(1.0 - vMid, 0.002, 0.998)));\n"
"            float midA = midS.a * (1.0 - smoothstep(0.86, 0.99, vMid));\n"
"            float3 midBase = isGoldenHour ? (midS.rgb * mix(float3(0.58, 0.52, 0.58), float3(0.95, 0.68, 0.44), sunWrap)) : midS.rgb;\n"
"            float3 midRim = u.sunCol.rgb * smoothstep(0.48, 0.92, vMid) * sunWrap * 0.34;\n"
"            float3 midRgb = mix(horizonCol, midBase + midRim, 0.64 + 0.24 * vMid);\n"
"            col = mix(col, midRgb, midA);\n"
"            backdropMask = max(backdropMask, midA * 0.85);\n"
"        }\n"
"    }\n"
"\n"
"    if (u.hazeParams.x > 0.005) {\n"
"        col = mix(col, float3(0.965, 0.851, 0.706), clamp(u.hazeParams.x, 0.0, 1.0));\n"
"    }\n"
"    // Alpha = backdropMask (0.0 on open sky so `post_fs` radial god-rays stream through tree gaps!)\n"
"    return float4(max(col, float3(0.0)), backdropMask);\n"
"}\n"
"\n"
"struct VSOut {\n"
"    float4 position [[position]];\n"
"    float3 worldPos;\n"
"    float3 normalW;\n"
"    float4 color;\n"
"    float2 uv;\n"
"    float4 stkFlags;\n"
"};\n"
"\n"
"struct ShadowVSOut {\n"
"    float4 position [[position]];\n"
"};\n"
"\n"
"vertex ShadowVSOut shadow_vs(\n"
"    uint vid [[vertex_id]],\n"
"    device const GpuVertex *vertices [[buffer(0)]],\n"
"    constant SceneUniforms &u [[buffer(1)]]\n"
") {\n"
"    GpuVertex v = vertices[vid];\n"
"    float3 pos = float3(v.pos);\n"
"    float4 flags = float4(v.stk_flags);\n"
"    if (flags.y > 0.01 && flags.x < 10.5) {\n"
"        float windT = u.hazeParams.z;\n"
"        float rootPin = smoothstep(0.06, 0.85, flags.z);\n"
"        pos.x += sin(windT * 2.8 + pos.x * 0.35 + pos.z * 0.22) * 0.16 * flags.y * rootPin;\n"
"    }\n"
"    ShadowVSOut out;\n"
"    // Skip transparent quads (`role >= 11.0`) in shadow caster pass\n"
"    if (flags.x > 10.5) {\n"
"        out.position = float4(0.0, 0.0, -2.0, 1.0);\n"
"    } else {\n"
"        out.position = u.sunViewProj * float4(pos, 1.0);\n"
"    }\n"
"    return out;\n"
"}\n"
"\n"
"vertex VSOut stage_vs(\n"
"    uint vid [[vertex_id]],\n"
"    device const GpuVertex *vertices [[buffer(0)]],\n"
"    constant SceneUniforms &u [[buffer(1)]]\n"
") {\n"
"    GpuVertex v = vertices[vid];\n"
"    float3 pos = float3(v.pos);\n"
"    float4 flags = float4(v.stk_flags);\n"
"\n"
"    // STK_SWAY wind vertex animation on palm fronds and verge foliage, pinned at the root (flags.z == ly)\n"
"    if (flags.y > 0.01 && flags.x < 10.5) {\n"
"        float windT = u.hazeParams.z;\n"
"        float rootPin = smoothstep(0.06, 0.85, flags.z);\n"
"        float sway = sin(windT * 2.8 + pos.x * 0.35 + pos.z * 0.22) * 0.16 * flags.y * rootPin;\n"
"        pos.x += sway;\n"
"        pos.y += cos(windT * 2.3 + pos.z * 0.3) * 0.035 * flags.y * smoothstep(0.25, 1.4, flags.z);\n"
"    }\n"
"    // 6-Train Shoaling 3D Trochoidal/Gerstner Ocean Swells (`role == 3.0`) on the 14-band tessellated sea surface\n"
"    float3 gerstnerNormal = float3(v.normal);\n"
"    if (abs(flags.x - 3.0) < 0.1) {\n"
"        float wt = u.hazeParams.z;\n"
"        float shoreDist = max(abs(pos.x) - 27.0, 0.0);\n"
"        float shoreDamp = smoothstep(1.0, 26.0, shoreDist);\n"
"        float shoalBoost = 1.0 + 0.42 * smoothstep(2.0, 14.0, shoreDist) * (1.0 - smoothstep(14.0, 48.0, shoreDist));\n"
"        float p1 = pos.x * 0.105 + pos.z * 0.068 + wt * 2.15;\n"
"        float p2 = pos.x * 0.195 - pos.z * 0.125 + wt * 2.85;\n"
"        float p3 = -pos.x * 0.085 + pos.z * 0.215 + wt * 3.40;\n"
"        float p4 = pos.x * 0.310 + pos.z * 0.175 - wt * 4.15;\n"
"        float p5 = pos.x * 0.460 - pos.z * 0.340 + wt * 4.95;\n"
"        float p6 = pos.x * 0.260 + pos.z * 0.045 + wt * 2.60;\n"
"        float amp = (0.22 + 0.78 * shoreDamp) * shoalBoost;\n"
"        pos.x += (cos(p1) * 0.42 + cos(p2) * 0.24 + cos(p4) * 0.11 + cos(p6) * 0.28) * shoreDamp;\n"
"        pos.z += (cos(p1) * 0.28 + cos(p3) * 0.22 + cos(p5) * 0.09) * shoreDamp;\n"
"        pos.y += (sin(p1) * 0.56 + sin(p2) * 0.32 + sin(p3) * 0.22 + sin(p4) * 0.12 + sin(p5) * 0.07 + sin(p6) * 0.24) * amp;\n"
"        float dYx = (cos(p1) * 0.059 + cos(p2) * 0.062 - cos(p3) * 0.019 + cos(p4) * 0.037 + cos(p6) * 0.062) * amp;\n"
"        float dYz = (cos(p1) * 0.038 - cos(p2) * 0.040 + cos(p3) * 0.047 + cos(p4) * 0.021 + cos(p6) * 0.011) * amp;\n"
"        gerstnerNormal = normalize(float3(-dYx, 1.0, -dYz));\n"
"    }\n"
"\n"
"    VSOut out;\n"
"    out.position = u.viewProj * float4(pos, 1.0);\n"
"    // Slight depth bias on under-car contact shadow quad (role == 11.0) so it never z-fights road ribbons\n"
"    if (abs(flags.x - 11.0) < 0.1) {\n"
"        out.position.z -= 0.00015 * out.position.w;\n"
"    }\n"
"    out.worldPos = pos;\n"
"    out.normalW = normalize(gerstnerNormal);\n"
"    out.color = float4(v.color);\n"
"    out.uv = float2(v.uv);\n"
"    out.stkFlags = flags;\n"
"    return out;\n"
"}\n"
"\n"
"fragment float4 stage_fs(\n"
"    VSOut in [[stage_in]],\n"
"    constant SceneUniforms &u [[buffer(1)]],\n"
"    texture2d<float> groundTex [[texture(0)]],\n"
"    texture2d<float> skyTex [[texture(1)]],\n"
"    texture2d<float> propAtlasTex [[texture(2)]],\n"
"    texture2d<float> shadowTex [[texture(3)]],\n"
"    sampler groundSampler [[sampler(0)]],\n"
"    sampler skySampler [[sampler(1)]]\n"
") {\n"
"    float3 normalW = normalize(in.normalW);\n"
"    float3 viewDir = normalize(u.cameraEye.xyz - in.worldPos);\n"
"    float3 sunDir = normalize(u.sunDir.xyz);\n"
"    float role = in.stkFlags.x;\n"
"    float heightH = in.stkFlags.z;\n"
"    bool isCar = (abs(role - 8.0) < 0.1);\n"
"    float rawBrush = in.stkFlags.w;\n"
"    int atlasTile = (!isCar && role < 10.5 && rawBrush >= 3.5) ? (int(floor((rawBrush + 0.5) / 4.0)) - 1) : -1;\n"
"    float brushFlag = (atlasTile >= 0) ? (rawBrush - float((atlasTile + 1) * 4)) : rawBrush;\n"
"    bool isBrushed = (!isCar && role < 10.5 && brushFlag > 0.5 && brushFlag < 1.5);\n"
"    bool isPainted = (!isCar && role < 10.5 && brushFlag > 1.5);\n"
"    float3 albedo = in.color.rgb;\n"
"    if (atlasTile >= 0 && atlasTile < 64) {\n"
"        float2 tileOrigin = float2(float(atlasTile & 7), float(atlasTile >> 3)) * 0.125;\n"
"        float2 localUv = isPainted ? clamp(in.uv, 0.0, 1.0) : fract(in.uv);\n"
"        float2 safeUv = clamp(localUv, 1.5 / 1024.0, 1.0 - 1.5 / 1024.0);\n"
"        float2 atlasUv = tileOrigin + safeUv * 0.125;\n"
"        float4 atlasSample = propAtlasTex.sample(skySampler, atlasUv);\n"
"        albedo = clamp(atlasSample.rgb * in.color.rgb, 0.0, 1.4);\n"
"        // Impasto brushstroke normal perturbation from heightfield encoded in `atlasSample.a`\n"
"        float impastoH = atlasSample.a;\n"
"        float dHx = dfdx(impastoH);\n"
"        float dHy = dfdy(impastoH);\n"
"        normalW = normalize(normalW + float3(-dHx * 1.65, -dHy * 1.65, (impastoH - 0.5) * 0.22));\n"
"    }\n"
"    float roadPaintMask = 0.0;\n"
"\n"
"    // World-Anchored 3D Painted Cumulus Cloud Banks (`role == 12.0`)\n"
"    if (abs(role - 12.0) < 0.1) {\n"
"        float2 p = in.uv * 2.0 - 1.0;\n"
"        float seedPhase = in.stkFlags.y;\n"
"        // Multi-lobe Kazuo Oga cumulus silhouette: flat cloud base (`p.y < -0.55`), billowy top domes\n"
"        float2 cMain = p - float2(0.0, 0.06);\n"
"        float2 cLeft = p - float2(-0.42 + 0.08 * sin(seedPhase), -0.10);\n"
"        float2 cRight = p - float2(0.40 + 0.08 * cos(seedPhase * 1.3), -0.08);\n"
"        float2 cCrown = p - float2(0.08 * sin(seedPhase * 0.7), 0.34);\n"
"        float dLobe = min(min(length(cMain / float2(0.58, 0.44)), length(cLeft / float2(0.42, 0.32))),\n"
"                          min(length(cRight / float2(0.42, 0.34)), length(cCrown / float2(0.38, 0.32))));\n"
"        float edgeNoise = (stkCells(in.uv * 4.5 + seedPhase) - 0.5) * 0.22;\n"
"        float flatBase = smoothstep(-0.68, -0.32, p.y);\n"
"        float cloudAlpha = (1.0 - smoothstep(0.72, 1.02, dLobe + edgeNoise)) * flatBase;\n"
"        if (cloudAlpha < 0.03) {\n"
"            discard_fragment();\n"
"        }\n"
"        // 3-tone gouache cumulus shading: warm sunlit cream top (`#FAEECE`), mid body (`#C4CADA`), cool belly (`#7080A6`)\n"
"        float lobeGrad = clamp(p.y * 0.65 + 0.45 - edgeNoise * 0.8, 0.0, 1.0);\n"
"        float band1 = smoothstep(0.22, 0.48, lobeGrad);\n"
"        float band2 = smoothstep(0.56, 0.80, lobeGrad);\n"
"        float3 cloudBelly = float3(0.439, 0.502, 0.651);\n"
"        float3 cloudMid = float3(0.769, 0.792, 0.855);\n"
"        float3 cloudTop = float3(0.980, 0.933, 0.808);\n"
"        float3 cloudRgb = mix(mix(cloudBelly, cloudMid, band1), cloudTop, band2);\n"
"        float sunRim = pow(clamp(dot(-viewDir, sunDir), 0.0, 1.0), 2.4) * smoothstep(0.35, 0.95, 1.0 - cloudAlpha);\n"
"        cloudRgb += u.sunCol.rgb * sunRim * 0.55;\n"
"        float distC = distance(u.cameraEye.xyz, in.worldPos);\n"
"        float fogC = clamp(smoothstep(1600.0, 3800.0, distC), 0.0, 0.78);\n"
"        cloudRgb = mix(cloudRgb, u.horizonCol.rgb, fogC);\n"
"        return float4(cloudRgb, cloudAlpha * 0.92);\n"
"    }\n"
"\n"
"    // Dynamic Gouache Billboarding Particle Puffs (`role == 13.0`: tire drift smoke & off-road dust)\n"
"    if (abs(role - 13.0) < 0.1) {\n"
"        float2 p = in.uv * 2.0 - 1.0;\n"
"        float age = in.stkFlags.y;\n"
"        float rDist = length(p) + (stkCells(in.uv * 3.8 + age * 2.5) - 0.5) * 0.28;\n"
"        float puffMask = 1.0 - smoothstep(0.45, 0.95, rDist);\n"
"        float alpha = puffMask * in.color.a;\n"
"        if (alpha < 0.02) {\n"
"            discard_fragment();\n"
"        }\n"
"        float puffLobe = smoothstep(-0.35, 0.45, p.y - p.x * 0.25);\n"
"        float3 puffRgb = in.color.rgb * mix(u.toonShade.rgb * 0.92, u.toonSun.rgb * 1.04, puffLobe);\n"
"        return float4(puffRgb, clamp(alpha, 0.0, 0.85));\n"
"    }\n"
"\n"
"    // Under-car soft contact shadow, 4-wheel AO & red taillight ground reflection (`role == 11.0`)\n"
"    if (abs(role - 11.0) < 0.1) {\n"
"        float2 p = in.uv * 2.0 - 1.0;\n"
"        float2 qBody = abs(p) - float2(0.54, 0.66);\n"
"        float sdfBody = length(max(qBody, 0.0)) + min(max(qBody.x, qBody.y), 0.0) - 0.15;\n"
"        float bodyAo = 1.0 - smoothstep(-0.20, 0.28, sdfBody);\n"
"        float2 wDist = (abs(p) - float2(0.56, 0.54)) / float2(0.16, 0.22);\n"
"        float wheelAo = exp(-dot(wDist, wDist) * 2.2);\n"
"        // Red taillight ground glow pools right behind the rear bumper (`p.y < -0.58`)\n"
"        float2 tailDist = ( float2(abs(p.x), p.y) - float2(0.46, -0.78) ) / float2(0.24, 0.22);\n"
"        float tailGlow = exp(-dot(tailDist, tailDist) * 2.4) * 0.48;\n"
"        float rawAlpha = clamp(bodyAo * 0.78 + wheelAo * 0.48 + tailGlow * 0.55, 0.0, 0.88);\n"
"        if (rawAlpha < 0.01) {\n"
"            discard_fragment();\n"
"        }\n"
"        float distS = distance(u.cameraEye.xyz, in.worldPos);\n"
"        float fogS = clamp(1.0 - exp(-(distS * u.hazeParams.y * 0.15) * (distS * u.hazeParams.y * 0.15)), 0.0, 1.0);\n"
"        float3 shadowRgb = mix(float3(0.01, 0.012, 0.025), float3(0.95, 0.12, 0.05), clamp(tailGlow * 1.4, 0.0, 0.85));\n"
"        return float4(shadowRgb, rawAlpha * (1.0 - fogS));\n"
"    }\n"
"\n"
"    if (abs(role - 1.0) < 0.1) {\n"
"        // Highway asphalt: isotropic mineral aggregate micro-grain, dual tire-wear polish tracks & weathered road markings\n"
"        bool isForkBranch = (in.uv.x > 1.5);\n"
"        float uCoord = isForkBranch ? (in.uv.x - 2.0) : in.uv.x;\n"
"        float vCoord = in.worldPos.z / 24.0;\n"
"        float aggFine = stkHash21(floor(in.worldPos.xz * float2(34.0, 28.0)));\n"
"        float aggMed = stkCells(in.worldPos.xz * 4.8);\n"
"        float aggMacro = stkCells(in.worldPos.xz * 0.65 + 3.1);\n"
"        float grain = aggFine * 0.45 + aggMed * 0.35 + aggMacro * 0.20;\n"
"        float laneLocal = fract(uCoord * 4.0);\n"
"        float tireTrack = exp(-pow((laneLocal - 0.30) / 0.11, 2.0)) + exp(-pow((laneLocal - 0.70) / 0.11, 2.0));\n"
"        float shoulderDust = smoothstep(0.42, 0.50, abs(uCoord - 0.5));\n"
"        albedo = float3(0.054, 0.058, 0.068) * (0.86 + 0.22 * grain) * (1.0 - 0.15 * clamp(tireTrack, 0.0, 1.0));\n"
"        albedo = mix(albedo, float3(0.14, 0.13, 0.12), shoulderDust * 0.22);\n"
"        normalW = normalize(normalW + float3((aggFine - 0.5) * 0.036, 0.0, (aggMed - 0.5) * 0.032));\n"
"\n"
"        float paintWear = 0.86 + 0.14 * aggMed;\n"
"        float edgeLine = smoothstep(0.016, 0.005, abs(uCoord - 0.032)) + smoothstep(0.016, 0.005, abs(uCoord - 0.968));\n"
"        float edgeMask = clamp(edgeLine, 0.0, 1.0) * paintWear;\n"
"        albedo = mix(albedo, float3(0.94, 0.95, 0.96), edgeMask);\n"
"        roadPaintMask = edgeMask;\n"
"        float dash = step(0.64, fract(vCoord));\n"
"        if (isForkBranch) {\n"
"            float branchMid = clamp(smoothstep(0.018, 0.006, abs(uCoord - 0.50)) * dash, 0.0, 1.0) * paintWear;\n"
"            albedo = mix(albedo, float3(0.94, 0.95, 0.96), branchMid);\n"
"            roadPaintMask = max(roadPaintMask, branchMid);\n"
"        } else {\n"
"            // Double yellow center line\n"
"            float doubleYellow = smoothstep(0.0075, 0.0025, abs(abs(uCoord - 0.50) - 0.0095));\n"
"            float centerYellow = clamp(doubleYellow, 0.0, 1.0) * paintWear;\n"
"            albedo = mix(albedo, float3(0.98, 0.68, 0.12), centerYellow);\n"
"            float lane1 = smoothstep(0.012, 0.004, abs(uCoord - 0.258)) * dash;\n"
"            float lane2 = smoothstep(0.012, 0.004, abs(uCoord - 0.742)) * dash;\n"
"            float laneMask = clamp(lane1 + lane2, 0.0, 1.0) * paintWear;\n"
"            albedo = mix(albedo, float3(0.94, 0.95, 0.96), laneMask);\n"
"            roadPaintMask = max(roadPaintMask, max(centerYellow, laneMask));\n"
"        }\n"
"    } else if (abs(role - 2.0) < 0.1) {\n"
"        // Segmented stone/concrete highway curb blocks with expansion mortar joints & bevelled edge normal\n"
"        float jointZ = smoothstep(0.045, 0.012, abs(fract(in.worldPos.z * 0.42) - 0.5));\n"
"        float stoneGrain = stkCells(in.worldPos.xz * 2.6) * 0.14 - 0.07;\n"
"        float3 curbStone = float3(0.89, 0.88, 0.85) * (1.0 + stoneGrain) * (1.0 - 0.28 * jointZ);\n"
"        albedo = curbStone;\n"
"        normalW = normalize(normalW + float3(0.0, 0.0, (fract(in.worldPos.z * 0.42) - 0.5) * 0.12 * jointZ));\n"
"    } else if (abs(role - 5.0) < 0.1) {\n"
"        // Coastal limestone seawall, coping & flagstone promenade (`bPromenade`, `bSeaWall`, `bSeaWallFace`)\n"
"        bool isWallFace = (abs(normalW.y) < 0.65);\n"
"        float2 pUv = isWallFace ? float2(in.worldPos.z * 0.45, in.worldPos.y * 1.35) : (in.worldPos.xz * 0.55);\n"
"        float2 cellId = floor(pUv);\n"
"        float stagger = fmod(abs(cellId.y), 2.0) * 0.5;\n"
"        float2 fUv = fract(float2(pUv.x + stagger, pUv.y));\n"
"        float mortar = max(smoothstep(0.055, 0.015, min(fUv.x, 1.0 - fUv.x)), smoothstep(0.075, 0.020, min(fUv.y, 1.0 - fUv.y)));\n"
"        float blockVar = (stkHash21(cellId) - 0.5) * 0.10;\n"
"        float mineral = (stkCells(in.worldPos.xz * 1.8) - 0.5) * 0.08;\n"
"        albedo = in.color.rgb * (1.0 + blockVar + mineral) * (1.0 - 0.24 * mortar);\n"
"        normalW = normalize(normalW + float3((fUv.x - 0.5) * 0.10 * mortar, 0.0, (fUv.y - 0.5) * 0.10 * mortar));\n"
"    } else if (abs(role - 3.0) < 0.1) {\n"
"        // Stylized coastal ocean:\n"
"        //   - Bathymetric reef-to-abyss depth absorption + mottled coral/sand patches\n"
"        //   - Dual-layer animated Voronoi shallow seabed caustics\n"
"        //   - 7-octave domain-warped Trochoidal swell + wind-chop + micro-capillary wave normals\n"
"        //   - Asymmetric curling shoreward surf rollers, Voronoi foam lace & undertow streaks\n"
"        float wt = u.hazeParams.z;\n"
"        float shoreDist = max(abs(in.worldPos.x) - 27.0, 0.0);\n"
"        float shallowMask = 1.0 - smoothstep(1.5, 38.0, shoreDist);\n"
"        float shelfMask = 1.0 - smoothstep(24.0, 210.0, shoreDist);\n"
"        float reefPatch = stkCells(in.worldPos.xz * 0.065 + 1.9);\n"
"        // Bathymetry palette: translucent aquamarine-jade shallows -> emerald-cerulean shelf -> deep sapphire abyss\n"
"        float3 shallowCol = mix(float3(0.09, 0.72, 0.66), float3(0.18, 0.78, 0.62), smoothstep(0.35, 0.75, reefPatch));\n"
"        float3 shelfCol = mix(in.color.rgb, float3(0.05, 0.40, 0.60), 0.72);\n"
"        float3 abyssCol = mix(in.color.rgb * 0.45, float3(0.02, 0.13, 0.32), 0.82);\n"
"        float3 bathyCol = mix(abyssCol, shelfCol, shelfMask);\n"
"        bathyCol = mix(bathyCol, shallowCol, shallowMask);\n"
"        // Dual-layer animated Voronoi sunlight caustics on the shallow coral-sand floor\n"
"        float2 cWarp = float2(sin(in.worldPos.z * 0.22 + wt * 1.4), cos(in.worldPos.x * 0.25 - wt * 1.2)) * 0.35;\n"
"        float cA = stkCells(in.worldPos.xz * 0.52 + cWarp + float2(wt * 0.45, -wt * 0.32));\n"
"        float cB = stkCells(in.worldPos.xz * 0.84 - cWarp - float2(wt * 0.38, wt * 0.51) + 2.7);\n"
"        float causticNet = pow(clamp(1.0 - abs(cA - cB) * 2.1, 0.0, 1.0), 2.2) * shallowMask;\n"
"        bathyCol += float3(0.32, 0.82, 0.68) * causticNet * 0.55;\n"
"        // 7-octave domain-warped ocean wave & capillary chop normal spectrum\n"
"        float p1 = in.worldPos.x * 0.105 + in.worldPos.z * 0.068 + wt * 2.15;\n"
"        float p2 = in.worldPos.x * 0.195 - in.worldPos.z * 0.125 + wt * 2.85;\n"
"        float p3 = -in.worldPos.x * 0.085 + in.worldPos.z * 0.215 + wt * 3.40;\n"
"        float p4 = in.worldPos.x * 0.44 + in.worldPos.z * 0.31 - wt * 4.40 + 0.45 * sin(p1);\n"
"        float p5 = in.worldPos.x * 0.82 - in.worldPos.z * 0.58 + wt * 5.60 + 0.40 * cos(p2);\n"
"        float p6 = -in.worldPos.x * 1.45 + in.worldPos.z * 1.12 - wt * 6.80;\n"
"        float p7 = in.worldPos.x * 2.35 + in.worldPos.z * 1.85 + wt * 8.20;\n"
"        float waveH = 0.40 * sin(p1) + 0.25 * sin(p2) + 0.17 * sin(p3) + 0.10 * sin(p4) + 0.05 * sin(p5) + 0.03 * sin(p6);\n"
"        float dWx = 0.14 * cos(p1) + 0.15 * cos(p2) - 0.06 * cos(p3) + 0.12 * cos(p4) + 0.09 * cos(p5) - 0.07 * cos(p6) + 0.05 * cos(p7);\n"
"        float dWz = 0.09 * cos(p1) - 0.10 * cos(p2) + 0.13 * cos(p3) + 0.09 * cos(p4) - 0.07 * cos(p5) + 0.06 * cos(p6) + 0.04 * cos(p7);\n"
"        normalW = normalize(float3(normalW.x - dWx * 1.25, 1.0, normalW.z - dWz * 1.25));\n"
"        albedo = bathyCol * (0.84 + 0.32 * (0.5 + 0.5 * waveH));\n"
"        // Asymmetric curling shoreward surf rollers + 3-scale Voronoi foam lace + undertow streaks\n"
"        float surfZone = 1.0 - smoothstep(3.0, 58.0, shoreDist);\n"
"        float rawPhase = shoreDist * 0.31 + wt * 2.75 + 0.75 * sin(in.worldPos.z * 0.085 + wt * 0.65);\n"
"        float curlPhase = rawPhase + 0.52 * sin(rawPhase);\n"
"        float breakerCrest = pow(max(0.0, sin(curlPhase)), 3.8) * surfZone;\n"
"        float breakerTrail = pow(max(0.0, sin(curlPhase - 0.65)), 2.0) * 0.55 * surfZone;\n"
"        float shoreSwash = smoothstep(8.5, 0.2, shoreDist) * (0.68 + 0.32 * sin(wt * 2.9 + in.worldPos.z * 0.16));\n"
"        float fCell1 = stkCells(in.worldPos.xz * 0.52 + float2(wt * 0.28, -wt * 0.12));\n"
"        float fCell2 = stkCells(in.worldPos.xz * 1.35 - float2(wt * 0.35, wt * 0.18) + 4.1);\n"
"        float undertow = 0.5 + 0.5 * sin(in.worldPos.z * 1.45 + sin(shoreDist * 0.4 - wt * 1.8) * 1.6);\n"
"        float foamLace = fCell1 * 0.58 + fCell2 * 0.42;\n"
"        float surfDrive = breakerCrest * 1.25 + breakerTrail * undertow * 0.85 + shoreSwash * 1.05;\n"
"        float foamWeb = smoothstep(0.26, 0.68, surfDrive + (foamLace - 0.44) * 0.58 * surfZone);\n"
"        float whitecap = smoothstep(0.38, 0.74, waveH + (foamLace - 0.38) * 0.40) * (1.0 - 0.45 * shallowMask);\n"
"        float3 foamSub = float3(0.58, 0.90, 0.90);\n"
"        float3 foamCrest = float3(0.985, 0.980, 0.962);\n"
"        float subMix = clamp(foamWeb * 0.76 + whitecap * 0.42, 0.0, 0.90);\n"
"        float crestMix = clamp(pow(foamWeb, 1.55) * 0.92 + whitecap * 0.68, 0.0, 0.96);\n"
"        albedo = mix(albedo, foamSub, subMix);\n"
"        albedo = mix(albedo, foamCrest, crestMix);\n"
"        roadPaintMask = crestMix;\n"
"    } else if (abs(role - 4.0) < 0.1) {\n"
"        // Biome-aware gouache landscape shader:\n"
"        //   - Aperiodic dual-scale ground canvas\n"
"        //   - Coastal wet-sand swash mirror & coral beach dunes\n"
"        //   - Desert wind-rippled barchan sand micro-dunes\n"
"        //   - Gouache meadow brushstrokes, wayside wildflowers & steep-cliff strata (`normalW.y < 0.75`)\n"
"        if (u.sunCol.w > 0.5) {\n"
"            float2 uvFine = in.worldPos.xz / u.sunCol.w;\n"
"            float2 rotXz = float2(in.worldPos.x * 0.7986 - in.worldPos.z * 0.6018, in.worldPos.x * 0.6018 + in.worldPos.z * 0.7986);\n"
"            float2 uvMacro = rotXz / (u.sunCol.w * 3.7);\n"
"            float3 sFine = groundTex.sample(groundSampler, uvFine).rgb;\n"
"            float3 sMacro = groundTex.sample(groundSampler, uvMacro).rgb;\n"
"            float blendNoise = smoothstep(0.25, 0.75, stkCells(in.worldPos.xz * 0.085));\n"
"            float macroWeight = (u.sunCol.w > 15.0) ? 0.15 : (0.35 + 0.35 * blendNoise);\n"
"            albedo = mix(sFine, sMacro, macroWeight);\n"
"        }\n"
"        float dapple = sin(in.worldPos.x * 0.014 + in.worldPos.z * 0.011) * cos(in.worldPos.x * 0.009 - in.worldPos.z * 0.015);\n"
"        float turfA = stkCells(in.worldPos.xz * 0.28);\n"
"        float turfB = stkCells(in.worldPos.xz * 1.15 + 4.2);\n"
"        float turfC = stkCells(in.worldPos.xz * 3.4 + 8.7);\n"
"        float turf = turfA * 0.50 + turfB * 0.32 + turfC * 0.18;\n"
"        bool isSandyBiome = (in.color.r > in.color.g * 1.05 && in.color.b < in.color.r * 0.88);\n"
"        bool isSnowBiome = (in.color.r > 0.80 && in.color.g > 0.82 && in.color.b > 0.85);\n"
"        if (isSandyBiome) {\n"
"            // Wind-rippled coastal/desert sand dunes + warm golden crest & cool coral-terracotta hollow shading\n"
"            float ripple = sin(in.worldPos.x * 1.65 + in.worldPos.z * 0.95 + sin(in.worldPos.z * 0.35) * 1.8) * 0.5 + 0.5;\n"
"            float3 warmSand = albedo * float3(1.14, 1.06, 0.92);\n"
"            float3 coolSand = albedo * float3(0.82, 0.74, 0.72);\n"
"            albedo = mix(coolSand, warmSand, clamp(0.48 + 0.32 * dapple + 0.18 * (ripple - 0.5) + 0.16 * (turf - 0.5), 0.0, 1.0));\n"
"            normalW = normalize(normalW + float3((ripple - 0.5) * 0.14 + (turfB - 0.5) * 0.10, 0.0, (turfA - 0.5) * 0.12));\n"
"        } else if (isSnowBiome) {\n"
"            float drift = sin(in.worldPos.x * 0.45 - in.worldPos.z * 0.32 + turfA * 2.2) * 0.5 + 0.5;\n"
"            float3 sunSnow = albedo * float3(1.06, 1.05, 1.02);\n"
"            float3 shadeSnow = albedo * float3(0.76, 0.84, 0.96);\n"
"            albedo = mix(shadeSnow, sunSnow, clamp(0.50 + 0.30 * dapple + 0.24 * (drift - 0.5), 0.0, 1.0));\n"
"            normalW = normalize(normalW + float3((drift - 0.5) * 0.14, 0.0, (turfB - 0.5) * 0.14));\n"
"        } else {\n"
"            // Lush Kazuo Oga gouache meadow / coastal turf with sunlit clover patches & cool viridian hollows\n"
"            float3 warmGround = albedo * float3(1.14, 1.10, 0.92);\n"
"            float3 coolGround = albedo * float3(0.74, 0.86, 0.78);\n"
"            albedo = mix(coolGround, warmGround, clamp(0.50 + 0.34 * dapple + 0.28 * (turf - 0.5), 0.0, 1.0));\n"
"            float vergeProx = smoothstep(26.0, 7.5, abs(in.worldPos.x));\n"
"            float wildflower = smoothstep(0.73, 0.89, turfC) * smoothstep(0.44, 0.78, turfA);\n"
"            float3 flowerDot = mix(float3(0.96, 0.86, 0.36), float3(0.94, 0.46, 0.34), stkHash21(floor(in.worldPos.xz * 2.4)));\n"
"            albedo = mix(albedo * mix(1.0, 0.86 + 0.20 * turfB, vergeProx * 0.65), flowerDot, wildflower * vergeProx * 0.46);\n"
"            normalW = normalize(normalW + float3((turfB - 0.5) * 0.18, 0.0, (turfA - 0.5) * 0.18));\n"
"        }\n"
"        // Sedimentary rock strata on steep cliff cuts (`normalW.y < 0.75`)\n"
"        float stkSlope = 1.0 - smoothstep(0.52, 0.75, max(normalW.y, 0.0));\n"
"        if (stkSlope > 0.01) {\n"
"            float2 triUv = (abs(normalW.x) > abs(normalW.z)) ? in.worldPos.zy : in.worldPos.xy;\n"
"            float rockCells = stkCells(triUv * float2(0.45, 0.85));\n"
"            float stkStrata = 0.5 + 0.5 * sin(in.worldPos.y * 1.65 + turfA * 3.8);\n"
"            float3 cliffRgb = mix(albedo * 0.58, float3(0.62, 0.57, 0.50), 0.55) * (0.78 + 0.32 * rockCells) * (0.85 + 0.25 * stkStrata);\n"
"            albedo = mix(albedo, cliffRgb, stkSlope * 0.85);\n"
"        }\n"
"    } else if (abs(role - 7.0) < 0.1) {\n"
"        // `bCarpet` Ghibli gouache flower carpet along the roadside verge (`flowerCarpet` in `scenery.js`)\n"
"        float edgeFade = smoothstep(0.0, 0.15, in.uv.y) * (1.0 - smoothstep(0.82, 1.0, in.uv.y));\n"
"        float3 leafBase = float3(0.22, 0.40, 0.16);\n"
"        float c1 = stkCells(in.worldPos.xz * 2.8);\n"
"        float c2 = stkCells(in.worldPos.xz * 4.5 + 7.3);\n"
"        float3 poppyOrange = float3(0.92, 0.36, 0.11);\n"
"        float3 poppyRed = float3(0.80, 0.19, 0.16);\n"
"        float3 blossom = mix(poppyOrange, poppyRed, smoothstep(0.35, 0.75, c2));\n"
"        float bloomMask = smoothstep(0.24, 0.60, max(c1, c2 * 0.95)) * (0.45 + 0.55 * edgeFade);\n"
"        albedo = mix(leafBase, blossom, bloomMask);\n"
"        normalW = normalize(normalW + float3((c1 - 0.5) * 0.18, 0.0, (c2 - 0.5) * 0.18));\n"
"    } else if (abs(role - 6.0) < 0.1) {\n"
"        // 3D cellular gouache leaf-cluster & conifer-bough relief (`role == 6.0`)\n"
"        float2 leafUv = in.worldPos.xz * 1.65 + float2(in.worldPos.y * 1.15, -in.worldPos.y * 0.85);\n"
"        float cLeaf1 = stkCells(leafUv);\n"
"        float cLeaf2 = stkCells(leafUv * 2.4 + 4.7);\n"
"        float leafMass = cLeaf1 * 0.62 + cLeaf2 * 0.38;\n"
"        float3 leafN = float3((cLeaf1 - 0.5) * 0.44, (leafMass - 0.48) * 0.38, (cLeaf2 - 0.5) * 0.44);\n"
"        normalW = normalize(normalW + leafN);\n"
"        float3 leafTint = mix(float3(0.76, 0.90, 0.96), float3(1.15, 1.12, 0.90), leafMass);\n"
"        float tintStrength = isPainted ? 0.58 : 1.0;\n"
"        albedo *= mix(float3(1.0), leafTint * mix(0.74, 1.10, leafMass), tintStrength);\n"
"    } else if (role < 0.5) {\n"
"        // 3D triplanar masonry/rock cleavage micro-normal detail on roadside rocks, gateways & landmarks\n"
"        float2 rUv = (abs(normalW.x) > abs(normalW.z)) ? in.worldPos.zy : in.worldPos.xy;\n"
"        float rCell1 = stkCells(rUv * 0.85);\n"
"        float rCell2 = stkCells(in.worldPos.xz * 1.45 + in.worldPos.y * 0.95);\n"
"        float rStrata = sin(in.worldPos.y * 3.2 + rCell1 * 2.4) * 0.5 + 0.5;\n"
"        normalW = normalize(normalW + float3((rCell1 - 0.5) * 0.26, (rStrata - 0.5) * 0.22, (rCell2 - 0.5) * 0.26));\n"
"        albedo *= 0.90 + 0.18 * (0.6 * rCell1 + 0.4 * rStrata);\n"
"    }\n"
"\n"
"    // Emissive taillights / nitro afterburners / unlit MeshBasicMaterial gantry signs:\n"
"    // Output HDR radiance > 1.0 on vehicle lamps/flames (`heightH <= 5.0`) so `post_fs` blooms them.\n"
"    if (abs(role - 9.0) < 0.1) {\n"
"        float boost = (heightH > 5.0) ? 1.05 : 2.35;\n"
"        return float4(albedo * boost, 1.0);\n"
"    }\n"
"\n"
"    // Skyscraper window grid (`tower-a`, `tower-b`, `tower-c` `_windowTexture` in `renderer.js`)\n"
"    if (abs(role - 10.0) < 0.1) {\n"
"        float2 wGrid = in.uv * 16.0;\n"
"        float2 wCell = floor(wGrid);\n"
"        float2 wFrac = fract(wGrid);\n"
"        bool inPane = (wFrac.x > 0.18 && wFrac.x < 0.82 && wFrac.y > 0.18 && wFrac.y < 0.84);\n"
"        float3 towerSeed = floor(in.worldPos * 0.04);\n"
"        float hLit = stkHash21(wCell + towerSeed.xz * 13.0 + towerSeed.y * 7.0);\n"
"        float hCol = stkHash21(wCell * 3.1 + towerSeed.xz * 19.0 + 5.3);\n"
"        float3 glassCol = float3(0.05, 0.06, 0.09);\n"
"        if (inPane && hLit < 0.45) {\n"
"            glassCol = (hCol < 0.70) ? float3(1.45, 1.05, 0.52) : float3(0.82, 1.12, 1.40);\n"
"        }\n"
"        float distW = distance(u.cameraEye.xyz, in.worldPos);\n"
"        float fogW = clamp(1.0 - exp(-(distW * u.hazeParams.y * 0.15) * (distW * u.hazeParams.y * 0.15)), 0.0, 1.0);\n"
"        return float4(mix(glassCol, u.horizonCol.rgb, fogW), 1.0);\n"
"    }\n"
"\n"
"    // STK_BRUSH: Gouache bristle stroke modulation (`BRUSH_WARM` / `BRUSH_COOL` in `TOON_GLSL`)\n"
"    if (isBrushed) {\n"
"        float stroke = stkBrushTone(in.worldPos, normalW);\n"
"        float3 brushTint = mix(float3(0.93, 0.96, 1.05), float3(1.07, 1.03, 0.95), stroke + 0.5);\n"
"        albedo *= brushTint;\n"
"    }\n"
"\n"
"    // Real-time 4-tap Poisson Directional Sun Shadow Map + analytical roadside canopy shadow\n"
"    float treeShadow = 1.0;\n"
"    if (u.camUp.w > 0.5) {\n"
"        if (abs(role - 1.0) < 0.1 || abs(role - 2.0) < 0.1 || abs(role - 4.0) < 0.1 || abs(role - 5.0) < 0.1) {\n"
"            treeShadow = stkRoadsideTreeShadow(in.worldPos, sunDir, u.hazeParams.z);\n"
"        }\n"
"        float4 shadowClip = u.sunViewProj * float4(in.worldPos + normalW * 0.18, 1.0);\n"
"        float3 shadowNdc = shadowClip.xyz / max(shadowClip.w, 1e-4);\n"
"        float2 shadowUv = float2(shadowNdc.x * 0.5 + 0.5, 0.5 - shadowNdc.y * 0.5);\n"
"        if (shadowUv.x > 0.01 && shadowUv.x < 0.99 && shadowUv.y > 0.01 && shadowUv.y < 0.99 && shadowNdc.z > 0.001 && shadowNdc.z < 0.995) {\n"
"            float2 poisson[4] = {\n"
"                float2(-0.94201624, -0.39906216),\n"
"                float2( 0.94558609, -0.76890725),\n"
"                float2(-0.09418410, -0.92938870),\n"
"                float2( 0.34495938,  0.29387760)\n"
"            };\n"
"            float shadowVis = 0.0;\n"
"            float bias = 0.0022;\n"
"            float texelSz = 1.35 / 2048.0;\n"
"            for (int si = 0; si < 4; si++) {\n"
"                float dSample = shadowTex.sample(skySampler, clamp(shadowUv + poisson[si] * texelSz, 0.002, 0.998)).r;\n"
"                shadowVis += (shadowNdc.z - bias <= dSample) ? 0.25 : 0.0;\n"
"            }\n"
"            float brushEdge = (stkCells(in.worldPos.xz * 1.8) - 0.5) * 0.08;\n"
"            float csmShadow = mix(0.38, 1.0, smoothstep(0.15, 0.85, shadowVis + brushEdge));\n"
"            treeShadow = min(treeShadow, csmShadow);\n"
"        }\n"
"    }\n"
"\n"
"    // STK_TOON 3-band cel shading (`TOON_GLSL` in renderer.js)\n"
"    float ndl = max(dot(normalW, sunDir), 0.0) * 0.78 + 0.22;\n"
"    if (isBrushed) {\n"
"        ndl += stkBrushTone(in.worldPos * 0.7, normalW) * 0.08;\n"
"    }\n"
"    float rawBand = smoothstep(0.12, 0.34, ndl) * 0.42\n"
"                  + smoothstep(0.44, 0.66, ndl) * 0.33\n"
"                  + smoothstep(0.76, 0.95, ndl) * 0.25;\n"
"    float toonBand = (isPainted ? max(rawBand, 0.34) : rawBand) * treeShadow;\n"
"    float3 toonShade = u.toonShade.rgb;\n"
"    float3 toonSun = u.toonSun.rgb;\n"
"    // Vertical foot-to-top tint (`GRADE_FOOT` -> `GRADE_TOP`) + tight ground-contact AO on props\n"
"    float3 vGrade = mix(float3(0.78, 0.82, 0.90), float3(1.08, 1.05, 0.98), clamp(heightH / 14.0, 0.0, 1.0));\n"
"    if (role < 0.5 || abs(role - 6.0) < 0.1) {\n"
"        float baseAo = mix(0.68, 1.0, smoothstep(0.0, 0.65, heightH));\n"
"        vGrade *= baseAo;\n"
"    }\n"
"    float3 lit = albedo * mix(toonShade, toonSun, toonBand) * vGrade;\n"
"\n"
"    // Golden-hour subsurface leaf translucency & amber frond rims (`role == 6.0` & `role == 0.0`)\n"
"    if ((role < 0.5 || abs(role - 6.0) < 0.1) && u.camUp.w > 0.5) {\n"
"        float backLight = pow(clamp(dot(-viewDir, sunDir), 0.0, 1.0), 1.8);\n"
"        float edgeLight = pow(1.0 - abs(dot(normalW, viewDir)), 2.2);\n"
"        if (abs(role - 6.0) < 0.1) {\n"
"            float3 sssCol = albedo * float3(1.35, 1.18, 0.45) + float3(0.42, 0.28, 0.06);\n"
"            lit += sssCol * backLight * (0.28 + 0.52 * edgeLight);\n"
"        } else {\n"
"            lit += u.sunCol.rgb * backLight * edgeLight * 0.24;\n"
"        }\n"
"    }\n"
"\n"
"    // Highway grazing sunset reflection & anisotropic specular sheen (`role == 1.0`)\n"
"    if (abs(role - 1.0) < 0.1) {\n"
"        float3 halfV = normalize(sunDir + viewDir);\n"
"        float ndv = clamp(dot(normalW, viewDir), 0.0, 1.0);\n"
"        float roadFresnel = pow(1.0 - ndv, 3.0);\n"
"        float3 refl = reflect(-viewDir, normalW);\n"
"        float3 skyRefl = stkSampleSkyEnv(refl, u, skyTex, skySampler);\n"
"        // Saturated golden-orange sun streak on the sunward lane of the asphalt + sharp micro-aggregate glint\n"
"        float sunBroad = pow(max(dot(normalW, halfV), 0.0), 14.0) * u.camUp.w;\n"
"        float sunSharp = pow(max(dot(normalW, halfV), 0.0), 48.0) * u.camUp.w;\n"
"        float sunwardBias = smoothstep(0.28, -0.42, (in.uv.x > 1.5 ? in.uv.x - 2.0 : in.uv.x) - 0.5);\n"
"        float shadowMod = mix(0.20, 1.0, treeShadow);\n"
"        float3 goldenStreak = float3(1.0, 0.52, 0.14) * (sunBroad * (0.24 + 0.52 * sunwardBias) + sunSharp * 0.30) * shadowMod;\n"
"        lit = mix(lit, skyRefl * shadowMod, roadFresnel * 0.18 * (1.0 - 0.65 * roadPaintMask))\n"
"            + goldenStreak * (1.0 - 0.55 * roadPaintMask);\n"
"    }\n"
"\n"
"    // Coastal ocean Fresnel sky reflection, subsurface emerald wave-crest glow & micro-facet sun glitter (`role == 3.0`)\n"
"    if (abs(role - 3.0) < 0.1) {\n"
"        float wt = u.hazeParams.z;\n"
"        float foamMask = roadPaintMask;\n"
"        // Smooth un-posterized liquid water diffuse shading (bypasses 3-band cartoon quantization on ocean)\n"
"        float waterDiff = clamp(ndl * 0.85 + 0.15, 0.38, 1.0);\n"
"        float3 waterBase = albedo * mix(toonShade * 0.96, toonSun * 1.04, waterDiff);\n"
"        float3 refl = reflect(-viewDir, normalW);\n"
"        float3 skyRefl = stkSampleSkyEnv(refl, u, skyTex, skySampler);\n"
"        // Physical Schlick Fresnel (F0 = 0.035), damped on aerated whitecap/surf foam\n"
"        float ndvW = clamp(dot(normalW, viewDir), 0.0, 1.0);\n"
"        float waterFresnel = (0.035 + 0.94 * pow(1.0 - ndvW, 4.0)) * (1.0 - 0.78 * foamMask);\n"
"        // Subsurface jade-aquamarine transmission through backlit and steep wave crests\n"
"        float waveTilt = smoothstep(0.06, 0.42, 1.0 - normalW.y);\n"
"        float waveBacklit = pow(clamp(dot(-viewDir, sunDir), 0.0, 1.0), 1.5) * waveTilt;\n"
"        float3 waveSss = float3(0.06, 0.84, 0.72) * (0.28 * waveTilt + 0.72 * waveBacklit) * (1.0 - 0.65 * foamMask) * u.camUp.w * 0.58;\n"
"        // Dual-scale sun glitter: broad golden sun path + high-frequency capillary diamond micro-facets\n"
"        float3 halfV = normalize(sunDir + viewDir);\n"
"        float ndh = max(dot(normalW, halfV), 0.0);\n"
"        float2 capG = float2(\n"
"            sin(in.worldPos.x * 3.8 + in.worldPos.z * 2.9 + wt * 6.4) + cos(in.worldPos.x * 5.2 - in.worldPos.z * 4.1 - wt * 7.8),\n"
"            cos(in.worldPos.x * 3.4 - in.worldPos.z * 3.7 + wt * 5.9) - sin(in.worldPos.x * 4.7 + in.worldPos.z * 4.9 - wt * 8.3)\n"
"        ) * 0.09;\n"
"        float3 microN = normalize(normalW + float3(capG.x, 0.0, capG.y));\n"
"        float ndhMicro = max(dot(microN, halfV), 0.0);\n"
"        float sunGlint = (pow(ndhMicro, 180.0) * 2.45 + pow(ndh, 48.0) * 0.95 + pow(ndh, 12.0) * 0.36) * (1.0 - 0.55 * foamMask) * u.camUp.w;\n"
"        float3 glintCol = mix(u.sunCol.rgb, float3(1.0, 0.78, 0.42), 0.38);\n"
"        lit = mix(waterBase + waveSss, skyRefl, clamp(waterFresnel, 0.0, 0.92)) + glintCol * sunGlint;\n"
"    }\n"
"\n"
"    // Warm sunlit silhouette rim light (`toonRim` in `TOON_GLSL`)\n"
"    if (role < 0.5 || abs(role - 6.0) < 0.1 || isCar) {\n"
"        float fresnel = pow(clamp(1.0 - abs(dot(normalW, viewDir)), 0.0, 1.0), 2.4);\n"
"        float sunAlign = clamp(dot(-viewDir, sunDir) * 0.5 + 0.5, 0.0, 1.0);\n"
"        float rim = smoothstep(0.36, 0.76, fresnel) * (0.35 + 0.65 * sunAlign) * (0.35 + 0.65 * toonBand);\n"
"        lit += mix(toonSun, u.sunCol.rgb, 0.5) * rim * 0.34;\n"
"    }\n"
"\n"
"    // Silhouette contour ink darkening on props and foliage (`CONTOUR` in `TOON_GLSL`)\n"
"    if (role < 0.5 || abs(role - 6.0) < 0.1) {\n"
"        float ndv = abs(dot(normalW, viewDir));\n"
"        float ink = mix(0.60, 1.0, smoothstep(0.06, 0.28, ndv));\n"
"        lit *= ink;\n"
"    }\n"
"\n"
"    // Automotive clearcoat lacquer, mirror chrome & tinted glass (`role == 8.0`)\n"
"    if (isCar) {\n"
"        float3 halfV = normalize(sunDir + viewDir);\n"
"        float ndh = max(dot(normalW, halfV), 0.0);\n"
"        float ndv = max(dot(normalW, viewDir), 0.0);\n"
"        float3 refl = reflect(-viewDir, normalW);\n"
"        float3 envCol = stkSampleSkyEnv(refl, u, skyTex, skySampler);\n"
"        float canopyRipple = 0.90 + 0.10 * sin(in.worldPos.z * 0.55 + refl.x * 4.0);\n"
"        envCol *= canopyRipple;\n"
"\n"
"        if (brushFlag > 1.5) {\n"
"            // Automotive Tinted Glass (`glass`): deep smoked cabin with sky/cloud reflection\n"
"            float glassFresnel = 0.24 + 0.74 * pow(1.0 - ndv, 2.8);\n"
"            float glassSpec = pow(ndh, 110.0);\n"
"            lit = mix(albedo * 0.28, envCol, glassFresnel) + float3(1.0, 0.95, 0.85) * glassSpec * 1.15;\n"
"        } else if (brushFlag > 0.5) {\n"
"            // Mirror Chrome & Alloy Rims (`chrome` / `rim`): high-F0 conductor reflection\n"
"            float3 roadBounce = float3(0.14, 0.15, 0.18);\n"
"            float3 chromeEnv = mix(roadBounce, envCol, smoothstep(-0.25, 0.15, refl.y));\n"
"            float chromeSpec = pow(ndh, 84.0) * 1.25 + pow(ndh, 18.0) * 0.30;\n"
"            lit = mix(lit * 0.30, chromeEnv, 0.78) + float3(1.0, 0.96, 0.88) * chromeSpec;\n"
"        } else {\n"
"            // Sculpted Metallic Clearcoat Car Paint (`paint`): deep crimson creases + golden sunset fender rim\n"
"            float bodyContour = mix(0.28, 1.05, pow(clamp(normalW.y * 0.5 + 0.5, 0.0, 1.0), 1.35) * (0.45 + 0.55 * toonBand));\n"
"            float3 deepBase = pow(max(albedo, float3(0.001)), float3(1.18)) * bodyContour;\n"
"            float specCoat = pow(ndh, 96.0);\n"
"            float specFlake = pow(ndh, 16.0);\n"
"            float fresnel = 0.08 + 0.86 * pow(1.0 - ndv, 3.2);\n"
"            float3 flakeTint = mix(albedo, u.sunCol.rgb, 0.45);\n"
"            lit = mix(deepBase, envCol, fresnel * 0.52)\n"
"                + flakeTint * (specFlake * 0.38)\n"
"                + float3(1.0, 0.94, 0.84) * (specCoat * 0.95 + fresnel * 0.20);\n"
"        }\n"
"    }\n"
"\n"
"    // Warm night headlight pool on the road ahead of the hero car (`bHeadlightPool` in `renderer.js`)\n"
"    if ((abs(role - 1.0) < 0.1 || abs(role - 2.0) < 0.1) && u.camUp.w < 0.5 && u.horizonCol.g < 0.35) {\n"
"        float3 poolCenter = u.cameraEye.xyz + u.camForward.xyz * 19.5;\n"
"        float2 dPool = in.worldPos.xz - poolCenter.xz;\n"
"        float2 fwdXz = normalize(u.camForward.xz + float2(1e-5, 0.0));\n"
"        float2 rightXz = normalize(u.camRight.xz + float2(1e-5, 0.0));\n"
"        float fwdDist = dot(dPool, fwdXz);\n"
"        float latDist = dot(dPool, rightXz);\n"
"        float ellip = length(float2(latDist / 3.75, fwdDist / 11.0));\n"
"        if (ellip < 1.0) {\n"
"            float poolFalloff = pow(1.0 - ellip, 1.75);\n"
"            lit += float3(1.0, 0.925, 0.769) * poolFalloff * 0.48;\n"
"        }\n"
"    }\n"
"\n"
"    // Per-stage atmospheric distance haze & golden-hour directional sun-glare (`sunHaze`)\n"
"    float dist = distance(u.cameraEye.xyz, in.worldPos);\n"
"    float fogScale = (u.camUp.w > 0.5 && u.sunDir.y < 0.18) ? 0.085 : 0.14;\n"
"    float fogDist = dist * u.hazeParams.y * fogScale;\n"
"    float expFog = 1.0 - exp(-fogDist * fogDist);\n"
"    float farReveal = smoothstep(680.0, 1480.0, dist);\n"
"    float fogFactor = clamp(max(expFog, farReveal), 0.0, 1.0);\n"
"    float sunLook = pow(clamp(dot(-viewDir, sunDir), 0.0, 1.0), 3.0);\n"
"    float3 sunHaze = mix(u.horizonCol.rgb, float3(0.96, 0.56, 0.24), sunLook * 0.52);\n"
"    float3 finalRgb = mix(lit, sunHaze, fogFactor);\n"
"\n"
"    // Subtle Kazuo Oga watercolor paper tooth (`STYLE_GLSL`)\n"
"    float paperGrain = stkHash21(floor(in.position.xy * 0.5)) - 0.5;\n"
"    finalRgb += paperGrain * 0.012;\n"
"    if (u.hazeParams.x > 0.005) {\n"
"        finalRgb = mix(finalRgb, float3(0.965, 0.851, 0.706), clamp(u.hazeParams.x, 0.0, 1.0));\n"
"    }\n"
"    // Alpha = 1.0 marks 3D geometry so `post_fs` radial god-rays are occluded by palm trees & cars.\n"
"    return float4(max(finalRgb, float3(0.0)), 1.0);\n"
"}\n"
"\n"
"// Pass 2: Fullscreen HDR composite pass (`post_fs`):\n"
"//   0. Screen-Space Horizon Ground-Truth Ambient Occlusion (GTAO) from `depthTex`\n"
"//   1. Peripheral high-speed radial asphalt streak blur (keeping hero car & horizon sharp)\n"
"//   2. 24-tap shadow-occluded crepuscular god-rays streaming through palm fronds from `sunDir`\n"
"//   3. Dual-radius 8-tap HDR Kawase/tent bloom on taillights, nitro flames, windows & sun corona\n"
"//   4. Golden-hour ACES filmic tonemapping + subtle optical vignette\n"
"fragment float4 post_fs(\n"
"    SkyOut in [[stage_in]],\n"
"    constant SceneUniforms &u [[buffer(0)]],\n"
"    texture2d<float> hdrTex [[texture(0)]],\n"
"    texture2d<float> depthTex [[texture(1)]],\n"
"    sampler postSampler [[sampler(0)]]\n"
") {\n"
"    float2 texUv = float2(in.uv.x, 1.0 - in.uv.y);\n"
"    float4 centerSample = hdrTex.sample(postSampler, texUv);\n"
"    float3 hdrCol = centerSample.rgb;\n"
"\n"
"    // 0. Screen-Space Ground-Truth Ambient Occlusion (GTAO) at prop/tree/curb/cliff crevices\n"
"    float dCenter = depthTex.sample(postSampler, texUv).r;\n"
"    if (dCenter < 0.9985) {\n"
"        float2 aoTexel = float2(1.0 / 1280.0, 1.0 / 800.0);\n"
"        float2 aoDirs[4] = {\n"
"            float2( 1.0,  0.0),\n"
"            float2( 0.0,  1.0),\n"
"            float2( 0.707,  0.707),\n"
"            float2(-0.707,  0.707)\n"
"        };\n"
"        float occ = 0.0;\n"
"        for (int k = 0; k < 4; k++) {\n"
"            float dPos = depthTex.sample(postSampler, clamp(texUv + aoDirs[k] * aoTexel * 3.0, 0.002, 0.998)).r;\n"
"            float dNeg = depthTex.sample(postSampler, clamp(texUv - aoDirs[k] * aoTexel * 3.0, 0.002, 0.998)).r;\n"
"            float valley = max(dCenter - 0.5 * (dPos + dNeg), 0.0);\n"
"            float rangeCheck = smoothstep(0.012, 0.001, abs(dPos - dNeg));\n"
"            occ += clamp(valley * 420.0, 0.0, 1.0) * rangeCheck;\n"
"        }\n"
"        float gtao = 1.0 - clamp(occ * 0.14, 0.0, 0.34);\n"
"        hdrCol *= mix(u.toonShade.rgb * 0.78, float3(1.0), gtao);\n"
"    }\n"
"\n"
"    // 1. Peripheral high-speed radial road motion streaks\n"
"    float speedKmh = clamp(u.camRight.w, 0.0, 340.0);\n"
"    float nitroAmt = clamp(u.camForward.w, 0.0, 1.0);\n"
"    float speedFactor = clamp((speedKmh - 90.0) / 220.0 + nitroAmt * 0.45, 0.0, 1.0);\n"
"    float2 vanishUv = float2(0.50, 0.47);\n"
"    float2 toEdge = texUv - vanishUv;\n"
"    float edgeDist = length(toEdge);\n"
"    // Protect center hero car (`distance(texUv, (0.5, 0.72)) < 0.24`) and upper sky (`texUv.y < 0.48`)\n"
"    float carProtect = smoothstep(0.18, 0.30, length((texUv - float2(0.50, 0.73)) * float2(1.0, 1.35)));\n"
"    float roadPeriphery = smoothstep(0.20, 0.52, edgeDist) * smoothstep(0.46, 0.62, texUv.y) * carProtect * speedFactor;\n"
"    if (roadPeriphery > 0.01) {\n"
"        float2 blurDir = normalize(toEdge) * (0.014 * roadPeriphery);\n"
"        float3 streak = hdrCol * 0.36;\n"
"        streak += hdrTex.sample(postSampler, clamp(texUv - blurDir * 0.5, 0.002, 0.998)).rgb * 0.24;\n"
"        streak += hdrTex.sample(postSampler, clamp(texUv - blurDir * 1.0, 0.002, 0.998)).rgb * 0.20;\n"
"        streak += hdrTex.sample(postSampler, clamp(texUv + blurDir * 0.5, 0.002, 0.998)).rgb * 0.12;\n"
"        streak += hdrTex.sample(postSampler, clamp(texUv + blurDir * 1.0, 0.002, 0.998)).rgb * 0.08;\n"
"        hdrCol = mix(hdrCol, streak, clamp(roadPeriphery * 0.85, 0.0, 0.85));\n"
"    }\n"
"\n"
"    // 2. 24-tap shadow-occluded crepuscular god-rays streaming from the sun through the palm trees\n"
"    if (u.camUp.w > 0.5) {\n"
"        float3 sunDirW = normalize(u.sunDir.xyz);\n"
"        float sunFwd = dot(normalize(u.camForward.xyz), sunDirW);\n"
"        if (sunFwd > 0.05) {\n"
"            float4 sunClip = u.viewProj * float4(u.cameraEye.xyz + sunDirW * 1000.0, 1.0);\n"
"            float2 sunNdc = sunClip.xy / max(sunClip.w, 0.001);\n"
"            float2 sunUv = float2(sunNdc.x * 0.5 + 0.5, 0.5 - sunNdc.y * 0.5);\n"
"            float2 toSun = sunUv - texUv;\n"
"            float2 deltaUv = toSun / 24.0;\n"
"            float sunDist = length(toSun);\n"
"            float rayAngle = atan2(toSun.y, toSun.x);\n"
"            float rayFan = 0.76 + 0.24 * sin(rayAngle * 20.0 + sin(rayAngle * 7.0) * 1.5);\n"
"            float radialFalloff = exp(-sunDist * 2.1) * smoothstep(0.05, 0.35, sunFwd) * rayFan;\n"
"            float2 marchUv = texUv;\n"
"            float3 shaftAccum = float3(0.0);\n"
"            float weight = 1.0;\n"
"            for (int i = 0; i < 24; i++) {\n"
"                marchUv += deltaUv;\n"
"                float4 s = hdrTex.sample(postSampler, clamp(marchUv, 0.002, 0.998));\n"
"                float skyUnoccluded = 1.0 - clamp(s.a, 0.0, 1.0);\n"
"                float3 brightSky = max(s.rgb - float3(0.45), float3(0.0));\n"
"                shaftAccum += min(brightSky, float3(2.2)) * skyUnoccluded * weight;\n"
"                weight *= 0.93;\n"
"            }\n"
"            float3 shaftTint = float3(1.0, 0.58, 0.18);\n"
"            hdrCol += (shaftAccum / 24.0) * shaftTint * radialFalloff * 0.52;\n"
"        }\n"
"    }\n"
"\n"
"    // 3. Dual-radius HDR Bloom (taillights, nitro exhaust flames, lit skyscraper windows & sun corona)\n"
"    float2 texel = float2(1.0 / 1280.0, 1.0 / 800.0);\n"
"    float2 offsets[8] = {\n"
"        float2(-1.5, -1.5), float2(1.5, -1.5), float2(-1.5, 1.5), float2(1.5, 1.5),\n"
"        float2(-3.8,  0.0), float2(3.8,  0.0), float2( 0.0, -3.8), float2(0.0, 3.8)\n"
"    };\n"
"    float3 bloomAccum = float3(0.0);\n"
"    for (int k = 0; k < 8; k++) {\n"
"        float3 bSample = hdrTex.sample(postSampler, clamp(texUv + offsets[k] * texel, 0.002, 0.998)).rgb;\n"
"        float3 bright = max(bSample - float3(0.95), float3(0.0));\n"
"        bloomAccum += bright;\n"
"    }\n"
"    hdrCol += (bloomAccum / 8.0) * 0.52;\n"
"\n"
"    // 4. Filmic shoulder tonemapping + subtle optical corner vignette\n"
"    float3 mapped = stkFilmicShoulder(hdrCol);\n"
"    float2 vigUv = texUv * 2.0 - 1.0;\n"
"    float vig = 1.0 - 0.14 * dot(vigUv * float2(0.85, 0.95), vigUv * float2(0.85, 0.95));\n"
"    return float4(clamp(mapped * vig, 0.0, 1.0), 1.0);\n"
"}\n";

static inline void apexAssertNoJsException(JSContextRef ctx, JSValueRef exc, const char *where) {
    if (!exc) {
        return;
    }
    NSString *msg = @"JavaScript exception";
    JSStringRef jsStr = JSValueToStringCopy(ctx, exc, NULL);
    if (jsStr) {
        CFStringRef cfStr = JSStringCopyCFString(kCFAllocatorDefault, jsStr);
        msg = (__bridge_transfer NSString *)cfStr;
        JSStringRelease(jsStr);
    }
    [NSException raise:@"ApexRunJavaScriptException" format:@"%s: %@", where, msg];
}

static inline void mat4_perspective(float *m, float fovy_rad, float aspect, float zn, float zf) {
    memset(m, 0, 16 * sizeof(float));
    float f = 1.0f / tanf(fovy_rad * 0.5f);
    m[0] = f / (aspect > 0.01f ? aspect : 1.777f);
    m[5] = f;
    m[10] = zf / (zf - zn);
    m[11] = 1.0f;
    m[14] = (-zn * zf) / (zf - zn);
}

static inline void mat4_ortho_lh(float *m, float half_w, float half_h, float zn, float zf) {
    memset(m, 0, 16 * sizeof(float));
    m[0] = 1.0f / fmaxf(half_w, 1.0f);
    m[5] = 1.0f / fmaxf(half_h, 1.0f);
    m[10] = 1.0f / fmaxf(zf - zn, 1.0f);
    m[14] = -zn / fmaxf(zf - zn, 1.0f);
    m[15] = 1.0f;
}

static inline void mat4_look_at_lh(
    float *m,
    const float eye[3],
    const float target[3],
    const float up[3],
    float out_fwd[3],
    float out_right[3],
    float out_up[3]
) {
    float fx = target[0] - eye[0];
    float fy = target[1] - eye[1];
    float fz = target[2] - eye[2];
    float flen = sqrtf(fx * fx + fy * fy + fz * fz);
    if (flen < 1e-5f) {
        fx = 0.0f; fy = 0.0f; fz = 1.0f;
    } else {
        fx /= flen; fy /= flen; fz /= flen;
    }

    float rx = up[1] * fz - up[2] * fy;
    float ry = up[2] * fx - up[0] * fz;
    float rz = up[0] * fy - up[1] * fx;
    float rlen = sqrtf(rx * rx + ry * ry + rz * rz);
    if (rlen < 1e-5f) {
        rx = 1.0f; ry = 0.0f; rz = 0.0f;
    } else {
        rx /= rlen; ry /= rlen; rz /= rlen;
    }

    float ux = fy * rz - fz * ry;
    float uy = fz * rx - fx * rz;
    float uz = fx * ry - fy * rx;

    out_fwd[0] = fx; out_fwd[1] = fy; out_fwd[2] = fz;
    out_right[0] = rx; out_right[1] = ry; out_right[2] = rz;
    out_up[0] = ux; out_up[1] = uy; out_up[2] = uz;

    m[0] = rx;  m[1] = ux;  m[2] = fx;  m[3] = 0.0f;
    m[4] = ry;  m[5] = uy;  m[6] = fy;  m[7] = 0.0f;
    m[8] = rz;  m[9] = uz;  m[10] = fz; m[11] = 0.0f;
    m[12] = -(rx * eye[0] + ry * eye[1] + rz * eye[2]);
    m[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
    m[14] = -(fx * eye[0] + fy * eye[1] + fz * eye[2]);
    m[15] = 1.0f;
}

static inline void mat4_mul(float *out, const float *a, const float *b) {
    float r[16];
    for (int col = 0; col < 4; col++) {
        for (int row = 0; row < 4; row++) {
            r[col * 4 + row] =
                a[0 * 4 + row] * b[col * 4 + 0] +
                a[1 * 4 + row] * b[col * 4 + 1] +
                a[2 * 4 + row] * b[col * 4 + 2] +
                a[3 * 4 + row] * b[col * 4 + 3];
        }
    }
    memcpy(out, r, sizeof(r));
}

#define kAudioBufferCount 3
#define kAudioFramesPerBuffer 1024

static AudioQueueRef gAudioQueue = NULL;
static AudioQueueBufferRef gAudioBuffers[kAudioBufferCount];

static void ApexAudioQueueCallback(
    void *inUserData,
    AudioQueueRef inAQ,
    AudioQueueBufferRef inBuffer
) {
    (void)inUserData;
    float *samples = (float *)inBuffer->mAudioData;
    apexrun_rust_render_audio(samples, kAudioFramesPerBuffer);
    inBuffer->mAudioDataByteSize = kAudioFramesPerBuffer * 2 * sizeof(float);
    AudioQueueEnqueueBuffer(inAQ, inBuffer, 0, NULL);
}

static inline void start_coreaudio_stream(void) {
    AudioStreamBasicDescription fmt = {0};
    fmt.mSampleRate = 48000.0;
    fmt.mFormatID = kAudioFormatLinearPCM;
    fmt.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
    fmt.mBytesPerPacket = 2 * sizeof(float);
    fmt.mFramesPerPacket = 1;
    fmt.mBytesPerFrame = 2 * sizeof(float);
    fmt.mChannelsPerFrame = 2;
    fmt.mBitsPerChannel = 32;

    OSStatus status = AudioQueueNewOutput(&fmt, ApexAudioQueueCallback, NULL, NULL, NULL, 0, &gAudioQueue);
    if (status != noErr || !gAudioQueue) {
        return;
    }
    UInt32 byteSize = kAudioFramesPerBuffer * 2 * sizeof(float);
    for (int i = 0; i < kAudioBufferCount; i++) {
        if (AudioQueueAllocateBuffer(gAudioQueue, byteSize, &gAudioBuffers[i]) == noErr) {
            ApexAudioQueueCallback(NULL, gAudioQueue, gAudioBuffers[i]);
        }
    }
    AudioQueueStart(gAudioQueue, NULL);
}

static inline NSString *locateSeedAssetsDirectory(void) {
    NSString *envDir = [[[NSProcessInfo processInfo] environment] objectForKey:@"APEXRUN_ASSETS_DIR"];
    if (envDir.length > 0 && [[NSFileManager defaultManager] fileExistsAtPath:envDir]) {
        return envDir;
    }
    NSString *bundleRes = [[[NSBundle mainBundle] resourcePath] stringByAppendingPathComponent:@"seed-assets"];
    if (bundleRes.length > 0 && [[NSFileManager defaultManager] fileExistsAtPath:bundleRes]) {
        return bundleRes;
    }
    NSString *exeDir = [[[NSBundle mainBundle] executablePath] stringByDeletingLastPathComponent];
    NSString *relRes = [exeDir stringByAppendingPathComponent:@"../Resources/seed-assets"];
    if (relRes.length > 0 && [[NSFileManager defaultManager] fileExistsAtPath:relRes]) {
        return relRes;
    }
    NSString *cwdAssets = [[[NSFileManager defaultManager] currentDirectoryPath] stringByAppendingPathComponent:@"apps/apexrun/.seed-assets"];
    if ([[NSFileManager defaultManager] fileExistsAtPath:cwdAssets]) {
        return cwdAssets;
    }
    return nil;
}

static inline id<MTLTexture> apexLoadSeedTexture(
    id<MTLDevice> device,
    NSMutableDictionary<NSString *, id<MTLTexture>> *cache,
    NSString *fileName
) {
    if (!fileName || fileName.length == 0 || !device) {
        return nil;
    }
    id<MTLTexture> cached = cache[fileName];
    if (cached) {
        return cached;
    }
    NSString *seedDir = locateSeedAssetsDirectory();
    if (!seedDir) {
        return nil;
    }
    NSString *fullPath = [seedDir stringByAppendingPathComponent:fileName];
    if (![[NSFileManager defaultManager] fileExistsAtPath:fullPath]) {
        return nil;
    }
    NSURL *url = [NSURL fileURLWithPath:fullPath];
    CGImageSourceRef src = CGImageSourceCreateWithURL((__bridge CFURLRef)url, NULL);
    if (!src) {
        return nil;
    }
    CGImageRef cgImg = CGImageSourceCreateImageAtIndex(src, 0, NULL);
    CFRelease(src);
    if (!cgImg) {
        return nil;
    }
    size_t width = CGImageGetWidth(cgImg);
    size_t height = CGImageGetHeight(cgImg);
    if (width == 0 || height == 0) {
        CGImageRelease(cgImg);
        return nil;
    }
    uint8_t *rgba = (uint8_t *)calloc(width * height * 4, 1);
    CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
    CGContextRef ctx = CGBitmapContextCreate(
        rgba,
        width,
        height,
        8,
        width * 4,
        cs,
        kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big
    );
    CGColorSpaceRelease(cs);
    if (!ctx) {
        free(rgba);
        CGImageRelease(cgImg);
        return nil;
    }
    CGContextDrawImage(ctx, CGRectMake(0, 0, (CGFloat)width, (CGFloat)height), cgImg);
    CGContextRelease(ctx);
    CGImageRelease(cgImg);

    size_t totalPixels = width * height;
    for (size_t i = 0; i < totalPixels; i++) {
        uint8_t a = rgba[i * 4 + 3];
        if (a > 0 && a < 255) {
            float invA = 255.0f / (float)a;
            int r = (int)roundf((float)rgba[i * 4 + 0] * invA);
            int g = (int)roundf((float)rgba[i * 4 + 1] * invA);
            int b = (int)roundf((float)rgba[i * 4 + 2] * invA);
            rgba[i * 4 + 0] = (uint8_t)(r > 255 ? 255 : r);
            rgba[i * 4 + 1] = (uint8_t)(g > 255 ? 255 : g);
            rgba[i * 4 + 2] = (uint8_t)(b > 255 ? 255 : b);
        }
    }

    MTLTextureDescriptor *td = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA8Unorm
                                                                                  width:width
                                                                                 height:height
                                                                              mipmapped:NO];
    td.usage = MTLTextureUsageShaderRead;
    id<MTLTexture> tex = [device newTextureWithDescriptor:td];
    [tex replaceRegion:MTLRegionMake2D(0, 0, width, height)
           mipmapLevel:0
             withBytes:rgba
           bytesPerRow:width * 4];
    free(rgba);
    if (tex && cache) {
        cache[fileName] = tex;
    }
    return tex;
}

static id<MTLRenderPipelineState> sShadowPipeline = nil;
static id<MTLRenderPipelineState> sPostPipeline = nil;
static id<MTLSamplerState> sPostSampler = nil;
static id<MTLTexture> sShadowDepthTex = nil;
static id<MTLTexture> sHdrColorTex = nil;
static id<MTLTexture> sHdrDepthTex = nil;
static id<MTLTexture> sPropAtlasTex = nil;
static NSUInteger sHdrWidth = 0;
static NSUInteger sHdrHeight = 0;
static double sLastFrameWallSec = 0.0;
static float sEmaFrameMs = 8.0f;
static float sDynamicRenderScale = 1.0f;

static inline void apexSetupMetalPipelines(
    id<MTLDevice> device,
    MTKView *metalView,
    id<MTLRenderPipelineState> __strong *outSkyPipeline,
    id<MTLDepthStencilState> __strong *outSkyDepth,
    id<MTLRenderPipelineState> __strong *outStagePipeline,
    id<MTLDepthStencilState> __strong *outStageDepth,
    id<MTLSamplerState> __strong *outSkySampler,
    id<MTLSamplerState> __strong *outGroundSampler,
    id<MTLTexture> __strong *outFallbackTexture
) {
    NSError *err = nil;
    id<MTLLibrary> lib = [device newLibraryWithSource:kApexMetalShaderSource options:nil error:&err];
    if (!lib) {
        [NSException raise:@"ApexRunMetalShaderException" format:@"Metal shader compile error: %@", err];
    }

    MTLRenderPipelineDescriptor *shadowDesc = [[MTLRenderPipelineDescriptor alloc] init];
    shadowDesc.vertexFunction = [lib newFunctionWithName:@"shadow_vs"];
    shadowDesc.fragmentFunction = nil;
    shadowDesc.depthAttachmentPixelFormat = MTLPixelFormatDepth32Float;
    shadowDesc.rasterSampleCount = 1;
    sShadowPipeline = [device newRenderPipelineStateWithDescriptor:shadowDesc error:&err];
    if (!sShadowPipeline) {
        [NSException raise:@"ApexRunMetalPipelineException" format:@"Failed to create shadow pipeline: %@", err];
    }

    MTLRenderPipelineDescriptor *skyDesc = [[MTLRenderPipelineDescriptor alloc] init];
    skyDesc.vertexFunction = [lib newFunctionWithName:@"sky_vs"];
    skyDesc.fragmentFunction = [lib newFunctionWithName:@"sky_fs"];
    skyDesc.colorAttachments[0].pixelFormat = MTLPixelFormatRGBA16Float;
    skyDesc.depthAttachmentPixelFormat = MTLPixelFormatDepth32Float;
    skyDesc.rasterSampleCount = 1;
    *outSkyPipeline = [device newRenderPipelineStateWithDescriptor:skyDesc error:&err];
    if (!*outSkyPipeline) {
        [NSException raise:@"ApexRunMetalPipelineException" format:@"Failed to create sky pipeline: %@", err];
    }

    MTLDepthStencilDescriptor *skyDepth = [[MTLDepthStencilDescriptor alloc] init];
    skyDepth.depthCompareFunction = MTLCompareFunctionAlways;
    skyDepth.depthWriteEnabled = NO;
    *outSkyDepth = [device newDepthStencilStateWithDescriptor:skyDepth];

    MTLRenderPipelineDescriptor *stageDesc = [[MTLRenderPipelineDescriptor alloc] init];
    stageDesc.vertexFunction = [lib newFunctionWithName:@"stage_vs"];
    stageDesc.fragmentFunction = [lib newFunctionWithName:@"stage_fs"];
    stageDesc.colorAttachments[0].pixelFormat = MTLPixelFormatRGBA16Float;
    stageDesc.colorAttachments[0].blendingEnabled = YES;
    stageDesc.colorAttachments[0].sourceRGBBlendFactor = MTLBlendFactorSourceAlpha;
    stageDesc.colorAttachments[0].destinationRGBBlendFactor = MTLBlendFactorOneMinusSourceAlpha;
    stageDesc.colorAttachments[0].sourceAlphaBlendFactor = MTLBlendFactorOne;
    stageDesc.colorAttachments[0].destinationAlphaBlendFactor = MTLBlendFactorOne;
    stageDesc.depthAttachmentPixelFormat = MTLPixelFormatDepth32Float;
    stageDesc.rasterSampleCount = 1;
    *outStagePipeline = [device newRenderPipelineStateWithDescriptor:stageDesc error:&err];
    if (!*outStagePipeline) {
        [NSException raise:@"ApexRunMetalPipelineException" format:@"Failed to create stage pipeline: %@", err];
    }

    MTLRenderPipelineDescriptor *postDesc = [[MTLRenderPipelineDescriptor alloc] init];
    postDesc.vertexFunction = [lib newFunctionWithName:@"sky_vs"];
    postDesc.fragmentFunction = [lib newFunctionWithName:@"post_fs"];
    postDesc.colorAttachments[0].pixelFormat = metalView.colorPixelFormat;
    postDesc.depthAttachmentPixelFormat = metalView.depthStencilPixelFormat;
    postDesc.rasterSampleCount = metalView.sampleCount;
    sPostPipeline = [device newRenderPipelineStateWithDescriptor:postDesc error:&err];
    if (!sPostPipeline) {
        [NSException raise:@"ApexRunMetalPipelineException" format:@"Failed to create post pipeline: %@", err];
    }

    MTLSamplerDescriptor *postSampDesc = [[MTLSamplerDescriptor alloc] init];
    postSampDesc.minFilter = MTLSamplerMinMagFilterLinear;
    postSampDesc.magFilter = MTLSamplerMinMagFilterLinear;
    postSampDesc.sAddressMode = MTLSamplerAddressModeClampToEdge;
    postSampDesc.tAddressMode = MTLSamplerAddressModeClampToEdge;
    sPostSampler = [device newSamplerStateWithDescriptor:postSampDesc];

    MTLDepthStencilDescriptor *stageDepth = [[MTLDepthStencilDescriptor alloc] init];
    stageDepth.depthCompareFunction = MTLCompareFunctionLessEqual;
    stageDepth.depthWriteEnabled = YES;
    *outStageDepth = [device newDepthStencilStateWithDescriptor:stageDepth];

    MTLSamplerDescriptor *sampDesc = [[MTLSamplerDescriptor alloc] init];
    sampDesc.minFilter = MTLSamplerMinMagFilterLinear;
    sampDesc.magFilter = MTLSamplerMinMagFilterLinear;
    sampDesc.mipFilter = MTLSamplerMipFilterLinear;
    sampDesc.maxAnisotropy = 16;
    sampDesc.sAddressMode = MTLSamplerAddressModeRepeat;
    sampDesc.tAddressMode = MTLSamplerAddressModeClampToEdge;
    *outSkySampler = [device newSamplerStateWithDescriptor:sampDesc];

    MTLSamplerDescriptor *groundSampDesc = [[MTLSamplerDescriptor alloc] init];
    groundSampDesc.minFilter = MTLSamplerMinMagFilterLinear;
    groundSampDesc.magFilter = MTLSamplerMinMagFilterLinear;
    groundSampDesc.mipFilter = MTLSamplerMipFilterLinear;
    groundSampDesc.maxAnisotropy = 16;
    groundSampDesc.sAddressMode = MTLSamplerAddressModeRepeat;
    groundSampDesc.tAddressMode = MTLSamplerAddressModeRepeat;
    *outGroundSampler = [device newSamplerStateWithDescriptor:groundSampDesc];

    MTLTextureDescriptor *fbDesc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA8Unorm
                                                                                      width:1
                                                                                     height:1
                                                                                  mipmapped:NO];
    fbDesc.usage = MTLTextureUsageShaderRead;
    id<MTLTexture> fbTex = [device newTextureWithDescriptor:fbDesc];
    uint8_t whitePx[4] = { 205, 218, 208, 0 };
    [fbTex replaceRegion:MTLRegionMake2D(0, 0, 1, 1) mipmapLevel:0 withBytes:whitePx bytesPerRow:4];
    *outFallbackTexture = fbTex;
}

static inline void apexEncodeSceneRenderPass(
    id<MTLDevice> device,
    id<MTLCommandBuffer> cmdBuf,
    MTKView *metalView,
    MTLRenderPassDescriptor *drawableRpd,
    const float *latestPose,
    NSString *currentStageId,
    float aspect,
    id<MTLRenderPipelineState> skyPipeline,
    id<MTLDepthStencilState> skyDepthState,
    id<MTLRenderPipelineState> stagePipeline,
    id<MTLDepthStencilState> stageDepthState,
    id<MTLSamplerState> skySampler,
    id<MTLSamplerState> groundSampler,
    id<MTLTexture> skyTexture,
    id<MTLTexture> farBackdropTexture,
    id<MTLTexture> midBackdropTexture,
    id<MTLTexture> groundTexture,
    id<MTLTexture> fallbackTexture,
    id<MTLBuffer> staticVertexBuffer,
    id<MTLBuffer> staticIndexBuffer,
    NSUInteger staticIndexCount
) {
    // Dynamic Cross-Platform Performance Governor:
    // Measures rolling frame pacing (`sEmaFrameMs`) and smoothly adapts internal HDR render scale (`0.72..1.0`)
    // with hysteresis so both high-refresh Desktop GPUs and thermal-constrained mobile GPUs stay locked at target Hz.
    double nowSec = CACurrentMediaTime();
    if (sLastFrameWallSec > 0.0) {
        float dtMs = (float)((nowSec - sLastFrameWallSec) * 1000.0);
        if (dtMs > 1.0f && dtMs < 80.0f) {
            sEmaFrameMs = sEmaFrameMs * 0.90f + dtMs * 0.10f;
        }
    }
    sLastFrameWallSec = nowSec;
    if (sEmaFrameMs > 15.8f && sDynamicRenderScale > 0.72f) {
        sDynamicRenderScale = fmaxf(0.72f, sDynamicRenderScale - 0.04f);
    } else if (sEmaFrameMs < 11.2f && sDynamicRenderScale < 1.0f) {
        sDynamicRenderScale = fminf(1.0f, sDynamicRenderScale + 0.02f);
    }
    // Quantize scale to 8% steps to avoid reallocating textures on tiny jitter
    float quantScale = roundf(sDynamicRenderScale * 12.5f) / 12.5f;
    NSUInteger w = (NSUInteger)fmax(320.0, round(metalView.drawableSize.width * quantScale));
    NSUInteger h = (NSUInteger)fmax(200.0, round(metalView.drawableSize.height * quantScale));
    if (!sHdrColorTex || !sHdrDepthTex || sHdrWidth != w || sHdrHeight != h) {
        sHdrWidth = w;
        sHdrHeight = h;
        MTLTextureDescriptor *cDesc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA16Float
                                                                                         width:w
                                                                                        height:h
                                                                                     mipmapped:NO];
        cDesc.usage = MTLTextureUsageRenderTarget | MTLTextureUsageShaderRead;
        cDesc.storageMode = MTLStorageModePrivate;
        sHdrColorTex = [device newTextureWithDescriptor:cDesc];

        MTLTextureDescriptor *dDesc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatDepth32Float
                                                                                         width:w
                                                                                        height:h
                                                                                     mipmapped:NO];
        dDesc.usage = MTLTextureUsageRenderTarget | MTLTextureUsageShaderRead;
        dDesc.storageMode = MTLStorageModePrivate;
        sHdrDepthTex = [device newTextureWithDescriptor:dDesc];
    }

    if (!sShadowDepthTex) {
        MTLTextureDescriptor *sdDesc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatDepth32Float
                                                                                          width:2048
                                                                                         height:2048
                                                                                      mipmapped:NO];
        sdDesc.usage = MTLTextureUsageRenderTarget | MTLTextureUsageShaderRead;
        sdDesc.storageMode = MTLStorageModePrivate;
        sShadowDepthTex = [device newTextureWithDescriptor:sdDesc];
    }

    if (!sPropAtlasTex) {
        uint32_t aw = 0, ah = 0;
        const uint8_t *atlasPtr = apexrun_rust_get_prop_atlas(&aw, &ah);
        if (atlasPtr && aw > 0 && ah > 0) {
            MTLTextureDescriptor *aDesc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA8Unorm
                                                                                             width:aw
                                                                                            height:ah
                                                                                         mipmapped:YES];
            aDesc.usage = MTLTextureUsageShaderRead;
            sPropAtlasTex = [device newTextureWithDescriptor:aDesc];
            [sPropAtlasTex replaceRegion:MTLRegionMake2D(0, 0, aw, ah)
                             mipmapLevel:0
                               withBytes:atlasPtr
                             bytesPerRow:aw * 4];
            id<MTLBlitCommandEncoder> blit = [cmdBuf blitCommandEncoder];
            [blit generateMipmapsForTexture:sPropAtlasTex];
            [blit endEncoding];
        }
    }

    SceneUniformsC u = {0};
    float eye[3] = { latestPose[4], latestPose[5], latestPose[6] };
    float target[3] = { latestPose[7], latestPose[8], latestPose[9] };
    float up[3] = { 0.0f, 1.0f, 0.0f };
    float fov = latestPose[10] > 0.2f ? latestPose[10] : 0.92f;

    float viewMat[16], projMat[16], fwd[3], right[3], camUp[3];
    mat4_look_at_lh(viewMat, eye, target, up, fwd, right, camUp);
    mat4_perspective(projMat, fov, aspect, 0.40f, 6000.0f);
    mat4_mul(u.view_proj, projMat, viewMat);

    u.camera_eye[0] = eye[0];
    u.camera_eye[1] = eye[1];
    u.camera_eye[2] = eye[2];
    u.camera_eye[3] = tanf(fov * 0.5f);

    StagePaletteC pal = stagePaletteForId(currentStageId);
    u.sun_dir[0] = pal.sun_dir[0];
    u.sun_dir[1] = pal.sun_dir[1];
    u.sun_dir[2] = pal.sun_dir[2];
    u.sun_dir[3] = pal.turn;

    // Directional Sun Shadow orthographic cascade centered 55m ahead of the camera
    float sunFocus[3] = {
        eye[0] + fwd[0] * 55.0f,
        eye[1] + fwd[1] * 10.0f,
        eye[2] + fwd[2] * 55.0f
    };
    float sx = pal.sun_dir[0];
    float sy = fmaxf(pal.sun_dir[1], 0.22f);
    float sz = pal.sun_dir[2];
    float slen = sqrtf(sx * sx + sy * sy + sz * sz);
    sx /= slen; sy /= slen; sz /= slen;
    float sunEye[3] = {
        sunFocus[0] + sx * 180.0f,
        sunFocus[1] + sy * 180.0f,
        sunFocus[2] + sz * 180.0f
    };
    float sunView[16], sunProj[16], sFwd[3], sRight[3], sUp[3];
    mat4_look_at_lh(sunView, sunEye, sunFocus, up, sFwd, sRight, sUp);
    mat4_ortho_lh(sunProj, 110.0f, 110.0f, 10.0f, 380.0f);
    mat4_mul(u.sun_view_proj, sunProj, sunView);

    u.haze_params[0] = latestPose[58];
    u.haze_params[1] = latestPose[13] > 0.0001f ? latestPose[13] : 0.012f;
    u.haze_params[2] = latestPose[2];
    u.haze_params[3] = aspect;

    u.cam_forward[0] = fwd[0];   u.cam_forward[1] = fwd[1];   u.cam_forward[2] = fwd[2];
    u.cam_forward[3] = latestPose[34];
    u.cam_right[0] = right[0];   u.cam_right[1] = right[1];   u.cam_right[2] = right[2];
    u.cam_right[3] = latestPose[17];
    u.cam_up[0] = camUp[0];      u.cam_up[1] = camUp[1];      u.cam_up[2] = camUp[2];
    u.cam_up[3] = pal.has_sun;

    u.horizon_col[0] = pal.horizon_srgb[0];
    u.horizon_col[1] = pal.horizon_srgb[1];
    u.horizon_col[2] = pal.horizon_srgb[2];
    u.horizon_col[3] = (skyTexture != nil) ? 1.0f : 0.0f;

    u.toon_sun[0] = pal.toon_sun[0];
    u.toon_sun[1] = pal.toon_sun[1];
    u.toon_sun[2] = pal.toon_sun[2];
    u.toon_sun[3] = (farBackdropTexture != nil) ? 1.0f : 0.0f;

    u.toon_shade[0] = pal.toon_shade[0];
    u.toon_shade[1] = pal.toon_shade[1];
    u.toon_shade[2] = pal.toon_shade[2];
    u.toon_shade[3] = (midBackdropTexture != nil) ? 1.0f : 0.0f;

    u.sun_col[0] = pal.sun_col[0];
    u.sun_col[1] = pal.sun_col[1];
    u.sun_col[2] = pal.sun_col[2];
    u.sun_col[3] = (groundTexture != nil) ? pal.ground_tile : 0.0f;

    const GpuVertexC *dynVerts = NULL;
    size_t dynVertCount = 0;
    const uint32_t *dynIndices = NULL;
    size_t dynIndexCount = 0;
    MacHudSnapshotC unusedSnap;
    apexrun_rust_sync_frame(
        NULL, NULL, NULL, 0, 0, NULL,
        &dynVerts, &dynVertCount, &dynIndices, &dynIndexCount, &unusedSnap
    );

    id<MTLBuffer> dynVBuf = nil;
    id<MTLBuffer> dynIBuf = nil;
    if (dynVerts && dynVertCount > 0 && dynIndices && dynIndexCount > 0) {
        dynVBuf = [device newBufferWithBytes:dynVerts
                                      length:dynVertCount * sizeof(GpuVertexC)
                                     options:MTLResourceStorageModeShared];
        dynIBuf = [device newBufferWithBytes:dynIndices
                                      length:dynIndexCount * sizeof(uint32_t)
                                     options:MTLResourceStorageModeShared];
    }

    const StaticChunkC *staticChunks = NULL;
    size_t staticChunkCount = 0;
    apexrun_rust_get_static_chunks(&staticChunks, &staticChunkCount);

    // Pass 0: Directional Sun Shadow Map Depth Pass (`2048x2048` `MTLPixelFormatDepth32Float`)
    // Culls static spatial chunks outside the shadow cascade (`[eye.z - 55m .. eye.z + 195m]`).
    if (sShadowPipeline && sShadowDepthTex) {
        MTLRenderPassDescriptor *shadowRpd = [MTLRenderPassDescriptor renderPassDescriptor];
        shadowRpd.depthAttachment.texture = sShadowDepthTex;
        shadowRpd.depthAttachment.loadAction = MTLLoadActionClear;
        shadowRpd.depthAttachment.storeAction = MTLStoreActionStore;
        shadowRpd.depthAttachment.clearDepth = 1.0;

        id<MTLRenderCommandEncoder> sEnc = [cmdBuf renderCommandEncoderWithDescriptor:shadowRpd];
        if (pal.has_sun > 0.5f) {
            [sEnc setRenderPipelineState:sShadowPipeline];
            [sEnc setDepthStencilState:stageDepthState];
            [sEnc setVertexBytes:&u length:sizeof(u) atIndex:1];
            if (staticVertexBuffer && staticIndexBuffer && staticIndexCount > 0) {
                [sEnc setVertexBuffer:staticVertexBuffer offset:0 atIndex:0];
                if (staticChunks && staticChunkCount > 0) {
                    float shadowZMin = eye[2] - 55.0f;
                    float shadowZMax = eye[2] + 195.0f;
                    for (size_t ci = 0; ci < staticChunkCount; ci++) {
                        StaticChunkC ch = staticChunks[ci];
                        if (ch.z_max >= shadowZMin && ch.z_min <= shadowZMax && ch.index_count > 0) {
                            [sEnc drawIndexedPrimitives:MTLPrimitiveTypeTriangle
                                             indexCount:ch.index_count
                                              indexType:MTLIndexTypeUInt32
                                            indexBuffer:staticIndexBuffer
                                      indexBufferOffset:(NSUInteger)ch.index_offset * sizeof(uint32_t)];
                        }
                    }
                } else {
                    [sEnc drawIndexedPrimitives:MTLPrimitiveTypeTriangle
                                     indexCount:staticIndexCount
                                      indexType:MTLIndexTypeUInt32
                                    indexBuffer:staticIndexBuffer
                              indexBufferOffset:0];
                }
            }
            if (dynVBuf && dynIBuf && dynIndexCount > 0) {
                [sEnc setVertexBuffer:dynVBuf offset:0 atIndex:0];
                [sEnc drawIndexedPrimitives:MTLPrimitiveTypeTriangle
                                 indexCount:dynIndexCount
                                  indexType:MTLIndexTypeUInt32
                                indexBuffer:dynIBuf
                          indexBufferOffset:0];
            }
        }
        [sEnc endEncoding];
    }

    // Pass 1: Offscreen RGBA16Float HDR 3D Scene Pass
    MTLRenderPassDescriptor *hdrRpd = [MTLRenderPassDescriptor renderPassDescriptor];
    hdrRpd.colorAttachments[0].texture = sHdrColorTex;
    hdrRpd.colorAttachments[0].loadAction = MTLLoadActionClear;
    hdrRpd.colorAttachments[0].storeAction = MTLStoreActionStore;
    hdrRpd.colorAttachments[0].clearColor = MTLClearColorMake(0.0, 0.0, 0.0, 0.0);
    hdrRpd.depthAttachment.texture = sHdrDepthTex;
    hdrRpd.depthAttachment.loadAction = MTLLoadActionClear;
    hdrRpd.depthAttachment.storeAction = MTLStoreActionStore;
    hdrRpd.depthAttachment.clearDepth = 1.0;

    id<MTLRenderCommandEncoder> enc = [cmdBuf renderCommandEncoderWithDescriptor:hdrRpd];
    if (skyPipeline) {
        [enc setRenderPipelineState:skyPipeline];
        [enc setDepthStencilState:skyDepthState];
        [enc setFragmentBytes:&u length:sizeof(u) atIndex:0];
        [enc setFragmentTexture:(skyTexture ?: fallbackTexture) atIndex:0];
        [enc setFragmentTexture:(farBackdropTexture ?: fallbackTexture) atIndex:1];
        [enc setFragmentTexture:(midBackdropTexture ?: fallbackTexture) atIndex:2];
        [enc setFragmentSamplerState:skySampler atIndex:0];
        [enc drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:3];
    }

    if (stagePipeline) {
        [enc setRenderPipelineState:stagePipeline];
        [enc setDepthStencilState:stageDepthState];
        [enc setVertexBytes:&u length:sizeof(u) atIndex:1];
        [enc setFragmentBytes:&u length:sizeof(u) atIndex:1];
        [enc setFragmentTexture:(groundTexture ?: fallbackTexture) atIndex:0];
        [enc setFragmentTexture:(skyTexture ?: fallbackTexture) atIndex:1];
        [enc setFragmentTexture:(sPropAtlasTex ?: fallbackTexture) atIndex:2];
        [enc setFragmentTexture:(sShadowDepthTex ?: fallbackTexture) atIndex:3];
        [enc setFragmentSamplerState:(groundSampler ?: skySampler) atIndex:0];
        [enc setFragmentSamplerState:skySampler atIndex:1];

        if (staticVertexBuffer && staticIndexBuffer && staticIndexCount > 0) {
            [enc setVertexBuffer:staticVertexBuffer offset:0 atIndex:0];
            if (staticChunks && staticChunkCount > 0) {
                float viewZMin = eye[2] - 45.0f;
                float viewZMax = eye[2] + 1650.0f;
                for (size_t ci = 0; ci < staticChunkCount; ci++) {
                    StaticChunkC ch = staticChunks[ci];
                    if (ch.z_max >= viewZMin && ch.z_min <= viewZMax && ch.index_count > 0) {
                        [enc drawIndexedPrimitives:MTLPrimitiveTypeTriangle
                                        indexCount:ch.index_count
                                         indexType:MTLIndexTypeUInt32
                                       indexBuffer:staticIndexBuffer
                                 indexBufferOffset:(NSUInteger)ch.index_offset * sizeof(uint32_t)];
                    }
                }
            } else {
                [enc drawIndexedPrimitives:MTLPrimitiveTypeTriangle
                                indexCount:staticIndexCount
                                 indexType:MTLIndexTypeUInt32
                               indexBuffer:staticIndexBuffer
                         indexBufferOffset:0];
            }
        }

        if (dynVBuf && dynIBuf && dynIndexCount > 0) {
            [enc setVertexBuffer:dynVBuf offset:0 atIndex:0];
            [enc drawIndexedPrimitives:MTLPrimitiveTypeTriangle
                            indexCount:dynIndexCount
                             indexType:MTLIndexTypeUInt32
                           indexBuffer:dynIBuf
                     indexBufferOffset:0];
        }
    }
    [enc endEncoding];

    // Pass 2: Fullscreen Post-Process Composite Pass (GTAO, God-Rays, HDR Bloom, Speed Streaks & ACES Grade)
    id<MTLRenderCommandEncoder> postEnc = [cmdBuf renderCommandEncoderWithDescriptor:drawableRpd];
    if (sPostPipeline && sHdrColorTex) {
        [postEnc setRenderPipelineState:sPostPipeline];
        [postEnc setDepthStencilState:skyDepthState];
        [postEnc setFragmentBytes:&u length:sizeof(u) atIndex:0];
        [postEnc setFragmentTexture:sHdrColorTex atIndex:0];
        [postEnc setFragmentTexture:(sHdrDepthTex ?: sHdrColorTex) atIndex:1];
        [postEnc setFragmentSamplerState:(sPostSampler ?: skySampler) atIndex:0];
        [postEnc drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:3];
    }
    [postEnc endEncoding];
}

#endif // APEX_APPLE_HOST_COMMON_H
