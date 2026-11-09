// Compact C-ABI Pose & Moments Float32Array struct shared across:
//   - Web / QuickJS / JavaScriptCore / rquickjs simulation tick
//   - Desktop Rust Bevy presenter (`#[repr(C)] pub struct PoseBuffer`)
//   - Phone Android Filament presenter (`FloatBuffer`) & DivVariableController
//   - Phone iOS Filament presenter (`UnsafeBufferPointer<Float>`) & DivVariableStorage
//
// Zero JSON serialization on the 60–120 Hz hot path: one contiguous Float32Array
// carries camera pose, atmosphere scalars, hero/rival/traffic/flagman/rider transforms,
// `moments(state)` / `replayMoments(state, cut)`, and fast HUD telemetry.

import {
  METRES_PER_UNIT,
  OUTRUN_STAGES,
  maxWheel,
  nitroStatus,
} from './simulation.js';
import { NIGHT_STAGES } from './scenery.js';
import { STAGE_LOOKS } from './stage_look.js';
import { moments, replayMoments } from './effects.js';
import { buildStageCenterline } from './stage_gltf.js';
import {
  computeCameraPose,
  computeRiderPose,
  marshalPose,
  sampleRoadPoint,
  sampleRoadPose,
  stageHaze,
} from './renderer.js';

export const BODY_PIVOT_Y = 0.32;
export const HAZE_DENSITY = 0.012;
export const WAVE_REST = 1.15;
export const GLANCE_PERIOD = 9;
export const GLANCE_SCENERY = 0.6;
export const GLANCE_GIRL = -0.5;
export const GIRL_ARM = {
  side: 0.08,
  chin: 0.5,
  shoulder: [0.15, 0.39, -0.01],
  raise: 1.9,
  out: 0.55,
  swing: 0.3,
  rate: 9,
};
export const GIRL_WAVE_TICKS = 150;
export const MAX_TRAFFIC_CARS = 12;
export const TRAFFIC_STRIDE = 8;
export const EQ_BANDS = 6;

export const POSE_LAYOUT = Object.freeze({
  // Header (0..3)
  TICK: 0,
  ALPHA: 1,
  WIND_TIME: 2,
  STAGE_NUM: 3,

  // Camera (4..11)
  CAM_EYE_X: 4,
  CAM_EYE_Y: 5,
  CAM_EYE_Z: 6,
  CAM_TARGET_X: 7,
  CAM_TARGET_Y: 8,
  CAM_TARGET_Z: 9,
  CAM_FOV: 10,
  CAM_ASPECT: 11,

  // Atmosphere & post-process (12..19)
  STAGE_HAZE: 12,
  HAZE_DENSITY: 13,
  SUN_HAZE_R: 14,
  SUN_HAZE_G: 15,
  SUN_HAZE_B: 16,
  SPEED_BLUR: 17,
  GOD_RAY_INTENSITY: 18,
  EXPOSURE: 19,

  // Hero car transform & procedural rig (20..35)
  HERO_X: 20,
  HERO_Y: 21,
  HERO_Z: 22,
  HERO_YAW: 23,
  HERO_PITCH: 24,
  HERO_ROLL: 25,
  HERO_BODY_PITCH: 26,
  HERO_BODY_ROLL: 27,
  HERO_BODY_PIVOT_Y: 28,
  HERO_STRETCH: 29,
  HERO_WHEEL_STEER: 30,
  HERO_WHEEL_SPIN: 31,
  HERO_DRIFT_DIR: 32,
  HERO_DRIFT_INTENSITY: 33,
  HERO_NITRO_FLAME: 34,
  HERO_HEADLIGHTS_ON: 35,

  // Riders procedural rig (36..41)
  RIDER_PASSENGER_ARM: 36,
  RIDER_PASSENGER_HEAD_YAW: 37,
  RIDER_GIRL_ARM_RAISE: 38,
  RIDER_GIRL_ARM_OUT: 39,
  RIDER_GIRL_ARM_SWING: 40,
  RIDER_GIRL_WAVING: 41,

  // Rival car transform (42..51)
  RIVAL_ACTIVE: 42,
  RIVAL_X: 43,
  RIVAL_Y: 44,
  RIVAL_Z: 45,
  RIVAL_YAW: 46,
  RIVAL_PITCH: 47,
  RIVAL_ROLL: 48,
  RIVAL_WHEEL_SPIN: 49,
  RIVAL_SPEED: 50,
  RIVAL_BEATEN: 51,

  // Flagman procedural rig (52..57)
  MARSHAL_ARM: 52,
  MARSHAL_FLAG: 53,
  MARSHAL_X: 54,
  MARSHAL_Y: 55,
  MARSHAL_Z: 56,
  MARSHAL_YAW: 57,

  // Moments / Replay overlay state (58..67)
  MOMENT_HAZE: 58,
  MOMENT_SWOOP_STAGE: 59,
  MOMENT_COUNTDOWN_CODE: 60, // 0=none, 1="1", 2="2", 3="3", 4="GO!", 5="GOAL!", 6="TIME OVER"
  MOMENT_CLEAR_STAGE: 61,
  MOMENT_CLEAR_BEATEN: 62,
  MOMENT_CLEAR_SKIP: 63,
  MOMENT_ENDING_CLEARED: 64,
  MOMENT_REPLAY_ACTIVE: 65,
  MOMENT_REPLAY_TRIP_ALPHA: 66,
  MOMENT_REPLAY_STAGE_ALPHA: 67,

  // Fast HUD telemetry (68..89)
  HUD_SPEED_KMH: 68,
  HUD_RPM: 69,
  HUD_TACHO_RATIO: 70,
  HUD_GEAR: 71,
  HUD_NITRO_AMOUNT: 72,
  HUD_NITRO_ACTIVE: 73,
  HUD_TIMER_SEC: 74,
  HUD_TIMER_DEC: 75,
  HUD_SCORE: 76,
  HUD_DRIFT_SCORE: 77,
  HUD_GFORCE_LAT: 78,
  HUD_SLIPSTREAM: 79,
  HUD_RIVAL_GAP_METRES: 80,
  HUD_FORK_DIST_METRES: 81,
  HUD_ROUTE_PROGRESS: 82,
  HUD_RADAR_NEAREST_Z: 83,
  HUD_EQ_0: 84,
  HUD_EQ_1: 85,
  HUD_EQ_2: 86,
  HUD_EQ_3: 87,
  HUD_EQ_4: 88,
  HUD_EQ_5: 89,

  // Traffic cars slice (90..185): 12 cars * 8 floats each
  TRAFFIC_BASE: 90,
});

export const POSE_BUFFER_FLOATS = POSE_LAYOUT.TRAFFIC_BASE + MAX_TRAFFIC_CARS * TRAFFIC_STRIDE; // 186 floats
export const POSE_BUFFER_BYTES = POSE_BUFFER_FLOATS * 4; // 744 bytes

const cameraState = {
  boostT: 0,
  hoodT: 0,
  lens: 0.68,
  flameT: 0,
  lastTick: -1,
};

const centerlineCache = new Map();
function getCachedCenterline(stageId) {
  let entry = centerlineCache.get(stageId);
  if (!entry) {
    entry = buildStageCenterline(stageId);
    centerlineCache.set(stageId, entry);
  }
  return entry;
}

function hexToRgb01(hex) {
  if (!hex || typeof hex !== 'string') return [0.96, 0.82, 0.68];
  const clean = hex.replace(/^#/, '');
  const n = parseInt(clean, 16);
  if (Number.isNaN(n)) return [0.96, 0.82, 0.68];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function encodeCountdownCode(countStr) {
  switch (countStr) {
    case '1': return 1;
    case '2': return 2;
    case '3': return 3;
    case 'GO!': return 4;
    case 'GOAL!': return 5;
    case 'TIME OVER': return 6;
    default: return 0;
  }
}

export function decodeCountdownCode(code) {
  switch (Math.round(code)) {
    case 1: return '1';
    case 2: return '2';
    case 3: return '3';
    case 4: return 'GO!';
    case 5: return 'GOAL!';
    case 6: return 'TIME OVER';
    default: return null;
  }
}

/**
 * Pack a simulation `state` (with optional `prev`, interpolation `alpha`, replay `cut`,
 * and 6-band `eqLevels`) into a 186-float C-ABI `Float32Array`.
 */
export function packPoseBuffer(state, options = {}) {
  const out = options.target instanceof Float32Array && options.target.length >= POSE_BUFFER_FLOATS
    ? options.target
    : new Float32Array(POSE_BUFFER_FLOATS);
  out.fill(0);

  const alpha = options.alpha ?? 1.0;
  const aspect = options.aspect ?? (16 / 9);
  const cut = options.cut ?? null;
  const eqLevels = options.eqLevels ?? [0, 0, 0, 0, 0, 0];

  const stageId = state?.stageId;
  if (!stageId || !OUTRUN_STAGES[stageId]) {
    throw new Error(`packPoseBuffer: unknown or missing stageId "${stageId}"`);
  }
  const centerline = getCachedCenterline(stageId);
  const player = state.karts?.find((k) => k.isPlayer) ?? state.karts?.[0];
  if (!player) {
    throw new Error('packPoseBuffer: state.karts must contain at least one kart');
  }

  const windTime = (state.tick || 0) / 60;
  out[POSE_LAYOUT.TICK] = state.tick || 0;
  out[POSE_LAYOUT.ALPHA] = alpha;
  out[POSE_LAYOUT.WIND_TIME] = windTime;
  out[POSE_LAYOUT.STAGE_NUM] = state.stageNum || 1;

  const playerLx = player.x || 0;
  const heroZMetres = (player.z || 0) * METRES_PER_UNIT;
  const heroPose = sampleRoadPose(centerline, heroZMetres, playerLx);

  const tickNow = state.tick || 0;
  if (state.stageState === 'title' || tickNow < cameraState.lastTick) {
    cameraState.boostT = 0;
    cameraState.hoodT = 0;
    cameraState.lens = 0.68;
    cameraState.flameT = 0;
  }
  cameraState.lastTick = tickNow;

  const playerBoosting = !!(player.isNitro || (player.nitroTimer || 0) > 0 || (player.turboTimer || 0) > 0);
  cameraState.boostT += ((playerBoosting ? 1 : 0) - cameraState.boostT) * (playerBoosting ? 0.18 : 0.025);
  cameraState.flameT += ((playerBoosting ? 1 : 0) - cameraState.flameT) * 0.25;
  const boostT = cameraState.boostT;

  const cam = computeCameraPose(
    state,
    player,
    heroPose,
    (z, x) => sampleRoadPoint(centerline, z, x),
    centerline.landmarks || [],
    cameraState,
    aspect,
    cut,
  );
  out[POSE_LAYOUT.CAM_EYE_X] = cam.eye[0];
  out[POSE_LAYOUT.CAM_EYE_Y] = cam.eye[1];
  out[POSE_LAYOUT.CAM_EYE_Z] = cam.eye[2];
  out[POSE_LAYOUT.CAM_TARGET_X] = cam.at[0];
  out[POSE_LAYOUT.CAM_TARGET_Y] = cam.at[1];
  out[POSE_LAYOUT.CAM_TARGET_Z] = cam.at[2];
  out[POSE_LAYOUT.CAM_FOV] = cam.fov;
  out[POSE_LAYOUT.CAM_ASPECT] = aspect;

  // Atmosphere & post-process scalars
  const sHaze = stageHaze(state, heroZMetres);
  const lookSpec = STAGE_LOOKS[stageId];
  const fogRgb = hexToRgb01(lookSpec?.fog?.color || '#C8E0EA');
  out[POSE_LAYOUT.STAGE_HAZE] = sHaze;
  out[POSE_LAYOUT.HAZE_DENSITY] = (lookSpec?.fog?.density ?? HAZE_DENSITY) * (0.25 + 0.75 * sHaze);
  out[POSE_LAYOUT.SUN_HAZE_R] = fogRgb[0];
  out[POSE_LAYOUT.SUN_HAZE_G] = fogRgb[1];
  out[POSE_LAYOUT.SUN_HAZE_B] = fogRgb[2];
  out[POSE_LAYOUT.SPEED_BLUR] = Math.max(0, Math.min(1, ((player.speed || 0) - 180) / 140)) * 0.035 + boostT * 0.04;
  out[POSE_LAYOUT.GOD_RAY_INTENSITY] = NIGHT_STAGES.has(stageId) ? 0.0 : 0.45 * (1 - sHaze);
  out[POSE_LAYOUT.EXPOSURE] = 1.05;

  // Hero car transform & procedural rig
  const body = player.body || { pitch: 0, roll: 0, stretch: 0 };
  const steerInput = player.steerAngle ?? player.steer ?? 0;
  const wheelSteer = steerInput * maxWheel(player.speed || 0);
  const wheelSpin = (heroZMetres / 0.34) % (Math.PI * 2);

  out[POSE_LAYOUT.HERO_X] = heroPose.x;
  out[POSE_LAYOUT.HERO_Y] = heroPose.y;
  out[POSE_LAYOUT.HERO_Z] = heroPose.z;
  out[POSE_LAYOUT.HERO_YAW] = heroPose.yaw
    + (player.heading || 0)
    + (player.drift ? (player.driftDir || 0) * 0.3 : 0)
    + ((player.spinTimer || 0) * 36 * Math.PI) / 180;
  out[POSE_LAYOUT.HERO_PITCH] = heroPose.pitch;
  out[POSE_LAYOUT.HERO_ROLL] = 0;
  out[POSE_LAYOUT.HERO_BODY_PITCH] = body.pitch || 0;
  out[POSE_LAYOUT.HERO_BODY_ROLL] = body.roll || 0;
  out[POSE_LAYOUT.HERO_BODY_PIVOT_Y] = BODY_PIVOT_Y;
  out[POSE_LAYOUT.HERO_STRETCH] = body.stretch || 0;
  out[POSE_LAYOUT.HERO_WHEEL_STEER] = wheelSteer;
  out[POSE_LAYOUT.HERO_WHEEL_SPIN] = wheelSpin;
  out[POSE_LAYOUT.HERO_DRIFT_DIR] = player.drift ? (player.driftDir || 0) : 0;
  out[POSE_LAYOUT.HERO_DRIFT_INTENSITY] = player.drift ? Math.min(1, (player.speed || 0) / 220) : 0;
  out[POSE_LAYOUT.HERO_NITRO_FLAME] = cameraState.flameT;
  out[POSE_LAYOUT.HERO_HEADLIGHTS_ON] = NIGHT_STAGES.has(stageId) ? 1.0 : 0.0;

  // Riders procedural rig shared with `renderer.js`
  const rPose = computeRiderPose(state, player, windTime, 0);
  out[POSE_LAYOUT.RIDER_PASSENGER_ARM] = rPose.waveZ;
  out[POSE_LAYOUT.RIDER_PASSENGER_HEAD_YAW] = rPose.headY;
  out[POSE_LAYOUT.RIDER_GIRL_ARM_RAISE] = rPose.girlRaise;
  out[POSE_LAYOUT.RIDER_GIRL_ARM_OUT] = rPose.girlOut;
  out[POSE_LAYOUT.RIDER_GIRL_ARM_SWING] = rPose.girlSwing;
  out[POSE_LAYOUT.RIDER_GIRL_WAVING] = rPose.greet > 0 ? 1 : 0;

  // Rival car
  const rival = state.rival;
  const rivalKart = rival?.kartId
    ? state.karts?.find((k) => k.id === rival.kartId)
    : state.karts?.find((k) => !k.isPlayer);
  if (rival || rivalKart) {
    const rx = rivalKart?.x ?? rival?.x ?? 0;
    const rz = rivalKart?.z ?? rival?.z ?? 0;
    const rSpeed = rivalKart?.speed ?? rival?.speed ?? 0;
    const rivalZMetres = rz * METRES_PER_UNIT;
    const rivalPose = sampleRoadPose(centerline, rivalZMetres, rx);
    out[POSE_LAYOUT.RIVAL_ACTIVE] = 1;
    out[POSE_LAYOUT.RIVAL_X] = rivalPose.x;
    out[POSE_LAYOUT.RIVAL_Y] = rivalPose.y;
    out[POSE_LAYOUT.RIVAL_Z] = rivalPose.z;
    out[POSE_LAYOUT.RIVAL_YAW] = rivalPose.yaw
      + (rivalKart?.heading || 0)
      + (rivalKart?.drift ? (rivalKart.driftDir || 0) * 0.3 : 0)
      + ((rivalKart?.spinTimer || 0) * 36 * Math.PI) / 180;
    out[POSE_LAYOUT.RIVAL_PITCH] = rivalPose.pitch + (rivalKart?.body?.pitch || 0);
    out[POSE_LAYOUT.RIVAL_ROLL] = rivalKart?.body?.roll || 0;
    out[POSE_LAYOUT.RIVAL_WHEEL_SPIN] = (rivalZMetres / 0.34) % (Math.PI * 2);
    out[POSE_LAYOUT.RIVAL_SPEED] = rSpeed;
    out[POSE_LAYOUT.RIVAL_BEATEN] = rival?.beaten ? 1 : (rival?.escaped ? -1 : 0);
  }

  // Flagman procedural rig
  const mPose = marshalPose(state);
  const gridPose = sampleRoadPose(centerline, 4.0, 1.25);
  out[POSE_LAYOUT.MARSHAL_ARM] = mPose.arm;
  out[POSE_LAYOUT.MARSHAL_FLAG] = mPose.flag;
  out[POSE_LAYOUT.MARSHAL_X] = gridPose.x;
  out[POSE_LAYOUT.MARSHAL_Y] = gridPose.y;
  out[POSE_LAYOUT.MARSHAL_Z] = gridPose.z;
  out[POSE_LAYOUT.MARSHAL_YAW] = gridPose.yaw + 0.64;

  // Moments / Replay overlay
  if (cut) {
    const rm = replayMoments(state, cut);
    out[POSE_LAYOUT.MOMENT_HAZE] = rm.haze;
    out[POSE_LAYOUT.MOMENT_REPLAY_ACTIVE] = 1;
    out[POSE_LAYOUT.MOMENT_REPLAY_TRIP_ALPHA] = rm.trip;
    out[POSE_LAYOUT.MOMENT_REPLAY_STAGE_ALPHA] = rm.stage?.alpha ?? 0;
  } else {
    const m = moments(state);
    out[POSE_LAYOUT.MOMENT_HAZE] = m.haze || 0;
    out[POSE_LAYOUT.MOMENT_SWOOP_STAGE] = m.swoop ? m.swoop.num : 0;
    out[POSE_LAYOUT.MOMENT_COUNTDOWN_CODE] = encodeCountdownCode(m.count);
    out[POSE_LAYOUT.MOMENT_CLEAR_STAGE] = m.clear ? m.clear.stage : 0;
    out[POSE_LAYOUT.MOMENT_CLEAR_BEATEN] = m.clear?.beaten ? 1 : 0;
    out[POSE_LAYOUT.MOMENT_CLEAR_SKIP] = m.clear?.skip ? 1 : 0;
    out[POSE_LAYOUT.MOMENT_ENDING_CLEARED] = state.stageState === 'finished' ? 1 : 0;
  }

  // Fast HUD telemetry
  const rawTime = state.timeRemaining ?? state.timer;
  if (typeof rawTime !== 'number' || !Number.isFinite(rawTime)) {
    throw new Error('packPoseBuffer: state.timeRemaining or state.timer must be a finite number');
  }
  const timerRaw = Math.max(0, rawTime);
  const timerSec = Math.floor(timerRaw);
  const timerDec = Math.floor((timerRaw - timerSec) * 10);
  const maxRpm = 8500;
  const rpm = player.rpm ?? Math.min(maxRpm, 1200 + (player.speed || 0) * 24);
  const trackLen = Math.max(1, state.trackLength || 1);
  const forkSeg = centerline.forkStart;
  const forkZMetres = forkSeg * centerline.segLen;
  const gearNum = player.gear === 'high' ? 2 : player.gear === 'low' ? 1 : (Number(player.gear) || 1);
  const nitroInfo = nitroStatus(player);
  const nitroVal = nitroInfo.fill * 100;
  const rivalZ = rivalKart?.z ?? rival?.z ?? 0;

  out[POSE_LAYOUT.HUD_SPEED_KMH] = Math.round(player.speed || 0);
  out[POSE_LAYOUT.HUD_RPM] = Math.round(rpm);
  out[POSE_LAYOUT.HUD_TACHO_RATIO] = Math.max(0, Math.min(1, rpm / maxRpm));
  out[POSE_LAYOUT.HUD_GEAR] = gearNum;
  out[POSE_LAYOUT.HUD_NITRO_AMOUNT] = Math.max(0, Math.min(100, nitroVal));
  out[POSE_LAYOUT.HUD_NITRO_ACTIVE] = nitroInfo.state === 'boost' ? 1 : 0;
  out[POSE_LAYOUT.HUD_TIMER_SEC] = timerSec;
  out[POSE_LAYOUT.HUD_TIMER_DEC] = timerDec;
  out[POSE_LAYOUT.HUD_SCORE] = Math.floor(state.score || 0);
  out[POSE_LAYOUT.HUD_DRIFT_SCORE] = Math.floor(player.driftCharge ?? player.driftScore ?? 0);
  out[POSE_LAYOUT.HUD_GFORCE_LAT] = steerInput * ((player.speed || 0) / 120);
  out[POSE_LAYOUT.HUD_SLIPSTREAM] = (player.turboTimer || 0) > 0 || player.slipstream ? 1 : 0;
  const rivalGapUnits = (rival || rivalKart)
    ? (rival?.escaped ? Math.max(0, state.trackLength - player.z) : (rivalZ - player.z))
    : 0;
  out[POSE_LAYOUT.HUD_RIVAL_GAP_METRES] = rivalGapUnits * METRES_PER_UNIT;
  out[POSE_LAYOUT.HUD_FORK_DIST_METRES] = Math.max(0, forkZMetres - heroZMetres);
  out[POSE_LAYOUT.HUD_ROUTE_PROGRESS] = Math.max(0, Math.min(1, (player.z || 0) / trackLen));

  for (let b = 0; b < EQ_BANDS; b++) {
    out[POSE_LAYOUT.HUD_EQ_0 + b] = eqLevels[b] ?? 0;
  }

  // Active 12-car traffic + remaining AI karts slice sorted by proximity to hero car
  const trafficRaw = Array.isArray(state.traffic) ? state.traffic : [];
  const extraKarts = (state.karts || [])
    .filter((k) => !k.isPlayer && k !== rivalKart)
    .map((k, idx) => ({
      id: 100 + idx,
      colorIdx: k.character === 'gnu' ? 5 : k.character === 'suzanne' ? 8 : (5 + idx) % 8,
      type: 'convertible',
      x: k.x || 0,
      z: k.z || 0,
      blinker: ((k.heading || 0) + (k.drift ? (k.driftDir || 0) * 0.3 : 0) + ((k.spinTimer || 0) * 36 * Math.PI) / 180) / 0.06,
      brake: (k.body?.pitch || 0) > 0.02,
      bodyPitch: k.body?.pitch || 0,
    }));
  const taggedTraffic = trafficRaw.map((tCar, tIdx) => {
    const parsed = typeof tCar.id === 'number'
      ? tCar.id
      : typeof tCar.id === 'string'
        ? parseInt(tCar.id.replace(/\D+/g, ''), 10)
        : NaN;
    const colorIdx = tCar.colorIdx ?? ((Number.isFinite(parsed) ? parsed : tIdx) & 7);
    return { ...tCar, colorIdx };
  });
  const allTraffic = [...extraKarts, ...taggedTraffic].map((tCar, idx) => {
    const tzUnits = state.trackLength ? ((tCar.z || 0) % state.trackLength) : (tCar.z || 0);
    const tzMetres = tzUnits * METRES_PER_UNIT;
    return { tCar, idx, tzMetres, absDist: Math.abs(tzMetres - heroZMetres) };
  });
  allTraffic.sort((a, b) => a.absDist - b.absDist);

  let nearestDz = Infinity;
  for (const item of allTraffic) {
    const dz = item.tzMetres - heroZMetres;
    if (dz > 0 && dz < nearestDz) nearestDz = dz;
  }

  const count = Math.min(MAX_TRAFFIC_CARS, allTraffic.length);
  for (let i = 0; i < count; i++) {
    const { tCar, tzMetres } = allTraffic[i];
    const tPose = sampleRoadPose(centerline, tzMetres, tCar.x || 0);
    const base = POSE_LAYOUT.TRAFFIC_BASE + i * TRAFFIC_STRIDE;
    const typeCode = tCar.type === 'convertible' ? 1 : tCar.type === 'pickup' ? 2 : tCar.type === 'truck' ? 3 : 0;
    const colorIdx = tCar.colorIdx ?? 0;
    const isBraking = !!(tCar.brake || tCar.braking);
    out[base + 0] = isBraking ? 2 : 1; // 1 = active, 2 = active + braking
    out[base + 1] = tCar.modelIndex ?? (typeCode + colorIdx * 8);
    out[base + 2] = tPose.x;
    out[base + 3] = tPose.y;
    out[base + 4] = tPose.z;
    out[base + 5] = tPose.yaw + (tCar.blinker ?? 0) * 0.06;
    out[base + 6] = (tzMetres / 0.34) % (Math.PI * 2);
    out[base + 7] = tPose.pitch + (tCar.bodyPitch || 0);
  }
  out[POSE_LAYOUT.HUD_RADAR_NEAREST_Z] = Number.isFinite(nearestDz) ? nearestDz : -1;

  return out;
}

/** Unpack a 186-float C-ABI `Float32Array` into a structured snapshot for inspection and tests. */
export function unpackPoseBuffer(buf) {
  const f = buf instanceof Float32Array ? buf : new Float32Array(buf);
  const traffic = [];
  for (let i = 0; i < MAX_TRAFFIC_CARS; i++) {
    const base = POSE_LAYOUT.TRAFFIC_BASE + i * TRAFFIC_STRIDE;
    if (f[base] > 0.5) {
      traffic.push({
        braking: f[base] > 1.5,
        modelIndex: Math.round(f[base + 1]),
        x: f[base + 2],
        y: f[base + 3],
        z: f[base + 4],
        yaw: f[base + 5],
        wheelSpin: f[base + 6],
        pitch: f[base + 7],
      });
    }
  }
  return {
    tick: Math.round(f[POSE_LAYOUT.TICK]),
    alpha: f[POSE_LAYOUT.ALPHA],
    windTime: f[POSE_LAYOUT.WIND_TIME],
    stageNum: Math.round(f[POSE_LAYOUT.STAGE_NUM]),
    camera: {
      eye: [f[POSE_LAYOUT.CAM_EYE_X], f[POSE_LAYOUT.CAM_EYE_Y], f[POSE_LAYOUT.CAM_EYE_Z]],
      target: [f[POSE_LAYOUT.CAM_TARGET_X], f[POSE_LAYOUT.CAM_TARGET_Y], f[POSE_LAYOUT.CAM_TARGET_Z]],
      fov: f[POSE_LAYOUT.CAM_FOV],
      aspect: f[POSE_LAYOUT.CAM_ASPECT],
    },
    atmosphere: {
      stageHaze: f[POSE_LAYOUT.STAGE_HAZE],
      hazeDensity: f[POSE_LAYOUT.HAZE_DENSITY],
      sunHaze: [f[POSE_LAYOUT.SUN_HAZE_R], f[POSE_LAYOUT.SUN_HAZE_G], f[POSE_LAYOUT.SUN_HAZE_B]],
      speedBlur: f[POSE_LAYOUT.SPEED_BLUR],
      godRayIntensity: f[POSE_LAYOUT.GOD_RAY_INTENSITY],
      exposure: f[POSE_LAYOUT.EXPOSURE],
    },
    hero: {
      position: [f[POSE_LAYOUT.HERO_X], f[POSE_LAYOUT.HERO_Y], f[POSE_LAYOUT.HERO_Z]],
      yaw: f[POSE_LAYOUT.HERO_YAW],
      pitch: f[POSE_LAYOUT.HERO_PITCH],
      roll: f[POSE_LAYOUT.HERO_ROLL],
      bodyPitch: f[POSE_LAYOUT.HERO_BODY_PITCH],
      bodyRoll: f[POSE_LAYOUT.HERO_BODY_ROLL],
      bodyPivotY: f[POSE_LAYOUT.HERO_BODY_PIVOT_Y],
      stretch: f[POSE_LAYOUT.HERO_STRETCH],
      wheelSteer: f[POSE_LAYOUT.HERO_WHEEL_STEER],
      wheelSpin: f[POSE_LAYOUT.HERO_WHEEL_SPIN],
      driftDir: f[POSE_LAYOUT.HERO_DRIFT_DIR],
      driftIntensity: f[POSE_LAYOUT.HERO_DRIFT_INTENSITY],
      nitroFlame: f[POSE_LAYOUT.HERO_NITRO_FLAME],
      headlightsOn: f[POSE_LAYOUT.HERO_HEADLIGHTS_ON] > 0.5,
    },
    riders: {
      passengerArm: f[POSE_LAYOUT.RIDER_PASSENGER_ARM],
      passengerHeadYaw: f[POSE_LAYOUT.RIDER_PASSENGER_HEAD_YAW],
      girlArmRaise: f[POSE_LAYOUT.RIDER_GIRL_ARM_RAISE],
      girlArmOut: f[POSE_LAYOUT.RIDER_GIRL_ARM_OUT],
      girlArmSwing: f[POSE_LAYOUT.RIDER_GIRL_ARM_SWING],
      girlWaving: f[POSE_LAYOUT.RIDER_GIRL_WAVING] > 0.5,
    },
    rival: {
      active: f[POSE_LAYOUT.RIVAL_ACTIVE] > 0.5,
      position: [f[POSE_LAYOUT.RIVAL_X], f[POSE_LAYOUT.RIVAL_Y], f[POSE_LAYOUT.RIVAL_Z]],
      yaw: f[POSE_LAYOUT.RIVAL_YAW],
      pitch: f[POSE_LAYOUT.RIVAL_PITCH],
      wheelSpin: f[POSE_LAYOUT.RIVAL_WHEEL_SPIN],
      speed: f[POSE_LAYOUT.RIVAL_SPEED],
      beaten: f[POSE_LAYOUT.RIVAL_BEATEN] > 0.5,
    },
    marshal: {
      arm: f[POSE_LAYOUT.MARSHAL_ARM],
      flag: f[POSE_LAYOUT.MARSHAL_FLAG],
      position: [f[POSE_LAYOUT.MARSHAL_X], f[POSE_LAYOUT.MARSHAL_Y], f[POSE_LAYOUT.MARSHAL_Z]],
      yaw: f[POSE_LAYOUT.MARSHAL_YAW],
    },
    moments: {
      haze: f[POSE_LAYOUT.MOMENT_HAZE],
      swoopStage: Math.round(f[POSE_LAYOUT.MOMENT_SWOOP_STAGE]),
      countdown: decodeCountdownCode(f[POSE_LAYOUT.MOMENT_COUNTDOWN_CODE]),
      clearStage: Math.round(f[POSE_LAYOUT.MOMENT_CLEAR_STAGE]),
      clearBeaten: f[POSE_LAYOUT.MOMENT_CLEAR_BEATEN] > 0.5,
      clearSkip: f[POSE_LAYOUT.MOMENT_CLEAR_SKIP] > 0.5,
      endingCleared: f[POSE_LAYOUT.MOMENT_ENDING_CLEARED] > 0.5,
      replayActive: f[POSE_LAYOUT.MOMENT_REPLAY_ACTIVE] > 0.5,
      replayTripAlpha: f[POSE_LAYOUT.MOMENT_REPLAY_TRIP_ALPHA],
      replayStageAlpha: f[POSE_LAYOUT.MOMENT_REPLAY_STAGE_ALPHA],
    },
    hud: {
      speedKmh: Math.round(f[POSE_LAYOUT.HUD_SPEED_KMH]),
      rpm: Math.round(f[POSE_LAYOUT.HUD_RPM]),
      tachoRatio: f[POSE_LAYOUT.HUD_TACHO_RATIO],
      gear: Math.round(f[POSE_LAYOUT.HUD_GEAR]),
      nitroAmount: f[POSE_LAYOUT.HUD_NITRO_AMOUNT],
      nitroActive: f[POSE_LAYOUT.HUD_NITRO_ACTIVE] > 0.5,
      timerSec: Math.round(f[POSE_LAYOUT.HUD_TIMER_SEC]),
      timerDec: Math.round(f[POSE_LAYOUT.HUD_TIMER_DEC]),
      score: Math.round(f[POSE_LAYOUT.HUD_SCORE]),
      driftScore: Math.round(f[POSE_LAYOUT.HUD_DRIFT_SCORE]),
      gForceLat: f[POSE_LAYOUT.HUD_GFORCE_LAT],
      slipstream: f[POSE_LAYOUT.HUD_SLIPSTREAM] > 0.5,
      rivalGapMetres: f[POSE_LAYOUT.HUD_RIVAL_GAP_METRES],
      forkDistMetres: f[POSE_LAYOUT.HUD_FORK_DIST_METRES],
      routeProgress: f[POSE_LAYOUT.HUD_ROUTE_PROGRESS],
      radarNearestZ: f[POSE_LAYOUT.HUD_RADAR_NEAREST_Z],
      eq: [
        f[POSE_LAYOUT.HUD_EQ_0],
        f[POSE_LAYOUT.HUD_EQ_1],
        f[POSE_LAYOUT.HUD_EQ_2],
        f[POSE_LAYOUT.HUD_EQ_3],
        f[POSE_LAYOUT.HUD_EQ_4],
        f[POSE_LAYOUT.HUD_EQ_5],
      ],
    },
    traffic,
  };
}
