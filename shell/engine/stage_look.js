// Per-stage atmosphere and roadside signature (DESIGN.md, "Each stage").
// Distances are world units: a lane is 3.5 wide, a segment 12 long.

import { createPrng } from './prng.js';

// The sea side's land runs this far past the rumble edge, then meets the water.
export const SHORE = 30;
// Metres of open water between the shore and the nearest boat.
export const BOAT_CLEARANCE = 10;

// Props that face along the road rather than at a random yaw.
const ORIENTED = new Set(['arch', 'powerPole', 'streetLamp', 'hangar', 'colosseum', 'lighthouse', 'tower', 'rockArch', 'seaArch',
  'chapelAlpine', 'chapelTuscan', 'clockTower', 'kasbah', 'aqueduct', 'spire']);

// How far a landform's base reaches from its centre at scale 1, in metres:
// it stands on the lowest ground under that reach, not at its centre's height.
export const PROP_FOOTPRINT = {
  mesa: 20, cliff: 16, colosseum: 90, hangar: 20, tower: 13, castleTower: 6, lighthouse: 4, rockArch: 30, seaArch: 6,
  chapelAlpine: 14, chapelTuscan: 14, clockTower: 14, kasbah: 14, aqueduct: 40, spire: 14, butte: 20, greatTree: 8, greatWindmill: 6,
};

// A solid prop's collision radius at scale 1, in world units; the car drives
// through anything not listed.
export const PROP_RADIUS = {
  palm: 0.5, cactus: 0.45, cypress: 0.7, pine: 1.0, broadleaf: 1.0, column: 0.7, brokenArch: 1.5,
  rock: 1.3, cliff: 18, mesa: 20, windmill: 2.2, powerPole: 0.35, streetLamp: 0.3, tower: 9,
  lighthouse: 2.5, castleTower: 8, runwayLight: 0.2, hangar: 12, colosseum: 75, turbine: 1.2,
  rockArch: 28, seaArch: 10, chapelAlpine: 14, chapelTuscan: 14, clockTower: 14, kasbah: 14, aqueduct: 6, spire: 14,
  butte: 20, greatTree: 3, greatWindmill: 4,
};

/** The segment a stage fraction `at` of `count` segments falls on. */
const atSegment = (at, count) => Math.max(2, Math.ceil(at * count));

/** The segment a stage's hero landmark stands at. */
export function heroSegment(stageId, count) {
  return atSegment(STAGE_LOOKS[stageId].props.find((spec) => spec.landmark).at, count);
}

/**
 * Every roadside placement of a stage, the one source the renderer draws and
 * the simulation collides with: the segment `i`, the side (-1 left, 1 right,
 * 0 over the road), the offset past the rumble edge, the scale and, for
 * unoriented kinds, the yaw.
 */
export function placeProps(stageId, count, forkStart) {
  const look = STAGE_LOOKS[stageId];
  const seed = [...stageId].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);
  const out = [];
  look.props.forEach((spec, k) => {
    const rand = createPrng(seed + k * 7919);
    const sides = spec.side === 'both' ? [-1, 1] : spec.side === 'left' ? [-1] : spec.side === 'right' ? [1] : [0];
    // A spec may hold to a zone of the stage, `zone: [from, to]` in
    // fractions of its length, so a stage runs through distinct scenes.
    // A stage's hero landmark stands once, `at` that fraction of its length.
    const [from, to] = spec.at !== undefined ? [spec.at, spec.at] : spec.zone ?? [0, 1];
    const once = spec.at !== undefined;
    for (let i = atSegment(from, count); once ? i === atSegment(from, count) : i < Math.min(count - 2, to * count); i += spec.every ?? 1) {
      if (spec.side === 'over' && i >= forkStart) break;
      for (const side of sides) {
        const wet = look.water && side !== 0 && (look.water.side === 'left') === (side < 0);
        // A boat floats: on the sea side, past the shore, or not at all.
        if (spec.kind === 'sailboat' && !wet) continue;
        const near = spec.kind === 'sailboat' ? Math.max(spec.near, SHORE + BOAT_CLEARANCE) : spec.near;
        const offset = near + rand() * (spec.far - near);
        const scale = spec.scale[0] + rand() * (spec.scale[1] - spec.scale[0]);
        const yaw = ORIENTED.has(spec.kind) ? null : rand() * Math.PI * 2;
        if (wet && spec.kind !== 'sailboat' && offset > SHORE - 4) continue;
        out.push({ kind: spec.kind, k, i, side, offset, scale, yaw, ...(spec.landmark ? { landmark: true } : {}) });
      }
    }
  });
  return out;
}

// A destination stage's `destination` is its ending's set piece (DESIGN.md
// "End of a run"): what stands where the road runs out past the final arch,
// each piece `beyond` metres past the arch and `across` metres off the road's
// line, the first the place the camera frames.
export const STAGE_LOOKS = {
  'coconut-beach': {
    sun: { color: '#FFF0C4', elevation: 0.05, azimuth: 0.1 },
    light: { ground: '#6B4A3A' },
    fog: { density: 0.0016 },
    ground: '#C9A57A',
    water: { side: 'left', color: '#1F5F80' },
    props: [
      // Palm avenue, open beach with sea views, the marina, the headland.
      { kind: 'palm', side: 'both', every: 1, near: 2, far: 6, scale: [1.0, 1.3], zone: [0, 0.3] },
      { kind: 'grassTuft', side: 'both', every: 1, near: 1, far: 30, scale: [0.8, 1.5], zone: [0, 0.55] },
      { kind: 'palm', side: 'both', every: 6, near: 6, far: 30, scale: [0.85, 1.3], zone: [0.3, 0.55] },
      { kind: 'shrub', side: 'both', every: 4, near: 6, far: 40, scale: [0.7, 1.4], zone: [0.3, 0.55] },
      { kind: 'sailboat', side: 'left', every: 7, near: 40, far: 160, scale: [0.8, 1.4], zone: [0.55, 0.8] },
      { kind: 'palm', side: 'right', every: 3, near: 3, far: 10, scale: [0.9, 1.2], zone: [0.55, 0.8] },
      // The hero landmark: the lighthouse on the marina's point.
      { kind: 'lighthouse', side: 'right', at: 0.7, near: 30, far: 30, scale: [1.5, 1.5], landmark: true },
      { kind: 'cliff', side: 'right', every: 3, near: 30, far: 60, scale: [0.8, 1.4], zone: [0.8, 1] },
      { kind: 'rock', side: 'both', every: 2, near: 4.5, far: 40, scale: [0.8, 2.4], zone: [0.8, 1] },
      { kind: 'grassTuft', side: 'both', every: 2, near: 1, far: 20, scale: [0.8, 1.3], zone: [0.8, 1] },
    ],
  },
  'desert-canyons': {
    sun: { color: '#FFF7DE', elevation: 0.45, azimuth: -0.5 },
    light: { ground: '#A0522D' },
    fog: { density: 0.0012 },
    ground: '#D9A066',
    water: null,
    props: [
      // Cactus plain, the canyon with mesas close by, the wide mesa valley.
      { kind: 'cactus', side: 'both', every: 1, near: 4, far: 30, scale: [0.8, 1.3], zone: [0, 1] },
      { kind: 'shrub', side: 'both', every: 3, near: 4, far: 50, scale: [0.4, 0.9], zone: [0, 0.3] },
      { kind: 'rock', side: 'both', every: 10, near: 6, far: 70, scale: [0.5, 1.1], zone: [0, 0.3] },
      { kind: 'mesa', side: 'both', every: 7, near: 38, far: 110, scale: [0.9, 1.3], zone: [0.3, 0.65] },
      { kind: 'rock', side: 'both', every: 4, near: 6, far: 50, scale: [0.5, 1.2], zone: [0.3, 0.65] },
      { kind: 'mesa', side: 'both', every: 9, near: 160, far: 380, scale: [1.2, 2.0], zone: [0.65, 1] },
      // The hero landmark: the great rock arch over the canyon's end.
      { kind: 'rockArch', side: 'right', at: 0.62, near: 90, far: 90, scale: [1.5, 1.5], landmark: true },
      { kind: 'rock', side: 'both', every: 8, near: 6, far: 70, scale: [0.5, 1.2], zone: [0.65, 1] },
    ],
  },
  'gateway-pass': {
    sun: { color: '#FFC6A4', elevation: 0.02, azimuth: 0.0 },
    light: { ground: '#2A2035' },
    fog: { density: 0.0018 },
    ground: '#4B3B55',
    water: null,
    props: [
      // Cypress avenue under the arches, open hills, the rocky pass.
      { kind: 'arch', side: 'over', every: 30, near: 2, far: 2, scale: [1, 1], zone: [0, 0.35] },
      { kind: 'cypress', side: 'both', every: 2, near: 5, far: 9, scale: [0.9, 1.3], zone: [0, 0.35] },
      { kind: 'grassTuft', side: 'both', every: 1, near: 1, far: 30, scale: [0.8, 1.4], zone: [0, 0.7] },
      { kind: 'cypress', side: 'both', every: 6, near: 8, far: 40, scale: [0.8, 1.3], zone: [0.35, 0.7] },
      { kind: 'rock', side: 'both', every: 4, near: 5, far: 60, scale: [0.6, 1.6], zone: [0.35, 0.7] },
      { kind: 'rock', side: 'both', every: 1, near: 4.9, far: 30, scale: [0.8, 2.6], zone: [0.7, 1] },
      { kind: 'cypress', side: 'both', every: 5, near: 7, far: 18, scale: [0.8, 1.1], zone: [0.7, 1] },
      // The hero landmark: a chapel and campanile on a knoll over the open hills.
      { kind: 'chapelTuscan', side: 'left', at: 0.52, near: 60, far: 60, scale: [1, 1], landmark: true },
    ],
  },
  'alpine-peaks': {
    sun: { color: '#FFFFFF', elevation: 0.6, azimuth: 0.7 },
    light: { ground: '#7A8AA0' },
    fog: { density: 0.0012 },
    ground: '#EEF3F8',
    water: null,
    props: [
      // Pine forest, the open snowfield under the peaks, the forest edge.
      { kind: 'pine', side: 'both', every: 2, near: 6, far: 30, scale: [0.6, 1.1], zone: [0, 0.4] },
      { kind: 'rock', side: 'both', every: 4, near: 4.5, far: 60, scale: [0.7, 2.0], zone: [0, 0.4] },
      { kind: 'rock', side: 'both', every: 1, near: 4.5, far: 50, scale: [0.8, 2.8], zone: [0.4, 0.7] },
      { kind: 'pine', side: 'both', every: 5, near: 10, far: 40, scale: [0.6, 1.0], zone: [0.4, 0.7] },
      { kind: 'pine', side: 'both', every: 3, near: 6, far: 24, scale: [0.6, 1.1], zone: [0.7, 1] },
      { kind: 'rock', side: 'both', every: 3, near: 4.5, far: 60, scale: [0.7, 2.6], zone: [0.7, 1] },
      // The hero landmark: the ridge chapel over the snowfield.
      { kind: 'chapelAlpine', side: 'right', at: 0.55, near: 60, far: 60, scale: [1.4, 1.4], landmark: true },
    ],
  },
  'wilderness-run': {
    sun: { color: '#E8EAD8', elevation: 0.4, azimuth: -0.2 },
    light: { ground: '#3B4A30' },
    fog: { density: 0.0032 },
    ground: '#3F6B35',
    water: null,
    props: [
      // Deep forest, the meadow, the forest again with ferns.
      { kind: 'broadleaf', side: 'both', every: 1, near: 3, far: 30, scale: [0.8, 1.4], zone: [0, 0.35] },
      { kind: 'shrub', side: 'both', every: 1, near: 2, far: 25, scale: [0.8, 1.6], zone: [0, 0.35] },
      { kind: 'grassTuft', side: 'both', every: 1, near: 1, far: 30, scale: [0.9, 1.6], zone: [0.35, 0.65] },
      { kind: 'broadleaf', side: 'both', every: 7, near: 12, far: 60, scale: [1.0, 1.6], zone: [0.35, 0.65] },
      { kind: 'shrub', side: 'both', every: 4, near: 4, far: 40, scale: [0.8, 1.4], zone: [0.35, 0.65] },
      { kind: 'broadleaf', side: 'both', every: 2, near: 4, far: 25, scale: [0.7, 1.3], zone: [0.65, 1] },
      { kind: 'shrub', side: 'both', every: 1, near: 2, far: 20, scale: [0.8, 1.6], zone: [0.65, 1] },
      { kind: 'grassTuft', side: 'both', every: 2, near: 1, far: 20, scale: [0.9, 1.4], zone: [0.65, 1] },
      // The hero landmark: the great tree alone in the meadow.
      { kind: 'greatTree', side: 'left', at: 0.5, near: 34, far: 34, scale: [1, 1], landmark: true },
    ],
  },
  'tulip-gardens': {
    sun: { color: '#FFFBE8', elevation: 0.3, azimuth: 0.3 },
    light: { ground: '#6A8F4A' },
    fog: { density: 0.0015 },
    ground: '#7FAE52',
    water: null,
    props: [
      // Open fields, the windmill row, fields with farm trees.
      { kind: 'grassTuft', side: 'both', every: 1, near: 1, far: 12, scale: [0.8, 1.3] },
      { kind: 'windmill', side: 'both', every: 18, near: 30, far: 60, scale: [1.2, 1.6], zone: [0, 0.35] },
      { kind: 'windmill', side: 'right', every: 4, near: 14, far: 16, scale: [1.3, 1.6], zone: [0.35, 0.65] },
      { kind: 'broadleaf', side: 'both', every: 5, near: 10, far: 40, scale: [0.9, 1.4], zone: [0.65, 1] },
      { kind: 'windmill', side: 'left', every: 20, near: 25, far: 50, scale: [1.2, 1.5], zone: [0.65, 1] },
      // The concept's polder: a power line along the road, slim turbines far off.
      { kind: 'powerPole', side: 'right', every: 5, near: 7, far: 7, scale: [1, 1] },
      { kind: 'turbine', side: 'both', every: 22, near: 150, far: 320, scale: [0.9, 1.2] },
      // The hero landmark: the great windmill across the field from the row.
      { kind: 'greatWindmill', side: 'left', at: 0.5, near: 40, far: 40, scale: [1, 1], landmark: true },
    ],
  },
  'sunset-highway': {
    sun: { color: '#FFD05C', elevation: 0.04, azimuth: 0.0 },
    light: { ground: '#2A1030' },
    fog: { density: 0.0014 },
    ground: '#3B1A3F',
    water: null,
    props: [
      // Desert scrub, the rock garden, the open plain; the poles run on.
      { kind: 'powerPole', side: 'right', every: 5, near: 6, far: 6, scale: [1, 1] },
      { kind: 'shrub', side: 'both', every: 2, near: 4, far: 60, scale: [0.5, 1.0], zone: [0, 0.4] },
      { kind: 'rock', side: 'both', every: 5, near: 3, far: 80, scale: [0.5, 1.4], zone: [0, 0.4] },
      { kind: 'rock', side: 'both', every: 1, near: 3.8, far: 40, scale: [0.8, 2.4], zone: [0.4, 0.7] },
      { kind: 'shrub', side: 'both', every: 6, near: 4, far: 60, scale: [0.5, 1.0], zone: [0.7, 1] },
      { kind: 'rock', side: 'both', every: 6, near: 6, far: 90, scale: [0.6, 1.8], zone: [0.7, 1] },
      // The hero landmark: a lone butte against the dusk.
      { kind: 'butte', side: 'left', at: 0.55, near: 110, far: 110, scale: [1, 1], landmark: true },
    ],
  },
  'ancient-ruins': {
    sun: { color: '#FFE0A0', elevation: 0.18, azimuth: -0.6 },
    light: { ground: '#6B4A2A' },
    fog: { density: 0.0017 },
    ground: '#C49A62',
    water: null,
    props: [
      // The colonnade, the field of broken arches, the grass hills.
      { kind: 'column', side: 'both', every: 1, near: 3, far: 4, scale: [0.9, 1.1], zone: [0, 0.3] },
      { kind: 'grassTuft', side: 'both', every: 1, near: 1, far: 25, scale: [0.8, 1.3] },
      { kind: 'brokenArch', side: 'both', every: 5, near: 12, far: 40, scale: [0.9, 1.3], zone: [0.3, 0.65] },
      { kind: 'column', side: 'both', every: 3, near: 6, far: 30, scale: [0.6, 1.1], zone: [0.3, 0.65] },
      { kind: 'rock', side: 'both', every: 2, near: 4.1, far: 50, scale: [0.6, 1.8], zone: [0.3, 0.65] },
      { kind: 'column', side: 'both', every: 9, near: 6, far: 40, scale: [0.7, 1.2], zone: [0.65, 1] },
      { kind: 'rock', side: 'both', every: 4, near: 4.5, far: 60, scale: [0.6, 2.0], zone: [0.65, 1] },
      // The hero landmark: the aqueduct striding along the grass hills.
      { kind: 'aqueduct', side: 'left', at: 0.72, near: 40, far: 40, scale: [1, 1], landmark: true },
    ],
  },
  'metropolis-night': {
    sun: { color: '#DFE6FF', elevation: 0.25, azimuth: 0.3 },
    light: { ground: '#10121C' },
    fog: { density: 0.0022 },
    ground: '#15161C',
    water: null,
    props: [
      // Downtown, the waterfront boulevard, downtown again.
      { kind: 'streetLamp', side: 'both', every: 4, near: 1, far: 1, scale: [1, 1] },
      { kind: 'tower', side: 'both', every: 2, near: 18, far: 60, scale: [0.8, 1.4], zone: [0, 0.35] },
      { kind: 'tower', side: 'right', every: 3, near: 40, far: 90, scale: [0.7, 1.2], zone: [0.35, 0.6] },
      { kind: 'tower', side: 'both', every: 2, near: 18, far: 50, scale: [0.9, 1.5], zone: [0.6, 1] },
      // The hero landmark: the spire over the waterfront, across the boulevard
      // from its towers.
      { kind: 'spire', side: 'left', at: 0.47, near: 70, far: 70, scale: [1, 1], landmark: true },
    ],
  },
  'coastal-cliffs': {
    sun: { color: '#F0F4F0', elevation: 0.35, azimuth: 0.5 },
    light: { ground: '#48574F' },
    fog: { density: 0.0024 },
    ground: '#5E6B4F',
    water: { side: 'right', color: '#2C6F7A' },
    props: [
      // Cliff road, the lighthouse headland, cliffs and boulders.
      { kind: 'cliff', side: 'left', every: 3, near: 34, far: 60, scale: [0.8, 1.6], zone: [0, 0.4] },
      { kind: 'grassTuft', side: 'both', every: 1, near: 1, far: 20, scale: [0.9, 1.5] },
      { kind: 'lighthouse', side: 'right', every: 200, near: 24, far: 24, scale: [1, 1], zone: [0.45, 0.6] },
      // The hero landmark: the rock arch on the headland, the cliffs' side, as
      // on the sea side the land falls away below the road and hid it.
      { kind: 'seaArch', side: 'left', at: 0.75, near: 24, far: 24, scale: [1.3, 1.3], landmark: true },
      { kind: 'rock', side: 'both', every: 3, near: 4.5, far: 40, scale: [0.8, 2.0], zone: [0.4, 0.6] },
      { kind: 'cliff', side: 'left', every: 2, near: 34, far: 50, scale: [1.0, 1.8], zone: [0.6, 1] },
      { kind: 'rock', side: 'both', every: 1, near: 4.9, far: 40, scale: [0.8, 2.6], zone: [0.6, 1] },
    ],
  },
  'destination-marina': {
    sun: { color: '#FFFFFF', elevation: 0.9, azimuth: 0.0 },
    light: { ground: '#5A7A8A' },
    fog: { density: 0.0010 },
    ground: '#E8DCC0',
    water: { side: 'left', color: '#1E78A8' },
    props: [
      { kind: 'sailboat', side: 'left', every: 3, near: 24, far: 160, scale: [0.8, 1.4] },
      { kind: 'palm', side: 'right', every: 4, near: 3, far: 10, scale: [0.9, 1.2] },
      // The hero landmark: the harbour clock tower.
      { kind: 'clockTower', side: 'right', at: 0.5, near: 30, far: 30, scale: [1, 1], landmark: true },
    ],
    destination: [{ kind: 'clockTower', scale: 1.1, beyond: 270, across: 0 }],
  },
  'destination-oasis': {
    sun: { color: '#FFD08A', elevation: 0.04, azimuth: -0.3 },
    light: { ground: '#5A3A2A' },
    fog: { density: 0.0016 },
    ground: '#D8A060',
    water: null,
    props: [
      { kind: 'dune', side: 'both', every: 5, near: 30, far: 160, scale: [0.8, 1.8] },
      { kind: 'pool', side: 'both', every: 25, near: 18, far: 30, scale: [0.9, 1.3] },
      { kind: 'palm', side: 'both', every: 5, near: 8, far: 30, scale: [0.8, 1.2] },
      { kind: 'rock', side: 'both', every: 4, near: 6, far: 60, scale: [0.5, 1.6] },
      // The hero landmark: the kasbah over the pools.
      { kind: 'kasbah', side: 'left', at: 0.5, near: 50, far: 50, scale: [1, 1], landmark: true },
    ],
    destination: [{ kind: 'kasbah', scale: 1.3, beyond: 245, across: 0 }],
  },
  'destination-castle': {
    sun: { color: '#E8D8FF', elevation: 0.03, azimuth: 0.4 },
    light: { ground: '#1A1828' },
    fog: { density: 0.0018 },
    ground: '#2F3A2F',
    water: null,
    props: [
      { kind: 'castleTower', side: 'both', every: 7, near: 18, far: 60, scale: [0.8, 1.5] },
      // The hero landmark: the keep, twice the towers' height.
      { kind: 'castleTower', side: 'left', at: 0.5, near: 45, far: 45, scale: [2.2, 2.2], landmark: true },
      { kind: 'cypress', side: 'both', every: 3, near: 3, far: 12, scale: [0.8, 1.1] },
      { kind: 'rock', side: 'both', every: 3, near: 4.5, far: 50, scale: [0.7, 2.0] },
      { kind: 'shrub', side: 'both', every: 2, near: 2, far: 30, scale: [0.8, 1.4] },
      { kind: 'grassTuft', side: 'both', every: 1, near: 1, far: 20, scale: [0.9, 1.4] },
    ],
    // The castle: its keep over the road's end between two gate towers.
    destination: [
      { kind: 'castleTower', scale: 1.5, beyond: 280, across: 0 },
      { kind: 'castleTower', scale: 0.9, beyond: 262, across: -26 },
      { kind: 'castleTower', scale: 0.9, beyond: 262, across: 26 },
    ],
  },
  'destination-colosseum': {
    sun: { color: '#FFF0C8', elevation: 0.25, azimuth: -0.3 },
    light: { ground: '#6A5038' },
    fog: { density: 0.0013 },
    ground: '#B8A078',
    water: null,
    props: [
      { kind: 'colosseum', side: 'right', at: 0.35, near: 100, far: 100, scale: [1, 1], landmark: true },
      { kind: 'column', side: 'left', every: 4, near: 3, far: 10, scale: [0.8, 1.1] },
      { kind: 'shrub', side: 'both', every: 3, near: 3, far: 30, scale: [0.6, 1.2] },
    ],
    destination: [{ kind: 'colosseum', scale: 1, beyond: 300, across: 0 }],
  },
  'destination-aerodrome': {
    sun: { color: '#FFD8B0', elevation: 0.05, azimuth: 0.8 },
    light: { ground: '#2A2A3A' },
    fog: { density: 0.0015 },
    ground: '#4A5040',
    water: null,
    props: [
      { kind: 'hangar', side: 'both', every: 18, near: 30, far: 60, scale: [0.9, 1.3] },
      // The hero landmark: the great airship hangar.
      { kind: 'hangar', side: 'right', at: 0.5, near: 70, far: 70, scale: [2.6, 2.6], landmark: true },
      { kind: 'runwayLight', side: 'both', every: 1, near: 1.5, far: 1.5, scale: [1, 1] },
      { kind: 'grassTuft', side: 'both', every: 1, near: 2, far: 40, scale: [0.9, 1.4] },
    ],
    destination: [{ kind: 'hangar', scale: 2.6, beyond: 270, across: 0 }],
  },
};

// Each builder returns template parts laid out around the origin with the
// ground at y = 0; the renderer instances them at every placement.
export const PROP_BUILDERS = {
  // DESIGN.md "Scenery": Palms.
  palm(B, scene, mat) {
    const parts = [];
    const RINGS = 10;
    const lean = (t) => 1.6 * t * t;
    for (let k = 0; k < RINGS; k++) {
      const t = (k + 0.5) / RINGS;
      const ring = B.MeshBuilder.CreateCylinder(`palm#trunk${k}`, {
        diameterTop: 0.72 - 0.34 * (t + 0.05), diameterBottom: 0.76 - 0.34 * t, height: 11 / RINGS + 0.06, tessellation: 7,
      }, scene);
      ring.position.set(lean(t), t * 11, 0);
      ring.rotation.z = -Math.atan(3.2 * t / 11);
      ring.material = mat(k % 2 ? '#6B4A32' : '#5A3D29');
      parts.push(ring);
    }
    const top = { x: lean(1), y: 11.1 };
    const blade = (name, length, droop, width, yaw, pitch, color, texture, glow = null) => {
      const left = [];
      const right = [];
      for (let j = 0; j <= 8; j++) {
        const s = j / 8;
        const reach = length * s;
        const y = (0.5 - droop * s) * reach * pitch;
        const w = width * (1 - s ** 1.5) * Math.min(1, s * 5) + 0.02;
        left.push(new B.Vector3(-w, y, reach));
        right.push(new B.Vector3(w, y, reach));
      }
      const m = B.MeshBuilder.CreateRibbon(name, { pathArray: [left, right], sideOrientation: B.Mesh.DOUBLESIDE }, scene);
      m.position.set(top.x, top.y, 0);
      m.rotation.y = yaw;
      m.material = mat(color, glow, texture);
      return m;
    };
    for (let f = 0; f < 14; f++) {
      const yaw = (f / 14) * Math.PI * 2 + (f % 2) * 0.12;
      const len = 5.2 + (f % 3) * 0.5;
      parts.push(blade(`palm#frond${f}`, len, 0.32 + (f % 4) * 0.05, 0.75, yaw, 0.55, '#FFFFFF', 'frond', '#1C3A14'));
    }
    for (let d = 0; d < 3; d++) {
      parts.push(blade(`palm#dry${d}`, 3.2, 1.1, 0.4, (d / 3) * Math.PI * 2 + 0.5, 1.4, '#8A6A3A', null));
    }
    for (let c = 0; c < 4; c++) {
      const a = (c / 4) * Math.PI * 2;
      const nut = B.MeshBuilder.CreateSphere(`palm#coconut${c}`, { diameter: 0.4, segments: 3 }, scene);
      nut.position.set(top.x + Math.sin(a) * 0.32, top.y - 0.35, Math.cos(a) * 0.32);
      nut.material = mat('#5B3A1E');
      parts.push(nut);
    }
    return parts;
  },
  rock(B, scene, mat) {
    const big = B.MeshBuilder.CreateSphere('rock#a', { diameter: 1.6, segments: 3 }, scene);
    big.position.set(0, 0.35, 0);
    big.scaling.set(1.3, 0.7, 1);
    big.rotation.y = 0.6;
    big.material = mat('#8A8078');
    const small = B.MeshBuilder.CreateSphere('rock#b', { diameter: 0.9, segments: 2 }, scene);
    small.position.set(0.95, 0.2, 0.4);
    small.scaling.set(1, 0.65, 1.2);
    small.material = mat('#6F665F');
    return [big, small];
  },
  shrub(B, scene, mat) {
    return [[0, 0.55, 0, 1.4, '#3E6B34'], [0.7, 0.4, 0.3, 1.0, '#4C7A3C'], [-0.6, 0.35, -0.2, 0.9, '#355E2D']].map(([x, y, z, d, c], k) => {
      const b = B.MeshBuilder.CreateSphere(`shrub#${k}`, { diameter: d, segments: 4 }, scene);
      b.position.set(x, y, z);
      b.scaling.set(1, 0.75, 1);
      b.material = mat(c);
      return b;
    });
  },
  grassTuft(B, scene, mat) {
    return [0, 1, 2, 3, 4].map((k) => {
      const a = (k / 5) * Math.PI * 2;
      const blade = B.MeshBuilder.CreateCylinder(`grassTuft#${k}`, { diameterTop: 0, diameterBottom: 0.12, height: 0.9 + (k % 2) * 0.3, tessellation: 3 }, scene);
      blade.position.set(Math.sin(a) * 0.15, 0.45, Math.cos(a) * 0.15);
      blade.rotation.set(Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35);
      blade.material = mat(k % 2 ? '#7C8F3E' : '#94A04A', null, 'sway');
      return blade;
    });
  },
  cactus(B, scene, mat) {
    const m = mat('#4F7A3A');
    const stem = B.MeshBuilder.CreateCylinder('cactus#stem', { diameter: 0.8, height: 5, tessellation: 8 }, scene);
    stem.position.set(0, 2.5, 0);
    const armL = B.MeshBuilder.CreateCylinder('cactus#armL', { diameter: 0.5, height: 1.8, tessellation: 8 }, scene);
    armL.position.set(-0.75, 3.2, 0);
    const armR = B.MeshBuilder.CreateCylinder('cactus#armR', { diameter: 0.5, height: 1.4, tessellation: 8 }, scene);
    armR.position.set(0.75, 2.6, 0);
    const parts = [stem, armL, armR];
    for (const p of parts) p.material = m;
    return parts;
  },
  mesa(B, scene, mat) {
    const body = B.MeshBuilder.CreateCylinder('mesa#body', { diameterTop: 34, diameterBottom: 44, height: 28, tessellation: 7 }, scene);
    body.position.set(0, 14, 0);
    body.material = mat('#B5532F');
    const cap = B.MeshBuilder.CreateCylinder('mesa#cap', { diameterTop: 30, diameterBottom: 35, height: 4, tessellation: 7 }, scene);
    cap.position.set(0, 30, 0);
    cap.material = mat('#C96A3C');
    return [body, cap];
  },
  // A painted stone gateway, warm limestone under a rounded arch of
  // voussoirs (a purple slab of boxes read as a cartoon block).
  arch(B, scene, mat) {
    const stone = mat('#C4BEA8');
    const shade = mat('#9E9884');
    const parts = [];
    for (const x of [-11.5, 11.5]) {
      const pillar = B.MeshBuilder.CreateBox('arch#pillar', { width: 3, height: 16, depth: 4 }, scene);
      pillar.position.set(x, 8, 0);
      pillar.material = stone;
      const plinth = B.MeshBuilder.CreateBox('arch#plinth', { width: 4, height: 1.6, depth: 5 }, scene);
      plinth.position.set(x, 0.8, 0);
      plinth.material = shade;
      parts.push(pillar, plinth);
    }
    for (let k = 0; k <= 8; k++) {
      const a = (Math.PI * k) / 8;
      const stoneK = B.MeshBuilder.CreateBox('arch#voussoir', { width: 3.2, height: 4.2, depth: 4.2 }, scene);
      stoneK.position.set(Math.cos(a) * 11.5, 16 + Math.sin(a) * 6, 0);
      stoneK.rotation.z = a - Math.PI / 2;
      stoneK.material = k === 4 ? shade : stone;
      parts.push(stoneK);
    }
    return parts;
  },
  // A slim modern wind turbine: a tapered white tower, a nacelle and three
  // long blades facing the road.
  turbine(B, scene, mat) {
    const white = mat('#E8E6DE');
    const tower = B.MeshBuilder.CreateCylinder('turbine#tower', { diameterTop: 0.8, diameterBottom: 1.8, height: 42, tessellation: 10 }, scene);
    tower.position.set(0, 21, 0);
    const nacelle = B.MeshBuilder.CreateBox('turbine#nacelle', { width: 1.6, height: 1.6, depth: 4 }, scene);
    nacelle.position.set(0, 42.5, 0.5);
    const parts = [tower, nacelle];
    for (let k = 0; k < 3; k++) {
      const a = (k * 2 * Math.PI) / 3 + 0.3;
      const blade = B.MeshBuilder.CreateBox('turbine#blade', { width: 0.9, height: 19, depth: 0.3 }, scene);
      blade.position.set(Math.sin(a) * 9.5, 42.5 + Math.cos(a) * 9.5, -1.6);
      blade.rotation.z = -a;
      parts.push(blade);
    }
    for (const p of parts) p.material = white;
    return parts;
  },
  cypress(B, scene, mat) {
    const crown = B.MeshBuilder.CreateCylinder('cypress#crown', { diameterTop: 0, diameterBottom: 2.4, height: 11, tessellation: 7 }, scene);
    crown.position.set(0, 6, 0);
    crown.material = mat('#24402A');
    return [crown];
  },
  pine(B, scene, mat) {
    const trunk = B.MeshBuilder.CreateCylinder('pine#trunk', { diameter: 0.4, height: 2, tessellation: 5 }, scene);
    trunk.position.set(0, 1, 0);
    trunk.material = mat('#4A3426');
    const crown = B.MeshBuilder.CreateCylinder('pine#crown', { diameterTop: 0, diameterBottom: 3.6, height: 8, tessellation: 7 }, scene);
    crown.position.set(0, 5.5, 0);
    crown.material = mat('#1F4A32');
    return [trunk, crown];
  },
  broadleaf(B, scene, mat) {
    const trunk = B.MeshBuilder.CreateCylinder('broadleaf#trunk', { diameter: 0.6, height: 4, tessellation: 6 }, scene);
    trunk.position.set(0, 2, 0);
    trunk.material = mat('#4A3A2A');
    const crown = B.MeshBuilder.CreateSphere('broadleaf#crown', { diameter: 7, segments: 4 }, scene);
    crown.position.set(0, 6.5, 0);
    crown.scaling.set(1, 0.8, 1);
    crown.material = mat('#3D6B2F');
    return [trunk, crown];
  },
  windmill(B, scene, mat) {
    const tower = B.MeshBuilder.CreateCylinder('windmill#tower', { diameterTop: 3, diameterBottom: 5, height: 13, tessellation: 8 }, scene);
    tower.position.set(0, 6.5, 0);
    tower.material = mat('#8A5A3C');
    const cap = B.MeshBuilder.CreateCylinder('windmill#cap', { diameterTop: 0, diameterBottom: 4, height: 3, tessellation: 8 }, scene);
    cap.position.set(0, 14.5, 0);
    cap.material = mat('#5A3A2A');
    const parts = [tower, cap];
    for (let i = 0; i < 4; i++) {
      const blade = B.MeshBuilder.CreateBox(`windmill#blade${i}`, { width: 1.4, height: 7, depth: 0.15 }, scene);
      const a = (i / 4) * Math.PI * 2 + 0.4;
      blade.position.set(Math.sin(a) * 3.5, 13 + Math.cos(a) * 3.5, -2.6);
      blade.rotation.z = -a;
      blade.material = mat('#F2EDE4');
      parts.push(blade);
    }
    return parts;
  },
  powerPole(B, scene, mat) {
    const m = mat('#1A0E22');
    const pole = B.MeshBuilder.CreateCylinder('powerPole#pole', { diameter: 0.4, height: 14, tessellation: 5 }, scene);
    pole.position.set(0, 7, 0);
    const bar = B.MeshBuilder.CreateBox('powerPole#bar', { width: 4, height: 0.3, depth: 0.3 }, scene);
    bar.position.set(0, 13, 0);
    pole.material = m;
    bar.material = m;
    return [pole, bar];
  },
  column(B, scene, mat) {
    const m = mat('#D8C39A');
    const shaft = B.MeshBuilder.CreateCylinder('column#shaft', { diameter: 1.4, height: 9, tessellation: 10 }, scene);
    shaft.position.set(0, 4.5, 0);
    const capital = B.MeshBuilder.CreateBox('column#capital', { width: 2.2, height: 0.7, depth: 2.2 }, scene);
    capital.position.set(0, 9.35, 0);
    const base = B.MeshBuilder.CreateBox('column#base', { width: 2.2, height: 0.6, depth: 2.2 }, scene);
    base.position.set(0, 0.3, 0);
    const parts = [shaft, capital, base];
    for (const p of parts) p.material = m;
    return parts;
  },
  brokenArch(B, scene, mat) {
    const m = mat('#C8B088');
    const left = B.MeshBuilder.CreateBox('brokenArch#left', { width: 2.5, height: 12, depth: 2.5 }, scene);
    left.position.set(-5, 6, 0);
    const right = B.MeshBuilder.CreateBox('brokenArch#right', { width: 2.5, height: 7, depth: 2.5 }, scene);
    right.position.set(5, 3.5, 0);
    const lintel = B.MeshBuilder.CreateBox('brokenArch#lintel', { width: 7, height: 2, depth: 2.6 }, scene);
    lintel.position.set(-2.4, 12.5, 0);
    lintel.rotation.z = -0.08;
    const parts = [left, right, lintel];
    for (const p of parts) p.material = m;
    return parts;
  },
  tower(B, scene, mat) {
    const body = B.MeshBuilder.CreateBox('tower#body', { width: 12, height: 60, depth: 12 }, scene);
    body.position.set(0, 30, 0);
    body.material = mat('#11131C', '#000000', 'windows');
    const crown = B.MeshBuilder.CreateBox('tower#crown', { width: 12.4, height: 0.6, depth: 12.4 }, scene);
    crown.position.set(0, 60.3, 0);
    crown.material = mat('#FF3D7F', '#FF3D7F');
    crown.__glowColor = new B.Color3(1.0, 0.24, 0.5);
    return [body, crown];
  },
  streetLamp(B, scene, mat) {
    const m = mat('#2A2D36');
    const pole = B.MeshBuilder.CreateCylinder('streetLamp#pole', { diameter: 0.25, height: 8, tessellation: 5 }, scene);
    pole.position.set(0, 4, 0);
    pole.material = m;
    const arm = B.MeshBuilder.CreateBox('streetLamp#arm', { width: 2.4, height: 0.18, depth: 0.18 }, scene);
    arm.position.set(-1.1, 8, 0);
    arm.material = m;
    const lamp = B.MeshBuilder.CreateBox('streetLamp#lamp', { width: 0.9, height: 0.25, depth: 0.5 }, scene);
    lamp.position.set(-2.1, 7.85, 0);
    lamp.material = mat('#FFB347', '#FFB347');
    lamp.__glowColor = new B.Color3(1.0, 0.7, 0.28);
    return [pole, arm, lamp];
  },
  cliff(B, scene, mat) {
    const rock = B.MeshBuilder.CreateBox('cliff#rock', { width: 22, height: 40, depth: 30 }, scene);
    rock.position.set(0, 20, 0);
    rock.rotation.y = 0.35;
    rock.material = mat('#6D6A5E');
    const ledge = B.MeshBuilder.CreateBox('cliff#ledge', { width: 18, height: 4, depth: 26 }, scene);
    ledge.position.set(-3, 41, 0);
    ledge.rotation.y = 0.1;
    ledge.material = mat('#4F6B3F');
    return [rock, ledge];
  },
  lighthouse(B, scene, mat) {
    const tower = B.MeshBuilder.CreateCylinder('lighthouse#tower', { diameterTop: 3, diameterBottom: 5, height: 24, tessellation: 12 }, scene);
    tower.position.set(0, 12, 0);
    tower.material = mat('#F4F1EA');
    const band = B.MeshBuilder.CreateCylinder('lighthouse#band', { diameterTop: 3.6, diameterBottom: 4.1, height: 3.5, tessellation: 12 }, scene);
    band.position.set(0, 15, 0);
    band.material = mat('#C62828');
    const lamp = B.MeshBuilder.CreateCylinder('lighthouse#lamp', { diameter: 2.6, height: 2.2, tessellation: 12 }, scene);
    lamp.position.set(0, 25.1, 0);
    lamp.material = mat('#FFF3B0', '#FFE27A');
    lamp.__glowColor = new B.Color3(1.0, 0.9, 0.5);
    return [tower, band, lamp];
  },
  sailboat(B, scene, mat) {
    const hull = B.MeshBuilder.CreateBox('sailboat#hull', { width: 2.4, height: 1.2, depth: 8 }, scene);
    hull.position.set(0, 0.2, 0);
    hull.material = mat('#F4F6F8');
    const mast = B.MeshBuilder.CreateCylinder('sailboat#mast', { diameter: 0.2, height: 12, tessellation: 5 }, scene);
    mast.position.set(0, 6.5, 0.5);
    mast.material = mat('#B0B4BA');
    const sail = B.MeshBuilder.CreateCylinder('sailboat#sail', { diameterTop: 0, diameterBottom: 5, height: 10, tessellation: 3 }, scene);
    sail.position.set(0, 6.5, -1.2);
    sail.scaling.set(0.12, 1, 1);
    sail.material = mat('#FFFFFF');
    return [hull, mast, sail];
  },
  dune(B, scene, mat) {
    const dune = B.MeshBuilder.CreateSphere('dune#body', { diameter: 40, segments: 6 }, scene);
    dune.position.set(0, -6, 0);
    dune.scaling.set(1.6, 0.45, 1);
    dune.material = mat('#E0AE6E');
    return [dune];
  },
  pool(B, scene, mat) {
    const water = B.MeshBuilder.CreateCylinder('pool#water', { diameter: 22, height: 0.2, tessellation: 18 }, scene);
    water.position.set(0, 0.08, 0);
    water.scaling.set(1, 1, 1.5);
    water.material = mat('#2F9FB0');
    return [water];
  },
  castleTower(B, scene, mat) {
    const keep = B.MeshBuilder.CreateCylinder('castleTower#keep', { diameter: 9, height: 32, tessellation: 10 }, scene);
    keep.position.set(0, 16, 0);
    keep.material = mat('#7E8096');
    const roof = B.MeshBuilder.CreateCylinder('castleTower#roof', { diameterTop: 0, diameterBottom: 11, height: 12, tessellation: 10 }, scene);
    roof.position.set(0, 38, 0);
    roof.material = mat('#3E2F66');
    const pane = B.MeshBuilder.CreateBox('castleTower#window', { width: 1.2, height: 2, depth: 0.4 }, scene);
    pane.position.set(0, 24, -4.5);
    pane.material = mat('#FFC870', '#FFB040');
    pane.__glowColor = new B.Color3(1.0, 0.7, 0.3);
    return [keep, roof, pane];
  },
  colosseum(B, scene, mat) {
    const m = mat('#D9B98A');
    const parts = [];
    for (const [y, h] of [[0.75, 1.5], [11.5, 1.5], [22.5, 1.8]]) {
      const band = B.MeshBuilder.CreateCylinder(`colosseum#band${y}`, { diameter: 120, height: h, tessellation: 48, arc: 0.35 }, scene);
      band.position.set(0, y, 0);
      band.material = m;
      parts.push(band);
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 * 0.35;
      for (const [y, h] of [[6, 10], [17, 10]]) {
        const pier = B.MeshBuilder.CreateBox(`colosseum#pier${i}_${y}`, { width: 2.2, height: h, depth: 2.2 }, scene);
        pier.position.set(Math.cos(a) * 60, y, Math.sin(a) * 60);
        pier.rotation.y = -a;
        pier.material = m;
        parts.push(pier);
      }
    }
    return parts;
  },
  hangar(B, scene, mat) {
    const shell = B.MeshBuilder.CreateCylinder('hangar#shell', { diameter: 26, height: 34, tessellation: 18, arc: 0.5 }, scene);
    shell.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    shell.position.set(0, 0, 0);
    shell.material = mat('#8A8F98');
    const door = B.MeshBuilder.CreateBox('hangar#door', { width: 0.4, height: 9, depth: 18 }, scene);
    door.position.set(-17, 4.5, 0);
    door.material = mat('#FFC27A', '#7A4A20');
    return [shell, door];
  },
  runwayLight(B, scene, mat) {
    const lamp = B.MeshBuilder.CreateBox('runwayLight#lamp', { width: 0.35, height: 0.3, depth: 0.35 }, scene);
    lamp.position.set(0, 0.15, 0);
    lamp.material = mat('#FFD27A', '#FFC04D');
    lamp.__glowColor = new B.Color3(1.0, 0.78, 0.3);
    return [lamp];
  },
};

