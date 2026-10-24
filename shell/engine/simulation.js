// Apex OutRun 60Hz Kinetic Engine
// Branching highway route tree, checkpoint countdown, civilian traffic,
// centrifugal curve physics, and 2-speed simcade transmission.

import { prngStep, createPrng } from './prng.js';
import { PROP_RADIUS, heroSegment, placeProps } from './stage_look.js';

// Solid roadside props by segment, per stage: what the car can hit.
const solidCache = new Map();
function solidProps(stage) {
  let bySegment = solidCache.get(stage.id);
  if (!bySegment) {
    bySegment = new Map();
    const fork = stage.fork ? stage.fork.forkSegment : stage.segmentCount;
    for (const p of placeProps(stage.id, stage.segmentCount, fork)) {
      if (!(p.kind in PROP_RADIUS) || p.side === 0) continue;
      if (!bySegment.has(p.i)) bySegment.set(p.i, []);
      bySegment.get(p.i).push(p);
    }
    solidCache.set(stage.id, bySegment);
  }
  return bySegment;
}
// The car's half-width and half-length, in world units.
const CAR_HALF_WIDTH = 0.9;
const CAR_HALF_LENGTH = 1.9;

// A stage at top speed spans about a minute of the 75s + 45s-per-checkpoint clock.
export const KMH_TO_UNITS_PER_TICK = 0.08;

// One sim unit along the road is 6 cm: 295 km/h reads as ~82 m/s.
export const METRES_PER_UNIT = 0.06;
// World units across the road per unit of kart x: the rumble edge is at |x| = 1.
export const LATERAL_UNITS = 8;
// The wheel's full lock (the stick's scale) and how far it turns toward the
// stick per tick, and back to centre once let go.
export const STEER_FULL = 0.6;
const STEER_RAMP = 0.06;
const STEER_RETURN = 0.1;
// The bicycle model: wheelbase in metres; the wheel's reach in radians at a
// standstill, halved by WHEEL_SPEED_REF m/s; how fast, per second, the
// heading self-aligns to the road.
const WHEELBASE = 2.4;
const WHEEL_REACH = 0.08;
const WHEEL_SPEED_REF = 20;
const SELF_ALIGN = 4;

/** The wheel's reach in radians at this speed in km/h: less as speed builds. */
export function maxWheel(kmh) {
  return WHEEL_REACH / (1 + kmh / 3.6 / WHEEL_SPEED_REF);
}

// The body on its springs (DESIGN.md "Hero car"), sized as a road car's:
// radians of pitch per m/s² of acceleration (nose up pulling away, down
// braking) and of roll per m/s² of sideways acceleration (out of the move),
// about 2.5–3° per g, and the most either asks for, about a degree; each
// spring's natural frequency in rad/s (about 1.4 Hz) and damping ratio, a
// sports car's dampers, which settle a move with one small overshoot; and
// the stretch nitro's kick gives the body, per second.
const BODY_PITCH = 0.0008;
const BODY_ROLL = 0.0022;
const BODY_LEAN_MAX = 0.02;
const BODY_OMEGA = 9;
const BODY_DAMPING = 0.7;
const STRETCH_OMEGA = 14;
const STRETCH_DAMPING = 0.3;
const STRETCH_KICK = 1.2;

export function restBody() {
  return { pitch: 0, pitchV: 0, roll: 0, rollV: 0, stretch: 0, stretchV: 0 };
}

/** One step of a damped spring toward `target`, semi-implicit, at 60 Hz. */
function spring(x, v, target, omega, damping) {
  const nv = v + (omega * omega * (target - x) - 2 * damping * omega * v) / 60;
  return [x + nv / 60, nv];
}

/** The body after one tick, from the kart before it and after it. */
function springBody(prev, kart) {
  const clamp = (t) => Math.max(-BODY_LEAN_MAX, Math.min(BODY_LEAN_MAX, t));
  const b = { ...prev.body };
  const accel = (kart.speed - prev.speed) / 3.6 * 60;
  const lateral = kart.speed / 3.6 * ((kart.heading || 0) - (prev.heading || 0)) * 60;
  const rollTarget = kart.drift ? kart.driftDir * 0.25 : clamp(BODY_ROLL * lateral);
  [b.pitch, b.pitchV] = spring(b.pitch, b.pitchV, clamp(BODY_PITCH * accel), BODY_OMEGA, BODY_DAMPING);
  [b.roll, b.rollV] = spring(b.roll, b.rollV, rollTarget, BODY_OMEGA, BODY_DAMPING);
  if (kart.isNitro && !prev.isNitro) b.stretchV += STRETCH_KICK;
  [b.stretch, b.stretchV] = spring(b.stretch, b.stretchV, 0, STRETCH_OMEGA, STRETCH_DAMPING);
  return b;
}

export const CLOCK_START_S = 75;
export const CHECKPOINT_S = 45;
// DESIGN.md "Race flow": the camera swoop before 3-2-1, the checkpoint arch's
// lead on the road's end, the autopilot's speed through it, and how long the
// car drives itself into the next stage unless Enter takes the wheel back.
export const INTRO_TICKS = 120;
export const ARCH_LEAD = 1800;
export const CRUISE_KMH = 180;
export const DEPART_TICKS = 120;
// The 3-2-1 after the swoop, and the ticks the marshal's flag takes to sweep down after GO.
export const COUNTDOWN_TICKS = 180;
export const GO_TICKS = 60;
// After the goal or time over, the moment the scene holds before the results.
export const END_HOLD_TICKS = 150;
const END_HOLD_MS = END_HOLD_TICKS * 1000 / 60;
// DESIGN.md "End of a run": past the final arch the car drives itself into
// its ending's destination, cruising, then braking to a stop this many metres
// on, before the landmark; the whole set piece lasts ARRIVAL_TICKS.
export const ARRIVAL_METRES = 150;
const ARRIVAL_KMH = 140;
const ARRIVAL_BRAKE = 10;
export const ARRIVAL_TICKS = 480;
// Metres before a stage's hero landmark the run's replay window opens.
export const LANDMARK_LEAD_METRES = 360;
export const FINAL_STAGE = 5;
const NITRO_KMH = 40;
// km/h per tick a car above its cap sheds, so a burst's end eases off.
const OVER_CAP_SHED = 0.5;
// km/h per tick the grass takes off a car above its 45 km/h.
const OFF_ROAD_SHED = 4;
// A press fires one burst of this many ticks and this much of the tank:
// three charges from full, refilling between bursts.
export const NITRO_TICKS = 150;
// DESIGN.md "Ghibli gouache": ticks the passenger waves for at a moment that
// earns it, and the events that are such moments (nitro's kick is the other).
export const WAVE_TICKS = 75;
const WAVE_EVENTS = new Set(['race-start', 'close-pass', 'rival-beaten', 'checkpoint-extended', 'arrived']);
export const NITRO_SHOT = 100 / 3;
const TURBO_KMH = 30;
const TRAFFIC_COUNT = 18;

// Each stage's rival starts ~90 m ahead and paces below the player's top speed.
const RIVAL_LEAD = 1500;
const RIVAL_TOP_SPEED = 255;
const RIVALS = ['kart-wilber', 'kart-gnu', 'kart-suzanne'];

/**
 * @template T
 * @param {T} state
 * @returns {T}
 */
function placeRival(state) {
  const player = state.karts.find((k) => k.isPlayer);
  const kartId = RIVALS[(state.stageNum - 1) % RIVALS.length];
  const rival = state.karts.find((k) => k.id === kartId);
  rival.z = player.z + RIVAL_LEAD;
  rival.x = 0.22;
  state.rival = { kartId, beaten: false, escaped: false };
  return state;
}

export const CLOSE_PASS_POINTS = 50;
// How long a close pass's banner pops, rises and fades.
export const CLOSE_PASS_BANNER_TICKS = 48;
export const RIVAL_POINTS = 1000;

// The run's score, line by line; the state's score is always their sum.
export function scoreBreakdown(state) {
  return [
    { key: 'distance', points: Math.round(state.metresDriven * 10) },
    { key: 'closePasses', points: state.closePassCount * CLOSE_PASS_POINTS },
    { key: 'rivals', points: state.rivalsBeaten * RIVAL_POINTS },
    { key: 'timeBonus', points: state.timeBonus },
  ];
}

// scoreBreakdown summed without its allocations, for the per-tick path.
const totalScore = (state) =>
  Math.round(state.metresDriven * 10) + state.closePassCount * CLOSE_PASS_POINTS +
  state.rivalsBeaten * RIVAL_POINTS + state.timeBonus;

export const OUTRUN_STAGES = {
  'coconut-beach': {
    id: 'coconut-beach',
    name: 'Coconut Beach',
    stageNum: 1,
    segmentCount: 380,
    segmentLength: 200,
    curves: [
      { start: 30, length: 50, curve: 1.5, pitch: 0 },
      { start: 100, length: 60, curve: -2.0, pitch: 12 },
      { start: 180, length: 50, curve: 2.5, pitch: -10 },
      { start: 250, length: 60, curve: -1.8, pitch: 8 },
    ],
    fork: {
      forkSegment: 320,
      leftBranch: 'desert-canyons',
      rightBranch: 'gateway-pass',
      leftLabel: 'DESERT CANYONS',
      rightLabel: 'GATEWAY PASS',
    },
  },
  'desert-canyons': {
    id: 'desert-canyons',
    name: 'Desert Canyons',
    stageNum: 2,
    segmentCount: 380,
    segmentLength: 200,
    curves: [
      { start: 30, length: 45, curve: -3.0, pitch: 15 },
      { start: 95, length: 55, curve: 3.5, pitch: -15 },
      { start: 170, length: 60, curve: -2.8, pitch: 10 },
      { start: 250, length: 50, curve: 3.0, pitch: -5 },
    ],
    fork: {
      forkSegment: 320,
      leftBranch: 'alpine-peaks',
      rightBranch: 'wilderness-run',
      leftLabel: 'ALPINE PEAKS',
      rightLabel: 'WILDERNESS RUN',
    },
  },
  'gateway-pass': {
    id: 'gateway-pass',
    name: 'Gateway Pass',
    stageNum: 2,
    segmentCount: 380,
    segmentLength: 200,
    curves: [
      { start: 40, length: 50, curve: 2.2, pitch: 20 },
      { start: 110, length: 60, curve: -3.2, pitch: -18 },
      { start: 190, length: 50, curve: 2.8, pitch: 12 },
    ],
    fork: {
      forkSegment: 320,
      leftBranch: 'wilderness-run',
      rightBranch: 'tulip-gardens',
      leftLabel: 'WILDERNESS RUN',
      rightLabel: 'TULIP GARDENS',
    },
  },
  'alpine-peaks': {
    id: 'alpine-peaks',
    name: 'Alpine Peaks',
    stageNum: 3,
    segmentCount: 380,
    segmentLength: 200,
    curves: [
      { start: 30, length: 60, curve: -3.5, pitch: 25 },
      { start: 110, length: 60, curve: 4.0, pitch: -22 },
      { start: 190, length: 65, curve: -3.0, pitch: 15 },
    ],
    fork: {
      forkSegment: 320,
      leftBranch: 'sunset-highway',
      rightBranch: 'ancient-ruins',
      leftLabel: 'SUNSET HIGHWAY',
      rightLabel: 'ANCIENT RUINS',
    },
  },
  'wilderness-run': {
    id: 'wilderness-run',
    name: 'Wilderness Run',
    stageNum: 3,
    segmentCount: 380,
    segmentLength: 200,
    curves: [
      { start: 35, length: 55, curve: 2.6, pitch: 10 },
      { start: 105, length: 55, curve: -3.0, pitch: -10 },
      { start: 185, length: 60, curve: 3.2, pitch: 14 },
    ],
    fork: {
      forkSegment: 320,
      leftBranch: 'ancient-ruins',
      rightBranch: 'metropolis-night',
      leftLabel: 'ANCIENT RUINS',
      rightLabel: 'METROPOLIS NIGHT',
    },
  },
  'tulip-gardens': {
    id: 'tulip-gardens',
    name: 'Tulip Gardens',
    stageNum: 3,
    segmentCount: 380,
    segmentLength: 200,
    curves: [
      { start: 40, length: 50, curve: -2.4, pitch: 0 },
      { start: 110, length: 60, curve: 2.8, pitch: 10 },
      { start: 190, length: 55, curve: -2.5, pitch: -8 },
    ],
    fork: {
      forkSegment: 320,
      leftBranch: 'metropolis-night',
      rightBranch: 'coastal-cliffs',
      leftLabel: 'METROPOLIS NIGHT',
      rightLabel: 'COASTAL CLIFFS',
    },
  },
  'sunset-highway': {
    id: 'sunset-highway',
    name: 'Sunset Highway',
    stageNum: 4,
    segmentCount: 380,
    segmentLength: 200,
    curves: [
      { start: 40, length: 60, curve: 3.0, pitch: 0 },
      { start: 120, length: 60, curve: -3.0, pitch: 10 },
      { start: 200, length: 60, curve: 2.5, pitch: -10 },
    ],
    fork: {
      forkSegment: 320,
      leftBranch: 'destination-marina',
      rightBranch: 'destination-oasis',
      leftLabel: 'MARINA BAY [A]',
      rightLabel: 'DESERT OASIS [B]',
    },
  },
  'ancient-ruins': {
    id: 'ancient-ruins',
    name: 'Ancient Ruins',
    stageNum: 4,
    segmentCount: 380,
    segmentLength: 200,
    curves: [
      { start: 30, length: 50, curve: -2.8, pitch: 12 },
      { start: 100, length: 65, curve: 3.2, pitch: -14 },
      { start: 180, length: 60, curve: -3.0, pitch: 10 },
    ],
    fork: {
      forkSegment: 320,
      leftBranch: 'destination-oasis',
      rightBranch: 'destination-castle',
      leftLabel: 'DESERT OASIS [B]',
      rightLabel: 'GRAND CASTLE [C]',
    },
  },
  'metropolis-night': {
    id: 'metropolis-night',
    name: 'Metropolis Night',
    stageNum: 4,
    segmentCount: 380,
    segmentLength: 200,
    curves: [
      { start: 40, length: 60, curve: 3.5, pitch: 18 },
      { start: 120, length: 60, curve: -3.8, pitch: -16 },
      { start: 200, length: 60, curve: 3.0, pitch: 8 },
    ],
    fork: {
      forkSegment: 320,
      leftBranch: 'destination-castle',
      rightBranch: 'destination-colosseum',
      leftLabel: 'GRAND CASTLE [C]',
      rightLabel: 'COLOSSEUM [D]',
    },
  },
  'coastal-cliffs': {
    id: 'coastal-cliffs',
    name: 'Coastal Cliffs',
    stageNum: 4,
    segmentCount: 380,
    segmentLength: 200,
    curves: [
      { start: 30, length: 55, curve: -3.2, pitch: 15 },
      { start: 105, length: 60, curve: 3.6, pitch: -15 },
      { start: 185, length: 60, curve: -3.0, pitch: 10 },
    ],
    fork: {
      forkSegment: 320,
      leftBranch: 'destination-colosseum',
      rightBranch: 'destination-aerodrome',
      leftLabel: 'COLOSSEUM [D]',
      rightLabel: 'AERODROME [E]',
    },
  },
  'destination-marina': {
    id: 'destination-marina',
    name: 'Marina Bay [Ending A]',
    stageNum: 5,
    segmentCount: 300,
    segmentLength: 200,
    curves: [
      { start: 40, length: 60, curve: 2.0, pitch: 0 },
      { start: 140, length: 60, curve: -2.0, pitch: 0 },
    ],
    fork: null,
  },
  'destination-oasis': {
    id: 'destination-oasis',
    name: 'Desert Oasis [Ending B]',
    stageNum: 5,
    segmentCount: 300,
    segmentLength: 200,
    curves: [
      { start: 50, length: 60, curve: -2.2, pitch: 5 },
      { start: 150, length: 50, curve: 2.5, pitch: -5 },
    ],
    fork: null,
  },
  'destination-castle': {
    id: 'destination-castle',
    name: 'Grand Castle [Ending C]',
    stageNum: 5,
    segmentCount: 300,
    segmentLength: 200,
    curves: [
      { start: 40, length: 50, curve: 2.5, pitch: 8 },
      { start: 130, length: 60, curve: -2.5, pitch: -8 },
    ],
    fork: null,
  },
  'destination-colosseum': {
    id: 'destination-colosseum',
    name: 'Colosseum Plaza [Ending D]',
    stageNum: 5,
    segmentCount: 300,
    segmentLength: 200,
    curves: [
      { start: 45, length: 55, curve: -2.0, pitch: 0 },
      { start: 140, length: 55, curve: 2.0, pitch: 0 },
    ],
    fork: null,
  },
  'destination-aerodrome': {
    id: 'destination-aerodrome',
    name: 'Aerodrome Runway [Ending E]',
    stageNum: 5,
    segmentCount: 300,
    segmentLength: 200,
    curves: [
      { start: 50, length: 40, curve: 1.2, pitch: 0 },
      { start: 140, length: 40, curve: -1.2, pitch: 0 },
    ],
    fork: null,
  },
};

export const CHARACTERS = {
  tux: { name: 'Apex GT Spyder', topSpeed: 295, accel: 1.45, handling: 1.2, color: '#D32F2F' },
  wilber: { name: 'Wilber GT', topSpeed: 285, accel: 1.5, handling: 1.3, color: '#FF9800' },
  gnu: { name: 'Gnu Turbo', topSpeed: 300, accel: 1.35, handling: 1.1, color: '#9C27B0' },
  suzanne: { name: 'Suzanne GT', topSpeed: 288, accel: 1.42, handling: 1.22, color: '#4CAF50' },
};

// A stage's segments, built once: the step reads them every tick.
const segmentCache = new Map();
export function stageSegments(stageConfig) {
  if (!segmentCache.has(stageConfig.id)) segmentCache.set(stageConfig.id, Object.freeze(createSegments(stageConfig).map(Object.freeze)));
  return segmentCache.get(stageConfig.id);
}

function createSegments(stageConfig) {
  const segments = [];
  const count = stageConfig.segmentCount;
  for (let i = 0; i < count; i++) {
    segments.push({
      index: i,
      curve: 0,
      pitch: 0,
    });
  }

  for (const c of stageConfig.curves || []) {
    for (let i = 0; i < c.length; i++) {
      const idx = (c.start + i) % count;
      segments[idx].curve = c.curve;
      segments[idx].pitch = c.pitch;
    }
  }

  return segments;
}

// The four lane centres, in sim x; the renderer paints its markings between them.
const LANES = [-0.65, -0.22, 0.22, 0.65];

// Speed is km/h: the base plus up to `spread` more; width and length in sim units.
// Traffic spacing, in track units: how close ahead or behind a lane must be
// clear to merge into it, the gap within which a follower matches its
// leader, and the least gap it ever leaves (a car's length and a little).
const LANE_CLEAR = 12 / METRES_PER_UNIT;
const FOLLOW_CLOSE = 12 / METRES_PER_UNIT;
const CAR_GAP = 7 / METRES_PER_UNIT;

/** Whether two cars at these x, with these widths, overlap across the road. */
function sideBySide(xa, wa, xb, wb) {
  return Math.abs(xa - xb) < (wa + wb) / 2 + 0.04;
}

/** A z difference wrapped into the half-lap either side. */
function wrapDz(dz, trackLength) {
  const w = ((dz % trackLength) + trackLength) % trackLength;
  return w > trackLength / 2 ? w - trackLength : w;
}

const TRAFFIC_TYPES = {
  convertible: { speed: 150, spread: 25, width: 0.25, length: 0.42 },
  pickup: { speed: 135, spread: 20, width: 0.28, length: 0.5 },
  truck: { speed: 105, spread: 15, width: 0.35, length: 0.9 },
  sedan: { speed: 125, spread: 20, width: 0.25, length: 0.45 },
};

// Where a new stage's traffic begins: past the stretch the car drives itself
// and the first moments after the wheel comes back.
const HANDOVER_CLEAR = 6000;

function spawnTraffic(stageConfig, seed, start = 450) {
  const traffic = [];
  const types = Object.keys(TRAFFIC_TYPES);
  const rand = createPrng(seed);

  const count = TRAFFIC_COUNT;
  const spacing = Math.floor((stageConfig.segmentCount * stageConfig.segmentLength * 0.8) / count);

  for (let i = 0; i < count; i++) {
    const laneIdx = Math.floor(rand() * LANES.length);
    const typeIdx = Math.floor(rand() * types.length);
    const type = types[typeIdx];

    const spec = TRAFFIC_TYPES[type];
    const baseSpeed = spec.speed + Math.floor(rand() * spec.spread);
    const { width, length } = spec;

    traffic.push({
      id: `traffic-${i}`,
      type,
      x: LANES[laneIdx],
      targetX: LANES[laneIdx],
      z: start + i * spacing,
      speed: baseSpeed,
      baseSpeed,
      width,
      length,
      laneTimer: 180 + Math.floor(rand() * 300),
      blinker: 0,
      brake: 0,
      passed: false,
    });
  }

  return traffic;
}

/**
 * One tick of the car's own drive into its ending's destination (DESIGN.md
 * "End of a run"): it eases to a cruise, brakes on a constant deceleration to
 * stop ARRIVAL_METRES past the final arch, straight and in a lane, and the
 * tick it stops is `parkedAt`, the moment its riders wave.
 */
function arrive(next, kart) {
  const stop = next.trackLength + ARRIVAL_METRES / METRES_PER_UNIT;
  const left = (stop - kart.z) * METRES_PER_UNIT;
  const braking = Math.sqrt(2 * ARRIVAL_BRAKE * left) * 3.6;
  kart.speed = Math.min(kart.speed + (ARRIVAL_KMH - kart.speed) * 0.06, braking);
  kart.x += (Math.max(-LANES[LANES.length - 1], Math.min(LANES[LANES.length - 1], kart.x)) - kart.x) * 0.05;
  kart.steerAngle *= 0.85;
  kart.heading = (kart.heading || 0) * 0.9;
  kart.drift = false;
  kart.isNitro = false;
  kart.nitroTimer = 0;
  kart.turboTimer = 0;
  if (kart.spinTimer > 0) kart.spinTimer--;
  kart.gear = kart.speed > 165 ? 'high' : 'low';
  kart.rpm = Math.round(1200 + (kart.speed / (kart.gear === 'low' ? 180 : 295)) * 7600);
  kart.z = Math.min(stop, kart.z + kart.speed * KMH_TO_UNITS_PER_TICK);
  if (kart.z === stop && next.parkedAt === null) {
    kart.speed = 0;
    kart.rpm = 1000;
    next.parkedAt = next.endTicks;
    next.events.push({ type: 'arrived' });
  }
}

export const DUEL_SEATS = 2;
// What each seat drives, by seat; both race the hero car's numbers.
const DUEL_CARS = ['tux', 'suzanne'];

/**
 * A duel: one stage raced by a car per seat from the countdown, with the
 * stage's traffic and no scripted rival. The goal is the arch; a fork is
 * never taken, since two cars on two stages share no road.
 */
function duelState(seed, stage) {
  const karts = DUEL_CARS.map((character, seat) => ({
    id: `kart-seat-${seat}`,
    character,
    car: 'tux',
    name: `Seat ${seat + 1}`,
    isPlayer: true,
    seat,
    x: seat === 0 ? -0.3 : 0.3,
    z: 0,
    speed: 0,
    steerAngle: 0,
    gear: 'low',
    drift: false,
    driftDir: 0,
    driftCharge: 0,
    turboTimer: 0,
    nitroFuel: 100,
    nitroTimer: 0,
    nitroHeld: false,
    isNitro: false,
    body: restBody(),
    waveTimer: 0,
    spinTimer: 0,
    crashed: false,
    currentLap: stage.stageNum || 1,
    rpm: 1000,
  }));
  return {
    tick: 0,
    seed,
    stageState: 'warmup',
    countdown: INTRO_TICKS + COUNTDOWN_TICKS,
    goTimer: 0,
    departTimer: 0,
    timeRemaining: CLOCK_START_S,
    timeElapsed: 0,
    score: 0,
    closePassCount: 0,
    stageId: stage.id,
    stageNum: stage.stageNum || 1,
    routeHistory: [stage.id],
    forkActive: false,
    forkPassed: false,
    nextStageId: null,
    endTicks: 0,
    stageClear: null,
    closePassBannerTimer: 0,
    rivalBannerTimer: 0,
    closePassBonus: 0,
    enterHeld: false,
    trackName: stage.name,
    trackLength: stage.segmentCount * stage.segmentLength,
    segmentCount: stage.segmentCount,
    segmentLength: stage.segmentLength,
    winnerId: null,
    karts,
    traffic: spawnTraffic(stage, seed),
    events: [],
    metresDriven: 0,
    rival: { kartId: '', beaten: false, escaped: false },
    rivalsBeaten: 0,
    timeBonus: 0,
    // The tick each seat reached the goal, and the seat that won.
    duel: { goal: DUEL_CARS.map(() => null), winner: null },
  };
}

/**
 * A duel ends on the tick the first car reaches the goal, or at time over,
 * where the car farther along wins; level, neither does. Its end is the
 * event a machine consumes.
 */
function endDuel(next) {
  if (next.duel.winner !== null || next.stageState === 'finished') return next;
  const reached = next.duel.goal.map((tick, seat) => ({ tick, seat })).filter((g) => g.tick !== null);
  const timedOut = next.stageState === 'game_over';
  if (reached.length === 0 && !timedOut) return next;
  const [a, b] = next.karts;
  const winner = reached.length === 1 ? reached[0].seat
    : reached.length > 1 ? null
    : a.z === b.z ? null : a.z > b.z ? a.seat : b.seat;
  next.duel.winner = winner;
  next.winnerId = winner === null ? null : next.karts[winner].id;
  next.stageState = 'finished';
  next.events.push({ type: 'duel-end', winner, goal: next.duel.goal.slice(), ticks: next.tick });
  return next;
}

// A seat's input as the byte a duel's peer receives, and every seat's bytes
// as a duel's command; a disconnected seat drives nothing.
const INPUT_BITS = ['up', 'down', 'left', 'right', 'drift', 'nitro'];
// A solo frame's command as the two bytes a lifted milestone carries: the
// seat's six bits and Enter in the first, the gear in the second.
const COMMAND_BITS = [...INPUT_BITS, 'enter'];
export const encodeCommand = (cmd) => Uint8Array.of(
  COMMAND_BITS.reduce((byte, key, bit) => (cmd[key] ? byte | (1 << bit) : byte), 0),
  { high: 1, low: 2 }[cmd.gear] ?? 0,
);
export const decodeCommand = (bytes) => ({
  ...Object.fromEntries(COMMAND_BITS.map((key, bit) => [key, (bytes[0] & (1 << bit)) !== 0])),
  gear: [undefined, 'high', 'low'][bytes[1]],
});

// The run's milestones (pronto's kinetic-machine record): the moments a row
// is worth, seconds to minutes apart, read off the frame's own events, each
// with what the page shows of it.
const MILESTONES = {
  'race-grid': 'grid',
  'race-start': 'start',
  'landmark-ahead': 'landmark',
  'checkpoint-extended': 'checkpoint',
  'time-out': 'time-over',
  'race-finish': 'finish',
  'duel-end': 'duel-finish',
};
// The kinds whose row carries the frame's state, so a replay window loads
// at once rather than replaying the run up to it.
export const milestoneSnapshots = ['landmark'];
export const milestones = (state) => state.events
  .filter((e) => MILESTONES[e.type] !== undefined)
  .map((e) => ({ kind: MILESTONES[e.type], ...milestoneDetail(state, e) }));

/** A stage as the page names it: its number, name and the fork ahead. */
function stageCard(id, stageNum) {
  const stage = OUTRUN_STAGES[id];
  return {
    stageId: id,
    stageNum,
    stageName: stage.name.replace(/\s*\[.*\]/, ''),
    fork: stage.fork ? [stage.fork.leftLabel, stage.fork.rightLabel] : null,
  };
}

function milestoneDetail(state, e) {
  const at = { ...stageCard(state.stageId, state.stageNum), score: state.score, duel: !!state.duel };
  if (e.type === 'checkpoint-extended') {
    return { ...at, next: stageCard(e.stageId, state.stageNum + 1), rival: state.rival.beaten ? 'beaten' : 'ahead' };
  }
  if (e.type === 'duel-end') {
    const raced = (tick) => (tick === null ? null : tick - INTRO_TICKS - COUNTDOWN_TICKS);
    return { ...at, winner: e.winner, goal: e.goal.map(raced), holdMs: END_HOLD_MS };
  }
  if ((e.type === 'time-out' || e.type === 'race-finish') && !state.duel) {
    return {
      ...at,
      entry: runEntry(state),
      holdMs: e.type === 'race-finish' ? ARRIVAL_TICKS * 1000 / 60 : END_HOLD_MS,
      finalStage: FINAL_STAGE,
      metres: Math.round(state.metresDriven),
      closePasses: state.closePassCount,
      perClosePass: CLOSE_PASS_POINTS,
      rivalsBeaten: state.rivalsBeaten,
      perRival: RIVAL_POINTS,
      lines: Object.fromEntries(scoreBreakdown(state).map((l) => [l.key, l.points])),
    };
  }
  return at;
}

export const encodeInput = (input) => INPUT_BITS.reduce((byte, key, bit) => (input[key] ? byte | (1 << bit) : byte), 0);
export const decodeInputs = (bytes, gone) => [...bytes].map((byte, seat) =>
  Object.fromEntries(INPUT_BITS.map((key, bit) => [key, !gone[seat] && (byte & (1 << bit)) !== 0])));

/**
 * The state as seat `seat` sees it: its own car is the player's and the hero
 * car, the other the opponent's. The renderer and the HUD draw one player;
 * this is that player.
 */
export function viewForSeat(state, seat) {
  if (!state.duel) return state;
  return {
    ...state,
    karts: state.karts.map((kart) => ({
      ...kart,
      isPlayer: kart.seat === seat,
      character: kart.seat === seat ? 'tux' : 'suzanne',
    })),
  };
}

export const apexrunEngine = {
  rateHz: 60,
  OUTRUN_STAGES,

  initState(seed = 0x1337, options = {}) {
    const stageId = options.stageId ?? 'coconut-beach';
    const stage = OUTRUN_STAGES[stageId];
    if (!stage) throw new Error(`simulation: unknown stage ${stageId}`);
    if (options.duel) return duelState(seed, stage);

    const karts = [
      {
        id: 'kart-player',
        character: 'tux',
        name: CHARACTERS.tux.name,
        isPlayer: true,
        x: options.playerX ?? 0.0,
        // A pit-lane scenario can start the player anywhere along the stage.
        z: options.playerZ ?? 0,
        speed: options.playerSpeed ?? 0,
        steerAngle: 0,
        gear: 'low',
        drift: false,
        driftDir: 0,
        driftCharge: 0,
        turboTimer: 0,
        nitroFuel: 100,
        nitroTimer: 0,
        nitroHeld: false,
        isNitro: false,
        body: restBody(),
        waveTimer: 0,
        spinTimer: 0,
        crashed: false,
        currentLap: stage.stageNum || 1,
        rpm: 1000,
      },
      {
        id: 'kart-wilber',
        character: 'wilber',
        name: 'Wilber GT',
        isPlayer: false,
        x: 0.45,
        z: 400,
        speed: 0,
        steerAngle: 0,
        gear: 'low',
        drift: false,
        driftDir: 0,
        driftCharge: 0,
        turboTimer: 0,
        nitroFuel: 50,
        nitroTimer: 0,
        nitroHeld: false,
        isNitro: false,
        body: restBody(),
        waveTimer: 0,
        spinTimer: 0,
        crashed: false,
        currentLap: stage.stageNum || 1,
        rpm: 1000,
      },
      {
        id: 'kart-gnu',
        character: 'gnu',
        name: 'Gnu Turbo',
        isPlayer: false,
        x: -0.45,
        z: 800,
        speed: 0,
        steerAngle: 0,
        gear: 'low',
        drift: false,
        driftDir: 0,
        driftCharge: 0,
        turboTimer: 0,
        nitroFuel: 50,
        nitroTimer: 0,
        nitroHeld: false,
        isNitro: false,
        body: restBody(),
        waveTimer: 0,
        spinTimer: 0,
        crashed: false,
        currentLap: stage.stageNum || 1,
        rpm: 1000,
      },
      {
        id: 'kart-suzanne',
        character: 'suzanne',
        name: 'Suzanne GT',
        isPlayer: false,
        x: 0.22,
        z: 1200,
        speed: 0,
        steerAngle: 0,
        gear: 'low',
        drift: false,
        driftDir: 0,
        driftCharge: 0,
        turboTimer: 0,
        nitroFuel: 50,
        nitroTimer: 0,
        nitroHeld: false,
        isNitro: false,
        body: restBody(),
        waveTimer: 0,
        spinTimer: 0,
        crashed: false,
        currentLap: stage.stageNum || 1,
        rpm: 1000,
      },
    ];

    const traffic = spawnTraffic(stage, seed);

    return placeRival({
      tick: 0,
      seed,
      stageState: options.stageState || 'warmup',
      countdown: (options.stageState || 'warmup') === 'warmup' ? INTRO_TICKS + COUNTDOWN_TICKS : 0,
      goTimer: 0,
      departTimer: 0,
      timeRemaining: CLOCK_START_S,
      timeElapsed: 0,
      score: 0,
      closePassCount: 0,
      stageId: stage.id,
      stageNum: stage.stageNum || 1,
      routeHistory: [stage.id],
      forkActive: false,
      forkPassed: false,
      // The stage the arch leads to, and the one just cleared, for the
      // hand-over's card.
      nextStageId: null,
      // Ticks since the run ended.
      endTicks: 0,
      stageClear: null,
      closePassBannerTimer: 0,
      rivalBannerTimer: 0,
      closePassBonus: 0,
      enterHeld: false,
      trackName: stage.name,
      trackLength: stage.segmentCount * stage.segmentLength,
      segmentCount: stage.segmentCount,
      segmentLength: stage.segmentLength,
      winnerId: null,
      karts,
      traffic,
      events: [],
      metresDriven: 0,
      rival: { kartId: '', beaten: false, escaped: false },
      rivalsBeaten: 0,
      timeBonus: 0,
    });
  },

  advanceFrame(state, inputs = {}) {
    const next = JSON.parse(JSON.stringify(state));
    next.tick++;
    next.events = [];
    if (next.stageState === 'finished' || next.stageState === 'game_over') next.endTicks++;

    // Enter acts on the frame it goes down, so a held key acts once.
    const enterPressed = !!inputs.enter && !state.enterHeld;
    next.enterHeld = !!inputs.enter;
    // The frame a run begins names its stage, whatever it begins in.
    if (state.tick === 0) next.events.push({ type: 'race-grid' });

    if (next.stageState === 'title') {
      if (enterPressed) {
        next.stageState = 'warmup';
        next.countdown = INTRO_TICKS + COUNTDOWN_TICKS;
      }
      return next;
    }

    if (next.goTimer > 0) next.goTimer--;
    if (next.stageState === 'checkpoint' && next.departTimer > 0) {
      next.departTimer--;
      if (next.departTimer === 0 || enterPressed) {
        next.departTimer = 0;
        next.stageState = 'racing';
        next.goTimer = GO_TICKS;
      }
    }
    if (next.closePassBannerTimer > 0) {
      next.closePassBannerTimer--;
    }
    if (next.rivalBannerTimer > 0) {
      next.rivalBannerTimer--;
    }

    if (next.stageState === 'warmup' && enterPressed && next.countdown > COUNTDOWN_TICKS) next.countdown = COUNTDOWN_TICKS;
    if (next.countdown > 0) {
      next.countdown--;
      if (next.countdown === 0 && next.stageState === 'warmup') {
        next.stageState = 'racing';
        next.goTimer = GO_TICKS;
        next.events.push({ type: 'race-start' });
      }
    }

    const currentStage = OUTRUN_STAGES[next.stageId] || OUTRUN_STAGES['coconut-beach'];
    const segments = stageSegments(currentStage);
    const trackLength = next.trackLength;
    // Past the fork the branches are separate roads, split by the sign of x.
    const pastFork = (z) => !!currentStage.fork && Math.floor(z / currentStage.segmentLength) >= currentStage.fork.forkSegment;

    if (next.stageState === 'racing') {
      next.timeElapsed += 1 / 60;
      next.timeRemaining = Math.max(0, next.timeRemaining - 1 / 60);

      if (next.timeRemaining <= 0) {
        next.stageState = 'game_over';
        next.events.push({ type: 'time-out' });
      }
    }
    // The tick the clock runs out ends the run: nothing reaches a checkpoint on it.
    const canDrive = next.stageState === 'racing' || next.stageState === 'checkpoint';
    const autopilot = next.stageState === 'checkpoint';
    const arriving = next.stageState === 'finished' && !next.duel;

    // Process Civilian Traffic
    if (canDrive && next.traffic) {
      for (let i = 0; i < next.traffic.length; i++) {
        const t = next.traffic[i];
        t.z = (t.z + t.speed * KMH_TO_UNITS_PER_TICK) % trackLength;

        // Lane change timer & AI decision
        t.laneTimer--;
        if (t.laneTimer <= 0) {
          let currentLaneIdx = 0;
          let bestDist = 999;
          for (let l = 0; l < LANES.length; l++) {
            const d = Math.abs(LANES[l] - t.targetX);
            if (d < bestDist) {
              bestDist = d;
              currentLaneIdx = l;
            }
          }

          const [prngVal] = prngStep((next.seed ^ (next.tick * 1009 + i * 37)) >>> 0);
          let dir = 0;
          if (currentLaneIdx === 0) dir = 1;
          else if (currentLaneIdx === LANES.length - 1) dir = -1;
          else dir = prngVal > 0.5 ? 1 : -1;

          let nextLaneIdx = Math.max(0, Math.min(LANES.length - 1, currentLaneIdx + dir));
          if (pastFork(t.z) && (LANES[nextLaneIdx] < 0) !== (LANES[currentLaneIdx] < 0)) {
            nextLaneIdx = currentLaneIdx - dir;
          }
          // A lane with a car in it, or heading into it, alongside or close
          // ahead or behind, is not taken: it is tried again a second later.
          const into = LANES[nextLaneIdx];
          const taken = next.traffic.some((o, j) => j !== i
            && (sideBySide(o.x, o.width, into, t.width) || sideBySide(o.targetX, o.width, into, t.width))
            && Math.abs(wrapDz(o.z - t.z, trackLength)) < LANE_CLEAR);
          if (taken) {
            t.laneTimer = 60;
          } else {
            t.targetX = into;
            t.blinker = t.targetX > t.x ? 1 : (t.targetX < t.x ? -1 : 0);
            t.laneTimer = 240 + Math.floor(prngVal * 360);
          }
        }

        // Interpolate lateral lane position
        const ldx = t.targetX - t.x;
        if (Math.abs(ldx) > 0.006) {
          t.x += Math.sign(ldx) * 0.006;
        } else {
          t.x = t.targetX;
          t.blinker = 0;
        }

        // Following a car ahead that overlaps its lane, even one part-way
        // through a lane change: it brakes, matches the leader close behind,
        // and never closes inside a car's length.
        let lead = null;
        let leadCarDist = 99999;
        for (let j = 0; j < next.traffic.length; j++) {
          if (i === j) continue;
          const other = next.traffic[j];
          if (sideBySide(other.x, other.width, t.x, t.width)) {
            const dz = (other.z - t.z + trackLength) % trackLength;
            if (dz > 0 && dz < 350 && dz < leadCarDist) {
              leadCarDist = dz;
              lead = other;
            }
          }
        }

        if (lead && leadCarDist < 250) {
          t.brake = 1;
          t.speed = leadCarDist < FOLLOW_CLOSE ? Math.min(t.speed, lead.speed) : Math.max(80, Math.min(t.speed - 0.5, lead.speed));
          if (leadCarDist < CAR_GAP) t.z = (lead.z - CAR_GAP + trackLength) % trackLength;
        } else {
          t.brake = 0;
          if (t.speed < t.baseSpeed) {
            t.speed = Math.min(t.baseSpeed, t.speed + 0.2);
          }
        }
      }
    }

    // Process Karts
    for (let k = 0; k < next.karts.length; k++) {
      const kart = next.karts[k];
      const stats = CHARACTERS[kart.car ?? kart.character];
      // A press, not a hold, fires: the key must come up before it refires,
      // seen on every tick, a spin's, a parked one's and the autopilot's too.
      // A duel's command is one input per seat, by the kart's seat.
      const own = next.duel ? inputs[kart.seat] ?? {} : inputs;
      const nitroDown = kart.isPlayer && !!own.nitro;
      const nitroPress = nitroDown && !kart.nitroHeld && !autopilot;
      kart.nitroHeld = nitroDown;
      // The autopilot cruises: a burst under way ends at the arch.
      if (autopilot) kart.nitroTimer = 0;

      if (arriving && kart.isPlayer) {
        arrive(next, kart);
        continue;
      }
      if (!canDrive) {
        kart.speed = 0;
        kart.rpm = 1000;
        kart.isNitro = false;
        kart.nitroTimer = 0;
        continue;
      }

      if (kart.spinTimer > 0) {
        kart.isNitro = false;
        kart.nitroTimer = 0;
        // A spin straightens the car up: it comes out of it on the road's line.
        kart.heading = 0;
        kart.steerAngle = 0;
        kart.spinTimer--;
        kart.speed *= 0.94;
        // Out Run's recovery: a crash slides the car back to the road's edge.
        if (kart.crashed) kart.x += (Math.sign(kart.x) * 0.85 - kart.x) * 0.12;
        if (kart.spinTimer === 0) kart.crashed = false;
        kart.z += kart.speed * KMH_TO_UNITS_PER_TICK;
        continue;
      }

      const isPlayer = kart.isPlayer;
      const cmd = isPlayer && !autopilot ? own : {};

      const accelInput = isPlayer ? !!(cmd.up || cmd.forward || cmd.jump) : true;
      const brakeInput = isPlayer ? !!(cmd.down || cmd.backward) : false;
      const steerLeft = isPlayer ? !!(cmd.left || cmd.strafeLeft) : false;
      const steerRight = isPlayer ? !!(cmd.right || cmd.strafeRight) : false;
      const driftInput = isPlayer ? !!(cmd.run || cmd.drift) : false;

      // Automatic / Manual 2-Speed Gearbox
      if (cmd.gear === 'low' || cmd.gear === 'high') {
        kart.gear = cmd.gear;
      } else {
        kart.gear = kart.speed > 165 ? 'high' : 'low';
      }

      let maxSpeed = kart.id === next.rival.kartId ? Math.min(stats.topSpeed, RIVAL_TOP_SPEED) : stats.topSpeed;
      if (kart.gear === 'low') {
        maxSpeed = Math.min(maxSpeed, 185);
      }

      if (nitroPress && kart.nitroTimer === 0 && nitroStatus(kart).charges > 0) {
        kart.nitroTimer = NITRO_TICKS;
        kart.nitroFuel = Math.max(0, kart.nitroFuel - NITRO_SHOT);
      }
      if (kart.nitroTimer > 0) {
        kart.nitroTimer--;
        kart.isNitro = true;
        maxSpeed += NITRO_KMH;
      } else {
        kart.isNitro = false;
        kart.nitroFuel = Math.min(100, kart.nitroFuel + 0.04);
      }

      if (kart.turboTimer > 0) {
        kart.turboTimer--;
        maxSpeed += TURBO_KMH;
      }

      // Off-road penalty
      const offRoad = Math.abs(kart.x) > 1.0;
      if (offRoad) {
        maxSpeed = Math.min(maxSpeed, 45);
        if (kart.speed > maxSpeed) kart.speed = Math.max(maxSpeed, kart.speed - OFF_ROAD_SHED);
      }

      // Acceleration & Braking
      if (accelInput) {
        const gearAccelMultiplier = kart.gear === 'low' ? 1.3 : (kart.speed > 140 ? 0.9 : 0.4);
        const before = kart.speed;
        kart.speed += stats.accel * gearAccelMultiplier;
        if (kart.speed > maxSpeed) kart.speed = Math.max(maxSpeed, Math.min(kart.speed, before - OVER_CAP_SHED));
      } else if (brakeInput) {
        kart.speed -= 2.2;
        if (kart.speed < 0) kart.speed = 0;
      } else {
        kart.speed -= 0.35;
        if (kart.speed < 0) kart.speed = 0;
      }

      // Current track curve for centrifugal force
      const currentSegIdx = Math.floor(kart.z / currentStage.segmentLength) % segments.length;
      const currentSeg = segments[currentSegIdx] || segments[0];

      // Steering & Drifting

      if (driftInput && (steerLeft || steerRight) && kart.speed > 50) {
        if (!kart.drift) {
          kart.drift = true;
          kart.driftDir = steerLeft ? -1 : 1;
          kart.driftCharge = 0;
          next.events.push({ type: 'drift-start', kartId: kart.id });
        }
      }

      // A kinematic bicycle model with the arcade aids (DESIGN.md "Hero
      // car"): the wheel turns at a limited rate toward the stick and returns
      // faster, reaches less as speed builds, turns the heading at speed x
      // tan(wheel) / wheelbase, and the heading self-aligns to the road; the
      // car moves sideways because it points sideways.
      const stick = kart.drift ? kart.driftDir : (steerRight ? 1 : 0) - (steerLeft ? 1 : 0);
      const wheelTarget = stick * STEER_FULL;
      const wheelStep = stick === 0 ? STEER_RETURN : STEER_RAMP;
      kart.steerAngle = (kart.steerAngle || 0) + Math.max(-wheelStep, Math.min(wheelStep, wheelTarget - (kart.steerAngle || 0)));
      const v = kart.speed / 3.6;
      const wheel = (kart.steerAngle / STEER_FULL) * maxWheel(kart.speed) * stats.handling * (kart.drift ? 1.35 : 1);
      kart.heading = (kart.heading || 0) + (v * Math.tan(wheel) / WHEELBASE - SELF_ALIGN * (kart.heading || 0)) / 60;
      kart.x += v * Math.sin(kart.heading) / 60 / LATERAL_UNITS;

      if (kart.drift) {
        kart.driftCharge = Math.min(100, (kart.driftCharge || 0) + 1.2);

        // Release drift
        if (!driftInput) {
          if (kart.driftCharge > 40) {
            kart.turboTimer = 45;
            next.events.push({ type: 'mini-turbo', kartId: kart.id });
          }
          kart.drift = false;
          kart.driftCharge = 0;
        }
      }

      // OutRun Centrifugal curve force
      if (currentSeg.curve !== 0 && kart.speed > 30) {
        const centrifugal = currentSeg.curve * 0.0022 * (kart.speed / 200);
        kart.x -= centrifugal;
      }

      // Barrier clamp
      kart.x = Math.max(-2.0, Math.min(2.0, kart.x));
      if (isPlayer && autopilot) {
        kart.speed += (CRUISE_KMH - kart.speed) * 0.08;
        kart.x += ((kart.x < 0 ? -1 : 1) * 0.45 - kart.x) * 0.08;
      }

      // Calculate Engine RPM (1000 - 9000)
      const gearRatio = kart.gear === 'low' ? 180 : 295;
      kart.rpm = Math.round(1200 + (kart.speed / gearRatio) * 7600);

      // Distance advancement
      const fromZ = kart.z;
      kart.z += kart.speed * KMH_TO_UNITS_PER_TICK;
      // The run's replay window on this stage opens short of its hero landmark.
      if (isPlayer && !next.duel && next.stageState === 'racing') {
        const opens = heroSegment(currentStage.id, currentStage.segmentCount) * currentStage.segmentLength - LANDMARK_LEAD_METRES / METRES_PER_UNIT;
        if (fromZ < opens && kart.z >= opens) next.events.push({ type: 'landmark-ahead' });
      }

      if (isPlayer && !autopilot && kart.spinTimer === 0 && Math.abs(kart.x) > 1) {
        const seg = Math.floor(kart.z / currentStage.segmentLength);
        const lateral = Math.abs(kart.x) * LATERAL_UNITS;
        for (let i = seg - 1; i <= seg + 1 && kart.spinTimer === 0; i++) {
          for (const p of solidProps(currentStage).get(i) ?? []) {
            if (Math.sign(kart.x) !== p.side) continue;
            const r = PROP_RADIUS[p.kind] * p.scale;
            const dz = Math.abs(kart.z - i * currentStage.segmentLength) * METRES_PER_UNIT;
            const dx = Math.abs(lateral - (LATERAL_UNITS + p.offset));
            if (dz < r + CAR_HALF_LENGTH && dx < r + CAR_HALF_WIDTH) {
              kart.spinTimer = 45;
              kart.crashed = true;
              kart.speed = Math.min(kart.speed * 0.3, 30);
              next.events.push({ type: 'prop-crash', kind: p.kind });
              break;
            }
          }
        }
      }

      // Civilian Traffic Collision & Drafting Near-Miss Check
      if (isPlayer && !autopilot && next.traffic) {
        for (const t of next.traffic) {
          if (pastFork(kart.z) && (kart.x < 0) !== (t.x < 0)) continue;
          const dz = Math.abs(kart.z - t.z);
          const dx = Math.abs(kart.x - t.x);
          const prevZ = kart.z - kart.speed * KMH_TO_UNITS_PER_TICK;
          const sweptZ = (prevZ <= t.z && kart.z >= t.z);

          if ((dz < 100 || sweptZ) && dx < t.width && kart.spinTimer === 0) {
            kart.spinTimer = 35;
            kart.speed = Math.min(kart.speed * 0.45, 65);
            next.events.push({ type: 'traffic-collision', trafficId: t.id, trafficType: t.type });
          } else if ((dz < 160 || sweptZ) && dx >= t.width && dx <= 0.60 && kart.speed > 160) {
            if (!t.passed) {
              t.passed = true;
              next.closePassCount++;
              next.closePassBannerTimer = CLOSE_PASS_BANNER_TICKS;
              next.closePassBonus = 50;
              next.events.push({
                type: 'close-pass',
                trafficId: t.id,
                trafficType: t.type,
                speed: Math.round(kart.speed),
                scoreBonus: 50,
              });
            }
          }

          if (dz > 300) {
            t.passed = false;
          }
        }
      }

      // A duel's goal is the arch: the first car under it wins.
      if (next.duel && next.stageState === 'racing' && kart.z >= trackLength - ARCH_LEAD && next.duel.goal[kart.seat] === null) {
        next.duel.goal[kart.seat] = next.tick;
        next.events.push({ type: 'duel-goal', seat: kart.seat });
      }

      // Checkpoint & Branching Fork Handling
      const fork = next.duel ? null : currentStage.fork;
      if (fork && isPlayer) {
        const segIdx = Math.floor(kart.z / currentStage.segmentLength);
        if (next.stageState === 'racing' && kart.z >= trackLength - ARCH_LEAD) {
          next.stageState = 'checkpoint';
          next.timeRemaining += CHECKPOINT_S;
          next.nextStageId = kart.x < 0 ? fork.leftBranch : fork.rightBranch;
          next.events.push({
            type: 'checkpoint-extended',
            stageId: next.nextStageId,
            timeBonus: CHECKPOINT_S,
          });
        }
        if (segIdx >= fork.forkSegment && !next.forkActive) {
          next.forkActive = true;
          next.events.push({
            type: 'fork-approach',
            leftLabel: fork.leftLabel,
            rightLabel: fork.rightLabel,
          });
        }
      }

      // Stage Fork Crossing & Completion
      if (kart.z >= trackLength) {
        if (!isPlayer) {
          if (kart.id === next.rival.kartId && !next.rival.beaten) next.rival.escaped = true;
          kart.z -= trackLength;
        } else if (fork) {
          // The stage the arch announced, whatever the car has drifted to since.
          const selectedStageId = next.nextStageId;
          if (!selectedStageId) throw new Error('simulation: the road ended with no stage announced at the arch');
          next.stageClear = { stageNum: next.stageNum, rival: next.rival.beaten ? 'beaten' : 'ahead' };
          next.stageId = selectedStageId;
          next.stageNum++;
          next.routeHistory.push(selectedStageId);

          const nextStageConfig = OUTRUN_STAGES[selectedStageId];
          next.trackName = nextStageConfig.name;
          next.trackLength = nextStageConfig.segmentCount * nextStageConfig.segmentLength;
          next.segmentCount = nextStageConfig.segmentCount;
          next.forkActive = false;

          next.departTimer = DEPART_TICKS;

          // Reset distance and spawn fresh traffic
          kart.z -= trackLength;
          kart.currentLap = next.stageNum;
          next.traffic = spawnTraffic(nextStageConfig, next.seed + next.stageNum * 997, HANDOVER_CLEAR);
          placeRival(next);
        } else {
          kart.z = trackLength;
          next.winnerId = kart.id;
          next.stageState = 'finished';
          // The end of the set piece's tick the car pulls up at.
          next.parkedAt = null;
          next.timeBonus = Math.round(next.timeRemaining * 1000);
          next.score = totalScore(next);
          next.events.push({ type: 'race-finish', winnerId: kart.id, score: next.score });
        }
      }

      if (isPlayer) {
        next.metresDriven += kart.speed * KMH_TO_UNITS_PER_TICK * METRES_PER_UNIT;
      }
    }

    next.karts.forEach((kart, k) => { kart.body = springBody(state.karts[k], kart); });
    for (const [k, kart] of next.karts.entries()) {
      if (!kart.isPlayer) continue;
      const moment = next.events.some((e) => WAVE_EVENTS.has(e.type)) || (kart.isNitro && !state.karts[k].isNitro);
      kart.waveTimer = moment ? WAVE_TICKS : Math.max(0, (kart.waveTimer ?? 0) - 1);
    }

    if (next.duel) return endDuel(next);
    const player = next.karts.find((k) => k.isPlayer);
    const rival = next.karts.find((k) => k.id === next.rival.kartId);
    if (!next.rival.beaten && !next.rival.escaped && player.z > rival.z) {
      next.rival.beaten = true;
      next.rivalsBeaten++;
      next.rivalBannerTimer = 120;
      next.events.push({ type: 'rival-beaten', kartId: rival.id, bonus: RIVAL_POINTS });
    }
    next.score = totalScore(next);

    return next;
  },

  saveState(state) {
    return JSON.parse(JSON.stringify(state));
  },

  loadState(snapshot) {
    return JSON.parse(JSON.stringify(snapshot));
  },
};

// The high-score table's column `outcome`: the destination reached, or the clock.
export const ENDINGS = {
  'destination-marina': 'A',
  'destination-oasis': 'B',
  'destination-castle': 'C',
  'destination-colosseum': 'D',
  'destination-aerodrome': 'E',
};

/** What the nitro gauge shows: a burst under way, charges to fire, or none yet. */
export function nitroStatus(kart) {
  // The epsilon keeps a full tank at three charges, not 2.9999.
  const charges = Math.floor(kart.nitroFuel / NITRO_SHOT + 1e-9);
  const state = kart.nitroTimer > 0 ? 'boost' : charges > 0 ? 'ready' : 'charging';
  return { state, fill: kart.nitroFuel / 100, charges };
}

/** Seconds on the clock by the time stage `stage` is reached. */
export const clockBudgetS = (stage) => CLOCK_START_S + (stage - 1) * CHECKPOINT_S;

const MAX_RUN_S = clockBudgetS(FINAL_STAGE);
// The clock's float steps can run one tick past its budget.
const MAX_RACING_TICKS = MAX_RUN_S * 60 + 1;
export const MAX_KMH = Math.max(...Object.values(CHARACTERS).map((c) => c.topSpeed)) + NITRO_KMH + TURBO_KMH;

// Every scoreBreakdown line at its most over a whole clock: distance at nitro
// and turbo on the fastest car every tick; a close pass per car slot at most
// every other tick (a pass and the reset it waits for never share one), plus
// one per stage for the fresh cars; a rival per stage; the whole clock left.
export const SCORE_CEILING =
  Math.ceil(MAX_RACING_TICKS * MAX_KMH * KMH_TO_UNITS_PER_TICK * METRES_PER_UNIT * 10) +
  TRAFFIC_COUNT * (Math.ceil(MAX_RACING_TICKS / 2) + FINAL_STAGE) * CLOSE_PASS_POINTS +
  FINAL_STAGE * RIVAL_POINTS +
  MAX_RUN_S * 1000;

/**
 * A finished run as a high-score row. run_ms is the clock spent, budget less
 * what is left, so a timeout is exactly its stage's budget and a goal is under it.
 */
export function runEntry(state) {
  if (state.stageState !== 'finished' && state.stageState !== 'game_over') {
    throw new Error(`a run in state ${state.stageState} has not ended`);
  }
  const outcome = state.stageState === 'game_over' ? 'time_over' : ENDINGS[state.stageId];
  if (outcome === undefined) throw new Error(`run finished on ${state.stageId}, which is no destination`);
  const run_ms = clockBudgetS(state.stageNum) * 1000 - Math.ceil(state.timeRemaining * 1000);
  return { outcome, stage: state.stageNum, run_ms, score: state.score };
}
