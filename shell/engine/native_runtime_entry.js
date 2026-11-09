// Native JavaScriptCore / QuickJS runtime entry point for Apex OutRun.
// Runs the unmodified 60 Hz `apexrunEngine` simulation (`simulation.js`), packs
// the 186-float C-ABI `PoseBuffer` (`pose_buffer.js`) every tick, and builds
// deterministic stage `.glb` bundles (`stage_gltf.js`) on stage transitions.

import {
  apexrunEngine,
  COUNTDOWN_TICKS,
  decodeCommand,
  decodeInputs,
  KMH_TO_UNITS_PER_TICK,
  OUTRUN_STAGES,
  viewForSeat,
} from './simulation.js';
import { packPoseBuffer, POSE_BUFFER_FLOATS } from './pose_buffer.js';
import { buildStageGltf } from './stage_gltf.js';

const poseArray = new Float32Array(POSE_BUFFER_FLOATS);
let currentState = apexrunEngine.initState(0x1337, {
  stageId: 'coconut-beach',
  stageState: 'title',
});

/**
 * Decode native bitmask inputs using `simulation.js`'s canonical `decodeCommand`
 * and `decodeInputs` so solo and GGRS duel streams produce identical commands on
 * Web and Native.
 *
 * `gearMode`: 0 = unchanged, 1 = low (`bytes[1] = 2`), 2 = high (`bytes[1] = 1`).
 */
export function decodeNativeStepInputs(maskSeat0, maskSeat1, gearMode = 0, isDuel = false) {
  const m0 = maskSeat0 | 0;
  const m1 = maskSeat1 | 0;
  const gearByte = gearMode === 2 ? 1 : gearMode === 1 ? 2 : 0;
  const cmd0 = decodeCommand(Uint8Array.of(m0 & 0x7f, gearByte));
  if (!isDuel) {
    return cmd0;
  }
  const [s0, s1] = decodeInputs(Uint8Array.of(m0 & 0x3f, m1 & 0x3f), [false, false]);
  const inputs = [{ ...s0, gear: cmd0.gear }, s1];
  inputs.enter = cmd0.enter;
  return inputs;
}

globalThis.__apexrunPoseArray = poseArray;
globalThis.__apexrunStageGlb = new Uint8Array(0);

globalThis.__apexrunNative = {
  init(seed = 0x1337, isDuel = false, stageState = 'title') {
    currentState = apexrunEngine.initState(seed >>> 0, {
      stageId: 'coconut-beach',
      duel: !!isDuel,
      stageState,
    });
    const view = currentState.duel ? viewForSeat(currentState, 0) : currentState;
    packPoseBuffer(view, { target: poseArray, aspect: 16 / 9 });
    return JSON.stringify({
      stageId: currentState.stageId,
      trackName: currentState.trackName,
      stageState: currentState.stageState,
      stageNum: currentState.stageNum || 1,
    });
  },

  initStage(seed = 0x1337, stageId = 'coconut-beach', stageState = 'racing', playerZ = 0, playerSpeed = 0) {
    currentState = apexrunEngine.initState(seed >>> 0, {
      stageId,
      stageState,
      ...(playerZ > 0 ? { playerZ } : {}),
      ...(playerSpeed > 0 ? { playerSpeed } : {}),
    });
    const view = currentState.duel ? viewForSeat(currentState, 0) : currentState;
    packPoseBuffer(view, { target: poseArray, aspect: 16 / 9 });
    return currentState.stageId;
  },

  buildStageGlb(stageId = 'coconut-beach') {
    const res = buildStageGltf(stageId, { textureSize: 8 });
    globalThis.__apexrunStageGlb = res.glb;
    return res.glb.byteLength;
  },

  step(maskSeat0, maskSeat1, gearMode, aspect, eq0, eq1, eq2, eq3, eq4, eq5) {
    const inputs = decodeNativeStepInputs(maskSeat0, maskSeat1, gearMode, !!currentState.duel);

    currentState = apexrunEngine.advanceFrame(currentState, inputs);
    const view = currentState.duel ? viewForSeat(currentState, 0) : currentState;
    packPoseBuffer(view, {
      target: poseArray,
      aspect: aspect || 16 / 9,
      eqLevels: [eq0 || 0, eq1 || 0, eq2 || 0, eq3 || 0, eq4 || 0, eq5 || 0],
    });

    const player = view.karts?.find((k) => k.isPlayer) ?? view.karts?.[0];
    const offRoad = player ? Math.abs(player.x || 0) > 1.02 : false;
    const onCurb = player ? Math.abs(player.x || 0) > 0.88 && Math.abs(player.x || 0) <= 1.05 : false;
    const events = Array.isArray(currentState.events)
      ? currentState.events.map((e) => e.type).join(',')
      : '';
    const fork = OUTRUN_STAGES[currentState.stageId]?.fork;
    const leftLabel = fork?.leftLabel ?? 'DESTINATION';
    const rightLabel = fork?.rightLabel ?? 'DESTINATION';

    // Exact hud.js rival gap text & traffic radar text
    const rival = view.karts?.find((k) => k.id === view.rival?.kartId);
    let rivalGapText = 'Rival in pursuit';
    if (view.duel && player) {
      const them = view.karts.find((k) => !k.isPlayer);
      if (them) {
        const gap = them.z - player.z;
        const pace = Math.max(gap > 0 ? them.speed : player.speed, 30) * KMH_TO_UNITS_PER_TICK * 60;
        rivalGapText = `Opponent is ${(Math.abs(gap) / pace).toFixed(1)} s ${gap > 0 ? 'ahead' : 'behind'}`;
      }
    } else if (rival && view.rival?.beaten) {
      rivalGapText = `${rival.name} beaten`;
    } else if (rival && view.rival?.escaped) {
      rivalGapText = `${rival.name} reached the checkpoint`;
    } else if (rival && player) {
      const gap = Math.max(0, rival.z - player.z);
      const pace = Math.max(rival.speed, 30) * KMH_TO_UNITS_PER_TICK * 60;
      rivalGapText = `${rival.name} is ${(gap / pace).toFixed(1)} s ahead`;
    }

    const trkLen = view.trackLength || 5000;
    const pz = (player?.z || 0) % trkLen;
    const ahead = (view.traffic || []).filter((t) => {
      const dz = (t.z % trkLen) - pz;
      return dz > 0 && dz < 450;
    });
    let radarText = 'CLEAR AHEAD';
    if (ahead.length > 0) {
      const nearest = ahead.reduce((a, b) => ((b.z % trkLen) < (a.z % trkLen) ? b : a));
      radarText = `${nearest.type.toUpperCase()} (${Math.round(((nearest.z % trkLen) - pz) * 0.1)}M)`;
    }

    return `${currentState.stageState}|${currentState.stageId}|${currentState.trackName}|${offRoad ? 1 : 0}|${onCurb ? 1 : 0}|${events}|${leftLabel}|${rightLabel}|${rivalGapText}|${radarText}`;
  },
};
