// DESIGN.md "Ghibli gouache": the verges are green and flowered but low and
// sparse, so the signature props and the fields read over them: low bushes,
// grass mounds and flowers, densest by the road. Every stage but the city
// grows its own; the renderer draws each kind as thin instances.

import { createPrng } from './prng.js';
import { SHORE, STAGE_LOOKS } from './stage_look.js';

// Metres past the rumble edge: most of a verge's scatter banks up in the
// near band, the rest thins out across the mid band. Items grow in clusters
// of CLUSTER items within CLUSTER_RADIUS metres, as glued foam does.
export const NEAR_BAND = [0.3, 5];
export const MID_BAND = [5, 25];
const MID_SHARE = 0.25;
const CLUSTER = [3, 7];
const CLUSTER_RADIUS = 1.6;

// The size range of each kind, in metres across.
export const SCATTER_SIZE = {
  bush: [0.5, 1.1], tuft: [0.4, 0.8], flower: [0.2, 0.38], drift: [0.8, 1.5],
  stone: [0.3, 0.7], cactus: [1.6, 3.6], poppies: [0.55, 1.0],
};

// Per stage: each kind its verges grow, its colour, and items a metre a side.
const lush = (deep, light, flowers) => [
  { kind: 'bush', colour: deep, perMetre: 0.2 },
  { kind: 'tuft', colour: light, perMetre: 0.35 },
  ...flowers.map((colour) => ({ kind: 'flower', colour, perMetre: 0.55 / flowers.length })),
];
const dry = (sage, ochre, flower) => [
  { kind: 'bush', colour: sage, perMetre: 0.25 },
  { kind: 'tuft', colour: ochre, perMetre: 0.3 },
  { kind: 'flower', colour: flower, perMetre: 0.3 },
  { kind: 'stone', colour: '#B5653A', perMetre: 0.15 },
  { kind: 'cactus', colour: '#3E6B33', perMetre: 0.12 },
];

/** Per stage: each kind its verges carry, its colour, and items a metre a side. */
export const VERGE_SCATTER = {
  'coconut-beach': lush('#2F6B2E', '#6FA83A', ['#E2452B', '#F2A33A', '#F7E8D0']),
  // The concept's desert verge is dense low green scrub; its saguaros are the pack's.
  'desert-canyons': [
    { kind: 'bush', colour: '#5E7E3A', perMetre: 0.35 },
    { kind: 'bush', colour: '#7E9446', perMetre: 0.2 },
    { kind: 'tuft', colour: '#9AA050', perMetre: 0.25 },
    { kind: 'flower', colour: '#E8C23A', perMetre: 0.15 },
    { kind: 'stone', colour: '#A8553A', perMetre: 0.05 },
  ],
  'gateway-pass': lush('#2E5A2A', '#5E8F35', ['#9B6FC9', '#F2E8DA']),
  'alpine-peaks': [
    // The concept's snow lies in soft continuous banks along the verge.
    { kind: 'drift', colour: '#EEF3F7', perMetre: 0.85 },
    { kind: 'bush', colour: '#24472E', perMetre: 0.15 },
    { kind: 'tuft', colour: '#4E6E3A', perMetre: 0.2 },
  ],
  'wilderness-run': lush('#264F25', '#4F7F2E', ['#F2E8DA', '#E8C23A']),
  // The concept's road runs between dense painted poppies, orange heads up
  // to the asphalt, before the tulip rows.
  'tulip-gardens': [
    { kind: 'poppies', colour: '#E8581A', perMetre: 0.8 },
    { kind: 'poppies', colour: '#C8302A', perMetre: 0.2 },
    { kind: 'tuft', colour: '#6E8A52', perMetre: 0.25 },
  ],
  'sunset-highway': dry('#8FA448', '#CC9A48', '#E8A23A'),
  'ancient-ruins': lush('#3A6630', '#7A9A45', ['#E2452B', '#F2E8DA']),
  'metropolis-night': [],
  'coastal-cliffs': lush('#2E5A2E', '#5E8F3A', ['#F2E8DA', '#E8C23A', '#9B6FC9']),
  'destination-marina': lush('#2F6B2E', '#6FA83A', ['#E2452B', '#F7E8D0']),
  'destination-oasis': dry('#5E8A3A', '#A8B04A', '#E2452B'),
  'destination-castle': lush('#2E5A2A', '#5E8F35', ['#E25A8C', '#F2E8DA']),
  'destination-colosseum': lush('#4E6E30', '#8A9A45', ['#E2452B', '#E8C23A']),
  'destination-aerodrome': lush('#3A6A2E', '#6E9A3A', ['#F2E8DA', '#E8C23A']),
};

/**
 * A stage's verge scatter over `count` segments `segLen` metres long: each
 * item's palette entry `k`, kind, segment `i` and fraction `along` it, side,
 * offset past the rumble edge, size in metres and yaw. Dry land only on the
 * sea side, as for props.
 */
export function scatterVerge(stageId, count, segLen) {
  const look = STAGE_LOOKS[stageId];
  const seed = [...stageId].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) ^ 0x5ca7;
  const out = [];
  VERGE_SCATTER[stageId].forEach(({ kind, perMetre }, k) => {
    const rand = createPrng(seed + k * 104729);
    const [lo, hi] = SCATTER_SIZE[kind];
    const perCluster = (CLUSTER[0] + CLUSTER[1]) / 2;
    for (let i = 0; i < count - 1; i++) {
      for (const side of [-1, 1]) {
        const wet = look.water && (look.water.side === 'left') === (side < 0);
        const clusters = Math.floor(perMetre * segLen / perCluster + rand());
        for (let c = 0; c < clusters; c++) {
          const [a, b] = rand() < MID_SHARE ? MID_BAND : NEAR_BAND;
          const centre = a + rand() * (b - a);
          const at = rand();
          const n = CLUSTER[0] + Math.floor(rand() * (CLUSTER[1] - CLUSTER[0] + 1));
          for (let m = 0; m < n; m++) {
            const offset = Math.min(MID_BAND[1], Math.max(NEAR_BAND[0], centre + (rand() - 0.5) * 2 * CLUSTER_RADIUS));
            const along = Math.min(0.999, Math.max(0, at + (rand() - 0.5) * 2 * CLUSTER_RADIUS / segLen));
            const size = lo + rand() * (hi - lo);
            // A drift lies along the road; the rest turn any way.
            const yaw = kind === 'drift' ? (rand() - 0.5) * 0.4 : rand() * Math.PI * 2;
            if (wet && offset > SHORE - 4) continue;
            out.push({ k, kind, i, along, side, offset, size, yaw });
          }
        }
      }
    }
  });
  return out;
}
