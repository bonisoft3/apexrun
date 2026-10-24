// Apex Run Canvas Renderer
// Renders pseudo-3D curved road projection, billboard sprites, karts,
// drift particles, exhaust nitro flames, and arcade racing HUD.

import { WAVE_TICKS, OUTRUN_STAGES, CHARACTERS, METRES_PER_UNIT, LATERAL_UNITS, INTRO_TICKS, ARCH_LEAD, COUNTDOWN_TICKS, GO_TICKS, STEER_FULL } from './simulation.js';
import { STAGE_LOOKS, PROP_BUILDERS, PROP_FOOTPRINT, PROP_RADIUS, SHORE, placeProps } from './stage_look.js';
import { createPrng } from './prng.js';
import { NIGHT_STAGES, brushStrokes, flowerCarpet, frondTexture, waveNormals } from './scenery.js';
import { lerp, lerpAngle } from '/omnishell/interpreter/kinetic.js';
import { scatterVerge, VERGE_SCATTER } from './scatter.js';
import { ArtLibrary, FLAGMAN, HERO_CAR, KIND_HEIGHT, MODEL_TURN, RIDERS, modelScales, ROAD_ALBEDO, STAGE_ART, TILE_METRES, TRAFFIC_LOD, TRAFFIC_MODELS, artEntry, fogVisible, lodFor } from './art.js';

// How hard the stylising pass inks, bands and saturates (DESIGN.md "Stylised AAA").
export const STYLE = { outline: 0.12, saturation: 1.0 };
// DESIGN.md "Ghibli gouache": the grade of a clear painted afternoon: soft
// cream highlights over cool shade, colour a little held back, low contrast.
export const GRADE = {
  highlightsHue: 50, highlightsDensity: 10, highlightsSaturation: 10,
  shadowsHue: 210, shadowsDensity: 15, shadowsSaturation: 15,
  globalSaturation: 0, contrast: 1.08,
};
// Metres the sea runs out from the shore, and one tile of its waves.
const SEA_REACH = 2500;
const WAVE_METRES = 50;
// Pack materials the wind moves (the plants' leaves and blades).
const SWAYING = new Set(['frond', 'frond_dry', 'grass', 'leaf']);
// How many metres the chase camera looks along the car's heading per radian.
const CAMERA_LOOK = 12;
// The verge scatter's chunk length in segments, and how far behind and ahead
// of the camera, in metres, a chunk is drawn: past that the lens and the haze
// have it.
const SCATTER_CHUNK = 25;
const SCATTER_BEHIND = 30;
const SCATTER_AHEAD = 360;
// DESIGN.md "Ghibli gouache": a coast road's promenade and sea wall, metres
// past the rumble edge: the promenade to the wall's road face, the wall's
// sea face, and its height over the road.
export const SEA_WALL = { wall: 3.6, out: 4.2, height: 0.9 };
// The concept's promenade is a painted mid-grey pavement beside a grey
// concrete wall, not pale sand.
export const PROMENADE = { paving: '#8E8B82', face: '#9C9E96', top: '#B6B3A8' };
// Pack materials repainted for the concepts: the saguaros' sage green under
// warm light, where the pack's was a bright toy green.
export const MATERIAL_TINTS = { cactus: '#6E8350', cactus_tip: '#9AA66E' };
// Pack foliage lifted toward the concepts' lit greens, per model: measured
// against them, the cypress and broadleaf stages' land sat at luminance
// 0.11-0.16 against 0.27.
export const MATERIAL_LIFT = { 'cypress/foliage': 1.5, 'tree-broadleaf-a/foliage': 1.3, 'tree-broadleaf-b/foliage': 1.3 };
/**
 * Where a verge item on the promenade grows: bushes and flowers in a bed
 * along the sea wall's road face, as the concept's greenery and flowers
 * stand against its wall; anything else not at all (null).
 */
export function promenadeBed(kind) {
  return kind === 'bush' || kind === 'flower' ? SEA_WALL.wall - 0.45 : null;
}
// DESIGN.md "Ghibli gouache": the passenger's gestures: his waving arm's turn
// at rest, on the door; and his glances, one every GLANCE_PERIOD seconds,
// alternately toward the scenery and the girl (radians of head turn).
const WAVE_REST = 1.15;
// The girl's wave at her ending (DESIGN.md "End of a run"): her outer arm's
// piece of skin lies past `side` metres out and below `chin` in her seat's
// frame (assets/tools/cartoon/riders/figures.py), turns about her shoulder,
// lifts `raise` radians from the wheel, leans `out` radians past her hair
// and swings `swing` radians either way of that at `rate` radians a second;
// the ticks she waves for once the car is parked.
const GIRL_ARM = { side: 0.08, chin: 0.5, shoulder: [0.15, 0.39, -0.01], raise: 1.9, out: 0.55, swing: 0.3, rate: 9 };
const GIRL_WAVE_TICKS = 150;
const GLANCE_PERIOD = 9;
const GLANCE_SCENERY = 0.6;
const GLANCE_GIRL = -0.5;
// DESIGN.md "Race flow": past a fork stage's end its branches run on this far,
// so the view ahead never meets the road's edge; the world hazes out over the
// stage's last metres and back in over the next stage's first, toward an
// exponential fog this dense at full haze (about 150 m of sight).
export const LEAD_OUT_METRES = 400;
// Past a destination stage's end the road runs on into its ending's set
// piece (DESIGN.md "End of a run"), and the land on this far past the
// furthest piece, so the camera pulled up over the place sees land behind it.
const TERMINUS_LAND = 600;

/** Metres a stage's road and land run on past its end. */
export function runOnMetres(stageId) {
  const destination = STAGE_LOOKS[stageId].destination;
  return destination ? Math.max(...destination.map((piece) => piece.beyond)) + TERMINUS_LAND : LEAD_OUT_METRES;
}

/** Metres past a destination stage's end its road runs to: the foot of the place it arrives at. */
export function terminusRoadMetres(stageId) {
  const [place] = STAGE_LOOKS[stageId].destination;
  return place.beyond - PROP_FOOTPRINT[place.kind] * place.scale;
}
export const HAZE_IN_METRES = 160;
export const HAZE_OUT_METRES = 240;
const HAZE_DENSITY = 0.012;
// Metres of road, land and scenery behind the grid, so the start's swoop
// looks back over a world rather than past its edge.
export const LEAD_IN_METRES = 400;
// Metres up from the car's root the body pitches and rolls about: the
// axles' height, so the body moves over wheels that stay put.
const BODY_PIVOT_Y = 0.32;
// The nitro flames' exhausts, metres out from the centreline and up.
const EXHAUST_X = 0.36;
const EXHAUST_Y = 0.26;
// The toon look (DESIGN.md "Toon", "Ghibli gouache"): the lit colour of every
// PBR surface replaced by three soft painted steps of the light reaching it
// (cast shadows included), lit tones toward the warm sun, shade toward the
// cool sky; foliage painted as warm and cool leaf masses and every other
// model with gouache strokes, warm on top, cool at the foot and softly
// contoured; a warm rim on silhouettes facing the sun; lamps keep their glow
// and the fog is laid back on.
export const TOON_GLSL = `
#ifdef STK_TOON
float toonL = dot(diffuseBase, vec3(0.2126, 0.7152, 0.0722)) / max(toonLevel, 0.001);
float toonBand = smoothstep(0.08, 0.30, toonL) * 0.4 + smoothstep(0.42, 0.62, toonL) * 0.35 + smoothstep(0.75, 0.95, toonL) * 0.25;
#ifdef STK_PAINTED
toonBand = PAINTED_FLOOR + (1.0 - PAINTED_FLOOR) * toonBand;
#endif
vec3 toonCol = surfaceAlbedo * mix(toonShade, toonSun, toonBand);
#ifdef STK_LEAVES
float leafMass = 1.0 - smoothstep(0.3, 0.8, stkCells(vPositionW * LEAF_PER_METRE));
toonCol *= mix(LEAF_COOL, LEAF_WARM, leafMass * (0.4 + 0.6 * toonBand)) * mix(LEAF_GAP, 1.0, leafMass);
#endif
#ifdef STK_BRUSH
toonCol *= stkBrushTone(vPositionW, normalW, distance(vEyePosition.xyz, vPositionW));
toonCol *= mix(GRADE_FOOT, vec3(1.0), smoothstep(0.0, GRADE_METRES, vStkLift)) * mix(vec3(1.0), GRADE_TOP, max(normalW.y, 0.0));
toonCol *= 1.0 - CONTOUR * smoothstep(0.6, 0.92, 1.0 - abs(dot(normalW, viewDirectionW)));
#endif
#ifdef STK_PATCH
toonCol *= 0.8 + 0.4 * stkGrain(vec3(vPositionW.x, 0.0, vPositionW.z) * PATCH_PER_METRE);
#endif
float toonEdge = 1.0 - max(dot(normalW, viewDirectionW), 0.0);
toonCol += toonRim * smoothstep(0.8, 0.95, toonEdge) * (1.0 - smoothstep(0.5, 0.85, normalW.y));
toonCol += finalEmissive;
#ifdef FOG
float toonFog = toLinearSpace(CalcFogFactor());
toonCol = mix(vFogColor, toonCol, toonFog);
#endif
finalColor = vec4(toonCol, finalColor.a);
#endif
`;
export const TOON_WGSL = `
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
toonCol *= 0.8 + 0.4 * stkGrain(vec3f(fragmentInputs.vPositionW.x, 0.0, fragmentInputs.vPositionW.z) * PATCH_PER_METRE);
#endif
let toonEdge: f32 = 1.0 - max(dot(normalW, viewDirectionW), 0.0);
toonCol += uniforms.toonRim * smoothstep(0.8, 0.95, toonEdge) * (1.0 - smoothstep(0.5, 0.85, normalW.y));
toonCol += finalEmissive;
#ifdef FOG
let toonFog: f32 = toLinearSpace(CalcFogFactor());
toonCol = mix(uniforms.vFogColor, toonCol, toonFog);
#endif
finalColor = vec4f(toonCol, finalColor.a);
#endif
`;

// DESIGN.md "Ghibli gouache": painted leaf masses and brushwork. The models
// have no UVs, so both are laid in world space: leaf masses are two octaves
// of value noise about a metre across, split between a warm lit tint and a
// cool blue-green shade; the strokes are a tile (brushStrokes) projected on
// the three planes the surface faces most, a tile every 1.25 m, lighter
// strokes warm and darker ones cool. Each model warms toward the sky and
// cools over its lowest GRADE_METRES; its contour darkens softly.
const LEAF_PER_METRE = 1.4;
const BRUSH_PER_METRE = 0.8;
const BRUSH_WARM = [1.26, 1.15, 0.9];
const BRUSH_COOL = [0.72, 0.82, 1.02];
// Past BRUSH_NEAR metres the tile doubles with each doubling of distance, so
// a stroke keeps its size on screen instead of averaging to grey; and how
// hard each stroke's tone is pushed toward its warm or cool end.
const BRUSH_NEAR = 12;
const BRUSH_PUSH = 2.8;
const GRADE_METRES = 2.0;
const GRADE_FOOT = [0.82, 0.9, 1.0];
const GRADE_TOP = [1.06, 1.02, 0.94];
const CONTOUR = 0.45;
const LEAF_WARM = [1.14, 1.1, 0.8];
const LEAF_COOL = [0.72, 0.86, 0.86];
// The dark between leaf masses, as a share of the mass's own tone.
const LEAF_GAP = 0.74;
// A baked painting's toon light: its darkest band still carries this share
// of the sun, so the painted shade is not shaded twice.
const PAINTED_FLOOR = 0.3;
// The ground's patches, lighter and darker, are tens of metres across.
const PATCH_PER_METRE = 0.045;
export const TOON_DEFS_GLSL = `
#define LEAF_PER_METRE ${LEAF_PER_METRE.toFixed(2)}
#define BRUSH_PER_METRE ${BRUSH_PER_METRE.toFixed(2)}
#define BRUSH_NEAR ${BRUSH_NEAR.toFixed(1)}
#define BRUSH_PUSH ${BRUSH_PUSH.toFixed(2)}
#define LEAF_WARM vec3(${LEAF_WARM.join(', ')})
#define LEAF_COOL vec3(${LEAF_COOL.join(', ')})
#define LEAF_GAP ${LEAF_GAP.toFixed(2)}
#define PAINTED_FLOOR ${PAINTED_FLOOR.toFixed(2)}
#define PATCH_PER_METRE ${PATCH_PER_METRE.toFixed(3)}
#define BRUSH_WARM vec3(${BRUSH_WARM.join(', ')})
#define BRUSH_COOL vec3(${BRUSH_COOL.join(', ')})
#define GRADE_METRES ${GRADE_METRES.toFixed(2)}
#define GRADE_FOOT vec3(${GRADE_FOOT.join(', ')})
#define GRADE_TOP vec3(${GRADE_TOP.join(', ')})
#define CONTOUR ${CONTOUR.toFixed(2)}
#ifdef STK_BRUSH
varying float vStkLift;
uniform sampler2D stkBrush;
float stkBrushPlanes(vec3 q, vec3 w) {
  return texture2D(stkBrush, q.zy).r * w.x + texture2D(stkBrush, q.xz).r * w.y + texture2D(stkBrush, q.xy).r * w.z;
}
vec3 stkBrushTone(vec3 p, vec3 n, float dist) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= dot(w, vec3(1.0));
  float octave = log2(max(dist / BRUSH_NEAR, 1.0));
  float k = BRUSH_PER_METRE / exp2(floor(octave));
  float b = mix(stkBrushPlanes(p * k, w), stkBrushPlanes(p * k * 0.5, w), fract(octave));
  return mix(BRUSH_COOL, BRUSH_WARM, clamp((b - 0.5) * BRUSH_PUSH + 0.5, 0.0, 1.0));
}
#endif
float stkHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float stkNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(stkHash(i), stkHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(stkHash(i + vec3(0.0, 1.0, 0.0)), stkHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(stkHash(i + vec3(0.0, 0.0, 1.0)), stkHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(stkHash(i + vec3(0.0, 1.0, 1.0)), stkHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float stkGrain(vec3 p) { return 0.65 * stkNoise(p) + 0.35 * stkNoise(p * 2.7); }
#ifdef STK_LEAVES
float stkCells(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); float d = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 r = o + vec3(stkHash(i + o), stkHash(i + o + 17.1), stkHash(i + o + 31.7)) - f;
    d = min(d, dot(r, r));
  }
  return sqrt(d);
}
#endif
`;
export const TOON_DEFS_WGSL = `
const LEAF_PER_METRE: f32 = ${LEAF_PER_METRE.toFixed(2)};
const BRUSH_PER_METRE: f32 = ${BRUSH_PER_METRE.toFixed(2)};
const BRUSH_NEAR: f32 = ${BRUSH_NEAR.toFixed(1)};
const BRUSH_PUSH: f32 = ${BRUSH_PUSH.toFixed(2)};
const LEAF_WARM: vec3f = vec3f(${LEAF_WARM.join(', ')});
const LEAF_COOL: vec3f = vec3f(${LEAF_COOL.join(', ')});
const LEAF_GAP: f32 = ${LEAF_GAP.toFixed(2)};
const PAINTED_FLOOR: f32 = ${PAINTED_FLOOR.toFixed(2)};
const PATCH_PER_METRE: f32 = ${PATCH_PER_METRE.toFixed(3)};
const BRUSH_WARM: vec3f = vec3f(${BRUSH_WARM.join(', ')});
const BRUSH_COOL: vec3f = vec3f(${BRUSH_COOL.join(', ')});
const GRADE_METRES: f32 = ${GRADE_METRES.toFixed(2)};
const GRADE_FOOT: vec3f = vec3f(${GRADE_FOOT.join(', ')});
const GRADE_TOP: vec3f = vec3f(${GRADE_TOP.join(', ')});
const CONTOUR: f32 = ${CONTOUR.toFixed(2)};
#ifdef STK_BRUSH
varying vStkLift: f32;
var stkBrushSampler: sampler;
var stkBrush: texture_2d<f32>;
fn stkBrushPlanes(q: vec3f, w: vec3f) -> f32 {
  return textureSample(stkBrush, stkBrushSampler, q.zy).r * w.x + textureSample(stkBrush, stkBrushSampler, q.xz).r * w.y + textureSample(stkBrush, stkBrushSampler, q.xy).r * w.z;
}
fn stkBrushTone(p: vec3f, n: vec3f, dist: f32) -> vec3f {
  var w = pow(abs(n), vec3f(4.0));
  w /= dot(w, vec3f(1.0));
  let octave = log2(max(dist / BRUSH_NEAR, 1.0));
  let k = BRUSH_PER_METRE / exp2(floor(octave));
  let b = mix(stkBrushPlanes(p * k, w), stkBrushPlanes(p * k * 0.5, w), fract(octave));
  return mix(BRUSH_COOL, BRUSH_WARM, clamp((b - 0.5) * BRUSH_PUSH + 0.5, 0.0, 1.0));
}
#endif
fn stkHash(q: vec3f) -> f32 { var p = fract(q * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
fn stkNoise(p: vec3f) -> f32 {
  let i = floor(p); var f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(stkHash(i), stkHash(i + vec3f(1.0, 0.0, 0.0)), f.x), mix(stkHash(i + vec3f(0.0, 1.0, 0.0)), stkHash(i + vec3f(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(stkHash(i + vec3f(0.0, 0.0, 1.0)), stkHash(i + vec3f(1.0, 0.0, 1.0)), f.x), mix(stkHash(i + vec3f(0.0, 1.0, 1.0)), stkHash(i + vec3f(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
fn stkGrain(p: vec3f) -> f32 { return 0.65 * stkNoise(p) + 0.35 * stkNoise(p * 2.7); }
#ifdef STK_LEAVES
fn stkCells(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); var d = 8.0;
  for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let o = vec3f(f32(x), f32(y), f32(z));
    let r = o + vec3f(stkHash(i + o), stkHash(i + o + 17.1), stkHash(i + o + 31.7)) - f;
    d = min(d, dot(r, r));
  } } }
  return sqrt(d);
}
#endif
`;
// Each brushed model's height over its own base, for the cool foot.
export const TOON_VERTEX_GLSL = {
  CUSTOM_VERTEX_DEFINITIONS: `#ifdef STK_BRUSH
varying float vStkLift;
#endif`,
  CUSTOM_VERTEX_MAIN_END: `#ifdef STK_BRUSH
vStkLift = (finalWorld * vec4(positionUpdated, 1.0)).y - finalWorld[3].y;
#endif`,
};
export const TOON_VERTEX_WGSL = {
  CUSTOM_VERTEX_DEFINITIONS: `#ifdef STK_BRUSH
varying vStkLift: f32;
#endif`,
  CUSTOM_VERTEX_MAIN_END: `#ifdef STK_BRUSH
vertexOutputs.vStkLift = (finalWorld * vec4f(positionUpdated, 1.0)).y - finalWorld[3].y;
#endif`,
};

/** Whether a material carries a baked painting: the baker marks it in the glTF's extras. */
export function painterly(mat) {
  return mat.metadata?.gltf?.extras?.painted === true;
}

/** Whether a toon material takes the brushwork: the ground and the road carry painted sets of their own. */
export function brushed(name) {
  return name !== 'bGroundMat' && name !== 'bRoadMat';
}

/**
 * Whether a material takes the toon bands. A car's paint, chrome, rims and
 * glass are a model car's lacquer, lit as themselves (DESIGN.md "Ghibli
 * gouache").
 */
export function toonable(name) {
  return !/^(kart_.+|bTraffic_\w+)_(paint|chrome|rim|glass)$/.test(name);
}

/** A model car's lacquer: deep clear-coated paint, mirror chrome and rims, clear glass. */
function lacquer(mat) {
  const part = mat.name.split('_').pop();
  if (part === 'paint') {
    mat.roughness = 0.18;
    mat.clearCoat.isEnabled = true;
    mat.clearCoat.intensity = 1;
    mat.clearCoat.roughness = 0.04;
  } else if (part === 'chrome' || part === 'rim') {
    mat.metallic = 1;
    mat.roughness = part === 'chrome' ? 0.04 : 0.08;
  } else if (part === 'glass') {
    mat.roughness = 0.02;
  }
}


/**
 * How a material is painted beyond the brush mottle every surface carries:
 * leaf masses for canopies, patches for the ground, or nothing more.
 */
export function grainOf(name) {
  if (name === 'bGroundMat') return 'patch';
  if (['foliage', 'frond'].includes(name.split('#').pop())) return 'leaves';
  return null;
}

// Toon tints: the lit band against the sun's colour, the shade against the
// sky's, and the rim's strength when the camera faces the sun.
const TOON_LIT = 1.32;
const TOON_SHADE = 0.74;
// DESIGN.md "Ghibli gouache": warm afternoon light and deep blue-green shade.
const TOON_WARM = [1.08, 1.0, 0.84];
const TOON_COOL = [0.84, 0.96, 1.05];
const TOON_RIM = 0.45;
/**
 * A round light for the toon sun: `edge` is where its rim falls off (1 a hard
 * disc, near 0 a soft halo). RGBA, white with the falloff in alpha.
 */
export function sunGlow(size, edge) {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const a = edge >= 1 ? Math.min(1, Math.max(0, (1 - d) * 24)) : Math.max(0, 1 - d) ** (1 / edge);
      pixels.set([255, 255, 255, Math.round(a * 255)], (y * size + x) * 4);
    }
  }
  return { pixels, width: size, height: size };
}

/**
 * A painted cumulus card (DESIGN.md "Ghibli gouache"), `width` x `height`
 * pixels, of a kind: a towering cumulus, a wide low bank, twin towers, a
 * rounded puff, an anvil, a ridge of humps or a narrow spire, its lobes
 * heaped on a flat base; lit by a sun behind the
 * viewer and to the left, in three soft painted tones from a warm lit top to
 * a blue-grey belly, its edges and steps broken by brush noise; clear
 * outside. RGBA, sRGB, rows top down.
 */
export function cumulusCard(width, height, seed, kind) {
  const card = cumulusPainter(width, height, seed, kind);
  card.paintRows(0, height);
  return { pixels: card.pixels, width, height, topDown: true };
}

/**
 * The same card painted a band of rows at a time, so the cards a stage will
 * need can be readied a few rows a frame while another is driven.
 */
export function cumulusPainter(width, height, seed, kind) {
  const rand = createPrng(seed * 7919 + 13);
  const base = 0.9 * height;
  const lobes = [];
  // A heap of lobes centred at x (pixels), `spread` pixels wide, rising `rise` of the height.
  const heap = (x, spread, rise, layers) => {
    const n0 = Math.max(3, Math.round(spread / (0.16 * height)));
    for (let k = 0; k < n0; k++) {
      const rr = height * (0.08 + 0.05 * rand());
      lobes.push([x - spread / 2 + spread * (k + 0.5) / n0 + 0.05 * height * (rand() - 0.5), base - rr * 0.5, rr]);
    }
    let top = base - height * 0.1;
    for (let layer = 1; layer <= layers; layer++) {
      const f = 1 - layer / (layers + 1.6);
      const count = Math.max(1, Math.round(n0 * f * 0.8));
      let rise_ = 0;
      for (let k = 0; k < count; k++) {
        const rr = height * (0.07 + 0.06 * rand()) * (rise / 0.8) ** 0.3;
        lobes.push([x + spread * f * 0.45 * ((k + 0.5) / count * 2 - 1) + 0.06 * height * (rand() - 0.5), top - rr * (0.4 + 0.3 * rand()), rr]);
        rise_ = Math.max(rise_, rr);
      }
      top -= Math.min(rise_ * 0.95, (rise * height) / layers);
    }
  };
  // Each card of a kind its own: its heaps' place, width and rise vary by seed.
  const v = () => 0.7 + 0.5 * rand();
  if (kind === 'tower') heap(width * (0.35 + 0.3 * rand()), width * 0.6 * v(), 0.82 * v(), 4 + Math.floor(3 * rand()));
  else if (kind === 'bank') { heap(width * (0.45 + 0.1 * rand()), width * 0.9, 0.24 * v(), 1); heap(width * (0.16 + 0.12 * rand()), width * 0.2, 0.78 * v(), 3); }
  else if (kind === 'twin') { const a = 0.2 + 0.15 * rand(); heap(width * a, width * 0.38 * v(), 0.78 * v(), 4); heap(width * (a + 0.4 + 0.15 * rand()), width * 0.34 * v(), 0.5 * v(), 3); }
  else if (kind === 'puff') heap(width * (0.38 + 0.24 * rand()), width * 0.42 * v(), 0.68 * v(), 3);
  else if (kind === 'anvil') {
    const x = width * (0.42 + 0.16 * rand());
    heap(x, width * 0.4, 0.8, 5);
    // The cap spreads from the tower's top: its lobes rest on the highest,
    const top = Math.min(...lobes.map(([, cy, rr]) => cy - rr * 0.3));
    // and it shears downwind, so an anvil leans one way.
    const shear = width * (0.06 + 0.1 * rand());
    for (let k = 0; k < 7; k++) lobes.push([x + shear + width * 0.36 * (k / 3 - 1), top + height * 0.05 * rand(), height * (0.08 + 0.03 * rand())]);
  } else if (kind === 'ridge') {
    const n = 2 + Math.floor(3 * rand());
    // Its humps climb toward the upwind end.
    for (let k = 0; k < n; k++) heap(width * ((k + 0.5) / n + 0.08 * (rand() - 0.5)), width * 0.8 / n, (0.25 + 0.4 * (1 - k / n) + 0.2 * rand()) * v(), Math.max(1, 3 - k));
  }
  else if (kind === 'spire') heap(width * (0.36 + 0.28 * rand()), width * 0.7 * v(), 0.95 * (0.8 + 0.2 * rand()), 5 + Math.floor(2 * rand()));
  else throw new Error(`cumulusCard: no kind ${kind}`);
  // A low skirt trails downwind of every heap, so no card reads the same mirrored.
  if (kind !== 'bank' && kind !== 'ridge') heap(width * (0.78 + 0.08 * rand()), width * 0.3, 0.16 * v(), 1);
  const light = [-0.45, -0.7, 0.55];
  const len = Math.hypot(...light);
  const L = light.map((c) => c / len);
  // Belly, body and sunlit top: the body sits under white, so the tone curve
  // keeps the step to the cream top that a white body lost.
  const tones = [[112, 128, 166], [196, 202, 218], [250, 238, 210]];
  const pixels = new Uint8Array(width * height * 4);
  const paintRows = (from, to) => {
    for (let y = from; y < to; y++) {
      for (let x = 0; x < width; x++) {
        let best = -Infinity;
        let n = null;
        for (const [cx, cy, rr] of lobes) {
          const dx = (x + 0.5 - cx) / rr;
          const dy = (y + 0.5 - cy) / rr;
          const depth = rr * (1 - Math.hypot(dx, dy));
          if (depth > best) { best = depth; n = [dx, dy, Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy))]; }
        }
        const brush = Math.sin(x * 0.37 + y * 0.11 + seed) * Math.sin(y * 0.29 - x * 0.07) * 0.08;
        const alpha = Math.min(1, Math.max(0, best / 3 + 0.4 + brush * 6)) * Math.min(1, Math.max(0, (base + 1 - y) / 4));
        if (alpha <= 0) continue;
        const lit = n[0] * L[0] + n[1] * L[1] + n[2] * L[2] + brush - 0.75 * Math.max(0, (y - (base - height * 0.22)) / (height * 0.22));
        // Painted in two soft steps: shade to body, body to the sunlit top.
        const toBody = smoothstep(-0.12, 0.2, lit);
        const toTop = smoothstep(0.42, 0.7, lit);
        const c = tones[0].map((v, i) => v + (tones[1][i] - v) * toBody + (tones[2][i] - tones[1][i]) * toTop);
        pixels.set([c[0], c[1], c[2], Math.round(alpha * 255)], (y * width + x) * 4);
      }
    }
  };
  return { pixels, width, height, topDown: true, paintRows };
}

// The kinds of cumulus, each with its card's width for its height: a stage's
// cards take one each, so those seen together differ in kind and shape.
export const CLOUD_KINDS = { tower: 1.0, bank: 2.6, twin: 1.7, puff: 1.35, anvil: 1.5, ridge: 2.2, spire: 0.75 };

/** The cumulus a stage paints on its `k`th card: seed, kind, texture size and cache key. */
export function cloudLook(stageId, k) {
  const stageSeed = [...stageId].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 8;
  const kinds = Object.keys(CLOUD_KINDS);
  const seed = stageSeed + k;
  const kind = kinds[seed % kinds.length];
  return { seed, kind, size: [Math.round(160 * CLOUD_KINDS[kind]), 160], key: `cumulus_${seed}` };
}

// Milliseconds a frame may spend readying the next stages' cumulus.
const CLOUD_PREWARM_MS = 4;

// DESIGN.md "Ghibli gouache": painted cumulus in banks one behind another.
// Per bank: metres out to either side of the road, the run of road over
// which its cards come round again, how far their bases float above the eye,
// their heights, how far toward the haze they fade, and how many cards.
export const CLOUD_BANKS = [
  { distance: 1300, span: 6000, lift: 140, metres: [380, 520], haze: 0, cards: 4 },
  { distance: 2200, span: 8000, lift: 220, metres: [520, 720], haze: 0.15, cards: 5 },
  { distance: 3400, span: 10000, lift: 340, metres: [700, 950], haze: 0.3, cards: 5 },
];
// The wind's drift along the road's run in metres a second, and how far the
// cards sway across it; their tone against the exposure, under the bloom so
// their painted shading reads.
const CLOUD_WIND = 1.2;
const CLOUD_SWAY = 40;
const CLOUD_TONE = 0.95;

/**
 * Where a cloud card stands for a camera at (x, y, z) after `windTime`
 * seconds: anchored in the world along the road's run, so the car drives
 * past it, drifting on the wind, and come round ahead again once a quarter
 * of its bank's span behind; held off to its side of the road.
 */
export function cloudPlace(card, x, y, z, windTime) {
  const { span, lift } = CLOUD_BANKS[card.bank];
  const along = card.along + CLOUD_WIND * windTime - z;
  const ahead = ((((along + span / 4) % span) + span) % span) - span / 4;
  return {
    x: x + card.side + CLOUD_SWAY * Math.sin(windTime * 0.05 + card.cloudSeed),
    y: y + lift + card.rise,
    z: z + ahead,
  };
}

// DESIGN.md "Ghibli gouache": a painted afternoon. Radians from the road
// ahead to every stage's sun (behind the viewer and to the left, so the
// faces ahead are lit and modelled), and the band its elevation is held in.
const SUN_TURN = -2.4;
const SUN_ELEVATION = [0.5, 0.7];
// The share of each stage's haze an afternoon's clear air keeps.
export const CLEAR_AIR = 0.22;
// The toon sun's distance and its core's and halo's widths, in metres.
const SUN_DISTANCE = 2400;
const SUN_CORE = 150;
const SUN_HALO = 700;
// The flower carpet: metres past the rumble edge it runs from and to, its
// lift over the ground, and the metres one painted tile covers.
const CARPET = { from: 0.4, to: 6.0, lift: 0.05, tile: 3 };
// A power line: each wire's attachment across the pole and up (metres, at
// the pole's kind height), how far apart two poles may stand and still be
// strung, the wires' sag mid-span, and the segments each span is drawn in.
const WIRE_POINTS = [[-0.62, 8.4], [0.62, 8.4], [0, 9.0]];
const WIRE_SPAN = 120;
const WIRE_SAG = 0.7;
const WIRE_STEPS = 8;
// The replay's shots through a window, as shares of it: the helicopter's
// end, then the chase camera's landmark pull's; the roadside camera has the
// rest. The helicopter's metres behind the car, how far it slides up, out to
// the side away from the landmark, up and how far it drops; the roadside
// camera's least and most metres ahead of the car and behind it, out past
// the rumble edge and up; and how far past its landmark a window still
// frames it.
const REPLAY_SHOTS = {
  helicopter: 0.36,
  pull: 0.66,
  heli: { back: 34, slide: 26, out: 26, up: 24, drop: 7 },
  roadside: { ahead: 170, behind: 45, off: 9, high: 1.4 },
  passed: 120,
};
// Kinds the chase camera also swings wide for, besides each stage's hero
// landmark and the fork's arch; the least spacing of any two such moments,
// and how far past the start the first may come, in metres.
const LANDMARKS = new Set(['colosseum', 'lighthouse', 'castleTower', 'windmill', 'hangar', 'mesa', 'cliff', 'brokenArch', 'tower']);
const LANDMARK_SPACING = 900;
const LANDMARK_START = 400;
// The share of the way a hero landmark turns the chase camera's aim from the
// road toward itself at full pull, and the height up it aims, as a share of
// its own.
const HERO_TURN = 0.47;
const HERO_AIM = 0.45;
// At full pull, metres the chase camera falls back, rises and swings out to
// the landmark's side, and radians its lens widens: about twice its resting
// distance and height, since on the long lens the close chase's pull read
// as half the move.
const PULL_BACK = 7.8;
const PULL_UP = 3.9;
const PULL_SWING = 2.7;
const PULL_LENS = 0.094;
// The chase camera's resting place, framed as the Ghibli concepts are (the
// owner chose their composition): metres behind and above the car's root,
// and how far ahead it aims, so the car sits small at the foot of a long
// lens and the sky takes over a third of the frame. A car within NEAR_FULL metres draws it fully
// in; past NEAR_GONE, not at all.
const CHASE_BACK = 7.5;
const CHASE_UP = 3.0;
const CHASE_AIM = 18;
const NEAR_FULL = 8;
const NEAR_GONE = 90;
// Per frame, the share of the way the camera eases toward the hood and back.
const HOOD_IN = 0.008;
const HOOD_OUT = 0.004;
// Nitro particles per second at full burn, and the share per frame the
// flame fades by once the burst ends.
const FLAME_RATE = 500;
const FLAME_FADE = 0.05;
// Metres the chase camera lifts per radian the road falls away past a crest.
const CREST_LIFT = 7;

/**
 * How much a landmark `ahead` metres away (negative once passed) draws the
 * camera: building from 620 m out, full from 460 m to 80 m, while it stands
 * in the frame ahead, and gone 60 m past it.
 */
export function landmarkPull(ahead) {
  return (1 - smoothstep(460, 620, ahead)) * smoothstep(-60, 80, ahead);
}

/**
 * How far a stage change has hazed the world out, 0 to 1, for a car
 * `metres` into its stage: rising over a fork stage's last HAZE_IN_METRES and
 * falling over every later stage's first HAZE_OUT_METRES.
 */
export function stageHaze(state, metres) {
  const end = state.trackLength * METRES_PER_UNIT;
  const fork = !!OUTRUN_STAGES[state.stageId]?.fork;
  const coming = fork && (state.stageState === 'racing' || state.stageState === 'checkpoint') ? smoothstep(end - HAZE_IN_METRES, end, metres) : 0;
  const leaving = state.stageNum > 1 ? 1 - smoothstep(0, HAZE_OUT_METRES, metres) : 0;
  return Math.max(coming, leaving);
}

/** Hermite step from 0 at `a` to 1 at `b`, as the shaders' smoothstep. */
function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// The marshal faces the oncoming grid and the road (his front is the
// model's -Z), and waves the raised flag this far either side of overhead.
const MARSHAL_FACING = 0.64;
const MARSHAL_WAVE = 0.35;
// Ticks the marshal takes to lift the flag, and to bring the wave up to full
// swing; how far, per radian the arm turns in a tick, the flag trails it.
const MARSHAL_LIFT_TICKS = 40;
const MARSHAL_WAVE_IN = 20;
const MARSHAL_FLAG_DRAG = 2.5;

/** Slow in and out, winding back first and overshooting before it settles. */
function easeInOutBack(t) {
  const c = 1.2;
  const u = Math.max(0, Math.min(1, t)) * 2;
  return u < 1 ? (u * u * ((c + 1) * u - c)) / 2 : ((u - 2) * (u - 2) * ((c + 1) * (u - 2) + c) + 2) / 2;
}

function marshalArm({ stageState, countdown, goTimer, tick }) {
  const counting = stageState === 'warmup' && countdown <= COUNTDOWN_TICKS;
  let raise = 0;
  if (counting) raise = 1;
  else if (stageState === 'warmup') raise = easeInOutBack((INTRO_TICKS + COUNTDOWN_TICKS - countdown) / MARSHAL_LIFT_TICKS);
  else if (goTimer > 0) raise = 1 - easeInOutBack(1 - goTimer / GO_TICKS);
  const wave = counting ? MARSHAL_WAVE * smoothstep(0, MARSHAL_WAVE_IN, COUNTDOWN_TICKS - countdown) * Math.sin(tick * 0.3) : 0;
  return -Math.PI * raise + wave;
}

/**
 * The flag marshal's pose (DESIGN.md "Race flow"), a pure function of the
 * race state: raised overhead and waving through 3-2-1, swept down on GO,
 * at rest otherwise. A negative turn about the shoulder's Z raises the arm;
 * -pi holds the flag straight up. The flag trails the arm's last tick.
 */
export function marshalPose(state) {
  const arm = marshalArm(state);
  const before = marshalArm({
    stageState: state.stageState,
    countdown: state.countdown + 1,
    goTimer: state.goTimer > 0 ? Math.min(GO_TICKS, state.goTimer + 1) : 0,
    tick: state.tick - 1,
  });
  return { arm, flag: -MARSHAL_FLAG_DRAG * (arm - before) };
}
// Windmill sails, radians a second.
const SAIL_TURN = 0.7;
const INK_METRES = 400;

// Prop kinds too low to cast a shadow worth its cost.
const GROUND_COVER = new Set(['grassTuft', 'pool']);
// Meshes the pack's sky already lights through the environment; the
// hemispheric fill, there for the rest, leaves them out.
const SKY_LIT = 0x10000000;
const skyLit = (mesh) => {
  mesh.layerMask |= SKY_LIT;
  return mesh;
};


// The hood cam's eye, up from the road and ahead of the root: over the
// bonnet (0.86 m at the windscreen) and in front of the windscreen.
const HOOD_EYE = { up: 1.0, ahead: 1.0 };
const GLOW_NITRO = Object.freeze({ r: 1.0, g: 0.55, b: 0.1 });

/** What the lighting stack turns on for an engine. */
export function qualityPlan(isWebGPU) {
  return isWebGPU
    ? { shadowMap: 2048, ssao: true, carProbe: true, godRays: true, speedBlur: true, msaa: 4, grade: true, style: true }
    : { shadowMap: 1024, ssao: false, carProbe: false, godRays: true, speedBlur: true, msaa: 1, grade: true, style: true };
}

// Sun shafts: the sky's bright pixels blurred radially toward the sun's
// screen position and added back (Babylon's own pass compiles only via GLSL).
const GOD_RAYS_GLSL = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 sunPos;
uniform float intensity;
void main(void) {
  vec4 base = texture2D(textureSampler, vUV);
  vec2 step = (vUV - sunPos) / 48.0;
  vec2 uv = vUV;
  float decay = 1.0;
  vec3 rays = vec3(0.0);
  for (int k = 0; k < 48; k++) {
    uv -= step;
    vec3 c = texture2D(textureSampler, uv).rgb;
    rays += max(c - vec3(0.72), vec3(0.0)) * decay;
    decay *= 0.955;
  }
  vec2 axis = vec2(0.5) - sunPos;
  vec3 ghost = vec3(0.0);
  for (int g = 1; g < 4; g++) {
    float d = length(vUV - (sunPos + axis * (0.55 * float(g))));
    ghost += vec3(1.0, 0.75 - 0.15 * float(g), 0.45 + 0.15 * float(g)) * (1.0 - smoothstep(0.0, 0.05 + 0.02 * float(g), d)) * 0.06;
  }
  gl_FragColor = vec4(base.rgb + rays * intensity / 48.0 + ghost * intensity, base.a);
}`;

const GOD_RAYS_WGSL = `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
uniform sunPos: vec2f;
uniform intensity: f32;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let base = textureSample(textureSampler, textureSamplerSampler, input.vUV);
  let st = (input.vUV - uniforms.sunPos) / 48.0;
  var uv = input.vUV;
  var decay = 1.0;
  var rays = vec3f(0.0);
  for (var k = 0; k < 48; k++) {
    uv -= st;
    let c = textureSampleLevel(textureSampler, textureSamplerSampler, uv, 0.0).rgb;
    rays += max(c - vec3f(0.72), vec3f(0.0)) * decay;
    decay *= 0.955;
  }
  let axis = vec2f(0.5) - uniforms.sunPos;
  var ghost = vec3f(0.0);
  for (var g = 1; g < 4; g++) {
    let fg = f32(g);
    let d = length(input.vUV - (uniforms.sunPos + axis * (0.55 * fg)));
    ghost += vec3f(1.0, 0.75 - 0.15 * fg, 0.45 + 0.15 * fg) * (1.0 - smoothstep(0.0, 0.05 + 0.02 * fg, d)) * 0.06;
  }
  fragmentOutputs.color = vec4f(base.rgb + rays * uniforms.intensity / 48.0 + ghost * uniforms.intensity, base.a);
}`;

/** A direction the art pack gives toward the sky (+Y up), in scene axes. */
export function skyDirection(B, [x, y, z]) {
  return new B.Vector3(x, y, z);
}

/** The chase camera's field of view: wider with speed and with `boost`, nitro eased 0..1. */
export function speedFov(speed, boost) {
  return 0.68 + 0.12 * Math.min(1, Math.max(0, speed) / 320) ** 1.3 + 0.11 * boost;
}

/**
 * The vertical field of view that shows a 16:9 frame's `lens` across the
 * width: a screen narrower than 16:9, a phone held upright, opens up and
 * down rather than cropping the road and the car to its middle.
 */
export function coverFov(lens, aspect) {
  const wide = 16 / 9;
  return aspect >= wide ? lens : 2 * Math.atan(Math.tan(lens / 2) * wide / aspect);
}

/** The fog colour warmed toward the sun as the camera faces it (`facing` is the cosine). */
export function sunHaze(fog, sun, facing) {
  if (facing <= 0) return fog;
  const t = facing ** 6 * 0.55;
  return { r: fog.r + (sun.r - fog.r) * t, g: fog.g + (sun.g - fog.g) * t, b: fog.b + (sun.b - fog.b) * t };
}

/**
 * Wind sway for fronds and grass, as a material plugin's vertex code: a part
 * swings by how far it reaches from its root (grass up, fronds out).
 */
export function windCode(lang) {
  return lang === 'WGSL'
    ? {
      CUSTOM_VERTEX_DEFINITIONS: 'fn stkSway(p: vec3f, reach: f32, windTime: f32) -> vec2f { return vec2f(sin(windTime * 1.7 + p.z * 0.08 + p.x * 0.03), cos(windTime * 1.3 + p.x * 0.08)) * reach; }',
      CUSTOM_VERTEX_UPDATE_WORLDPOS: 'let stkS = stkSway(worldPos.xyz, max(positionUpdated.y + 0.5, abs(positionUpdated.z)) * 0.05, uniforms.windTime); worldPos = vec4f(worldPos.x + stkS.x, worldPos.y, worldPos.z + stkS.y * 0.5, worldPos.w);',
    }
    : {
      CUSTOM_VERTEX_DEFINITIONS: 'vec2 stkSway(vec3 p, float reach, float t) { return vec2(sin(t * 1.7 + p.z * 0.08 + p.x * 0.03), cos(t * 1.3 + p.x * 0.08)) * reach; }',
      CUSTOM_VERTEX_UPDATE_WORLDPOS: 'vec2 stkS = stkSway(worldPos.xyz, max(positionUpdated.y + 0.5, abs(positionUpdated.z)) * 0.05, windTime); worldPos.x += stkS.x; worldPos.z += stkS.y * 0.5;',
    };
}

// Edge-only radial blur toward the centre, stronger with speed.
const SPEED_BLUR_GLSL = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float strength;
void main(void) {
  vec2 dir = vUV - vec2(0.5, 0.55);
  float edge = smoothstep(0.18, 0.62, length(dir));
  vec3 acc = vec3(0.0);
  for (int k = 0; k < 8; k++) acc += texture2D(textureSampler, vUV - dir * strength * edge * float(k) / 8.0).rgb;
  gl_FragColor = vec4(acc / 8.0, texture2D(textureSampler, vUV).a);
}`;

const SPEED_BLUR_WGSL = `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
uniform strength: f32;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let dir = input.vUV - vec2f(0.5, 0.55);
  let edge = smoothstep(0.18, 0.62, length(dir));
  var acc = vec3f(0.0);
  for (var k = 0; k < 8; k++) {
    acc += textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV - dir * uniforms.strength * edge * f32(k) / 8.0, 0.0).rgb;
  }
  fragmentOutputs.color = vec4f(acc / 8.0, textureSample(textureSampler, textureSamplerSampler, input.vUV).a);
}`;

// The pipeline's tone curve (Narkowicz's fit of ACES) and its inverse: the
// painted skies are finished images, so the dome undoes the curve and the
// exposure the pipeline is about to apply.
export function acesFit(x) {
  return (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
}
/** The fog colour that, through the exposure and ACES, lands on the painted sky's horizon. */
export function skyHaze([r, g, b], exposure) {
  const lin = (c) => untoneMap(c ** 2.2) / exposure;
  return { r: lin(r), g: lin(g), b: lin(b) };
}
export function untoneMap(c) {
  const k = Math.min(c, 0.99);
  const a = 2.43 * k - 2.51;
  const b = 0.59 * k - 0.03;
  return (-b - Math.sqrt(b * b - 4 * a * 0.14 * k)) / (2 * a);
}

const SKY_GLSL = {
  vertex: `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main(void) {
  vDir = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`,
  fragment: `
precision highp float;
varying vec3 vDir;
uniform sampler2D skyTexture;
uniform float exposure;
uniform float haze;
uniform vec3 hazeColor;
float untone(float c) {
  float k = min(c, 0.99);
  float a = 2.43 * k - 2.51;
  float b = 0.59 * k - 0.03;
  return (-b - sqrt(b * b - 4.0 * a * 0.14 * k)) / (2.0 * a);
}
void main(void) {
  vec3 d = normalize(vDir);
  // Of two longitudes half a turn apart, the one whose derivative is small:
  // atan's jump from 1 to 0 would pick the smallest mip down one column.
  float u1 = atan(d.z, d.x) / 6.2831853 + 0.5;
  float u2 = fract(u1 + 0.5) - 0.5;
  vec2 uv = vec2(fwidth(u1) <= fwidth(u2) + 1e-6 ? u1 : u2, acos(clamp(d.y, -1.0, 1.0)) / 3.1415927);
  vec3 c = pow(texture2D(skyTexture, uv).rgb, vec3(2.2));
  gl_FragColor = vec4(mix(vec3(untone(c.r), untone(c.g), untone(c.b)) / exposure, hazeColor, haze), 1.0);
}`,
};

const SKY_WGSL = {
  vertex: `
attribute position: vec3f;
uniform worldViewProjection: mat4x4f;
varying vDir: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vDir = vertexInputs.position;
  vertexOutputs.position = uniforms.worldViewProjection * vec4f(vertexInputs.position, 1.0);
}`,
  fragment: `
varying vDir: vec3f;
var skyTextureSampler: sampler;
var skyTexture: texture_2d<f32>;
uniform exposure: f32;
uniform haze: f32;
uniform hazeColor: vec3f;
fn untone(c: f32) -> f32 {
  let k = min(c, 0.99);
  let a = 2.43 * k - 2.51;
  let b = 0.59 * k - 0.03;
  return (-b - sqrt(b * b - 4.0 * a * 0.14 * k)) / (2.0 * a);
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let d = normalize(input.vDir);
  // Of two longitudes half a turn apart, the one whose derivative is small:
  // atan2's jump from 1 to 0 would pick the smallest mip down one column.
  let u1 = atan2(d.z, d.x) / 6.2831853 + 0.5;
  let u2 = fract(u1 + 0.5) - 0.5;
  let uv = vec2f(select(u2, u1, fwidth(u1) <= fwidth(u2) + 1e-6), acos(clamp(d.y, -1.0, 1.0)) / 3.1415927);
  let c = pow(textureSample(skyTexture, skyTextureSampler, uv).rgb, vec3f(2.2));
  fragmentOutputs.color = vec4f(mix(vec3f(untone(c.r), untone(c.g), untone(c.b)) / uniforms.exposure, uniforms.hazeColor, uniforms.haze), 1.0);
}`,
};

// DESIGN.md "Scenery": Horizon. The painted distance, finished like the sky
// it stands under; its silhouette is the strip's alpha. A ring with a gap
// sinks below the land where the road runs and over the water, so the road
// is not walled off and no treeline stands in the sea.
const BACKDROP_GLSL = {
  vertex: `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
uniform vec2 heading;
uniform float gap;
uniform float waterSide;
uniform float sink;
varying vec2 vUV;
void main(void) {
  vUV = uv;
  vec2 dir = normalize(position.xz);
  float lateral = dot(dir, vec2(heading.y, -heading.x));
  float keep = mix(1.0, smoothstep(0.3, 0.55, abs(lateral)), gap) * (1.0 - smoothstep(-0.05, 0.2, lateral * waterSide));
  gl_Position = worldViewProjection * vec4(position.x, position.y - (1.0 - keep) * sink, position.z, 1.0);
}`,
  fragment: `
precision highp float;
varying vec2 vUV;
uniform sampler2D backdropTexture;
uniform float exposure;
uniform float haze;
uniform vec3 hazeColor;
float untone(float c) {
  float k = min(c, 0.99);
  float a = 2.43 * k - 2.51;
  float b = 0.59 * k - 0.03;
  return (-b - sqrt(b * b - 4.0 * a * 0.14 * k)) / (2.0 * a);
}
void main(void) {
  vec4 t = texture2D(backdropTexture, vUV);
  if (t.a < 0.5) discard;
  vec3 c = pow(t.rgb, vec3(2.2));
  gl_FragColor = vec4(mix(vec3(untone(c.r), untone(c.g), untone(c.b)) / exposure, hazeColor, haze), 1.0);
}`,
};

const BACKDROP_WGSL = {
  vertex: `
attribute position: vec3f;
attribute uv: vec2f;
uniform worldViewProjection: mat4x4f;
uniform heading: vec2f;
uniform gap: f32;
uniform waterSide: f32;
uniform sink: f32;
varying vUV: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vUV = vertexInputs.uv;
  let p = vertexInputs.position;
  let dir = normalize(p.xz);
  let lateral = dot(dir, vec2f(uniforms.heading.y, -uniforms.heading.x));
  let keep = mix(1.0, smoothstep(0.3, 0.55, abs(lateral)), uniforms.gap) * (1.0 - smoothstep(-0.05, 0.2, lateral * uniforms.waterSide));
  vertexOutputs.position = uniforms.worldViewProjection * vec4f(p.x, p.y - (1.0 - keep) * uniforms.sink, p.z, 1.0);
}`,
  fragment: `
varying vUV: vec2f;
var backdropTextureSampler: sampler;
var backdropTexture: texture_2d<f32>;
uniform exposure: f32;
uniform haze: f32;
uniform hazeColor: vec3f;
fn untone(c: f32) -> f32 {
  let k = min(c, 0.99);
  let a = 2.43 * k - 2.51;
  let b = 0.59 * k - 0.03;
  return (-b - sqrt(b * b - 4.0 * a * 0.14 * k)) / (2.0 * a);
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let t = textureSample(backdropTexture, backdropTextureSampler, input.vUV);
  if (t.a < 0.5) { discard; }
  let c = pow(t.rgb, vec3f(2.2));
  fragmentOutputs.color = vec4f(mix(vec3f(untone(c.r), untone(c.g), untone(c.b)) / uniforms.exposure, uniforms.hazeColor, uniforms.haze), 1.0);
}`,
};

/** Width over height of a painted backdrop strip (assets/tools/ghibli/backdrops). */
export const BACKDROP_ASPECT = 4;
// Each layer's ring: metres out from the camera and tall, and whether it
// opens around the road ahead and behind.
export const BACKDROPS = [
  { layer: 'far', radius: 2400, height: 520, gap: false },
  { layer: 'mid', radius: 1200, height: 190, gap: true },
];
const BACKDROP_SEGMENTS = 96;

// DESIGN.md "Stylised AAA": ink where the depth breaks, light in soft bands,
// colour pushed, over every asset alike.
const STYLE_GLSL = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D depthSampler;
uniform vec2 texel;
uniform float outline;
uniform float saturation;
uniform float inkFar;
void main(void) {
  vec4 c = texture2D(textureSampler, vUV);
  float d = texture2D(depthSampler, vUV).r;
  float edge = abs(texture2D(depthSampler, vUV + vec2(texel.x, 0.0)).r - d)
    + abs(texture2D(depthSampler, vUV - vec2(texel.x, 0.0)).r - d)
    + abs(texture2D(depthSampler, vUV + vec2(0.0, texel.y)).r - d)
    + abs(texture2D(depthSampler, vUV - vec2(0.0, texel.y)).r - d);
  float haze = inkFar * d;
  float ink = smoothstep(0.12, 0.35, edge / max(d, 0.0001)) * outline * exp(-haze * haze);
  vec3 col = c.rgb;
  col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, saturation);
  // Gouache on paper: colour gently quantised toward flat washes, and the
  // paper's grain two pixels across under it.
  vec3 quantise = floor(col * 14.0 + 0.5) / 14.0;
  col = mix(col, quantise, 0.3);
  float paper = fract(sin(dot(floor(vUV / texel * 0.5), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  col *= 1.0 + paper * 0.045;
  gl_FragColor = vec4(col * (1.0 - ink), c.a);
}`;

const STYLE_WGSL = `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
var depthSamplerSampler: sampler;
var depthSampler: texture_2d<f32>;
uniform texel: vec2f;
uniform outline: f32;
uniform saturation: f32;
uniform inkFar: f32;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let c = textureSample(textureSampler, textureSamplerSampler, input.vUV);
  // Sampled by UV, as the colour is: read by texel index the depth map comes
  // out flipped on WebGPU and inks one place's silhouettes onto another.
  let d = textureSample(depthSampler, depthSamplerSampler, input.vUV).r;
  let edge = abs(textureSample(depthSampler, depthSamplerSampler, input.vUV + vec2f(uniforms.texel.x, 0.0)).r - d)
    + abs(textureSample(depthSampler, depthSamplerSampler, input.vUV - vec2f(uniforms.texel.x, 0.0)).r - d)
    + abs(textureSample(depthSampler, depthSamplerSampler, input.vUV + vec2f(0.0, uniforms.texel.y)).r - d)
    + abs(textureSample(depthSampler, depthSamplerSampler, input.vUV - vec2f(0.0, uniforms.texel.y)).r - d);
  let haze = uniforms.inkFar * d;
  let ink = smoothstep(0.12, 0.35, edge / max(d, 0.0001)) * uniforms.outline * exp(-haze * haze);
  var col = c.rgb;
  col = mix(vec3f(dot(col, vec3f(0.299, 0.587, 0.114))), col, uniforms.saturation);
  // Gouache on paper: colour gently quantised toward flat washes, and the
  // paper's grain two pixels across under it.
  let quantise = floor(col * 14.0 + 0.5) / 14.0;
  col = mix(col, quantise, 0.3);
  let paper = fract(sin(dot(floor(input.vUV / uniforms.texel * 0.5), vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
  col *= 1.0 + paper * 0.045;
  fragmentOutputs.color = vec4f(col * (1.0 - ink), c.a);
}`;

/**
 * WebGPU where the browser offers an adapter, WebGL2 otherwise
 * (DESIGN.md Review, "Toward 2025-era graphics").
 */
export async function createEngine(B, canvas, gpu) {
  if (gpu && await gpu.requestAdapter()) {
    const engine = new B.WebGPUEngine(canvas, { antialias: true, stencil: true });
    await engine.initAsync();
    return engine;
  }
  return new B.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
}

export class ApexrunRenderer {
  /** Ready to draw: the first stage's art loaded and its track built. */
  static async create(canvas, hudCanvas, manifest, place) {
    const renderer = new ApexrunRenderer(canvas, hudCanvas, await createEngine(globalThis.BABYLON, canvas, navigator.gpu), manifest, place);
    await renderer.ready;
    return renderer;
  }

  /**
   * `place.dpr` is the display's pixels per CSS pixel; `place.locate(url)`
   * resolves an art file's URL to one this realm can load
   * (ArtLibrary).
   */
  constructor(canvas, hudCanvas, engine, manifest, place) {
    this.canvas = canvas;
    this.hudCanvas = hudCanvas;
    this.hudCtx = hudCanvas?.getContext?.('2d') || null;
    this.width = canvas?.width || 800;
    this.height = canvas?.height || 450;
    // World units per sim unit; across the road, the sim's |x| = 1 off-road
    // edge lands on the rumble strip.
    this.trackScale = METRES_PER_UNIT;
    this.lateralScale = LATERAL_UNITS;
    // Nitro eased 0..1, for the camera, the blur and the view's width.
    this.boostT = 0;
    // How far the chase camera has drawn in onto the hood, eased 0..1.
    this.hoodT = 0;
    // Whether a replay's shot holds the camera off the car this frame.
    this.shotHeld = false;

    const B = globalThis.BABYLON;
    if (!B) {
      throw new Error('ApexrunRenderer: BABYLON is required');
    }

    // No engine is the headless case: tests and tools render nowhere.
    const isGPU = engine !== null;
    this.isGPU = isGPU;
    this.engine = engine ?? new B.NullEngine();
    this.isWebGPU = !!this.engine.isWebGPU;

    this.resolutionScale = 1.0;
    // The hero car's axles ahead of and behind its root: its own wheel hubs.
    const hub = (name) => artEntry(manifest, HERO_CAR).wheels.find((w) => w.name === name).hub[2];
    this.heroAxles = { front: hub('wheel_FL'), rear: -hub('wheel_RL') };
    // Pixels drawn per CSS pixel at full scale: a Retina display drawn at CSS
    // resolution is half its own, stretched; past 2 the cost outruns the eye.
    this.pixelRatio = Math.min(2, place.dpr);
    this.dpr = place.dpr;
    this.locate = place.locate;
    // The canvas's size in CSS pixels, which every drawing size is a scale
    // of (_fit).
    this.cssWidth = (canvas?.width ?? 0) / place.dpr;
    this.cssHeight = (canvas?.height ?? 0) / place.dpr;
    this._fit();
    this.engine.setHardwareScalingLevel?.(1 / this.pixelRatio);
    this.minResolutionScale = 0.5;
    this.maxResolutionScale = 1.0;
    this.adaptiveResolution = true;
    this.targetFrameTimeMs = 16.67;
    this._intervalEma = 0;
    this._slowFrames = 0;
    this._steadyFrames = 0;
    this._refreshMs = 0;
    this._climbWait = 180;
    this._sinceClimb = Infinity;
    /** @type {number | null} */
    this._lastFrameAt = null;
    this.now = () => performance.now();


    this.scene = new B.Scene(this.engine);
    this.scene.clearColor = new B.Color4(0.96, 0.42, 0.15, 1);
    this._registerShaders(B);
    this._initBabylon3D(B, manifest);
    this.bTrafficMeshes = [];
    /** Every slot's car of every type it has drawn, kept for its next turn. */
    this.trafficPool = new Map();
    /** What a change of stage builds after its frame, one a frame. */
    this.stageJobs = [];
    this.trafficLooks = {};
    this._initHeadlightPool(B);
    this._limitGlow();
  }

  /**
   * The display's own frame interval: the median of a bare rAF loop, run
   * before the game loop starts, since no browser API reports refresh rate.
   * @param {(cb: (t: number) => void) => unknown} raf
   */
  calibrateRefresh(raf, frames = 30) {
    /** @type {number[]} */
    const stamps = [];
    return new Promise((resolve) => {
      /** @param {number} t */
      const tick = (t) => {
        stamps.push(t);
        if (stamps.length <= frames) return raf(tick);
        const gaps = stamps.slice(1).map((v, i) => v - stamps[i]).sort((a, b) => a - b);
        this._refreshMs = gaps[gaps.length >> 1];
        resolve(this._refreshMs);
      };
      raf(tick);
    });
  }


  // One presented frame's interval against the slower of the target and the
  // calibrated refresh. 30 slow frames step the scale down; 180 steady frames
  // climb it, and a climb undone within 300 frames doubles that wait.
  recordFrameTime(intervalMs) {
    if (!this.adaptiveResolution || !this.engine?.setHardwareScalingLevel || intervalMs > 250) return;
    this._intervalEma = this._intervalEma === 0 ? intervalMs : this._intervalEma * 0.9 + intervalMs * 0.1;
    this._sinceClimb++;
    const target = Math.max(this.targetFrameTimeMs, this._refreshMs);
    if (this._intervalEma > target * 1.1) {
      this._steadyFrames = 0;
      if (++this._slowFrames >= 30 && this.resolutionScale > this.minResolutionScale) {
        if (this._sinceClimb < 300) this._climbWait = Math.min(this._climbWait * 2, 3600);
        this.setResolutionScale(this.resolutionScale - 0.1);
        this._slowFrames = 0;
      }
      return;
    }
    this._slowFrames = 0;
    if (this._intervalEma > target * 1.04) {
      this._steadyFrames = 0;
    } else if (++this._steadyFrames >= this._climbWait) {
      this._steadyFrames = 0;
      if (this.resolutionScale < this.maxResolutionScale) {
        this.setResolutionScale(this.resolutionScale + 0.05);
        this._sinceClimb = 0;
      }
    }
  }

  setResolutionScale(scale) {
    const clamped = Math.max(this.minResolutionScale, Math.min(this.maxResolutionScale, scale));
    this.resolutionScale = clamped;
    if (this.engine?.setHardwareScalingLevel) {
      this._fit();
      this.engine.setHardwareScalingLevel(1.0 / (clamped * this.pixelRatio));
      // Forced, as a resize is: at full scale the drawing size is the CSS
      // size _fit set, so the engine sees no change and keeps its
      // multisampled target at the last step's size.
      this._fit();
      this.engine.resize(true);
    }
  }

  // Babylon sizes its drawing buffer as the canvas's size over the scaling
  // level, and with no document to read a CSS size from it reads the canvas's
  // own: the drawing size it set last. Scaled again from there, every step of
  // the adaptive resolution compounded, until an OffscreenCanvas was drawn at
  // a twentieth of its pixels. So the canvas is put back to its CSS size
  // before each resize, and the level scales that.
  _fit() {
    if (!this.canvas) return;
    this.canvas.width = Math.max(1, Math.round(this.cssWidth));
    this.canvas.height = Math.max(1, Math.round(this.cssHeight));
  }

  getResolutionScale() {
    return this.resolutionScale;
  }

  setAdaptiveResolution(enabled, options = {}) {
    this.adaptiveResolution = !!enabled;
    if (options.minScale !== undefined) this.minResolutionScale = options.minScale;
    if (options.maxScale !== undefined) this.maxResolutionScale = options.maxScale;
    if (options.targetFps !== undefined && options.targetFps > 0) {
      this.targetFrameTimeMs = 1000 / options.targetFps;
    }
  }

  /** The canvas's new size in device pixels, its CSS size times the ratio. */
  resize(w, h) {
    this.width = w;
    this.height = h;
    this.cssWidth = w / this.dpr;
    this.cssHeight = h / this.dpr;
    if (this.hudCanvas) {
      this.hudCanvas.width = w;
      this.hudCanvas.height = h;
    }
    if (this.engine) {
      this.engine.setHardwareScalingLevel?.(1.0 / (this.resolutionScale * this.pixelRatio));
      this._fit();
      // Forced: an engine that sees no change keeps its multisampled target
      // at the old size.
      this.engine.resize(true);
    }
  }

  _setNodeEnabled(node, enabled) {
    if (!node) return;
    if (typeof node.setEnabled === 'function') {
      node.setEnabled(enabled);
    } else {
      node.isVisible = !!enabled;
    }
  }

  /**
   * @param {any} state
   * @param {boolean} [isHistorical=false]
   * @param {any} [prevState=null]
   * @param {number} [alpha=1]
   * @param {{index: number, count: number, from: number, frames: number} | null} [cut=null] a replay's window
   */
  render(state, isHistorical = false, prevState = null, alpha = 1, cut = null) {
    this._renderBabylon(state, isHistorical, prevState, alpha, cut);
    if (isHistorical || !this.isGPU) {
      this._lastFrameAt = null;
      return;
    }
    const now = this.now();
    if (this._lastFrameAt !== null) this.recordFrameTime(now - this._lastFrameAt);
    this._lastFrameAt = now;
  }

  _registerShaders(B) {
    if (!B.Effect || !B.Effect.ShadersStore) return;

    B.Effect.ShadersStore.stkGodRaysPixelShader = GOD_RAYS_GLSL;
    B.ShaderStore.ShadersStoreWGSL.stkGodRaysPixelShader = GOD_RAYS_WGSL;
    B.Effect.ShadersStore.stkSpeedBlurPixelShader = SPEED_BLUR_GLSL;
    B.ShaderStore.ShadersStoreWGSL.stkSpeedBlurPixelShader = SPEED_BLUR_WGSL;
    B.Effect.ShadersStore.stkStylePixelShader = STYLE_GLSL;
    B.ShaderStore.ShadersStoreWGSL.stkStylePixelShader = STYLE_WGSL;
    B.Effect.ShadersStore.stkSkyVertexShader = SKY_GLSL.vertex;
    B.Effect.ShadersStore.stkSkyFragmentShader = SKY_GLSL.fragment;
    B.ShaderStore.ShadersStoreWGSL.stkSkyVertexShader = SKY_WGSL.vertex;
    B.ShaderStore.ShadersStoreWGSL.stkSkyFragmentShader = SKY_WGSL.fragment;
    B.Effect.ShadersStore.stkBackdropVertexShader = BACKDROP_GLSL.vertex;
    B.Effect.ShadersStore.stkBackdropFragmentShader = BACKDROP_GLSL.fragment;
    B.ShaderStore.ShadersStoreWGSL.stkBackdropVertexShader = BACKDROP_WGSL.vertex;
    B.ShaderStore.ShadersStoreWGSL.stkBackdropFragmentShader = BACKDROP_WGSL.fragment;
  }

  _initBabylon3D(B, manifest) {
    const scene = this.scene;
    this.textures = new Map();

    // Target Camera chasing player kart
    this.bCamera = new B.TargetCamera('bKartCam', new B.Vector3(0, 4, -10), scene);
    this.lens = speedFov(0, 0);
    this.bCamera.fov = this.lens;
    this.bCamera.minZ = 0.1;

    const hemi = new B.HemisphericLight('bHemi', new B.Vector3(0, 1, 0), scene);
    hemi.excludeWithLayerMask = SKY_LIT;
    this.bHemi = hemi;
    const sun = new B.DirectionalLight('bSun', new B.Vector3(0, -1, 1), scene);
    this.bSun = sun;
    if (this.isGPU) {
      this.brushTexture = this._generated(B, 'brush', () => brushStrokes(256, 7));
      for (const mat of scene.materials) this._toonMaterial(B, mat);
      scene.onNewMaterialAddedObservable.add((mat) => this._toonMaterial(B, mat));
    }

    scene.fogMode = B.Scene.FOGMODE_EXP2;

    // The stage's painted sky (DESIGN.md "Stylised AAA").
    const skyMat = new B.ShaderMaterial('bSkyMat', scene, 'stkSky', {
      attributes: ['position'],
      uniforms: ['worldViewProjection', 'exposure', 'haze', 'hazeColor'],
      samplers: ['skyTexture'],
      shaderLanguage: this.isWebGPU ? B.ShaderLanguage.WGSL : B.ShaderLanguage.GLSL,
    });
    skyMat.backFaceCulling = false;
    // The far cloud bank stands beyond the dome.
    skyMat.disableDepthWrite = true;
    const sky = B.MeshBuilder.CreateSphere('bSky', { diameter: 6000, segments: 24 }, scene);
    this.bSky = sky;
    sky.material = skyMat;
    sky.infiniteDistance = true;
    sky.applyFog = false;
    this.bSkyMat = skyMat;
    this.bBackdropMats = Object.fromEntries(BACKDROPS.map(({ layer }) => {
      const mat = new B.ShaderMaterial(`bBackdrop_${layer}`, scene, 'stkBackdrop', {
        attributes: ['position', 'uv'],
        uniforms: ['worldViewProjection', 'exposure', 'heading', 'gap', 'waterSide', 'sink', 'haze', 'hazeColor'],
        samplers: ['backdropTexture'],
        shaderLanguage: this.isWebGPU ? B.ShaderLanguage.WGSL : B.ShaderLanguage.GLSL,
      });
      mat.backFaceCulling = false;
      return [layer, mat];
    }));
    this.bSunDisc = [['core', SUN_CORE, 1, 1.0], ['halo', SUN_HALO, 0.5, 0.3]].map(([name, size, edge, strength]) => {
      const disc = B.MeshBuilder.CreatePlane(`bSun_${name}`, { size }, scene);
      const mat = new B.StandardMaterial(`bSun_${name}`, scene);
      mat.disableLighting = true;
      mat.opacityTexture = this._generated(B, `sun_${name}`, () => sunGlow(128, edge), true);
      mat.alphaMode = B.Engine.ALPHA_ADD;
      mat.backFaceCulling = false;
      disc.material = mat;
      disc.billboardMode = B.Mesh.BILLBOARDMODE_ALL;
      disc.applyFog = false;
      disc.__strength = strength;
      disc.setEnabled(false);
      return disc;
    });

    this.bClouds = CLOUD_BANKS.flatMap((bank, b) => Array.from({ length: bank.cards }, (_, j) => [b, j])).map(([bank, j], k) => {
      const card = B.MeshBuilder.CreatePlane(`bCloud_${k}`, { size: 1 }, scene);
      const mat = new B.StandardMaterial(`bCloud_${k}`, scene);
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      card.material = mat;
      card.billboardMode = B.Mesh.BILLBOARDMODE_Y;
      card.applyFog = false;
      return Object.assign(card, { bank, slot: j, metres: 0, rise: 0, along: 0, side: 0, cloudSeed: null, cloudKind: null, cloudSize: null });
    });

    this.art = new ArtLibrary(B, scene, manifest, this.locate);
    this.bGroundMat = this._surfaceMaterial(B, 'bGroundMat');
    this.bWaterMat = new B.StandardMaterial('bWaterMat', scene);
    this.bWaterMat.specularPower = 96;
    this.bWater = [];
    this.bTerrain = [];
    this.swaying = new Set();
    this.toon = { sun: [1, 1, 1], shade: [0.4, 0.4, 0.5], rim: [0, 0, 0], level: 1 };
    this.bHorizon = [];
    this.bShore = [];
    this.bLaneLines = [];
    this.laneDashes = [];
    this.propMaterials = new Map();
    this.trafficLamps = {
      brake: new B.Color3(1.0, 0.1, 0.1),
      tail: new B.Color3(0.4, 0.05, 0.05),
      blink: new B.Color3(1.0, 0.7, 0.0),
      dark: new B.Color3(0.05, 0.03, 0.0),
    };
    this.bDecorMeshes = [];
    this.currentStageId = 'coconut-beach';

    // Materials cache
    this.bMaterials = {
      road: Object.assign(this._surfaceMaterial(B, 'bRoadMat'), { albedoColor: new B.Color3(ROAD_ALBEDO, ROAD_ALBEDO, ROAD_ALBEDO) }),
      rumbleRed: new B.StandardMaterial('bRumbleRedMat', scene),
    };

    this.bMaterials.rumbleRed.diffuseColor = B.Color3.FromHexString('#ECEFF1');
    this.bMaterials.rumbleRed.backFaceCulling = false;

    // Procedural particle textures cache
    this.particleTextures = {
      flame: this._createProceduralTexture(B, 'flame'),
      spark: this._createProceduralTexture(B, 'spark'),
    };

    this.bKartMeshes = new Map();

    if (this.isGPU && B.GlowLayer) {
      this.glow = new B.GlowLayer('bStkGlow', scene, { mainTextureRatio: 0.5, blurKernelSize: 16 });
      this.glow.intensity = 0.85;
      this.glow.customEmissiveColorSelector = (mesh, _subMesh, _material, result) => {
        const c = mesh.__glowColor || mesh.parent?.__glowColor;
        if (c) {
          result.set(c.r, c.g, c.b, 1.0);
        } else {
          result.set(0, 0, 0, 0);
        }
      };
    }

    // Atmospheric post-processing pipeline: speed vignette and contrast punch
    if (this.isGPU && B.DefaultRenderingPipeline) {
      this.pipeline = new B.DefaultRenderingPipeline('bStkPipeline', true, scene, [this.bCamera]);
      if (this.pipeline.imageProcessing) {
        this.pipeline.imageProcessing.vignetteEnabled = true;
        this.pipeline.imageProcessing.vignetteWeight = 1.25;
        this.pipeline.imageProcessing.vignetteStretch = 0.5;
        this.pipeline.imageProcessing.vignetteColor = new B.Color4(0, 0, 0, 0);
        this.pipeline.imageProcessing.contrast = GRADE.contrast;
        this.pipeline.imageProcessing.exposure = 1.05;
      }
      this.pipeline.bloomEnabled = true;
      this.pipeline.bloomThreshold = 0.9;
      this.pipeline.bloomWeight = 0.18;
      this.pipeline.bloomKernel = 64;
      this._initLighting(B, qualityPlan(this.isWebGPU));
    }
    this.ready = this.art.loadStage(this.currentStageId).then(() => {
      this._mountKarts(B);
      this._rebuildTrackForStage(this.currentStageId);
    });
  }

  /** A PBR surface for the pack's albedo, normal and AO-roughness-metal maps. */
  _surfaceMaterial(B, name) {
    const mat = new B.PBRMaterial(name, this.scene);
    mat.backFaceCulling = false;
    mat.twoSidedLighting = true;
    mat.metallic = 1;
    mat.roughness = 1;
    mat.useAmbientOcclusionFromMetallicTextureRed = true;
    mat.useRoughnessFromMetallicTextureGreen = true;
    mat.useMetallnessFromMetallicTextureBlue = true;
    return mat;
  }

  /**
   * Dresses a surface with a pack texture set, tiled by the mesh's own UVs: a
   * texture scaled on its own costs a varying, and three of them with fog and
   * shadows pass the 16 fragment inputs Apple allows.
   */
  _surfaceTextures(B, mat, set) {
    const tex = (map) => {
      const t = this.art.get(`tex/${set}/${map}`);
      t.wrapU = t.wrapV = B.Texture.WRAP_ADDRESSMODE;
      return t;
    };
    mat.albedoTexture = tex('albedo');
    mat.bumpTexture = tex('normal');
    mat.metallicTexture = tex('arm');
  }

  _createProceduralTexture(B, type) {
    const dt = new B.DynamicTexture('dt_' + type, { width: 32, height: 32 }, this.scene, false);
    const ctx = dt.getContext();
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    if (type === 'flame') {
      // White: the flame's colour comes from its gradient over life.
      grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
      grad.addColorStop(0.4, 'rgba(255, 255, 255, 0.6)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    } else if (type === 'spark') {
      grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
      grad.addColorStop(0.3, 'rgba(56, 189, 248, 0.9)');
      grad.addColorStop(0.7, 'rgba(2, 136, 209, 0.5)');
      grad.addColorStop(1, 'rgba(0, 50, 150, 0.0)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    dt.update();
    return dt;
  }

  _getCurve(track, segIdx) {
    for (const c of track.curves) {
      if (segIdx >= c.start && segIdx < c.start + c.length) {
        return c.curve;
      }
    }
    return 0;
  }

  _getPitch(track, segIdx) {
    for (const c of track.curves) {
      if (segIdx >= c.start && segIdx < c.start + c.length) {
        return c.pitch;
      }
    }
    return 0;
  }

  /**
   * The road under world depth `z` for a car at lane `x`, interpolated
   * between centreline points: everything placed on the road reads it here.
   */
  _roadAt(z, x) {
    const pts = this.trackPts;
    const end = pts[pts.length - 1];
    // Past its end the road runs straight on along its closing heading.
    if (z > end.z) {
      const along = (z - end.z) / this.endOn.z;
      const k = pts.length - 1;
      return { x: end.x + this.endOn.x * along + this._laneShift(k, x) + x * this.lateralScale, y: end.y, yaw: this.headings[k] };
    }
    const last = pts.length - 1.000001;
    const f = Math.max(0, Math.min(last, z / this.segLen));
    const i = Math.floor(f);
    const t = f - i;
    const a = pts[i];
    const b = pts[i + 1];
    const X = lerp(a.x + this._laneShift(i, x), b.x + this._laneShift(i + 1, x), t) + x * this.lateralScale;
    // The road and the ground run out along each point's right vector, so the
    // surface under (X, z) belongs to the point whose right line passes through
    // it: off the centreline on a curve, further along or back.
    let g = f;
    for (let k = 0; k < 2; k++) {
      const j = Math.floor(g);
      const u = g - j;
      const rx = lerp(this.rights[j].x, this.rights[j + 1].x, u);
      const rz = lerp(this.rights[j].z, this.rights[j + 1].z, u);
      const d = (X - lerp(pts[j].x, pts[j + 1].x, u)) * rx + (z - lerp(pts[j].z, pts[j + 1].z, u)) * rz;
      g = Math.max(0, Math.min(last, (z - rz * d) / this.segLen));
    }
    const j = Math.floor(g);
    return {
      x: X,
      y: lerp(pts[j].y, pts[j + 1].y, g - j),
      yaw: lerpAngle(this.headings[i], this.headings[i + 1], t),
    };
  }

  /** A car's pose at `z`: on the line through the road under both axles, pitched with it. */
  _poseOnRoad(z, x, axleFront = this.heroAxles.front, axleRear = this.heroAxles.rear) {
    const road = this._roadAt(z, x);
    const front = this._roadAt(z + axleFront, x).y;
    const rear = this._roadAt(z - axleRear, x).y;
    const grade = (front - rear) / (axleFront + axleRear);
    return { ...road, y: rear + grade * axleRear, pitch: Math.atan(grade) };
  }

  // Past a fork the sim routes by the sign of x, so a kart drawn around the
  // trunk's centerline would sit on the gore; it rides its branch instead.
  _laneShift(segIdx, x) {
    const shift = this.forkDiverge[segIdx] * this.rights[segIdx].x;
    return x < 0 ? -shift : shift;
  }


  _rebuildTrackForStage(stageId) {
    const B = globalThis.BABYLON;
    if (!B || !this.scene) return;

    const stage = OUTRUN_STAGES[stageId];
    if (!stage) throw new Error(`renderer: unknown stage ${stageId}`);
    this.currentStageId = stageId;
    const changing = !!this.bRoad;
    this.stageJobs = [];

    // Dispose previous track ribbons and structures if they exist
    if (this.bRoad) { this.bRoad.dispose(); this.bRoad = null; }
    for (const m of [...(this.bLeadIn ?? []), ...(this.bLeadOut ?? [])]) m.dispose();
    this.bLeadOut = [];
    this.bLeadIn = [];
    this.bRoadLead = null;
    this.bRoadEnd = null;
    for (const m of [...this.bLaneLines, ...this.bTerrain, ...this.bWater, ...this.bShore, ...(this.bSeaWall ?? []), ...(this.bCarpet ?? [])]) m.dispose();
    this.bSeaWall = [];
    this.bCarpet = [];
    for (const m of this.bHorizon) m.dispose();
    this.laneDashes = [];
    this.bLaneLines = [];
    this.bTerrain = [];
    this.bWater = [];
    this.bHorizon = [];
    this.bShore = [];
    if (this.bRumbleL) { this.bRumbleL.dispose(); this.bRumbleL = null; }
    if (this.bRumbleR) { this.bRumbleR.dispose(); this.bRumbleR = null; }
    if (this.bForkRoadL) { this.bForkRoadL.dispose(); this.bForkRoadL = null; }
    if (this.bForkRoadR) { this.bForkRoadR.dispose(); this.bForkRoadR = null; }
    if (this.bForkDivider) { this.bForkDivider.dispose(); this.bForkDivider = null; }
    if (this.bForkGantry) { this.bForkGantry.dispose(false, true); this.bForkGantry = null; this.bForkSigns = []; }
    if (this.bFinishGantry) { this.bFinishGantry.dispose(false, true); this.bFinishGantry = null; }
    // Their meshes share the cached prop materials, so only the materials
    // built for them alone go with them.
    for (const arch of this.bCheckpointArches ?? []) arch.dispose();
    this.bCheckpointArches = [];
    this.bMarshal?.root.dispose();
    this.bMarshal = null;
    for (const mat of this.bRaceFlowMats ?? []) mat.dispose(false, true);
    this.bRaceFlowMats = [];

    if (this.bDecorMeshes) {
      for (const m of this.bDecorMeshes) {
        m.dispose?.();
      }
      this.bDecorMeshes = [];
    }
    // The pack's materials stay with its containers, for the next stage.
    for (const { lods } of this.bModelSets ?? []) {
      for (const { rootNodes } of lods) for (const root of rootNodes) root.dispose(false, false);
    }
    this.bModelSets = [];
    for (const { mesh } of this.bScatter ?? []) mesh.dispose();
    for (const mesh of this.bScatterTemplates ?? []) mesh.dispose(false, true);
    this.bScatter = [];
    this.bScatterTemplates = [];

    const S = this.trackScale;
    const segLen = stage.segmentLength * S;
    const rumbleW = this.lateralScale;
    const halfW = rumbleW * 0.94;

    const centerline = [];
    let x = 0;
    let dx = 0;
    let y = 0;
    let dy = 0;

    for (let i = 0; i < stage.segmentCount; i++) {
      const z = i * segLen;
      // Curve and pitch are target heading and grade, eased toward so each bend
      // and hill returns to straight and level: karts are placed by z, so the
      // road must never turn back on itself. Pitch 25 ≈ 0.33 keeps hills under
      // the chase camera's 2.1 / 6.2 sightline over the car.
      const c = this._getCurve(stage, i);
      dx += (c * segLen / 10 - dx) * 0.08;
      x += dx;

      const p = this._getPitch(stage, i);
      dy += (p * segLen / 75 - dy) * 0.08;
      y += dy;

      centerline.push(new B.Vector3(x, y, z));
    }

    const pts = centerline;
    // Screen-right across the road at each point, level with the horizon.
    const rights = pts.map((_, i) => {
      const a = pts[Math.max(0, i - 1)];
      const c = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      return new B.Vector3((c.z - a.z) / len, 0, -(c.x - a.x) / len);
    });
    this.trackPts = pts;
    this.segLen = segLen;
    // Behind the grid the road runs straight on along its opening heading.
    const run = Math.hypot(pts[1].x - pts[0].x, pts[1].z - pts[0].z);
    const back = { x: (pts[0].x - pts[1].x) / run, z: (pts[0].z - pts[1].z) / run };
    const leadSegs = Math.ceil(LEAD_IN_METRES / segLen);
    this.leadPts = [];
    for (let k = leadSegs; k > 0; k--) this.leadPts.push(new B.Vector3(pts[0].x + back.x * k * segLen, pts[0].y, pts[0].z + back.z * k * segLen));
    this.leadPts.push(pts[0]);
    this.leadRights = this.leadPts.map(() => rights[0]);
    // Past the end the road runs straight on along its closing heading.
    const last = pts.length - 1;
    const endRun = Math.hypot(pts[last].x - pts[last - 1].x, pts[last].z - pts[last - 1].z);
    const on = { x: (pts[last].x - pts[last - 1].x) / endRun, z: (pts[last].z - pts[last - 1].z) / endRun };
    this.endOn = on;
    this.leadOutPts = [pts[last]];
    for (let k = 1; k <= Math.ceil(runOnMetres(stage.id) / segLen); k++) this.leadOutPts.push(new B.Vector3(pts[last].x + on.x * k * segLen, pts[last].y, pts[last].z + on.z * k * segLen));
    this.leadOutRights = this.leadOutPts.map(() => rights[last]);

    const leftPath = [];
    const rightPath = [];
    const leftRumble = [];
    const rightRumble = [];
    const forkStart = stage.fork ? stage.fork.forkSegment : pts.length;
    // Past the fork each side's half of the road peels outward, eased so the
    // split opens gently; a branch keeps its two lanes and 0.6 of the centre.
    const forkLength = Math.max(1, pts.length - forkStart - 1);
    this.forkDiverge = pts.map((_, i) => i < forkStart ? 0 : ((i - forkStart) / forkLength) ** 2 * halfW * 2.0);
    this.rights = rights;
    this.headings = rights.map((r) => Math.atan2(-r.z, r.x));

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const b = rights[i];

      leftPath.push(new B.Vector3(p.x - b.x * halfW, p.y + 0.02, p.z - b.z * halfW));
      rightPath.push(new B.Vector3(p.x + b.x * halfW, p.y + 0.02, p.z + b.z * halfW));
      leftRumble.push(new B.Vector3(p.x - b.x * rumbleW, p.y + 0.01, p.z - b.z * rumbleW));
      rightRumble.push(new B.Vector3(p.x + b.x * rumbleW, p.y + 0.01, p.z + b.z * rumbleW));
    }

    // Left to right, so the ribbon's normals face up: the sky's light is
    // read per vertex from them, before two-sided lighting can flip one.
    this.bRoad = B.MeshBuilder.CreateRibbon('bRoad', { pathArray: [leftPath, rightPath], uvs: this._roadUVs(B, [leftPath, rightPath]), closeArray: false, sideOrientation: B.Mesh.DOUBLESIDE }, this.scene);
    this.bRoad.material = this.bMaterials.road;
    skyLit(this.bRoad);
    this._surfaceTextures(B, this.bMaterials.road, 'asphalt');

    this._buildLaneLines(B, pts, rights, forkStart);

    this.bRumbleL = B.MeshBuilder.CreateRibbon('bRumbleL', { pathArray: [leftPath, leftRumble], closeArray: false, sideOrientation: B.Mesh.DOUBLESIDE }, this.scene);
    this.bRumbleL.material = this.bMaterials.rumbleRed;

    this.bRumbleR = B.MeshBuilder.CreateRibbon('bRumbleR', { pathArray: [rightRumble, rightPath], closeArray: false, sideOrientation: B.Mesh.DOUBLESIDE }, this.scene);
    this.bRumbleR.material = this.bMaterials.rumbleRed;
    this._buildLeadInRoad(B, halfW, rumbleW);

    // Build Fork Road Split & Overhead Gantry
    if (stage.fork && forkStart < pts.length) {
      const forkLeftRoadL = [];
      const forkLeftRoadR = [];
      const forkRightRoadL = [];
      const forkRightRoadR = [];
      const forkDivL = [];
      const forkDivR = [];

      for (let i = forkStart; i < pts.length; i++) {
        const p = pts[i];
        const b = rights[i];
        const diverge = this.forkDiverge[i];
        const gap = Math.max(0, diverge - 0.6);
        const at = (offset, lift) => new B.Vector3(p.x + b.x * offset, p.y + lift, p.z + b.z * offset);

        forkLeftRoadL.push(at(-(diverge + rumbleW), 0.03));
        forkLeftRoadR.push(at(-gap, 0.03));
        forkRightRoadL.push(at(gap, 0.03));
        forkRightRoadR.push(at(diverge + rumbleW, 0.03));

        // Center Diverter Chevron Area
        forkDivL.push(at(-gap, 0.035));
        forkDivR.push(at(gap, 0.035));
      }

      this.bForkRoadL = B.MeshBuilder.CreateRibbon('bForkRoadL', { pathArray: [forkLeftRoadL, forkLeftRoadR], uvs: this._roadUVs(B, [forkLeftRoadL, forkLeftRoadR]), closeArray: false, sideOrientation: B.Mesh.DOUBLESIDE }, this.scene);
      this.bForkRoadL.material = this.bMaterials.road;
      skyLit(this.bForkRoadL);

      this.bForkRoadR = B.MeshBuilder.CreateRibbon('bForkRoadR', { pathArray: [forkRightRoadL, forkRightRoadR], uvs: this._roadUVs(B, [forkRightRoadL, forkRightRoadR]), closeArray: false, sideOrientation: B.Mesh.DOUBLESIDE }, this.scene);
      this.bForkRoadR.material = this.bMaterials.road;
      skyLit(this.bForkRoadR);

      this.bForkDivider = B.MeshBuilder.CreateRibbon('bForkDivider', { pathArray: [forkDivR, forkDivL], uvs: this._groundUVs(B, [forkDivR, forkDivL]), closeArray: false, sideOrientation: B.Mesh.DOUBLESIDE }, this.scene);
      // The gore between the branches is the stage's own verge, not paint.
      this.bForkDivider.material = this.bGroundMat;
      this._buildLeadOutRoad(B, rumbleW);

      // Overhead Sega Route Fork Gantry
      const gPt = pts[forkStart];
      const gB = rights[forkStart];
      const gantryRoot = new B.TransformNode('bForkGantry', this.scene);
      gantryRoot.position.set(gPt.x, gPt.y, gPt.z);

      const gantryPillarL = B.MeshBuilder.CreateCylinder('gPillarL', { diameter: 0.6, height: 9.0 }, this.scene);
      gantryPillarL.position.set(-gB.x * (halfW + 3.0), 4.5, -gB.z * (halfW + 3.0));
      gantryPillarL.parent = gantryRoot;

      const gantryPillarR = B.MeshBuilder.CreateCylinder('gPillarR', { diameter: 0.6, height: 9.0 }, this.scene);
      gantryPillarR.position.set(gB.x * (halfW + 3.0), 4.5, gB.z * (halfW + 3.0));
      gantryPillarR.parent = gantryRoot;

      const gantryBeam = B.MeshBuilder.CreateBox('gBeam', { width: (halfW + 3.0) * 2.2, height: 1.0, depth: 1.0 }, this.scene);
      gantryBeam.position.set(0, 8.5, 0);
      gantryBeam.parent = gantryRoot;

      const gMat = new B.StandardMaterial('gMat', this.scene);
      gMat.diffuseColor = B.Color3.FromHexString('#37474F');
      gantryPillarL.material = gMat;
      gantryPillarR.material = gMat;
      gantryBeam.material = gMat;

      // Destination boards: where each lane goes, lettered on its colour.
      this.bForkSigns = [[-1, stage.fork.leftLabel, '#00B8D4'], [1, stage.fork.rightLabel, '#FF6D00']].map(([side, label, colour]) => {
        const board = B.MeshBuilder.CreatePlane(side < 0 ? 'gSignL' : 'gSignR', { width: halfW * 0.9, height: 2.2, sideOrientation: B.Mesh.DOUBLESIDE }, this.scene);
        board.position.set(side * halfW * 0.55, 8.5, -0.6);
        board.parent = gantryRoot;
        board.material = this._gantrySignMaterial(B, side, label, colour);
        return board;
      });

      this.bForkGantry = gantryRoot;
    } else {
      this._buildTerminus(B, halfW, rumbleW);
      // The final arch, over the finish line.
      const finIdx = pts.length - 1;
      const finPt = pts[finIdx];
      const finB = rights[finIdx];
      const finishRoot = new B.TransformNode('bFinishGantry', this.scene);
      finishRoot.position.set(finPt.x, finPt.y, finPt.z);

      const fPillarL = B.MeshBuilder.CreateCylinder('fPillarL', { diameter: 0.8, height: 10.0 }, this.scene);
      fPillarL.position.set(-finB.x * (halfW + 3.5), 5.0, -finB.z * (halfW + 3.5));
      fPillarL.parent = finishRoot;

      const fPillarR = B.MeshBuilder.CreateCylinder('fPillarR', { diameter: 0.8, height: 10.0 }, this.scene);
      fPillarR.position.set(finB.x * (halfW + 3.5), 5.0, finB.z * (halfW + 3.5));
      fPillarR.parent = finishRoot;

      const fBeam = B.MeshBuilder.CreateBox('fBeam', { width: (halfW + 3.5) * 2.2, height: 2.0, depth: 1.2 }, this.scene);
      fBeam.position.set(0, 9.0, 0);
      fBeam.parent = finishRoot;

      const fMat = new B.StandardMaterial('fMat', this.scene);
      fMat.diffuseColor = B.Color3.FromHexString('#FFD700');
      fMat.emissiveColor = B.Color3.FromHexString('#FFA000');
      fPillarL.material = fMat;
      fPillarR.material = fMat;
      fBeam.material = fMat;

      this.bFinishGantry = finishRoot;
    }

    if (stage.fork) {
      const archZ = (stage.segmentCount * stage.segmentLength - ARCH_LEAD) * S;
      // Each arch names the stage its branch leads to.
      for (const side of [-1, 1]) {
        const label = side < 0 ? stage.fork.leftLabel : stage.fork.rightLabel;
        this.bCheckpointArches.push(this._checkpointArch(B, archZ, side, halfW, this._checkpointSignMaterial(B, side, label)));
      }
    }
    if (STAGE_ART[stage.id].flagman) this.bMarshal = this._marshal(B);

    this._applyStageLook(B, stage, pts, rights, forkStart, rumbleW);
    // A change of stage is in the haze: the verge's models and scatter, most
    // of its meshes and of their first draw, build a job a frame behind it.
    if (!changing) while (this.stageJobs.length) this.stageJobs.shift()();
  }

  // The arch a branch drives under where the autopilot takes over.
  _checkpointArch(B, z, side, halfW, signMat) {
    const scene = this.scene;
    const road = this._roadAt(z, side * 0.45);
    const root = new B.TransformNode(`bCheckpointArch_${side}`, scene);
    root.position.set(road.x, road.y, z);
    root.rotation.y = road.yaw;
    const span = halfW * 1.25;
    const mat = this._propMaterial(B, '#E8E2D0');
    for (const x of [-span / 2, span / 2]) {
      const pillar = B.MeshBuilder.CreateBox(`bArchPillar_${side}_${x}`, { width: 0.7, height: 7.5, depth: 0.7 }, scene);
      pillar.position.set(x, 3.75, 0);
      pillar.material = mat;
      pillar.parent = root;
    }
    const sign = B.MeshBuilder.CreatePlane(`bArchSign_${side}`, { width: span + 0.7, height: 1.6, sideOrientation: B.Mesh.DOUBLESIDE }, scene);
    sign.position.set(0, 7.2, -0.4);
    sign.parent = root;
    sign.material = signMat;
    return root;
  }

  // A gantry board: an arrow and the branch's name, dark on its colour, lit
  // by nothing so it reads the same in any light.
  _gantrySignMaterial(B, side, label, colour) {
    const mat = new B.StandardMaterial(`gSignMat_${side}`, this.scene);
    const tex = new B.DynamicTexture(`gSignTex_${side}`, { width: 512, height: 128 }, this.scene, true);
    const ctx = tex.getContext();
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#0B0D12';
    ctx.font = 'bold 46px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${side < 0 ? '◀ ' : ''}${label.toUpperCase()}${side > 0 ? ' ▶' : ''}`, 256, 82);
    tex.update();
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.disableLighting = true;
    this.bRaceFlowMats.push(mat);
    return mat;
  }

  _checkpointSignMaterial(B, side, label) {
    const scene = this.scene;
    const signMat = new B.StandardMaterial(`bArchSignMat_${side}`, scene);
    const tex = new B.DynamicTexture(`bArchSignTex_${side}`, { width: 512, height: 128 }, scene, true);
    const ctx = tex.getContext();
    ctx.fillStyle = '#E8E2D0';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#141414';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('CHECKPOINT', 150, 44);
    ctx.font = 'bold 44px sans-serif';
    ctx.fillText(label.toUpperCase().replace(/\s*\[.*\]/, ''), 24, 106);
    tex.update();
    signMat.diffuseTexture = tex;
    signMat.emissiveColor = new B.Color3(0.35, 0.35, 0.33);
    this.bRaceFlowMats.push(signMat);
    return signMat;
  }

  // The flag marshal beside the grid (DESIGN.md "Race flow"): the pack's
  // cartoon flagman on the verge, turned toward the cars.
  _marshal(B) {
    const scene = this.scene;
    // x = 1 is the road's outer edge.
    const road = this._roadAt(14, 1);
    const root = new B.TransformNode('bMarshal', scene);
    root.position.set(road.x + 2.4, road.y, 14);
    root.rotation.y = road.yaw + MARSHAL_FACING;
    const { rootNodes } = this.art.get(FLAGMAN).instantiateModelsToScene((name) => `bMarshal_${name}`, false, { doNotInstantiate: true });
    for (const node of rootNodes) node.parent = root;
    const node = (name) => {
      const found = rootNodes.flatMap((n) => [n, ...n.getDescendants(false)]).find((n) => n.name === `bMarshal_${name}`);
      if (!found) throw new Error(`renderer: ${FLAGMAN} has no ${name} node`);
      // The glTF loader poses nodes by quaternion, which overrides rotation.
      found.rotationQuaternion = null;
      return found;
    };
    const arm = node('arm_R');
    const flag = node('flag');
    for (const mesh of rootNodes.flatMap((n) => n.getChildMeshes(false))) {
      skyLit(mesh);
      if (mesh.material?.name === 'flag' && !this.swaying.has(mesh.material)) {
        this.swaying.add(mesh.material);
        this._sway(B, mesh.material);
      }
    }
    return { root, arm, flag };
  }

  _poseMarshal(state) {
    const m = this.bMarshal;
    if (!m) return;
    const pose = marshalPose(state);
    m.arm.rotation.z = pose.arm;
    m.flag.rotation.z = pose.flag;
  }

  // Lanes sit where the sim puts traffic (x = ±0.22, ±0.65): dashed dividers
  // between them, one 8 m dash per two 12 m segments, and solid edge lines
  // just inside the rumble strip. Past the fork each side's lines ride its
  // branch and the centre divider stops where the gore opens.
  _buildLaneLines(B, pts, rights, forkStart) {
    const L = this.lateralScale;
    const paint = this._lineMaterial(B);
    const across = (i, offset) => offset + Math.sign(offset) * this.forkDiverge[i];
    for (const [name, offset] of [['bEdge_0', -0.87 * L], ['bEdge_1', 0.87 * L]]) {
      const left = [];
      const right = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const b = rights[i];
        const d = across(i, offset);
        left.push(new B.Vector3(p.x + b.x * (d - 0.12), p.y + 0.04, p.z + b.z * (d - 0.12)));
        right.push(new B.Vector3(p.x + b.x * (d + 0.12), p.y + 0.04, p.z + b.z * (d + 0.12)));
      }
      const line = B.MeshBuilder.CreateRibbon(name, { pathArray: [right, left], closeArray: false, sideOrientation: B.Mesh.DOUBLESIDE }, this.scene);
      line.material = paint;
      this.bLaneLines.push(line);
    }
    [-0.435 * L, 0, 0.435 * L].forEach((offset, k) => {
      // One box's thin instances: no per-dash scene node to cull each frame
      // or to dirty when a stage swaps its light.
      const dash = B.MeshBuilder.CreateBox(`bLane_${k}`, { width: 0.2, height: 0.02, depth: 8 }, this.scene);
      dash.material = this._lineMaterial(B, offset === 0);
      const end = offset === 0 ? Math.min(forkStart, pts.length) : pts.length;
      const dashes = [];
      for (let i = 0; i + 1 < end; i += 2) {
        const p = pts[i];
        const q = pts[i + 1];
        const b = rights[i];
        const d = across(i, offset);
        dashes.push({
          lane: k, segment: i,
          x: (p.x + q.x) / 2 + b.x * d, y: (p.y + q.y) / 2 + 0.04, z: (p.z + q.z) / 2 + b.z * d,
          pitch: -Math.atan2(q.y - p.y, q.z - p.z), yaw: Math.atan2(q.x - p.x, q.z - p.z),
        });
      }
      const matrices = new Float32Array(dashes.length * 16);
      const one = new B.Vector3(1, 1, 1);
      dashes.forEach(({ x, y, z, pitch, yaw }, n) => {
        B.Matrix.Compose(one, B.Quaternion.RotationYawPitchRoll(yaw, pitch, 0), new B.Vector3(x, y, z)).copyToArray(matrices, n * 16);
      });
      dash.thinInstanceSetBuffer('matrix', matrices, 16, true);
      this.laneDashes.push(...dashes);
      this.bLaneLines.push(dash);
    });
  }

  /** The road behind the grid: asphalt, rumble strips, edge lines and dashes. */
  _buildLeadInRoad(B, halfW, rumbleW) {
    this.bRoadLead = this._straightRoad(B, 'Lead', this.leadPts, this.leadRights[0], halfW, rumbleW, this.bLeadIn);
  }

  /**
   * The road past a destination stage's end (DESIGN.md "End of a run"): on
   * to the foot of the place it arrives at, ground the rest of the way, and
   * the place itself, which the camera turns to as to a hero landmark.
   */
  _buildTerminus(B, halfW, rumbleW) {
    const stageId = this.currentStageId;
    const front = terminusRoadMetres(stageId);
    const end = this.leadOutPts[0];
    const on = this.endOn;
    const b = this.leadOutRights[0];
    const at = (d) => new B.Vector3(end.x + on.x * d, end.y, end.z + on.z * d);
    const road = [...this.leadOutPts.filter((_, k) => k * this.segLen < front), at(front)];
    this.bRoadEnd = this._straightRoad(B, 'End', road, b, halfW, rumbleW, this.bLeadOut);
    const ground = [at(front), ...this.leadOutPts.filter((_, k) => k * this.segLen > front)];
    const across = (d) => ground.map((p) => new B.Vector3(p.x + b.x * d, p.y - 0.05, p.z + b.z * d));
    const forecourt = [across(rumbleW), across(-rumbleW)];
    const mesh = B.MeshBuilder.CreateRibbon('bGroundEnd', { pathArray: forecourt, uvs: this._groundUVs(B, forecourt), closeArray: false, sideOrientation: B.Mesh.DOUBLESIDE }, this.scene);
    mesh.material = this.bGroundMat;
    skyLit(mesh);
    this.bLeadOut.push(mesh);
  }

  /** The destination's pieces as model spots, past the road's end, their fronts (+Z) facing back down it. */
  _destinationSpots() {
    const end = this.leadOutPts[0];
    const on = this.endOn;
    const b = this.leadOutRights[0];
    return STAGE_LOOKS[this.currentStageId].destination.map((piece) => ({
      ...piece,
      x: end.x + on.x * piece.beyond + b.x * piece.across,
      y: end.y - 0.05,
      z: end.z + on.z * piece.beyond + b.z * piece.across,
      yaw: Math.atan2(-on.x, -on.z),
    }));
  }

  /** A straight stretch of road over `pts`, its markings and rumble, into `into`. */
  _straightRoad(B, suffix, pts, b, halfW, rumbleW, into) {
    const across = (d, lift) => pts.map((p) => new B.Vector3(p.x + b.x * d, p.y + lift, p.z + b.z * d));
    const ribbon = (name, paths, material, uvs) => {
      const mesh = B.MeshBuilder.CreateRibbon(name, { pathArray: paths, uvs, closeArray: false, sideOrientation: B.Mesh.DOUBLESIDE }, this.scene);
      mesh.material = material;
      into.push(mesh);
      return mesh;
    };
    const road = [across(-halfW, 0.02), across(halfW, 0.02)];
    const surface = ribbon(`bRoad${suffix}`, road, this.bMaterials.road, this._roadUVs(B, road));
    skyLit(surface);
    ribbon(`bRumble${suffix}L`, [across(-halfW, 0.02), across(-rumbleW, 0.01)], this.bMaterials.rumbleRed);
    ribbon(`bRumble${suffix}R`, [across(rumbleW, 0.01), across(halfW, 0.02)], this.bMaterials.rumbleRed);
    const L = this.lateralScale;
    const paint = this._lineMaterial(B);
    for (const [k, d] of [[0, -0.87 * L], [1, 0.87 * L]]) ribbon(`bEdge${suffix}_${k}`, [across(d + 0.12, 0.04), across(d - 0.12, 0.04)], paint);
    const yaw = Math.atan2(pts[1].x - pts[0].x, pts[1].z - pts[0].z);
    [-0.435 * L, 0, 0.435 * L].forEach((d, k) => {
      const dash = B.MeshBuilder.CreateBox(`bLane${suffix}_${k}`, { width: 0.2, height: 0.02, depth: 8 }, this.scene);
      dash.material = this._lineMaterial(B, d === 0);
      const at = pts.slice(0, -1).filter((_, i) => i % 2 === 0).map((p, n) => [p, pts[2 * n + 1]]);
      const matrices = new Float32Array(at.length * 16);
      const one = new B.Vector3(1, 1, 1);
      at.forEach(([p, q], n) => {
        B.Matrix.Compose(one, B.Quaternion.RotationYawPitchRoll(yaw, 0, 0), new B.Vector3((p.x + q.x) / 2 + b.x * d, p.y + 0.04, (p.z + q.z) / 2 + b.z * d)).copyToArray(matrices, n * 16);
      });
      dash.thinInstanceSetBuffer('matrix', matrices, 16, true);
      into.push(dash);
    });
    return surface;
  }

  /** Paints queued cumulus within the frame's budget, uploading each card as it completes. */
  _prewarmClouds(B) {
    if (!this.isGPU) return;
    const t0 = performance.now();
    while (this.cloudQueue?.length && performance.now() - t0 < CLOUD_PREWARM_MS) {
      const job = this.cloudQueue[0];
      if (this.textures.has(job.key)) { this.cloudQueue.shift(); continue; }
      job.painter ??= cumulusPainter(job.size[0], job.size[1], job.seed, job.kind);
      job.row ??= 0;
      const to = Math.min(job.size[1], job.row + 8);
      job.painter.paintRows(job.row, to);
      job.row = to;
      if (job.row === job.size[1]) {
        this._generated(B, job.key, () => job.painter, true);
        this.cloudQueue.shift();
      }
    }
  }

  _trafficCar(B, i, type) {
    const key = `${i}:${type}`;
    if (!this.trafficPool.has(key)) this.trafficPool.set(key, this._createTrafficMesh(B, i, type));
    return this.trafficPool.get(key);
  }

  /** A new stage respawns its traffic at random: one car a frame builds every
   * slot's every type ahead of it, so the change of stage builds none. */
  _prewarmTraffic(B, state) {
    const count = state.traffic?.length ?? 0;
    for (let i = 0; i < count; i++) {
      for (const type of Object.keys(TRAFFIC_MODELS)) {
        if (this.trafficPool.has(`${i}:${type}`)) continue;
        this._trafficCar(B, i, type);
        return;
      }
    }
  }

  /** A fork stage's branches past its end, at their full divergence, with the gore between them. */
  _buildLeadOutRoad(B, rumbleW) {
    const pts = this.leadOutPts;
    const b = this.leadOutRights[0];
    const diverge = this.forkDiverge[this.forkDiverge.length - 1];
    const gap = Math.max(0, diverge - 0.6);
    const across = (d, lift) => pts.map((p) => new B.Vector3(p.x + b.x * d, p.y + lift, p.z + b.z * d));
    const ribbon = (name, paths, material, uvs) => {
      const mesh = B.MeshBuilder.CreateRibbon(name, { pathArray: paths, uvs, closeArray: false, sideOrientation: B.Mesh.DOUBLESIDE }, this.scene);
      mesh.material = material;
      this.bLeadOut.push(mesh);
      return mesh;
    };
    for (const [name, paths] of [['bRoadOutL', [across(-(diverge + rumbleW), 0.03), across(-gap, 0.03)]], ['bRoadOutR', [across(gap, 0.03), across(diverge + rumbleW, 0.03)]]]) {
      skyLit(ribbon(name, paths, this.bMaterials.road, this._roadUVs(B, paths)));
    }
    const gore = [across(gap, 0.035), across(-gap, 0.035)];
    ribbon('bGoreOut', gore, this.bGroundMat, this._groundUVs(B, gore));
    const L = this.lateralScale;
    const paint = this._lineMaterial(B);
    for (const [k, d] of [[0, -(0.87 * L + diverge)], [1, 0.87 * L + diverge]]) ribbon(`bEdgeOut_${k}`, [across(d + 0.12, 0.04), across(d - 0.12, 0.04)], paint);
    const yaw = Math.atan2(pts[1].x - pts[0].x, pts[1].z - pts[0].z);
    [-(0.435 * L + diverge), 0.435 * L + diverge].forEach((d, k) => {
      const dash = B.MeshBuilder.CreateBox(`bLaneOut_${k}`, { width: 0.2, height: 0.02, depth: 8 }, this.scene);
      dash.material = paint;
      const at = pts.slice(0, -1).filter((_, i) => i % 2 === 0).map((p, n) => [p, pts[2 * n + 1]]);
      const matrices = new Float32Array(at.length * 16);
      const one = new B.Vector3(1, 1, 1);
      at.forEach(([p, q], n) => {
        B.Matrix.Compose(one, B.Quaternion.RotationYawPitchRoll(yaw, 0, 0), new B.Vector3((p.x + q.x) / 2 + b.x * d, p.y + 0.04, (p.z + q.z) / 2 + b.z * d)).copyToArray(matrices, n * 16);
      });
      dash.thinInstanceSetBuffer('matrix', matrices, 16, true);
      this.bLeadOut.push(dash);
    });
  }

  /** Road paint: white lines, or the yellow centre line (DESIGN.md "Ghibli gouache"). */
  _lineMaterial(B, centre = false) {
    const key = centre ? 'bCentreLineMat' : 'bLineMat';
    if (!this[key]) {
      const mat = new B.StandardMaterial(key, this.scene);
      mat.diffuseColor = centre ? new B.Color3(0.96, 0.74, 0.18) : new B.Color3(0.92, 0.92, 0.9);
      mat.emissiveColor = centre ? new B.Color3(0.36, 0.26, 0.04) : new B.Color3(0.35, 0.35, 0.33);
      this[key] = mat;
    }
    return this[key];
  }

  _propMaterial(B, color, emissive = null, texture = null) {
    const key = `${color}|${emissive}|${texture}`;
    let mat = this.propMaterials.get(key);
    if (!mat) {
      mat = new B.StandardMaterial(`prop:${key}`, this.scene);
      mat.diffuseColor = B.Color3.FromHexString(color);
      mat.specularColor = new B.Color3(0.04, 0.04, 0.04);
      if (emissive) mat.emissiveColor = B.Color3.FromHexString(emissive);
      if (texture === 'windows') mat.emissiveTexture = this._windowTexture(B);
      if (texture === 'frond') {
        mat.diffuseTexture = this._generated(B, 'frond', () => frondTexture(128, 32), true);
        mat.useAlphaFromDiffuseTexture = true;
        mat.transparencyMode = B.Material.MATERIAL_ALPHATEST;
        // Mipmapping averages leaflets into their gaps; a low cut-off keeps a
        // far crown full instead of skeletal.
        mat.alphaCutOff = 0.2;
        mat.backFaceCulling = false;
      }
      if (texture === 'frond' || texture === 'sway') this._sway(B, mat);
      this.propMaterials.set(key, mat);
    }
    return mat;
  }

  _windowTexture(B) {
    const tex = new B.DynamicTexture('bWindowTex', { width: 64, height: 256 }, this.scene, false);
    const ctx = tex.getContext();
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 64, 256);
    const rand = createPrng(0x51A7);
    for (let y = 4; y < 256; y += 8) {
      for (let x = 4; x < 64; x += 8) {
        if (rand() < 0.45) {
          ctx.fillStyle = rand() < 0.7 ? '#FFC870' : '#9FD8FF';
          ctx.fillRect(x, y, 4, 4);
        }
      }
    }
    tex.update();
    return tex;
  }

  /** A generated map, uploaded once per key; null where there is no GPU. */
  /**
   * A generated texture, cached by key. An image whose rows run top down, as
   * a picture's do (`topDown`), is uploaded flipped so v rises up the image.
   */
  _generated(B, key, make, alpha = false) {
    if (!this.isGPU || !B.RawTexture?.CreateRGBATexture) return null;
    let tex = this.textures.get(key);
    if (!tex) {
      const map = make();
      tex = B.RawTexture.CreateRGBATexture(map.pixels, map.width, map.height, this.scene, true, !!map.topDown, B.Texture.TRILINEAR_SAMPLINGMODE);
      tex.wrapU = tex.wrapV = B.Texture.WRAP_ADDRESSMODE;
      tex.hasAlpha = alpha;
      this.textures.set(key, tex);
    }
    return tex;
  }

  _groundUVs(B, pathArray, tile = STAGE_ART[this.currentStageId].groundTile ?? TILE_METRES.ground) {
    return pathArray.flat().map((v) => new B.Vector2(v.x / tile, v.z / tile));
  }

  /** A road ribbon's UVs in tiles: u along its first edge, v across from it. */
  _roadUVs(B, pathArray) {
    const [edge] = pathArray;
    const along = [0];
    for (let i = 1; i < edge.length; i++) along.push(along[i - 1] + B.Vector3.Distance(edge[i - 1], edge[i]));
    return pathArray.flatMap((path) => path.map((v, i) => new B.Vector2(along[i] / TILE_METRES.road, B.Vector3.Distance(edge[i], v) / TILE_METRES.road)));
  }

  // DESIGN.md "Scenery": Ground and Water.
  _dressGround(B, look, pts, rights, rumbleW, waterY) {
    const art = STAGE_ART[this.currentStageId];
    this._surfaceTextures(B, this.bGroundMat, art.ground);
    const [r, g, b] = art.groundTint ?? [1, 1, 1];
    this.bGroundMat.albedoColor = new B.Color3(r, g, b);
    const swell = this._generated(B, 'waves', () => waveNormals(256, 256, 23));
    if (swell) swell.uScale = swell.vScale = 1;
    this.bWaterMat.bumpTexture = swell;
    if (!look.water) return;
    const side = look.water.side === 'left' ? -1 : 1;
    const edge = (offset) => pts.map((p, i) => {
      const b = rights[i];
      const d = rumbleW + this.forkDiverge[i] + offset;
      return new B.Vector3(p.x + side * b.x * d, waterY + 0.08, p.z + side * b.z * d);
    });
    const foam = B.MeshBuilder.CreateRibbon('bFoam', { pathArray: [edge(SHORE), edge(SHORE + 3.5)], sideOrientation: B.Mesh.DOUBLESIDE }, this.scene);
    foam.material = this._propMaterial(B, '#F4F1E8', '#9FA6A8');
    this.bShore.push(foam);
  }

  // DESIGN.md "Scenery": Horizon. Rings about the camera, as the sky is.
  _raiseHorizon(B, look, baseY) {
    const waterSide = look.water ? (look.water.side === 'left' ? -1 : 1) : 0;
    for (const { layer, radius, height, gap } of BACKDROPS) {
      const texture = this.art.get(`backdrop/${this.currentStageId}.${layer}`);
      texture.wrapU = B.Texture.WRAP_ADDRESSMODE;
      texture.wrapV = B.Texture.CLAMP_ADDRESSMODE;
      const mat = this.bBackdropMats[layer];
      mat.setTexture('backdropTexture', texture);
      mat.setFloat('gap', gap ? 1 : 0);
      mat.setFloat('waterSide', gap ? waterSide : 0);
      mat.setFloat('sink', height * 1.2);
      // Whole tiles around, each as wide as four heights.
      const tiles = Math.round((2 * Math.PI * radius) / (height * BACKDROP_ASPECT));
      // The foot sinks a tenth of the height below the stage's lowest ground.
      const footY = baseY - height * 0.1;
      const ring = (y) => Array.from({ length: BACKDROP_SEGMENTS + 1 }, (_, k) => {
        const a = (k / BACKDROP_SEGMENTS) * 2 * Math.PI;
        return new B.Vector3(Math.sin(a) * radius, y, Math.cos(a) * radius);
      });
      const us = Array.from({ length: BACKDROP_SEGMENTS + 1 }, (_, k) => (k / BACKDROP_SEGMENTS) * tiles);
      const strip = B.MeshBuilder.CreateRibbon(`bBackdrop_${layer}`, {
        pathArray: [ring(footY), ring(footY + height)],
        // The pack's textures load top row first: v runs down the strip.
        uvs: [...us.map((u) => new B.Vector2(u, 1)), ...us.map((u) => new B.Vector2(u, 0))],
        sideOrientation: B.Mesh.DOUBLESIDE,
      }, this.scene);
      strip.material = mat;
      strip.applyFog = false;
      strip.backdrop = { layer, radius, height, tiles, gap };
      this.bHorizon.push(strip);
    }
  }

  // The modern lighting stack (DESIGN.md Review, "Toward 2025-era graphics"):
  // image-based light from the stage's own sky, cascaded sun shadows, and the
  // screen-space passes the quality plan allows.
  _initLighting(B, plan) {
    const scene = this.scene;
    const cam = this.bCamera;

    if (plan.ssao) {
      // Its own geometry buffer, so it costs no colour attachments beside
      // the HDR target (Apple caps those at 32 bytes per sample).
      const ssao = new B.SSAO2RenderingPipeline('bSsao', scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [cam], true);
      ssao.radius = 1.4;
      ssao.totalStrength = 0.9;
      ssao.samples = 12;
      ssao.maxZ = 180;
    }
    if (plan.carProbe) {
      const car = new B.ReflectionProbe('bCarProbe', 128, scene);
      car.refreshRate = 3;
      car.cubeTexture.onAfterRenderObservable.add((face) => this._readCarProbe(B, face));
      this.carProbe = car;
    }

    const shadows = new B.CascadedShadowGenerator(plan.shadowMap, this.bSun);
    shadows.numCascades = 3;
    shadows.lambda = 0.85;
    shadows.shadowMaxZ = 260;
    shadows.stabilizeCascades = true;
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = B.ShadowGenerator.QUALITY_MEDIUM;
    shadows.darkness = 0.5;
    shadows.bias = 0.004;
    this.shadows = shadows;

    const ip = this.pipeline.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES;
    this.pipeline.samples = plan.msaa;
    // Anti-aliasing runs after the ink (below), or the outlines are drawn on
    // top of it as raw pixel stairs.
    this.pipeline.fxaaEnabled = !plan.style;
    if (plan.grade) {
      const curves = new B.ColorCurves();
      const { contrast, ...tints } = GRADE;
      Object.assign(curves, tints);
      ip.colorCurvesEnabled = true;
      ip.colorCurves = curves;
      ip.contrast = contrast;
    }
    if (plan.godRays) {
      const rays = new B.PostProcess('bGodRays', 'stkGodRays', {
        uniforms: ['sunPos', 'intensity'], size: 1.0, camera: cam, engine: this.engine,
        shaderLanguage: this.isWebGPU ? B.ShaderLanguage.WGSL : B.ShaderLanguage.GLSL,
      });
      rays.onApply = (effect) => {
        effect.setFloat2('sunPos', this.sunScreen.x, this.sunScreen.y);
        effect.setFloat('intensity', this.sunScreen.intensity);
      };
      this.godRays = rays;
      this.sunScreen = { x: 0.5, y: 0.5, intensity: 0 };
    }
    if (plan.style) {
      // Linear depth for the ink, half float so it filters everywhere; its own
      // pass, so it costs the scene target no colour attachment. The ink fades
      // out like exp2 fog by INK_METRES, sooner in thicker fog: inked, the
      // painted horizon ridges read as paper cut-outs.
      const depth = scene.enableDepthRenderer(cam, false, false).getDepthMap();
      const style = new B.PostProcess('bStyle', 'stkStyle', {
        uniforms: ['texel', 'outline', 'saturation', 'inkFar'], samplers: ['depthSampler'], size: 1.0, camera: cam, engine: this.engine,
        shaderLanguage: this.isWebGPU ? B.ShaderLanguage.WGSL : B.ShaderLanguage.GLSL,
      });
      style.onApply = (effect) => {
        effect.setTexture('depthSampler', depth);
        effect.setFloat2('texel', 1 / style.width, 1 / style.height);
        effect.setFloat('outline', STYLE.outline);
        effect.setFloat('saturation', STYLE.saturation);
        effect.setFloat('inkFar', Math.max(scene.fogDensity, 1 / INK_METRES) * cam.maxZ);
      };
      this.stylePass = style;
      this.inkAA = new B.FxaaPostProcess('bInkAA', 1.0, cam);
    }
    if (plan.speedBlur) {
      const blur = new B.PostProcess('bSpeedBlur', 'stkSpeedBlur', {
        uniforms: ['strength'], size: 1.0, camera: cam, engine: this.engine,
        shaderLanguage: this.isWebGPU ? B.ShaderLanguage.WGSL : B.ShaderLanguage.GLSL,
      });
      blur.onApply = (effect) => effect.setFloat('strength', this.speedBlurStrength);
      this.speedBlurStrength = 0;
      this.speedBlur = blur;
    }
  }

  // A stage's road and terrain take shadows; its standing props cast them.
  _shadowStage() {
    if (!this.shadows) return;
    for (const m of [this.bRoad, this.bRumbleL, this.bRumbleR, this.bForkRoadL, this.bForkRoadR, this.bForkDivider, ...this.bTerrain, ...this.bLaneLines]) {
      if (m) m.receiveShadows = true;
    }
    for (const t of this.bDecorMeshes ?? []) {
      const [kind, part] = t.name.split('#');
      if (GROUND_COVER.has(kind) || /^(coconut|dry)/.test(part ?? '')) continue;
      this.shadows.addShadowCaster(t, false);
    }
    for (const { spots, lods } of this.bModelSets ?? []) {
      // Full and middle detail reach past the cascades' far edge.
      if (spots.some((s) => s.casts)) for (const { mesh } of [...lods[0].parts, ...lods[1].parts]) this.shadows.addShadowCaster(mesh, false);
    }
    if (this.carProbe) {
      const list = this.carProbe.renderList;
      list.length = 0;
      list.push(this.bSky, this.bRoad, ...this.bTerrain, ...this.bHorizon);
      this.carProbeStale = true;
      // Until the cube's own is read back, the paint's diffuse light is the
      // stage sky's: a probe without one is read back on its first draw, and
      // the paint drawn before that lands is black.
      this.carProbe.cubeTexture.sphericalPolynomial = this.scene.environmentTexture.sphericalPolynomial;
    }
  }

  /**
   * The paint's diffuse light reads the car probe's spherical polynomial too;
   * a stage's first capture refreshes it, read back beside the one the paint
   * has, which it keeps until this lands (_shadowStage).
   */
  _readCarProbe(B, face) {
    if (face !== 5 || !this.carProbeStale) return;
    this.carProbeStale = false;
    const cube = this.carProbe.cubeTexture;
    B.CubeMapToSphericalPolynomialTools.ConvertCubeMapTextureToSphericalPolynomial(cube).then((polynomial) => {
      cube.sphericalPolynomial = polynomial;
    });
  }

  // The sun's screen position for the god-ray pass, faded out as it leaves
  // the view.
  _trackSun(B) {
    if (!this.godRays) return;
    const cam = this.bCamera;
    // The sky's drawn sun, not the light, whose elevation is clamped.
    const dir = this.sunDir;
    const forward = cam.getForwardRay(1).direction;
    const facing = B.Vector3.Dot(forward, dir);
    const at = B.Vector3.Project(cam.position.add(dir.scale(2000)), B.Matrix.Identity(), cam.getTransformationMatrix(),
      cam.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight()));
    const x = at.x / this.engine.getRenderWidth();
    const y = 1 - at.y / this.engine.getRenderHeight();
    const onScreen = Math.max(0, 1 - Math.max(Math.abs(x - 0.5), Math.abs(y - 0.5)) * 1.2);
    this.sunScreen.x = x;
    this.sunScreen.y = y;
    this.sunScreen.intensity = this.hasSun && facing > 0 ? 1.6 * facing * onScreen : 0;
  }

  // The toon plugin on every PBR surface.
  _toonMaterial(B, mat) {
    if (mat.getClassName() !== 'PBRMaterial' || !toonable(mat.name)) return;
    const renderer = this;
    this.StkToon ??= class extends B.MaterialPluginBase {
      constructor(material) {
        super(material, 'StkToon', 300, { STK_TOON: false, STK_LEAVES: false, STK_PATCH: false, STK_BRUSH: false, STK_PAINTED: false });
        this._grain = grainOf(material.name);
        this._brushed = brushed(material.name);
        this._enable(true);
      }
      prepareDefines(defines) {
        defines.STK_TOON = true;
        // A baked painting (assets/tools/ghibli/bake) carries its own brushwork,
        // leaf masses and shade: the toon light only modulates it.
        const painted = painterly(this._material);
        defines.STK_PAINTED = painted;
        defines.STK_LEAVES = this._grain === 'leaves' && !painted;
        defines.STK_PATCH = this._grain === 'patch';
        defines.STK_BRUSH = this._brushed && !painted;
      }
      getSamplers(samplers) {
        samplers.push('stkBrush');
      }
      getUniforms(lang) {
        return {
          ubo: [
            { name: 'toonSun', size: 3, type: 'vec3' }, { name: 'toonShade', size: 3, type: 'vec3' },
            { name: 'toonRim', size: 3, type: 'vec3' }, { name: 'toonLevel', size: 1, type: 'float' },
          ],
          fragment: lang === B.ShaderLanguage.WGSL ? '' : 'uniform vec3 toonSun; uniform vec3 toonShade; uniform vec3 toonRim; uniform float toonLevel;',
        };
      }
      bindForSubMesh(ubo) {
        const t = renderer.toon;
        ubo.updateFloat3('toonSun', ...t.sun);
        ubo.updateFloat3('toonShade', ...t.shade);
        ubo.updateFloat3('toonRim', ...t.rim);
        ubo.updateFloat('toonLevel', t.level);
        if (this._brushed) ubo.setTexture('stkBrush', renderer.brushTexture);
      }
      getCustomCode(shaderType, lang) {
        const wgsl = lang === B.ShaderLanguage.WGSL;
        if (shaderType === 'vertex') return wgsl ? TOON_VERTEX_WGSL : TOON_VERTEX_GLSL;
        return { CUSTOM_FRAGMENT_DEFINITIONS: wgsl ? TOON_DEFS_WGSL : TOON_DEFS_GLSL, CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: wgsl ? TOON_WGSL : TOON_GLSL };
      }
      isCompatible() { return true; }
      getClassName() { return 'StkToon'; }
    };
    new this.StkToon(mat);
  }

  // Wind for fronds and grass (windCode), where the engine has plugins.
  _sway(B, mat) {
    if (!this.isGPU) return;
    const renderer = this;
    this.StkWind ??= class extends B.MaterialPluginBase {
      constructor(material) {
        super(material, 'StkWind', 200, { STK_WIND: false });
        this._enable(true);
      }
      prepareDefines(defines) { defines.STK_WIND = true; }
      getUniforms(lang) { return { ubo: [{ name: 'windTime', size: 1, type: 'float' }], vertex: lang === B.ShaderLanguage.WGSL ? '' : 'uniform float windTime;' }; }
      bindForSubMesh(ubo) { ubo.updateFloat('windTime', renderer.windTime); }
      getCustomCode(shaderType, lang) {
        return shaderType === 'vertex' ? windCode(lang === B.ShaderLanguage.WGSL ? 'WGSL' : 'GLSL') : null;
      }
      isCompatible() { return true; }
      getClassName() { return 'StkWind'; }
    };
    new this.StkWind(mat);
  }

  // Per frame: wind time, sun-warmed haze and backlit fronds, the edge speed
  // blur, the camera's rumble shake, and the night headlight pool.
  _frameEffects(B, player, x, y, z, lx) {
    const cam = this.bCamera;
    const facing = B.Vector3.Dot(cam.getForwardRay(1).direction, this.sunDir);
    // An overcast or night sky has no sun to warm the haze toward.
    const h = this.hasSun ? sunHaze(this.baseFog, this.sunTint, facing) : this.baseFog;
    this.scene.fogColor.set(h.r, h.g, h.b);
    // A stage change hazes the painted sky and distance out with the land.
    const haze = this.transitionHaze ?? 0;
    for (const mat of [this.bSkyMat, ...Object.values(this.bBackdropMats)]) {
      mat.setFloat('haze', haze);
      mat.setColor3('hazeColor', this.scene.fogColor);
    }
    const rim = this.hasSun ? Math.max(0, facing) ** 2 * TOON_RIM : 0;
    const ahead = cam.getForwardRay(1).direction;
    const run = Math.hypot(ahead.x, ahead.z) || 1;
    for (const mat of Object.values(this.bBackdropMats)) mat.setVector2('heading', new B.Vector2(ahead.x / run, ahead.z / run));
    for (const strip of this.bHorizon) strip.position.set(cam.position.x, 0, cam.position.z);
    // An overcast or night sky has no sunlit cumulus to tower.
    for (const card of this.bClouds) {
      card.setEnabled(this.hasSun);
      if (!this.hasSun) continue;
      const at = cloudPlace(card, cam.position.x, cam.position.y, cam.position.z, this.windTime);
      card.position.set(at.x, at.y, at.z);
      card.visibility = 1 - haze;
      const k = CLOUD_TONE * this.toonExposure;
      const bankHaze = CLOUD_BANKS[card.bank].haze;
      const fog = this.scene.fogColor;
      card.material.emissiveColor = new B.Color3(lerp(k, fog.r, bankHaze), lerp(k, fog.g, bankHaze), lerp(k, fog.b, bankHaze));
    }
    for (const disc of this.bSunDisc) {
      disc.setEnabled(this.hasSun);
      if (!this.hasSun) continue;
      disc.position.copyFrom(cam.position.add(this.sunDir.scale(SUN_DISTANCE)));
      disc.visibility = 1 - haze;
      const k = disc.__strength * 1.6;
      disc.material.emissiveColor = new B.Color3(this.sunTint.r * k, this.sunTint.g * 0.62 * k, this.sunTint.b * 0.36 * k);
    }
    const k = rim * this.toonExposure;
    this.toon.rim = [this.sunTint.r * k, this.sunTint.g * k, this.sunTint.b * k];
    const speed = player?.speed ?? 0;
    // A camera that does not ride with the car feels no speed.
    this.speedBlurStrength = this.shotHeld ? 0 : Math.max(0, (speed - 200) / 115) * 0.06 + 0.1 * this.boostT;
    if (player && Math.abs(player.x) > 0.92 && speed > 40) {
      cam.position.y += Math.sin(this.windTime * 90) * 0.05 * Math.min(1, speed / 200);
    }
    this.carProbe?.position.set(x, y + 1.2, z);
    const pool = this.bHeadlightPool;
    if (pool) {
      this._setNodeEnabled(pool, this.isNight && !!player);
      const ahead = this._roadAt(z + 14, lx);
      pool.position.set(ahead.x, ahead.y + 0.06, z + 14);
      pool.rotation.y = ahead.yaw;
    }
  }

  // A warm pool of light thrown on the asphalt ahead on night stages.
  _initHeadlightPool(B) {
    const pool = B.MeshBuilder.CreatePlane('bHeadlightPool', { width: 7.5, height: 22 }, this.scene);
    pool.rotation.x = Math.PI / 2;
    const mat = new B.StandardMaterial('bHeadlightPoolMat', this.scene);
    const tex = new B.DynamicTexture('bHeadlightPoolTex', 64, this.scene, false);
    const ctx = tex.getContext();
    const g = ctx.createRadialGradient(32, 26, 1, 32, 32, 31);
    g.addColorStop(0, 'rgba(255,236,196,0.42)');
    g.addColorStop(0.45, 'rgba(255,226,170,0.16)');
    g.addColorStop(1, 'rgba(255,220,160,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    tex.update();
    tex.hasAlpha = true;
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.disableLighting = true;
    mat.transparencyMode = B.Material.MATERIAL_ALPHABLEND;
    pool.material = mat;
    this._setNodeEnabled(pool, false);
    this.bHeadlightPool = pool;
  }

  // The glow pass redraws what it is given; only lamps, tail lights and balls
  // glow, so the rest of the scene stays out of it.
  _limitGlow() {
    if (!this.glow) return;
    this.glow.includedOnlyMeshes = this.scene.meshes
      .filter((m) => m.__glowColor || m.parent?.__glowColor)
      .map((m) => m.uniqueId);
  }

  _applyStageLook(B, stage, pts, rights, forkStart, rumbleW) {
    const look = STAGE_LOOKS[stage.id];
    const scene = this.scene;
    const color = (hex) => B.Color3.FromHexString(hex);

    const art = STAGE_ART[stage.id];
    const skyId = `sky/${art.sky}.env`;
    const sky = artEntry(this.art.manifest, skyId);
    // One environment texture stays the scene's, taking each stage's
    // prefiltered sky (and its harmonics, which ride the GPU texture): setting
    // a new one marked every material dirty, 130 ms at a change of stage.
    const stageEnv = this.art.get(skyId);
    if (!this.environment) {
      this.environment = stageEnv.clone();
      scene.environmentTexture = this.environment;
    }
    this.environment._texture = stageEnv._texture;
    scene.environmentIntensity = art.skyLight ?? 1;
    // Each stage paints its own cumulus, every card its own.
    const seen = new Set();
    this.bClouds.forEach((card, k) => {
      const bank = CLOUD_BANKS[card.bank];
      const look = cloudLook(stage.id, k);
      card.cloudSeed = look.seed;
      card.cloudKind = look.kind;
      // Each kind serves two banks; its second card is mirrored,
      // so a kind seen twice at once never shows the same silhouette.
      card.mirrored = seen.has(card.cloudKind);
      seen.add(card.cloudKind);
      const aspect = CLOUD_KINDS[card.cloudKind];
      const roll = (n) => ((Math.imul(card.cloudSeed, 2654435761) >>> n) & 1023) / 1023;
      card.metres = bank.metres[0] + (bank.metres[1] - bank.metres[0]) * roll(3);
      // Spread along the bank's span, alternating sides of the road.
      card.along = ((card.slot + 0.15 + 0.7 * roll(7)) / bank.cards) * bank.span;
      card.side = (card.slot % 2 ? 1 : -1) * bank.distance * (0.45 + 0.6 * roll(13));
      // A bank is low; the others stand their full height.
      const tall = card.cloudKind === 'bank' || card.cloudKind === 'ridge' ? 0.6 : 1;
      card.rise = card.metres * tall / 2;
      card.cloudSize = look.size;
      card.scaling.set(card.metres * aspect * tall * (card.mirrored ? -1 : 1), card.metres * tall, 1);
      const tex = this._generated(B, look.key, () => cumulusCard(card.cloudSize[0], card.cloudSize[1], card.cloudSeed, card.cloudKind), true);
      card.material.emissiveTexture = tex;
      card.material.opacityTexture = tex;
    });
    const skyTexture = this.art.get(`sky/${art.sky}.paint.jpg`);
    // Repeats around the dome, so the seam-free longitude may run past 1.
    skyTexture.wrapU = B.Texture.WRAP_ADDRESSMODE;
    this.bSkyMat.setTexture('skyTexture', skyTexture);
    // The pack's sun is clamped out of the sky's light and handed back as the
    // directional light; a sky with no disc lights by its dome alone.
    const sunPeak = Math.max(0, ...(sky.sun_light_rgb ?? []));
    this.hasSun = sunPeak > 0;
    const az = look.sun.azimuth;
    const el = look.sun.elevation;
    const photoSun = this.hasSun ? skyDirection(B, sky.sun_dir) : new B.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    // Every stage is drawn in the afternoon: its whole sky (dome, light and
    // sun) turns so the sun stands SUN_TURN radians from the road's run,
    // held at an afternoon's height.
    const turn = this.hasSun ? SUN_TURN - Math.atan2(photoSun.x, photoSun.z) : 0;
    const turned = B.Vector3.TransformNormal(photoSun, B.Matrix.RotationY(turn));
    const elevation = this.hasSun ? Math.min(Math.max(Math.asin(turned.y), SUN_ELEVATION[0]), SUN_ELEVATION[1]) : Math.asin(turned.y);
    const flat = Math.hypot(turned.x, turned.z);
    const sunDir = new B.Vector3(turned.x / flat * Math.cos(elevation), Math.sin(elevation), turned.z / flat * Math.cos(elevation));
    this.sunDir = sunDir;
    this.bSky.rotation.y = turn;
    scene.environmentTexture.rotationY = turn;
    // Distance fades into the painted sky's own horizon.
    const exposure = sky.object_exposure * (art.exposure ?? 1);
    const haze = skyHaze(artEntry(this.art.manifest, `sky/${art.sky}.paint.jpg`).horizon_srgb, this.pipeline?.imageProcessing ? exposure : 1);
    this.baseFog = new B.Color3(haze.r, haze.g, haze.b);
    scene.clearColor = new B.Color4(haze.r, haze.g, haze.b, 1);
    scene.fogColor = this.baseFog.clone();
    this.sunTint = color(look.sun.color);
    this.isNight = NIGHT_STAGES.has(stage.id);
    this.baseFogDensity = look.fog.density * CLEAR_AIR;
    scene.fogDensity = this.baseFogDensity;

    this.bSun.direction = new B.Vector3(-sunDir.x, -Math.max(sunDir.y, 0.25), -sunDir.z);
    if (this.hasSun) this.bSun.diffuse = new B.Color3(...sky.sun_light_rgb.map((c) => c / sunPeak));
    this.bSun.intensity = sunPeak;
    this.bSun.shadowEnabled = this.hasSun;
    // Hemispheric light carries the sky's own irradiance to the materials
    // that do not read the environment.
    const skyPeak = Math.max(...sky.irradiance_up);
    this.bHemi.diffuse = new B.Color3(...sky.irradiance_up.map((c) => c / skyPeak));
    this.bHemi.groundColor = color(look.light.ground);
    this.bHemi.intensity = skyPeak;
    // Toon bands: lit toward the sun's colour, shade toward the sky's own
    // light and the haze, normalised by the light a sunlit face receives.
    // Toon bands: lit toward the sun's colour warmed to white, shade toward
    // the sky's own light and the haze's hue, against the sun's full
    // strength, so a backlit stage falls mostly into shade and reads as
    // silhouettes.
    const sunRgb = this.hasSun ? sky.sun_light_rgb.map((c) => c / sunPeak) : [1, 1, 1];
    const hazePeak = Math.max(haze.r, haze.g, haze.b);
    const hazeHue = [haze.r, haze.g, haze.b].map((c) => c / hazePeak);
    const skyRgb = sky.irradiance_up.map((c) => c / skyPeak);
    // The tints are set on screen, so the stage's exposure is divided out,
    // as the haze's is: every stage's bands land as bright as tuned.
    const unexposed = this.pipeline?.imageProcessing ? 1 / exposure : 1;
    this.toonExposure = unexposed;
    Object.assign(this.toon, {
      sun: sunRgb.map((c, k) => lerp(c, 1, 0.55) * TOON_LIT * TOON_WARM[k] * unexposed),
      shade: skyRgb.map((c, k) => (c + hazeHue[k]) * 0.5 * TOON_SHADE * TOON_COOL[k] * unexposed),
      level: this.hasSun ? sunPeak : skyPeak,
    });
    if (this.pipeline?.imageProcessing) {
      // The post-process grades with a configuration of its own: on the
      // scene's, an exposure marked every material dirty, though they leave
      // image processing to the post-process.
      const ip = this.pipeline.imageProcessing;
      if (ip.imageProcessingConfiguration === scene.imageProcessingConfiguration) ip.imageProcessingConfiguration = scene.imageProcessingConfiguration.clone();
      ip.exposure = exposure;
    }
    this.bSkyMat.setFloat('exposure', this.pipeline?.imageProcessing ? exposure : 1);
    for (const mat of Object.values(this.bBackdropMats)) mat.setFloat('exposure', this.pipeline?.imageProcessing ? exposure : 1);
    this.bWaterMat.diffuseColor = color(look.water?.color ?? look.ground);
    this.bWaterMat.specularColor = color(look.sun.color);

    // Terrain follows the road's height out to the props, then settles to the
    // stage's lowest point so far silhouettes stand on ground, not in the air.
    const baseY = Math.min(...pts.map((p) => p.y)) - 2;
    const waterY = baseY - 1;
    const terrainY = (p, offset) => offset <= 40 ? p.y - 0.05 : p.y + (baseY - p.y) * Math.min(1, (offset - 40) / 400);
    // The sea side is level to 18 out, then a beach down to the water at the shore.
    const isWet = (side) => !!look.water && side !== 0 && (look.water.side === 'left') === (side < 0);
    const groundY = (p, side, offset) => !isWet(side) ? terrainY(p, offset)
      : offset >= SHORE ? waterY : lerp(p.y - 0.05, waterY, Math.max(0, offset - 18) / (SHORE - 18));
    this.groundY = groundY;
    const band = (side, offsets, along = pts, across = rights, diverge = this.forkDiverge) => {
      const paths = offsets.map((offset) => along.map((p, i) => {
        const b = across[i];
        const d = rumbleW + (diverge[i] ?? 0) + offset;
        return new B.Vector3(p.x + side * b.x * d, groundY(p, side, offset), p.z + side * b.z * d);
      }));
      return side > 0 ? paths.reverse() : paths;
    };
    for (const side of [-1, 1]) {
      const wet = isWet(side);
      const pathArray = band(side, wet ? [0, 18, SHORE] : [0, 40, 440, 1400]);
      const terrain = B.MeshBuilder.CreateRibbon(`bTerrain_${side}`, { pathArray, uvs: this._groundUVs(B, pathArray), closeArray: false, sideOrientation: B.Mesh.DOUBLESIDE }, scene);
      terrain.material = this.bGroundMat;
      skyLit(terrain);
      this.bTerrain.push(terrain);
      const leadPath = band(side, wet ? [0, 18, SHORE] : [0, 40, 440, 1400], this.leadPts, this.leadRights, []);
      const outPath = band(side, wet ? [0, 18, SHORE] : [0, 40, 440, 1400], this.leadOutPts, this.leadOutRights, this.leadOutPts.map(() => this.forkDiverge[this.forkDiverge.length - 1]));
      const out = B.MeshBuilder.CreateRibbon(`bTerrainOut_${side}`, { pathArray: outPath, uvs: this._groundUVs(B, outPath), closeArray: false, sideOrientation: B.Mesh.DOUBLESIDE }, scene);
      out.material = this.bGroundMat;
      skyLit(out);
      this.bTerrain.push(out);
      const lead = B.MeshBuilder.CreateRibbon(`bTerrainLead_${side}`, { pathArray: leadPath, uvs: this._groundUVs(B, leadPath), closeArray: false, sideOrientation: B.Mesh.DOUBLESIDE }, scene);
      lead.material = this.bGroundMat;
      skyLit(lead);
      this.bTerrain.push(lead);
      if (wet) {
        // The sea starts at the shore all along the road, as the beach ends
        // there, behind the start and past a fork too.
        const seaOffsets = [SHORE, SHORE + SEA_REACH];
        const seas = [
          ['bWater', band(side, seaOffsets)],
          ['bWaterLead', band(side, seaOffsets, this.leadPts, this.leadRights, [])],
          ['bWaterOut', band(side, seaOffsets, this.leadOutPts, this.leadOutRights, this.leadOutPts.map(() => this.forkDiverge[this.forkDiverge.length - 1]))],
        ];
        for (const [name, seaPaths] of seas) {
          const water = B.MeshBuilder.CreateRibbon(name, { pathArray: seaPaths, uvs: this._groundUVs(B, seaPaths, WAVE_METRES), closeArray: false, sideOrientation: B.Mesh.DOUBLESIDE }, scene);
          water.material = this.bWaterMat;
          this.bWater.push(water);
        }
      }
    }

    this._dressGround(B, look, pts, rights, rumbleW, waterY);
    this._raiseHorizon(B, look, baseY);
    const decor = [];
    // Behind the grid stands the scenery of the road's first stretch,
    // mirrored across the start line; along a destination stage's road on
    // past its end, its last stretch's, mirrored across the finish, clear of
    // the place it arrives at.
    const ahead = placeProps(stage.id, pts.length, forkStart);
    const leadSegs = this.leadPts.length - 1;
    const outSegs = look.destination ? terminusRoadMetres(stage.id) / this.segLen : 0;
    const seaSide = art.seaWall ? (look.water.side === 'left' ? -1 : 1) : 0;
    const promenade = (pl) => pl.side === seaSide && pl.offset < SEA_WALL.out && ['grassTuft', 'shrub'].includes(pl.kind);
    const spotAhead = ({ kind, i, side, offset, yaw, scale }) => {
      const p = pts[i];
      const reach = (PROP_FOOTPRINT[kind] ?? 0) * scale;
      const b = rights[i];
      const d = side === 0 ? 0 : rumbleW + this.forkDiverge[i] + offset;
      // A large prop stands on the lowest ground under its footprint, across
      // the road and along it: on a climb its downhill side sinks in rather
      // than showing its underside.
      let y = p.y;
      if (side !== 0) {
        const span = Math.ceil(reach / this.segLen);
        y = Infinity;
        for (let j = Math.max(0, i - span); j <= Math.min(pts.length - 1, i + span); j++) {
          for (const o of [offset - reach, offset, offset + reach]) y = Math.min(y, groundY(pts[j], side, o));
        }
      }
      return {
        x: p.x + side * b.x * d,
        y,
        z: p.z + side * b.z * d,
        yaw: yaw ?? Math.atan2(pts[i + 1].x - p.x, pts[i + 1].z - p.z) + (side < 0 ? Math.PI : 0),
      };
    };
    const spot = (pl) => {
      if (!pl.behind && !pl.beyond) return spotAhead(pl);
      const at = spotAhead(pl);
      const p = pts[pl.i];
      const mirror = pl.behind ? pts[0] : pts[pts.length - 1];
      return { ...at, x: at.x + 2 * (mirror.x - p.x), y: at.y - p.y + mirror.y, z: at.z + 2 * (mirror.z - p.z) };
    };
    const destination = look.destination ? this._destinationSpots() : [];
    const pastEnd = (pl) => ({ ...pl, beyond: true });
    const clear = (pl) => {
      const at = spot(pl);
      return destination.every((piece) => Math.hypot(at.x - piece.x, at.z - piece.z) > (PROP_FOOTPRINT[piece.kind] * piece.scale + (PROP_FOOTPRINT[pl.kind] ?? 0) * pl.scale + 8));
    };
    const placements = [
      ...ahead,
      ...ahead.filter((pl) => pl.i <= leadSegs).map((pl) => ({ ...pl, behind: true })),
      ...(look.destination ? ahead.filter((pl) => pl.i >= pts.length - 1 - outSegs && pl.side !== 0 && !pl.landmark).map(pastEnd).filter(clear) : []),
    ].filter((pl) => !promenade(pl));
    this.propPlacements = placements;
    if (seaSide) this._seaWall(B, pts, rights, rumbleW, seaSide);
    if (art.carpet) this._carpet(B, pts, rights, rumbleW, art.carpet);
    this.propSpot = spot;
    // A kind the pack has models for draws them, each model once for all the
    // kinds that use it: its thin instances live on its shared geometry.
    const modelled = new Map();
    look.props.forEach((spec, k) => {
      const ours = placements.filter((pl) => pl.k === k);
      const models = art.models[spec.kind];
      if (models) {
        const scales = modelScales(this.art.manifest, spec.kind, models);
        ours.forEach((pl, n) => {
          const id = models[n % models.length];
          const height = artEntry(this.art.manifest, `model/${id}/lod0`).bounds_m[1][1];
          if (!modelled.has(id)) modelled.set(id, []);
          const scale = pl.scale * scales[n % models.length];
          const at = spot(pl);
          modelled.get(id).push({ ...at, yaw: at.yaw + (MODEL_TURN[id] ?? 0), scale, size: scale * height, casts: !GROUND_COVER.has(spec.kind) });
        });
        return;
      }
      const templates = PROP_BUILDERS[spec.kind](B, scene, (c, e, t) => this._propMaterial(B, c, e, t));
      // A part with no thin instances draws itself once, at its own transform.
      if (ours.length === 0) {
        for (const t of templates) t.dispose();
        return;
      }
      // Each part draws every placement as a thin instance, so its own
      // transform is folded into the instance matrices and reset to identity.
      for (const t of templates) {
        const tp = { x: t.position.x, y: t.position.y, z: t.position.z };
        const r = { x: t.rotation.x, y: t.rotation.y, z: t.rotation.z };
        const ts = { x: t.scaling.x, y: t.scaling.y, z: t.scaling.z };
        const matrices = new Float32Array(ours.length * 16);
        ours.forEach((pl, n) => {
          const { x, y, z, yaw } = spot(pl);
          const scale = pl.scale;
          const cos = Math.cos(yaw);
          const sin = Math.sin(yaw);
          const lx = tp.x * scale;
          const lz = tp.z * scale;
          B.Matrix.Compose(
            new B.Vector3(ts.x * scale, ts.y * scale, ts.z * scale),
            B.Quaternion.RotationYawPitchRoll(r.y + yaw, r.x, r.z),
            new B.Vector3(x + lx * cos + lz * sin, y + tp.y * scale, z - lx * sin + lz * cos),
          ).copyToArray(matrices, n * 16);
        });
        t.position.set(0, 0, 0);
        t.rotation.set(0, 0, 0);
        t.scaling.set(1, 1, 1);
        t.thinInstanceSetBuffer('matrix', matrices, 16, true);
        decor.push(t);
      }
    });
    for (const piece of destination) {
      const models = art.models[piece.kind];
      if (!models) throw new Error(`renderer: ${stage.id}'s destination ${piece.kind} has no model`);
      const [id] = models;
      const scale = piece.scale * modelScales(this.art.manifest, piece.kind, models)[0];
      if (!modelled.has(id)) modelled.set(id, []);
      modelled.get(id).push({ ...piece, scale, size: scale * artEntry(this.art.manifest, `model/${id}/lod0`).bounds_m[1][1], casts: true });
    }
    this.bDecorMeshes = decor;
    this._hangWires(B, ahead.filter((pl) => pl.kind === 'powerPole').sort((a, b) => a.i - b.i).map(spot));
    // The moments the chase camera swings wide for: the stage's hero
    // landmark, which it turns to, and the fork's checkpoint arch, then the
    // rarer set pieces where they keep LANDMARK_SPACING from every other.
    const mark = (pl) => {
      const at = spot(pl);
      return { z: at.z, side: pl.side, x: at.x, y: at.y, height: (KIND_HEIGHT[pl.kind] ?? 0) * pl.scale, hero: !!pl.landmark };
    };
    const heroes = ahead.filter((pl) => pl.landmark).map(mark);
    if (destination.length) {
      const [place] = destination;
      heroes.push({ z: place.z, side: 0, x: place.x, y: place.y, height: KIND_HEIGHT[place.kind] * place.scale, hero: true });
    }
    if (forkStart < pts.length) heroes.push({ z: pts[forkStart].z, side: 0, hero: false });
    const z0 = pts[0].z + LANDMARK_START;
    this.landmarks = heroes.filter((m) => m.z >= z0);
    for (const m of ahead.filter((pl) => LANDMARKS.has(pl.kind) && !pl.landmark).map(mark).sort((a, b) => a.z - b.z)) {
      if (m.z >= z0 && this.landmarks.every((o) => Math.abs(m.z - o.z) >= LANDMARK_SPACING)) this.landmarks.push(m);
    }
    this.landmarks.sort((a, b) => a.z - b.z);
    this.lodFrame = 0;
    this._limitGlow();
    this._shadowStage();
    this.stageJobs.push(
      ...[...modelled].map(([id, spots]) => () => this.bModelSets.push(this._modelSet(B, id, spots))),
      ...this._scatterVerge(B, stage, pts, rights, rumbleW, placements, spot),
      () => {
        this.lodFrame = 0;
        this._limitGlow();
        this._shadowStage();
      },
    );
    // The stages the forks lead to load while this one is driven.
    const fork = OUTRUN_STAGES[stage.id].fork;
    if (fork) for (const next of [fork.leftBranch, fork.rightBranch]) this.art.loadStage(next);
    // Their cumulus is painted while this one is driven, a few rows a frame,
    // so the change of stage paints none.
    this.cloudQueue = fork ? [fork.leftBranch, fork.rightBranch].flatMap((next) => this.bClouds.map((_, k) => cloudLook(next, k))) : [];
  }

  /**
   * The stage's verge scatter (DESIGN.md "Ghibli gouache"): each palette
   * entry's items as thin instances of one small mesh, cut into chunks of
   * SCATTER_CHUNK segments so only those near the camera draw; none on the
   * asphalt, inside a prop or by the flagman. The first stretch's scatter
   * stands mirrored behind the start, as its props do.
   */
  /** The promenade and the low sea wall along the road's sea side (DESIGN.md "Ghibli gouache"). */
  _seaWall(B, pts, rights, rumbleW, side) {
    const along = [...this.leadPts.slice(0, -1), ...pts];
    const across = [...this.leadRights.slice(0, -1), ...rights];
    const diverge = [...this.leadPts.slice(0, -1).map(() => 0), ...this.forkDiverge];
    const path = (offset, lift) => along.map((p, i) => {
      const d = rumbleW + diverge[i] + offset;
      return new B.Vector3(p.x + side * across[i].x * d, p.y + lift, p.z + side * across[i].z * d);
    });
    const order = (paths) => (side > 0 ? paths.reverse() : paths);
    const part = (name, paths, colour) => {
      const mesh = B.MeshBuilder.CreateRibbon(name, { pathArray: order(paths), closeArray: false, sideOrientation: B.Mesh.DOUBLESIDE }, this.scene);
      // PBR, so the painted light takes it as it takes the land.
      const mat = new B.PBRMaterial(name, this.scene);
      mat.albedoColor = B.Color3.FromHexString(colour);
      mat.metallic = 0;
      mat.roughness = 0.9;
      mesh.material = mat;
      mesh.receiveShadows = true;
      this.bSeaWall.push(mesh);
    };
    const { wall, out, height } = SEA_WALL;
    part('bPromenade', [path(0, 0.03), path(wall, 0.05)], PROMENADE.paving);
    part('bSeaWallFace', [path(wall, 0.05), path(wall, height)], PROMENADE.face);
    part('bSeaWallTop', [path(wall, height), path(out, height)], PROMENADE.top);
    part('bSeaWallBack', [path(out, height), path(out, -1.5)], '#A89C86');
  }

  // DESIGN.md "Ghibli gouache": a verge painted as a flower carpet, so the
  // flowers read as a mass at speed where heads alone read as dots; the
  // instanced heads stand on it near the camera.
  _carpet(B, pts, rights, rumbleW, colours) {
    const along = [...this.leadPts.slice(0, -1), ...pts];
    const across = [...this.leadRights.slice(0, -1), ...rights];
    const diverge = [...this.leadPts.slice(0, -1).map(() => 0), ...this.forkDiverge];
    const run = [0];
    for (let i = 1; i < along.length; i++) run.push(run[i - 1] + B.Vector3.Distance(along[i - 1], along[i]));
    const texture = this._generated(B, `carpet_${colours.join('_')}`, () => flowerCarpet(256, 11, colours));
    const mat = new B.PBRMaterial('bCarpet', this.scene);
    mat.albedoTexture = texture;
    mat.metallic = 0;
    mat.roughness = 0.95;
    for (const side of [-1, 1]) {
      const path = (offset) => along.map((p, i) => {
        const d = rumbleW + diverge[i] + offset;
        return new B.Vector3(p.x + side * across[i].x * d, p.y + CARPET.lift, p.z + side * across[i].z * d);
      });
      const paths = [path(CARPET.from), path(CARPET.to)];
      const uvs = paths.flatMap((_, k) => run.map((r) => new B.Vector2(r / CARPET.tile, (k ? CARPET.to - CARPET.from : 0) / CARPET.tile)));
      const mesh = B.MeshBuilder.CreateRibbon(`bCarpet_${side}`, { pathArray: side > 0 ? paths.reverse() : paths, uvs: side > 0 ? [...uvs.slice(run.length), ...uvs.slice(0, run.length)] : uvs, closeArray: false, sideOrientation: B.Mesh.DOUBLESIDE }, this.scene);
      mesh.material = mat;
      mesh.receiveShadows = true;
      skyLit(mesh);
      this.bCarpet.push(mesh);
    }
  }

  _scatterVerge(B, stage, pts, rights, rumbleW, placements, spot) {
    const scene = this.scene;
    const palette = VERGE_SCATTER[stage.id];
    if (!palette.length) return [];
    const solid = placements.filter((pl) => pl.side !== 0 && pl.kind in PROP_RADIUS).map((pl) => {
      const at = spot(pl);
      return { x: at.x, z: at.z, r: PROP_RADIUS[pl.kind] * pl.scale + 0.3 };
    });
    if (this.bMarshal) solid.push({ x: this.bMarshal.root.position.x, z: this.bMarshal.root.position.z, r: 1.2 });
    const cell = 12;
    const grid = new Map();
    for (const c of solid) {
      for (let gx = Math.floor((c.x - c.r) / cell); gx <= Math.floor((c.x + c.r) / cell); gx++) {
        for (let gz = Math.floor((c.z - c.r) / cell); gz <= Math.floor((c.z + c.r) / cell); gz++) {
          const key = `${gx},${gz}`;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(c);
        }
      }
    }
    const clear = (x, z) => !(grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? []).some((c) => Math.hypot(x - c.x, z - c.z) < c.r);
    const p0 = pts[0];
    const leadSegs = this.leadPts.length - 1;
    // Nothing grows on a promenade but its bed against the wall.
    const promenadeSide = STAGE_ART[stage.id].seaWall ? (STAGE_LOOKS[stage.id].water.side === 'left' ? -1 : 1) : 0;
    // Per palette entry and chunk, the items' places; chunk -1 is behind the start.
    const chunks = palette.map(() => new Map());
    for (const item of scatterVerge(stage.id, pts.length, this.segLen)) {
      const { k, i, along, side, size, yaw } = item;
      let { offset } = item;
      if (side === promenadeSide && offset < SEA_WALL.out + 0.3) {
        offset = promenadeBed(item.kind);
        if (offset === null) continue;
      }
      const p = pts[i];
      const q = pts[i + 1];
      const b = rights[i];
      const d = rumbleW + this.forkDiverge[i] + offset;
      const x = lerp(p.x, q.x, along) + side * b.x * d;
      const z = lerp(p.z, q.z, along) + side * b.z * d;
      const y = lerp(this.groundY(p, side, offset), this.groundY(q, side, offset), along);
      const places = [[Math.floor(i / SCATTER_CHUNK), x, y, z]];
      if (i < leadSegs) places.push([-1, x - 2 * (p.x - p0.x), y - p.y + p0.y, z - 2 * (p.z - p0.z)]);
      for (const [chunk, px, py, pz] of places) {
        if (!clear(px, pz)) continue;
        if (!chunks[k].has(chunk)) chunks[k].set(chunk, []);
        chunks[k].get(chunk).push({ x: px, y: py, z: pz, size, yaw });
      }
    }
    return palette.map(({ kind, colour }, k) => () => {
      const template = this._scatterMesh(B, kind, colour, k);
      this.bScatterTemplates.push(template);
      for (const [chunk, items] of chunks[k]) {
        // A mesh's thin-instance buffers live on its geometry: each chunk
        // needs its own, or the chunks overwrite one another's.
        const mesh = template.clone(`${template.name}@${chunk}`);
        mesh.makeGeometryUnique();
        mesh.material = template.material;
        const matrices = new Float32Array(items.length * 16);
        items.forEach(({ x, y, z, size, yaw }, n) => {
          // A cactus is a tall narrow stem, a tuft a low grass mound, a flower
          // a bright dot held up among the grass.
          const [w, h] = kind === 'cactus' ? [size * 0.32, size * 2] : kind === 'tuft' ? [size, size * 0.5] : kind === 'stone' ? [size, size * 0.55] : kind === 'flower' ? [size, size] : [size, size * 0.8];
          // Flowers dot the bushes' faces as well as the grass beneath them.
          const lift = kind === 'flower' ? 0.2 + 1.3 * ((yaw * 7.13) % 1) : 0;
          B.Matrix.Compose(new B.Vector3(w, h, w), B.Quaternion.RotationYawPitchRoll(yaw, 0, 0), new B.Vector3(x, y + lift, z)).copyToArray(matrices, n * 16);
        });
        mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
        mesh.thinInstanceRefreshBoundingInfo();
        mesh.freezeWorldMatrix();
        const zs = items.map((it) => it.z);
        this.bScatter.push({ mesh, z0: Math.min(...zs), z1: Math.max(...zs) });
      }
      template.setEnabled(false);
    });
  }

  /** One unit-sized scatter shape, its base at its origin, in its palette colour. */
  _scatterMesh(B, kind, colour, k) {
    const scene = this.scene;
    // The part after '#' picks the paint: leaf masses for foliage.
    const grain = { stone: 'stone', cactus: 'cactus', flower: 'flower', poppies: 'flower', drift: 'snow' }[kind] ?? 'foliage';
    const name = `scatter_${kind}_${k}#${grain}`;
    // DESIGN.md "Ghibli gouache": scrub, grass and wildflowers as the
    // concept paints them, textured clumps about a unit tall: a bush is
    // sprigs leaning out from its root, a tuft blades, a flower patch heads
    // at a few heights, a cactus a saguaro; stones stay one round.
    const rand = createPrng(0x5c7b + k * 977 + kind.length * 131);
    const lean = (part, x, z, tilt, h) => {
      const turn = Math.atan2(x, z);
      part.bakeTransformIntoVertices(B.Matrix.Translation(0, h / 2, 0)
        .multiply(B.Matrix.RotationX(tilt))
        .multiply(B.Matrix.RotationY(turn))
        .multiply(B.Matrix.Translation(x, 0, z)));
      return part;
    };
    const ring = (n, reach) => Array.from({ length: n }, (_, i) => {
      const a = (i / n) * 2 * Math.PI + rand() * 0.6;
      const r = reach * Math.sqrt(rand());
      return [Math.sin(a) * r, Math.cos(a) * r, r / reach];
    });
    let parts;
    if (kind === 'bush') {
      parts = ring(9, 0.32).map(([x, z, out]) => {
        const h = 0.55 + 0.45 * rand() * (1 - 0.5 * out);
        return lean(B.MeshBuilder.CreateCylinder(name, { diameterTop: 0.05, diameterBottom: 0.3, height: h, tessellation: 5 }, scene), x, z, 0.15 + 0.35 * out, h);
      });
    } else if (kind === 'tuft') {
      parts = ring(8, 0.18).map(([x, z, out]) => {
        const h = 0.6 + 0.4 * rand();
        return lean(B.MeshBuilder.CreateCylinder(name, { diameterTop: 0, diameterBottom: 0.08, height: h, tessellation: 3 }, scene), x, z, 0.2 + 0.45 * out, h);
      });
    } else if (kind === 'flower' || kind === 'poppies') {
      parts = ring(kind === 'poppies' ? 9 : 5, 0.4).map(([x, z]) => {
        const head = B.MeshBuilder.CreateSphere(name, { diameter: 0.3, segments: 2 }, scene);
        head.bakeTransformIntoVertices(B.Matrix.Translation(x, 0.45 + 0.45 * rand(), z));
        return head;
      });
    } else if (kind === 'drift') {
      // A snow bank: low overlapping mounds strung along the road, so drifts
      // side by side read as one continuous bank (round clumps read as cotton).
      parts = [-1.1, -0.35, 0.4, 1.1].map((z) => {
        const mound = B.MeshBuilder.CreateSphere(name, { diameter: 1, segments: 6 }, scene);
        mound.bakeTransformIntoVertices(B.Matrix.Scaling(1.3 + 0.5 * rand(), 0.4 + 0.15 * rand(), 1.4 + 0.4 * rand()).multiply(B.Matrix.Translation(0.15 * (rand() - 0.5), 0.05, z)));
        return mound;
      });
    } else if (kind === 'cactus') {
      // A saguaro: a ribbed trunk and two arms that elbow out and rise.
      const column = (d, h, x, y) => {
        const c = B.MeshBuilder.CreateCylinder(name, { diameter: d, height: h, tessellation: 8 }, scene);
        c.bakeTransformIntoVertices(B.Matrix.Translation(x, y + h / 2, 0));
        const cap = B.MeshBuilder.CreateSphere(name, { diameter: d, segments: 3 }, scene);
        cap.bakeTransformIntoVertices(B.Matrix.Translation(x, y + h, 0));
        return [c, cap];
      };
      const elbow = (x0, x1, y, d) => {
        const e = B.MeshBuilder.CreateCylinder(name, { diameter: d, height: Math.abs(x1 - x0), tessellation: 6 }, scene);
        e.bakeTransformIntoVertices(B.Matrix.RotationZ(Math.PI / 2).multiply(B.Matrix.Translation((x0 + x1) / 2, y, 0)));
        return e;
      };
      const up = 0.4 + 0.15 * rand();
      parts = [...column(0.17, 0.92, 0, 0), elbow(0.05, 0.2, up, 0.11), ...column(0.11, 0.3 + 0.1 * rand(), 0.2, up),
        elbow(-0.05, -0.17, up + 0.12, 0.1), ...column(0.1, 0.22 + 0.1 * rand(), -0.17, up + 0.12)];
    } else {
      const part = B.MeshBuilder.CreateSphere(name, { diameter: 1, segments: kind === 'stone' ? 2 : 5 }, scene);
      part.bakeTransformIntoVertices(B.Matrix.Translation(0, 0.5, 0));
      parts = [part];
    }
    const mesh = parts.length > 1 ? B.Mesh.MergeMeshes(parts, true) : parts[0];
    mesh.name = name;
    const mat = new B.PBRMaterial(name, scene);
    mat.albedoColor = B.Color3.FromHexString(colour);
    mat.metallic = 0;
    mat.roughness = 0.9;
    mesh.material = mat;
    return mesh;
  }

  // DESIGN.md "Ghibli gouache": a power line's wires hang from pole to pole,
  // sagging between them, from the crossarm's two insulators and the pole top.
  _hangWires(B, poles) {
    this.bWires?.dispose();
    this.bWires = null;
    if (poles.length < 2) return;
    const lines = [];
    for (let n = 1; n < poles.length; n++) {
      const a = poles[n - 1];
      const b = poles[n];
      if (Math.hypot(b.x - a.x, b.z - a.z) > WIRE_SPAN) continue;
      for (const [lx, ly] of WIRE_POINTS) {
        const end = (p) => new B.Vector3(p.x + lx * Math.cos(p.yaw), p.y + ly, p.z - lx * Math.sin(p.yaw));
        const from = end(a);
        const to = end(b);
        lines.push(Array.from({ length: WIRE_STEPS + 1 }, (_, k) => {
          const t = k / WIRE_STEPS;
          return B.Vector3.Lerp(from, to, t).add(new B.Vector3(0, -WIRE_SAG * 4 * t * (1 - t), 0));
        }));
      }
    }
    if (!lines.length) return;
    this.bWires = B.MeshBuilder.CreateLineSystem('bWires', { lines }, this.scene);
    this.bWires.color = new B.Color3(0.16, 0.15, 0.14);
  }

  /** Only the scatter chunks near the camera draw. */
  _showScatter(eye) {
    for (const { mesh, z0, z1 } of this.bScatter) mesh.setEnabled(z1 > eye.z - SCATTER_BEHIND && z0 < eye.z + SCATTER_AHEAD);
  }

  /**
   * One model at every placement of it: each part of each level of detail
   * holds every placement's matrix, ready for _updateLods to pick from.
   */
  _modelSet(B, id, spots) {
    const lods = [0, 1, 2].map((lod) => {
      const pivots = artEntry(this.art.manifest, `model/${id}/lod${lod}`).pivots ?? {};
      const { rootNodes } = this.art.get(`model/${id}/lod${lod}`).instantiateModelsToScene((name) => `${id}#${lod}#${name}`, false, { doNotInstantiate: true });
      const parts = rootNodes.flatMap((root) => root.getChildMeshes(false)).filter((mesh) => mesh.getTotalVertices() > 0).map((mesh) => {
        // Thin instances apply before the part's own world matrix (the
        // glTF root's handedness flip among it), so a placement P is drawn
        // as world · P · world⁻¹.
        const world = mesh.computeWorldMatrix(true).clone();
        const inverse = world.clone().invert();
        const thin = new Float32Array(spots.length * 16);
        spots.forEach(({ x, y, z, yaw, scale }, n) => {
          const place = B.Matrix.Compose(new B.Vector3(scale, scale, scale), B.Quaternion.RotationYawPitchRoll(yaw, 0, 0), new B.Vector3(x, y, z));
          world.multiply(place).multiply(inverse).copyToArray(thin, n * 16);
        });
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.setEnabled(false);
        skyLit(mesh);
        if (mesh.material?.name.endsWith('lamp')) mesh.__glowColor = mesh.material.emissiveColor;
        const mat = mesh.material;
        const part = mat?.name.split('#').pop();
        const tint = mat && MATERIAL_TINTS[part];
        if (tint) mat.albedoColor = B.Color3.FromHexString(tint);
        const lift = mat && MATERIAL_LIFT[`${id}/${part}`];
        if (lift && !mat.__lifted) {
          mat.albedoColor = mat.albedoColor.scale(lift);
          mat.__lifted = true;
        }
        if (mat && SWAYING.has(mat.name) && !this.swaying.has(mat)) {
          this.swaying.add(mat);
          this._sway(B, mat);
        }
        // A pivot node turns about its own origin, the manifest's hub.
        const spin = mesh.name.split('#').pop().replace(/_primitive\d+$/, '') in pivots;
        return { mesh, thin, drawn: '', picked: [], buffer: null, spin };
      });
      return { rootNodes, parts };
    });
    return { id, spots, lods };
  }

  /** Pivot parts turn `t` seconds on, about their local +Z, at each placement drawn. */
  _turnSails(t) {
    const B = globalThis.BABYLON;
    const turn = B.Matrix.RotationZ(t * SAIL_TURN);
    for (const { lods } of this.bModelSets) {
      for (const { parts } of lods) {
        for (const part of parts) {
          if (!part.spin || part.picked.length === 0) continue;
          part.picked.forEach((n, j) => turn.multiply(B.Matrix.FromArray(part.thin, n * 16)).copyToArray(part.buffer, j * 16));
          part.mesh.thinInstanceBufferUpdated('matrix');
        }
      }
    }
  }

  /** Each placement drawn at the detail its distance from `eye` calls for. */
  _updateLods(eye) {
    const visible = fogVisible(this.scene.fogDensity);
    for (const { spots, lods } of this.bModelSets) {
      const levels = [[], [], []];
      spots.forEach(({ x, z, size }, n) => {
        const lod = lodFor(Math.hypot(x - eye.x, z - eye.z), size, visible);
        if (lod !== null) levels[lod].push(n);
      });
      lods.forEach(({ parts }, lod) => {
        const picked = levels[lod];
        const key = picked.join(',');
        for (const part of parts) {
          const { mesh, thin } = part;
          if (part.drawn === key) continue;
          part.drawn = key;
          part.picked = picked;
          mesh.setEnabled(picked.length > 0);
          if (picked.length === 0) continue;
          const buffer = new Float32Array(picked.length * 16);
          picked.forEach((n, j) => buffer.set(thin.subarray(n * 16, n * 16 + 16), j * 16));
          part.buffer = buffer;
          // A turning part rewrites its matrices every frame, in place.
          mesh.thinInstanceSetBuffer('matrix', buffer, 16, !part.spin);
        }
      });
    }
  }
  /** Every character's car, once the art that builds it has loaded. */
  _mountKarts(B) {
    for (const charKey of Object.keys(CHARACTERS)) {
      const kart = this._create3DKartMesh(B, charKey);
      this.bKartMeshes.set(charKey, kart);
      if (this.carProbe) {
        for (const mesh of kart.root.getChildMeshes(false)) if (mesh.material && !toonable(mesh.material.name)) mesh.material.reflectionTexture = this.carProbe.cubeTexture;
      }
      if (this.shadows) for (const m of kart.root.getChildMeshes(false)) this.shadows.addShadowCaster(m, false);
    }
  }

  _create3DKartMesh(B, charKey) {
    const scene = this.scene;
    const root = new B.TransformNode('kart_' + charKey, scene);
    const charColors = {
      tux: '#D50000', // Iconic Rosso Corsa Red
      wilber: '#FFB300', // Giallo Modena Yellow
      gnu: '#8E24AA', // Purple
      suzanne: '#00897B', // Emerald
    };

    // DESIGN.md "Hero car": the pack's generated convertible, nose on +Z.
    const { rootNodes } = this.art.get(HERO_CAR).instantiateModelsToScene((name) => `kart_${charKey}_${name}`, true, { doNotInstantiate: true });
    // The root takes the road's pose and the heading; the chassis under it
    // the sim's sprung body pose, about the axles' height. The wheels are
    // unsprung: they stay with the root, on the road.
    const chassis = new B.TransformNode('chassis_' + charKey, scene);
    chassis.parent = root;
    chassis.setPivotPoint(new B.Vector3(0, BODY_PIVOT_Y, 0));
    for (const node of rootNodes) node.parent = chassis;
    const parts = rootNodes.flatMap((node) => node.getChildMeshes(false));
    const withMaterial = (name) => parts.filter((m) => m.material?.name.endsWith(name));
    const [body] = withMaterial('paint');
    if (!body) throw new Error(`renderer: ${HERO_CAR} has no paint`);
    for (const mat of new Set(parts.map((m) => m.material))) if (!toonable(mat.name)) lacquer(mat);
    const { riders, flutter, wave, rest, head, greet } = this._riders(B, chassis);
    body.material.albedoColor = B.Color3.FromHexString(charColors[charKey] || '#D50000');
    for (const lamp of withMaterial('taillight')) lamp.__glowColor = new B.Color3(0.6, 0.04, 0.1);
    // Each wheel is its own node at its hub: it spins about X and the front
    // pair steers about Y.
    const nodes = rootNodes.flatMap((node) => [node, ...node.getChildren(undefined, false)]);
    const wheels = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'].map((name) => {
      const wheel = nodes.find((n) => n.name.endsWith(name));
      if (!wheel) throw new Error(`renderer: ${HERO_CAR} has no ${name}`);
      wheel.rotationQuaternion = null;
      return wheel;
    });
    // A frame beside the chassis with the model root's own transform (its
    // handedness flip), so each wheel keeps its local pose.
    const gltfRoot = wheels[0].parent;
    if (!rootNodes.includes(gltfRoot)) throw new Error(`renderer: ${HERO_CAR}'s wheels are not on its root`);
    const wheelFrame = new B.TransformNode('wheels_' + charKey, scene);
    wheelFrame.parent = root;
    wheelFrame.position.copyFrom(gltfRoot.position);
    wheelFrame.rotationQuaternion = gltfRoot.rotationQuaternion?.clone() ?? null;
    wheelFrame.rotation.copyFrom(gltfRoot.rotation);
    wheelFrame.scaling.copyFrom(gltfRoot.scaling);
    for (const wheel of wheels) wheel.parent = wheelFrame;
    const rearZ = artEntry(this.art.manifest, HERO_CAR).bounds_m[0][2];

    // Nitro: a jet from each side's exhaust, yellow-white at the pipe and
    // burning out orange. It rides the car, and each particle stays under the
    // bloom threshold, so only the dense core blooms.
    const nitroParticles = [-1, 1].map((side) => {
      const flame = new B.ParticleSystem(`nitro_${charKey}_${side}`, 90, scene);
      flame.particleTexture = this.particleTextures.flame;
      flame.emitter = root;
      flame.isLocal = true;
      flame.minEmitBox = new B.Vector3(side * EXHAUST_X - 0.05, EXHAUST_Y - 0.03, rearZ - 0.05);
      flame.maxEmitBox = new B.Vector3(side * EXHAUST_X + 0.05, EXHAUST_Y + 0.03, rearZ - 0.05);
      flame.addColorGradient(0, new B.Color4(1.0, 0.95, 0.75, 0.45));
      flame.addColorGradient(0.3, new B.Color4(1.0, 0.78, 0.15, 0.45));
      flame.addColorGradient(0.65, new B.Color4(1.0, 0.38, 0.03, 0.3));
      flame.addColorGradient(1, new B.Color4(0.6, 0.06, 0.0, 0.0));
      flame.addSizeGradient(0, 0.7);
      flame.addSizeGradient(0.3, 1);
      flame.addSizeGradient(1, 0.5);
      flame.minSize = 0.1;
      flame.maxSize = 0.22;
      flame.minLifeTime = 0.05;
      flame.maxLifeTime = 0.14;
      flame.emitRate = FLAME_RATE;
      flame.blendMode = B.ParticleSystem.BLENDMODE_ADD;
      flame.direction1 = new B.Vector3(-0.06, 0.02, -1);
      flame.direction2 = new B.Vector3(0.06, 0.1, -1);
      flame.minEmitPower = 9;
      flame.maxEmitPower = 15;
      flame.stop();
      return flame;
    });

    // Drift sparks ParticleSystem
    const driftParticles = new B.ParticleSystem('drift_' + charKey, 80, scene);
    driftParticles.particleTexture = this.particleTextures.spark;
    driftParticles.emitter = root;
    driftParticles.minEmitBox = new B.Vector3(-1.0, 0.1, -1.1);
    driftParticles.maxEmitBox = new B.Vector3(1.0, 0.25, -1.1);
    driftParticles.color1 = new B.Color4(0.2, 0.8, 1.0, 1.0);
    driftParticles.color2 = new B.Color4(1.0, 0.85, 0.2, 0.8);
    driftParticles.colorDead = new B.Color4(0.1, 0.1, 0.3, 0.0);
    driftParticles.minSize = 0.15;
    driftParticles.maxSize = 0.4;
    driftParticles.minLifeTime = 0.1;
    driftParticles.maxLifeTime = 0.25;
    driftParticles.emitRate = 60;
    driftParticles.direction1 = new B.Vector3(-1.0, 0.5, -1.0);
    driftParticles.direction2 = new B.Vector3(1.0, 0.8, -1.5);
    driftParticles.minEmitPower = 2;
    driftParticles.maxEmitPower = 5;
    driftParticles.stop();

    return { root, chassis, body, riders, flutter, wave, rest, head, greet, wheels, steered: wheels.slice(0, 2), nitroParticles, driftParticles };
  }

  /**
   * The pack's riders in `chassis`'s seats, full and light detail
   * (DESIGN.md "Ghibli gouache"): their root nodes take the car's own frame,
   * and the rig's wind parts turn about their pivots.
   */
  _riders(B, chassis) {
    const { rig } = artEntry(this.art.manifest, RIDERS[0]);
    const riders = RIDERS.map((id, lod) => this.art.get(id).instantiateModelsToScene((name) => `${chassis.name}_r${lod}_${name}`, false, { doNotInstantiate: true }).rootNodes);
    // A rig node in every level of detail: the full one, and its twins that move with it.
    const posed = (name) => {
      const [node, ...twins] = riders.map((roots, lod) => {
        const found = roots.flatMap((root) => [root, ...root.getDescendants(false)]).find((n) => n.name.endsWith(`_${name}`));
        if (!found) throw new Error(`renderer: ${RIDERS[lod]} has no ${name}`);
        found.rotationQuaternion = null;
        return found;
      });
      return { node, twins };
    };
    const flutter = Object.entries(rig.nodes).filter(([, n]) => n.flutter_axis)
      .map(([name, { flutter_axis: axis, flutter_rad: amp }]) => ({ ...posed(name), axis, amp }));
    for (const roots of riders) for (const root of roots) root.parent = chassis;
    return { riders, flutter, wave: posed('boy_wave'), rest: posed('boy_rest'), head: posed('boy_head'), greet: this._girlArm(B, riders[0], chassis.name) };
  }

  /**
   * The girl's outer arm (DESIGN.md "End of a run"), cut from her full
   * detail's skin as its own mesh so she can lift it from the wheel and wave:
   * of the skin's three pieces (her face and her two arms) the one on her
   * outer side, glTF +X, below her chin. It turns about her shoulder: `lift`
   * raises it about X, toward up, and `wave` swings the raised arm about the
   * forward axis.
   */
  _girlArm(B, roots, name) {
    const skin = roots.flatMap((root) => [root, ...root.getDescendants(false)])
      .find((n) => /_girl_primitive\d+$/.test(n.name) && n.material?.name.endsWith('skin'));
    if (!skin) throw new Error('renderer: the riders have no girl skin');
    skin.makeGeometryUnique();
    const positions = skin.getVerticesData(B.VertexBuffer.PositionKind);
    const normals = skin.getVerticesData(B.VertexBuffer.NormalKind);
    const colors = skin.getVerticesData(B.VertexBuffer.ColorKind);
    const indices = skin.getIndices();
    const parent = Array.from({ length: positions.length / 3 }, (_, v) => v);
    const root = (v) => (parent[v] === v ? v : (parent[v] = root(parent[v])));
    for (let t = 0; t < indices.length; t += 3) {
      parent[root(indices[t])] = root(indices[t + 1]);
      parent[root(indices[t + 1])] = root(indices[t + 2]);
    }
    const pieces = new Map();
    for (let v = 0; v < parent.length; v++) {
      const piece = pieces.get(root(v)) ?? { n: 0, x: 0, y: 0 };
      piece.n++;
      piece.x += positions[v * 3];
      piece.y += positions[v * 3 + 1];
      pieces.set(root(v), piece);
    }
    const outer = [...pieces].find(([, p]) => p.x / p.n > GIRL_ARM.side && p.y / p.n < GIRL_ARM.chin)?.[0];
    if (outer === undefined) throw new Error('renderer: the girl has no outer arm to wave');
    const kept = [];
    const cut = [];
    for (let t = 0; t < indices.length; t += 3) (root(indices[t]) === outer ? cut : kept).push(indices[t], indices[t + 1], indices[t + 2]);
    skin.setIndices(kept);
    const used = [...new Set(cut)];
    const at = new Map(used.map((v, k) => [v, k]));
    const [px, py, pz] = GIRL_ARM.shoulder;
    const arm = new B.VertexData();
    arm.positions = used.flatMap((v) => [positions[v * 3] - px, positions[v * 3 + 1] - py, positions[v * 3 + 2] - pz]);
    arm.normals = used.flatMap((v) => [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]]);
    if (colors) arm.colors = used.flatMap((v) => [0, 1, 2, 3].map((c) => colors[v * 4 + c]));
    arm.indices = cut.map((v) => at.get(v));
    const shoulder = new B.TransformNode(`${name}_girl_shoulder`, this.scene);
    shoulder.parent = skin.parent;
    shoulder.position.set(px, py, pz);
    const raise = new B.TransformNode(`${name}_girl_raise`, this.scene);
    raise.parent = shoulder;
    const mesh = new B.Mesh(`${name}_girl_arm`, this.scene);
    arm.applyToMesh(mesh);
    mesh.material = skin.material;
    mesh.parent = raise;
    // The way about X that lifts the hand, read off the hand itself: the
    // glTF root's handedness flip sits above, so local +Y is still up.
    const hand = used.reduce((a, v) => (positions[v * 3 + 2] > positions[a * 3 + 2] ? v : a));
    const reach = new B.Vector3(positions[hand * 3] - px, positions[hand * 3 + 1] - py, positions[hand * 3 + 2] - pz);
    const up = B.Vector3.TransformCoordinates(reach, B.Matrix.RotationX(1)).y > reach.y ? 1 : -1;
    // And the way about the forward axis that takes the raised hand out past
    // her hair, her outer side being +X.
    const raised = B.Vector3.TransformCoordinates(reach, B.Matrix.RotationX(up * GIRL_ARM.raise));
    const out = B.Vector3.TransformCoordinates(raised, B.Matrix.RotationZ(1)).x > raised.x ? 1 : -1;
    return {
      arm: mesh,
      raise,
      shoulder,
      pose(lift, t) {
        raise.rotation.x = up * GIRL_ARM.raise * lift;
        shoulder.rotation.z = out * lift * (GIRL_ARM.out + GIRL_ARM.swing * Math.sin(t * GIRL_ARM.rate));
      },
    };
  }

  /**
   * The replay's cinematic cameras (DESIGN.md "End of a run"), a pure
   * function of the window and the frame: a helicopter high and wide behind
   * the car sliding up alongside it, then the chase camera's own landmark
   * pull (null), then a camera at the roadside opposite the landmark that
   * waits for the car, its lens narrowing as it is far, and turns to follow
   * it by. The stage's hero landmark is the one the window opened short of.
   */
  _replayShot(B, cut, state, a, car) {
    const t = Math.max(0, (state.tick - 1 + a - cut.from) / 60);
    const span = cut.frames / 60;
    const heroes = this.landmarks.filter((m) => m.hero);
    const hero = heroes.find((m) => m.z > car.z - REPLAY_SHOTS.passed) ?? heroes.at(-1);
    const side = hero?.side || 1;
    if (t < span * REPLAY_SHOTS.helicopter) {
      const u = t / (span * REPLAY_SHOTS.helicopter);
      const { back, slide, out, up, drop } = REPLAY_SHOTS.heli;
      return {
        eye: new B.Vector3(car.x - side * out, car.y + up - drop * u, car.z - back + slide * u),
        at: new B.Vector3(car.x + side * 4, car.y + 2, car.z + 25),
        lens: 0.72,
      };
    }
    if (t < span * REPLAY_SHOTS.pull) return null;
    const { ahead, behind, off, high } = REPLAY_SHOTS.roadside;
    const plant = Math.min(car.z + ahead, Math.max(car.z - behind, hero?.z ?? car.z + ahead));
    const road = this._roadAt(plant, 0);
    const eye = new B.Vector3(road.x - side * (this.lateralScale + off), road.y + high, plant);
    const at = new B.Vector3(car.x, car.y + 0.8, car.z);
    const reach = B.Vector3.Distance(eye, at);
    return { eye, at, lens: Math.max(0.22, Math.min(0.9, 2 * Math.atan(7 / reach))) };
  }

  _createTrafficMesh(B, i, type) {
    const scene = this.scene;
    const colors = ['#E53935', '#1E88E5', '#43A047', '#FB8C00', '#FDD835', '#8E24AA', '#FFFFFF', '#424242'];
    const root = new B.TransformNode(`bTraffic_${i}`, scene);

    // DESIGN.md "Traffic": the pack's 80s bodies, each car its own paint.
    const id = `model/${TRAFFIC_MODELS[type]}/${TRAFFIC_LOD}`;
    const { bounds_m: [[, , rearZ], [halfW]], wheels } = artEntry(this.art.manifest, id);
    const { rootNodes } = this.art.get(id).instantiateModelsToScene((name) => `bTraffic_${i}_${name}`, false, { doNotInstantiate: true });
    for (const node of rootNodes) node.parent = root;
    const meshes = rootNodes.flatMap((node) => node.getChildMeshes(false));
    // Cloning a car's every material was most of its cost: the cars of a
    // type share one set, and each owns only its paint and its tail lamps.
    const looks = this.trafficLooks[type] ??= new Map();
    for (const mesh of meshes) {
      skyLit(mesh);
      if (!looks.has(mesh.material)) {
        const mat = mesh.material.clone(`bTraffic_${type}_${mesh.material.name.split('_').pop()}`);
        if (!toonable(mat.name)) lacquer(mat);
        looks.set(mesh.material, mat);
      }
      mesh.material = looks.get(mesh.material);
    }
    const own = (part) => {
      const shared = [...looks.values()].find((mat) => mat.name === `bTraffic_${type}_${part}`);
      if (!shared) throw new Error(`renderer: ${id} has no ${part} material`);
      const mat = shared.clone(`bTraffic_${i}_${part}`);
      for (const mesh of meshes) if (mesh.material === shared) mesh.material = mat;
      return mat;
    };
    const matBody = own('paint');
    matBody.albedoColor = B.Color3.FromHexString(colors[i % colors.length]);
    const matTail = own('taillight');

    const blinker = (name, side) => {
      const mat = new B.StandardMaterial(`bTrafficMat${name}_${i}`, scene);
      mat.diffuseColor = new B.Color3(0.8, 0.5, 0.0);
      mat.emissiveColor = new B.Color3(0.1, 0.07, 0.0);
      const box = B.MeshBuilder.CreateBox(`bTraffic${name}_${i}`, { width: 0.16, height: 0.12, depth: 0.06 }, scene);
      box.position.set(side * (halfW - 0.12), 0.8, rearZ - 0.02);
      box.material = mat;
      box.parent = root;
      return mat;
    };
    const hub = (name) => wheels.find((w) => w.name === name).hub[2];
    const axleFront = hub('wheel_FL');
    const axleRear = -hub('wheel_RL');
    this._setNodeEnabled(root, false);
    return { root, type, axleFront, axleRear, matBody, matTail, matBlinkerL: blinker('BlinkL', -1), matBlinkerR: blinker('BlinkR', 1) };
  }

  _renderBabylon(state, isHistorical = false, prevState = null, alpha = 1, cut = null) {
    if (state.stageId && state.stageId !== this.currentStageId) {
      // The bridge holds the race while a stage's art loads; until then the
      // last frame stands.
      if (!this.art.ready(state.stageId)) return;
      this._rebuildTrackForStage(state.stageId);
      // A replay cuts to a stage outside any haze: it is built whole.
      if (cut) while (this.stageJobs.length) this.stageJobs.shift()();
    } else {
      this.stageJobs.shift()?.();
    }

    const B = globalThis.BABYLON;
    const a = Math.max(0, Math.min(1, typeof alpha === 'number' ? alpha : 1));
    this.windTime = (state.tick || 0) / 60;
    if (this.bWaterMat.bumpTexture) this.bWaterMat.bumpTexture.uOffset = (state.tick || 0) * 0.0004;
    const player = state.karts.find((k) => k.isPlayer) || state.karts[0];
    const S = this.trackScale;

    let playerKx = 0;
    let playerKy = 0;
    let playerKz = 0;
    let playerLx = 0;
    let playerSteer = 0;
    let playerSwing = 0;
    let playerPitch = 0;
    let playerBoosting = false;

    const racing = new Set(state.karts.map((k) => k.character));
    for (const [character, m] of this.bKartMeshes) this._setNodeEnabled(m.root, racing.has(character));

    for (let i = 0; i < state.karts.length; i++) {
      const kart = state.karts[i];
      const meshObj = this.bKartMeshes?.get(kart.character);
      if (!meshObj) continue;

      const prevKart = prevState?.karts?.find(k => k.character === kart.character);
      // The sim keeps the player within [0, trackLength] and parks it at
      // trackLength on the finish; only rivals lap the stage.
      const along = (z) => (kart.isPlayer ? z : z % state.trackLength) * S;
      let lx = kart.x;
      let kz = along(kart.z);
      let steerAngle = kart.steerAngle || 0;
      let heading = kart.heading || 0;
      let body = kart.body;

      if (prevKart && !isHistorical) {
        const dz = kart.z - prevKart.z;
        // Continuous interpolation when not wrapping around the lap boundary
        if (dz >= 0 && dz < state.trackLength * 0.5) {
          lx = lerp(prevKart.x, kart.x, a);
          kz = along(lerp(prevKart.z, kart.z, a));
          steerAngle = lerpAngle(prevKart.steerAngle || 0, kart.steerAngle || 0, a);
          heading = lerp(prevKart.heading || 0, kart.heading || 0, a);
          body = { pitch: lerp(prevKart.body.pitch, kart.body.pitch, a), roll: lerp(prevKart.body.roll, kart.body.roll, a), stretch: lerp(prevKart.body.stretch, kart.body.stretch, a) };
        }
      }

      const road = this._poseOnRoad(kz, lx);
      const posX = road.x;
      const posY = road.y;
      // The car points where the sim's bicycle model heads it, a few degrees
      // off the road for a lane change, and its body rides the sim's springs:
      // nose up is a negative turn about X, and the stretch keeps its volume.
      const slip = heading;
      meshObj.root.position.set(posX, posY, kz);
      meshObj.root.rotation.x = -road.pitch;
      meshObj.root.rotation.y = road.yaw + slip + (kart.drift ? kart.driftDir * 0.3 : 0);
      meshObj.chassis.rotation.x = -body.pitch;
      meshObj.chassis.rotation.z = body.roll;
      const across = 1 / Math.sqrt(1 + body.stretch);
      meshObj.chassis.scaling.set(across, across, 1 + body.stretch);
      // Scarf, long hair and the waving arm swing on the wind time, faster
      // and wider with speed.
      const gust = 0.4 + 0.6 * Math.min(1, Math.abs(kart.speed || 0) / 200);
      meshObj.flutter.forEach(({ node, axis, amp, twins }, n) => {
        const turn = Math.sin(this.windTime * (6 + 3 * gust) + n * 1.9 + i) * amp * gust;
        node.rotation[axis] = turn;
        for (const twin of twins) twin.rotation[axis] = turn;
      });
      // The boy's arm rests on the door, gripping its edge; a moment (the sim's
      // wave timer) swaps in the waving arm, lifts it, waves it and lowers it,
      // eased. His head glances about now and then.
      const u = 1 - (kart.waveTimer ?? 0) / WAVE_TICKS;
      const lift = kart.waveTimer > 0 ? smoothstep(0, 0.2, u) * (1 - smoothstep(0.8, 1, u)) : 0;
      const waveZ = lerp(WAVE_REST, Math.sin(this.windTime * 13) * 0.3, lift);
      const t = this.windTime + i * 3.7;
      const glance = smoothstep(0, 1.2, t % GLANCE_PERIOD) * (1 - smoothstep(2.6, 3.8, t % GLANCE_PERIOD));
      const headY = (Math.floor(t / GLANCE_PERIOD) % 2 ? GLANCE_GIRL : GLANCE_SCENERY) * glance;
      for (const n of [meshObj.wave.node, ...meshObj.wave.twins]) { n.rotation.z = waveZ; this._setNodeEnabled(n, kart.waveTimer > 0); }
      for (const n of [meshObj.rest.node, ...meshObj.rest.twins]) this._setNodeEnabled(n, !(kart.waveTimer > 0));
      for (const n of [meshObj.head.node, ...meshObj.head.twins]) n.rotation.y = headY;
      // Pulled up at her ending, the girl lifts her hand from the wheel and waves.
      const parked = kart.isPlayer && state.parkedAt != null ? state.endTicks - state.parkedAt : -1;
      const greet = parked < 0 ? 0 : smoothstep(0, 20, parked) * (1 - smoothstep(GIRL_WAVE_TICKS - 20, GIRL_WAVE_TICKS, parked));
      meshObj.greet.pose(greet, this.windTime);
      // The car the player drives carries the full detail, the others the light.
      meshObj.riders.forEach((roots, lod) => { for (const r of roots) this._setNodeEnabled(r, (lod === 0) === !!kart.isPlayer); });

      if (kart.isPlayer) {
        playerKx = posX;
        playerKy = posY;
        playerKz = kz;
        playerLx = lx;
        playerSteer = steerAngle;
        playerSwing = slip;
        playerPitch = road.pitch;
        playerBoosting = !!(kart.isNitro || kart.turboTimer > 0);
      }

      if (kart.spinTimer > 0) {
        meshObj.root.rotation.y += (kart.spinTimer * 36) * Math.PI / 180;
      }

      for (const wl of meshObj.wheels) {
        wl.rotation.x += kart.speed * 0.02;
      }
      for (const wl of meshObj.steered) wl.rotation.y = steerAngle * 0.6;

      const isBoosting = !!(kart.isNitro || kart.turboTimer > 0);
      meshObj.flameT = isBoosting ? 1 : (meshObj.flameT || 0) * (1 - FLAME_FADE);
      if (meshObj.flameT < 0.05) meshObj.flameT = 0;
      for (const flame of meshObj.nitroParticles) {
        flame.emitRate = FLAME_RATE * meshObj.flameT;
        if (meshObj.flameT > 0 && !flame.isStarted()) flame.start();
        if (meshObj.flameT === 0 && flame.isStarted()) flame.stop();
      }

      const isDrifting = !!(kart.drift && Math.abs(kart.speed) > 20);
      if (isDrifting) {
        if (!meshObj.driftParticles.isStarted()) meshObj.driftParticles.start();
      } else {
        if (meshObj.driftParticles.isStarted()) meshObj.driftParticles.stop();
      }

    }

    // Nitro surges in fast and fades out slower than it came.
    this.boostT += ((playerBoosting ? 1 : 0) - this.boostT) * (playerBoosting ? 0.18 : 0.025);

    if (player && this.bCamera) {
      const px = playerKx;
      const py = playerKy;
      const pz = playerKz;
      const steerAngle = playerSteer;
      const ahead = this._roadAt(pz + 18.0, playerLx);
      // The camera breathes (DESIGN.md "Chase camera"): close over the cockpit
      // by default, it pulls back as speed builds and much further on nitro,
      // closes in toward the hood when a car comes close, lifts over a crest,
      // and swings up and wide for a landmark ahead. Each is a smooth function
      // of the state.
      const pace = Math.min(1, Math.max(0, (player.speed || 0) / 315));
      let near = 0;
      for (const other of [...(state.traffic || []), ...state.karts.filter((k) => !k.isPlayer)]) {
        const d = Math.hypot((other.z - player.z) * S, (other.x - player.x) * this.lateralScale);
        near = Math.max(near, 1 - smoothstep(NEAR_FULL, NEAR_GONE, d));
      }
      let pull = 0;
      let pullSide = 0;
      let hero = null;
      for (const m of this.landmarks) {
        const w = landmarkPull(m.z - pz);
        if (w > pull) { pull = w; pullSide = m.side; hero = m.hero ? m : null; }
      }
      const gradeAhead = (this._roadAt(pz + 40, playerLx).y - this._roadAt(pz + 30, playerLx).y) / 10;
      const crest = Math.min(0.3, Math.max(0, playerPitch - Math.atan(gradeAhead)));
      const lag = CHASE_BACK + 2.0 * pace + 4 * this.boostT + PULL_BACK * pull;
      const back = this._roadAt(pz - lag, playerLx);

      const cos = Math.cos(playerPitch);
      const sin = Math.sin(playerPitch);
      // DESIGN.md "Race flow": before 3-2-1 the camera swoops down from
      // above the grid and lands on the chase pose.
      const intro = state.stageState === 'warmup' ? Math.max(0, Math.min(1, (state.countdown - COUNTDOWN_TICKS) / INTRO_TICKS)) : 0;
      const e = intro * intro * (3 - 2 * intro);
      // A car close by draws the camera onto the hood, for concentration;
      // nitro and the start keep it in chase. It eases in over seconds, so a
      // car passing by draws it part way and only one kept alongside takes
      // it all the way.
      const hoodTarget = near * (1 - this.boostT) * (1 - e);
      this.hoodT += (hoodTarget - this.hoodT) * (hoodTarget > this.hoodT ? HOOD_IN : HOOD_OUT);
      // A replay frames the landmark from the chase, never the hood.
      if (cut) this.hoodT = 0;
      const hood = this.hoodT;

      // Chase: in the car's own pitched frame, so on any grade the car holds
      // its place in the view and the road reads as level beneath it. Behind
      // the car, as in racing games, it looks a little along the heading, so
      // a turn rotates the view rather than sliding the car across it.
      const rise = CREST_LIFT * crest;
      const up = CHASE_UP - 0.15 * pace - 0.5 * this.boostT + rise + PULL_UP * pull;
      const trail = pullSide * PULL_SWING * pull;
      const look = playerSwing * CAMERA_LOOK;
      const aim = CHASE_AIM + 4 * this.boostT + 4 * pull;
      const aimUp = 0.3 + 0.6 * this.boostT;
      const chaseEye = new B.Vector3(back.x - trail - 14 * e, py - lag * sin + up * cos + 30 * e, pz - lag * cos - up * sin - 18 * e);
      const chaseAt = new B.Vector3(ahead.x - trail * 0.5 + look + pullSide * 4.7 * pull, py + aim * sin + aimUp * cos - 0.6 * rise - 6 * e, pz + aim * cos - aimUp * sin - 8 * e);
      // A hero landmark turns the aim toward itself, keeping its distance, so
      // it stands in the frame beside the road while the camera pulls back.
      if (hero) {
        const toRoad = chaseAt.subtract(chaseEye);
        const reach = toRoad.length();
        const toHero = new B.Vector3(hero.x, hero.y + hero.height * HERO_AIM, hero.z).subtract(chaseEye).normalize();
        const turned = B.Vector3.Lerp(toRoad.normalize(), toHero, HERO_TURN * pull).normalize();
        chaseAt.copyFrom(chaseEye.add(turned.scale(reach)));
      }

      // Hood: low over the front deck, the hood's edge framing the bottom of
      // the view; fixed to the car, so on a grade it pitches with the hood.
      const vibe = Math.sin((state.tick || 0) * 0.8) * ((player.speed || 0) / 300) * 0.006;
      const hoodUp = HOOD_EYE.up + vibe;
      const hoodEye = new B.Vector3(px, py + hoodUp * cos + HOOD_EYE.ahead * sin, pz + HOOD_EYE.ahead * cos - hoodUp * sin);
      const hoodAt = new B.Vector3(ahead.x + look, hoodEye.y - 0.05 + Math.tan(playerPitch) * (pz + 24.0 - hoodEye.z), pz + 24.0);

      this.bCamera.position.copyFrom(B.Vector3.Lerp(chaseEye, hoodEye, hood));
      this.bCamera.setTarget(B.Vector3.Lerp(chaseAt, hoodAt, hood));
      this.lens = lerp(this.lens, lerp(speedFov(player.speed || 0, this.boostT) + PULL_LENS * pull, 0.92 + 0.1 * this.boostT, hood), 0.1);
      this.bCamera.fov = coverFov(this.lens, this.width / this.height);
      const shot = cut && this._replayShot(B, cut, state, a, new B.Vector3(px, py, pz));
      this.shotHeld = !!shot;
      if (shot) {
        this.bCamera.position.copyFrom(shot.eye);
        this.bCamera.setTarget(shot.at);
        this.bCamera.fov = coverFov(shot.lens, this.width / this.height);
      }
    }

    if (this.pipeline?.imageProcessing) {
      if (player && player.spinTimer > 0) {
        this.pipeline.imageProcessing.vignetteColor.copyFromFloats(0.8, 0.1, 0.1, 0);
        this.pipeline.imageProcessing.vignetteWeight = 1.8;
      } else if (playerBoosting) {
        this.pipeline.imageProcessing.vignetteColor.copyFromFloats(0.0, 0.1, 0.3, 0);
        this.pipeline.imageProcessing.vignetteWeight = 1.7;
        this.pipeline.imageProcessing.contrast = GRADE.contrast + 0.06;
      } else {
        this.pipeline.imageProcessing.vignetteColor.copyFromFloats(0, 0, 0, 0);
        this.pipeline.imageProcessing.vignetteWeight = 1.25;
        this.pipeline.imageProcessing.contrast = GRADE.contrast;
      }
    }

    // Update Civilian Traffic
    if (state.traffic) {
      const blinkOn = Math.floor((state.tick || 0) / 12) % 2 === 0;
      for (let i = 0; i < Math.max(this.bTrafficMeshes.length, state.traffic.length); i++) {
        let tMesh = this.bTrafficMeshes[i];
        const tData = state.traffic[i];
        if (tData) {
          if (tMesh?.type !== tData.type) {
            if (tMesh) this._setNodeEnabled(tMesh.root, false);
            tMesh = this.bTrafficMeshes[i] = this._trafficCar(B, i, tData.type);
          }
          this._setNodeEnabled(tMesh.root, true);
          const tz = (tData.z % state.trackLength) * S;
          const road = this._poseOnRoad(tz, tData.x, tMesh.axleFront, tMesh.axleRear);
          tMesh.root.position.set(road.x, road.y, tz);
          tMesh.root.rotation.x = -road.pitch;
          tMesh.root.rotation.y = road.yaw + (tData.blinker ?? 0) * 0.06;

          const lamp = this.trafficLamps;
          tMesh.matTail.emissiveColor = tData.brake ? lamp.brake : lamp.tail;
          tMesh.matBlinkerL.emissiveColor = tData.blinker === -1 && blinkOn ? lamp.blink : lamp.dark;
          tMesh.matBlinkerR.emissiveColor = tData.blinker === 1 && blinkOn ? lamp.blink : lamp.dark;
        } else {
          this._setNodeEnabled(tMesh.root, false);
        }
      }
    }

    this._poseMarshal(state);
    this._prewarmClouds(B);
    this._prewarmTraffic(B, state);
    this.transitionHaze = stageHaze(state, playerKz);
    this.scene.fogDensity = lerp(this.baseFogDensity, HAZE_DENSITY, this.transitionHaze);
    this._frameEffects(B, player, playerKx, playerKy, playerKz, playerLx);
    // Placements change level a few times a second, not every frame.
    if (this.lodFrame++ % 8 === 0) {
      this._updateLods(this.bCamera.position);
      this._showScatter(this.bCamera.position);
    }
    this._turnSails(this.windTime);
    this._trackSun(B);
    this.engine.beginFrame();
    this.scene.render();
    this.engine.endFrame();
  }
}
