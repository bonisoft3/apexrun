// Unit tests for Slice 2: deterministic stage glTF 2.0 (.glb) builder (`stage_gltf.js`)
// and C-ABI pose + moments buffer (`pose_buffer.js`) verified against `renderer.js`.

import { apexrunEngine, decodeInputs, encodeCommand, encodeInput } from '../shell/engine/simulation.js';
import { STAGE_ART } from '../shell/engine/art.js';
import {
  DRY_TERRAIN_OFFSETS,
  PROP_FOOTPRINT,
  PROP_RADIUS,
  WET_TERRAIN_OFFSETS,
  terrainHeightAt,
} from '../shell/engine/stage_look.js';
import { decodeNativeStepInputs } from '../shell/engine/native_runtime_entry.js';
import {
  MATERIAL_LIFT,
  MATERIAL_TINTS,
  SURFACE_OVERLAYS,
  brushed,
  grainOf,
  marshalPose,
  stageHaze,
  toonable,
} from '../shell/engine/renderer.js';
import {
  SCATTER_CHUNK,
  SWAYING,
  buildStageCenterline,
  buildStageGltf,
  materialStkExtras,
  parseGlb,
} from '../shell/engine/stage_gltf.js';
import {
  BODY_PIVOT_Y,
  POSE_BUFFER_BYTES,
  POSE_BUFFER_FLOATS,
  POSE_LAYOUT,
  packPoseBuffer,
  unpackPoseBuffer,
} from '../shell/engine/pose_buffer.js';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEquals<T>(actual: T, expected: T, msg = ''): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg ? msg + ': ' : ''}Expected ${b}, got ${a}`);
}

Deno.test('stage_gltf: deterministic binary .glb output and valid round-trip across stages', () => {
  const first = buildStageGltf('coconut-beach', { textureSize: 8 });
  const second = buildStageGltf('coconut-beach', { textureSize: 8 });

  assertEquals(first.glb.byteLength, second.glb.byteLength, 'GLB byte length must be deterministic');
  for (let i = 0; i < first.glb.byteLength; i++) {
    if (first.glb[i] !== second.glb[i]) {
      throw new Error(`GLB bytes differ at offset ${i}`);
    }
  }

  const parsed = parseGlb(first.glb);
  assertEquals(parsed.version, 2, 'GLB version must be 2');
  assertEquals(parsed.gltf.asset.version, '2.0');
  assertEquals(parsed.gltf.extensionsUsed, ['EXT_mesh_gpu_instancing']);

  const sceneStk = parsed.gltf.scenes[0].extras.stk;
  assertEquals(sceneStk.stageId, 'coconut-beach');
  assertEquals(sceneStk.scatterChunkSegments, SCATTER_CHUNK);
  assertEquals(sceneStk.skyKtx2, `sky/${STAGE_ART['coconut-beach'].sky}.ktx2`);
  assertEquals(sceneStk.shoreSide, -1);

  const nodeNames = parsed.gltf.nodes.map((n: { name: string }) => n.name);
  for (const required of ['bRoad', 'bRumbleL', 'bRumbleR', 'bForkRoadL', 'bForkRoadR', 'bForkDivider', 'bPromenade', 'bSeaWall', 'bWater']) {
    assert(nodeNames.includes(required), `Missing stage ribbon node: ${required}`);
  }

  // Verify EXT_mesh_gpu_instancing chunk nodes are chunked by SCATTER_CHUNK = 25 segments
  const chunkNodes = parsed.gltf.nodes.filter((n: { extensions?: { EXT_mesh_gpu_instancing?: unknown } }) =>
    Boolean(n.extensions?.EXT_mesh_gpu_instancing)
  );
  assert(chunkNodes.length > 0, 'Stage must contain EXT_mesh_gpu_instancing chunk nodes');
  for (const cn of chunkNodes) {
    const ext = cn.extensions.EXT_mesh_gpu_instancing.attributes;
    assert(typeof ext.TRANSLATION === 'number', 'Missing TRANSLATION accessor');
    assert(typeof ext.ROTATION === 'number', 'Missing ROTATION accessor');
    assert(typeof ext.SCALE === 'number', 'Missing SCALE accessor');
    const transAcc = parsed.gltf.accessors[ext.TRANSLATION];
    const rotAcc = parsed.gltf.accessors[ext.ROTATION];
    const scaleAcc = parsed.gltf.accessors[ext.SCALE];
    assertEquals(transAcc.type, 'VEC3');
    assertEquals(rotAcc.type, 'VEC4');
    assertEquals(scaleAcc.type, 'VEC3');
    assertEquals(transAcc.count, cn.extras.instanceCount);
    const meshDef = parsed.gltf.meshes[cn.mesh];
    assert(
      meshDef.name.startsWith('model/') || meshDef.name.startsWith('scatter/'),
      `Chunk mesh must reference model/<id>/lod0 or scatter/<kind>, got ${meshDef.name}`,
    );
    const bv = parsed.gltf.bufferViews[transAcc.bufferView];
    const byteOffset = (bv.byteOffset || 0) + (transAcc.byteOffset || 0);
    const transFloats = new Float32Array(
      parsed.bin.buffer,
      parsed.bin.byteOffset + byteOffset,
      transAcc.count * 3,
    );
    for (let k = 0; k < transAcc.count; k++) {
      const wz = transFloats[k * 3 + 2];
      assert(
        wz >= cn.extras.zMin - 1e-3 && wz <= cn.extras.zMax + 1e-3,
        `Instance z=${wz} outside chunk [${cn.extras.zMin}, ${cn.extras.zMax}] in ${cn.name}`,
      );
    }
  }

  // Also verify destination set-piece instances on a goal stage (`destination-marina`) stay inside chunk bounds
  const goalParsed = parseGlb(buildStageGltf('destination-marina', { textureSize: 8 }).glb);
  for (const cn of goalParsed.gltf.nodes.filter((n: { extensions?: { EXT_mesh_gpu_instancing?: unknown } }) =>
    Boolean(n.extensions?.EXT_mesh_gpu_instancing)
  )) {
    const transAcc = goalParsed.gltf.accessors[cn.extensions.EXT_mesh_gpu_instancing.attributes.TRANSLATION];
    const bv = goalParsed.gltf.bufferViews[transAcc.bufferView];
    const transFloats = new Float32Array(
      goalParsed.bin.buffer,
      goalParsed.bin.byteOffset + (bv.byteOffset || 0) + (transAcc.byteOffset || 0),
      transAcc.count * 3,
    );
    for (let k = 0; k < transAcc.count; k++) {
      const wz = transFloats[k * 3 + 2];
      assert(
        wz >= cn.extras.zMin - 1e-3 && wz <= cn.extras.zMax + 1e-3,
        `Goal instance z=${wz} outside chunk [${cn.extras.zMin}, ${cn.extras.zMax}] in ${cn.name}`,
      );
    }
  }
});

Deno.test('stage_gltf: embeds flowerCarpet texture as valid PNG when stage art declares carpet', () => {
  const tulip = buildStageGltf('tulip-gardens', { textureSize: 8 });
  const parsed = parseGlb(tulip.glb);
  const imgNames = parsed.gltf.images.map((img: { name: string }) => img.name);
  assert(imgNames.includes('frondTexture'), 'Missing frondTexture');
  assert(imgNames.includes('waveNormals'), 'Missing waveNormals');
  assert(imgNames.includes('brushStrokes'), 'Missing brushStrokes');
  assert(imgNames.includes('flowerCarpet'), 'tulip-gardens must embed flowerCarpet texture');
  for (const img of parsed.gltf.images) {
    assertEquals(img.mimeType, 'image/png');
    const bv = parsed.gltf.bufferViews[img.bufferView];
    const bytes = parsed.bin.subarray(bv.byteOffset, bv.byteOffset + 8);
    assertEquals(Array.from(bytes), [137, 80, 78, 71, 13, 10, 26, 10], 'Image bufferView must start with PNG magic');
  }
});

Deno.test('stage_gltf: material.extras.stk matches renderer.js rules exactly', () => {
  const roadStk = materialStkExtras('bRoadMat');
  assertEquals(roadStk.toon, toonable('bRoadMat'));
  assertEquals(roadStk.brushed, brushed('bRoadMat'));
  assertEquals(roadStk.grain, grainOf('bRoadMat'));

  const groundStk = materialStkExtras('bGroundMat');
  assertEquals(groundStk.brushed, false);
  assertEquals(groundStk.grain, 'patch');

  const frondStk = materialStkExtras('palm#frond', { modelKey: 'palm' });
  assertEquals(frondStk.sway, SWAYING.has('frond'));
  assertEquals(frondStk.grain, 'leaves');
  assertEquals(frondStk.brushed, true);

  const cactusStk = materialStkExtras('prop#cactus');
  assertEquals(cactusStk.tint, MATERIAL_TINTS.cactus);

  const cypressStk = materialStkExtras('cypress#foliage', { modelKey: 'cypress' });
  assertEquals(cypressStk.lift, MATERIAL_LIFT['cypress/foliage']);

  const ironStk = materialStkExtras('castle-tower#iron', { modelKey: 'castle-tower' });
  assertEquals(ironStk.depthOffset, SURFACE_OVERLAYS['castle-tower/iron']);

  const carLacquerStk = materialStkExtras('kart_hero_paint');
  assertEquals(carLacquerStk.toon, false);
  assertEquals(carLacquerStk.brushed, false);
});

Deno.test('pose_buffer: C-ABI Float32Array layout packs camera, hero, marshal, moments, traffic, and fast HUD', () => {
  assertEquals(POSE_BUFFER_FLOATS, 186);
  assertEquals(POSE_BUFFER_BYTES, 744);

  let state = apexrunEngine.initState(0x1337, { stageId: 'coconut-beach' });
  const eq = [0.2, 0.4, 0.6, 0.8, 0.5, 0.3];

  // Warmup / countdown state
  const warmupBuf = packPoseBuffer(state, { alpha: 0.5, eqLevels: eq });
  const warmup = unpackPoseBuffer(warmupBuf);
  assertEquals(warmup.stageNum, 1);
  assertEquals(warmup.hero.bodyPivotY, Math.fround(BODY_PIVOT_Y));
  assertEquals(warmup.marshal.arm, Math.fround(marshalPose(state).arm));

  // Step into active racing
  for (let i = 0; i < 480; i++) {
    state = apexrunEngine.advanceFrame(state, { enter: i === 0, up: true, left: i % 40 < 20, nitro: i > 400 });
  }

  const raceBuf = packPoseBuffer(state, { alpha: 1.0, eqLevels: eq });
  const race = unpackPoseBuffer(raceBuf);

  assert(race.hud.speedKmh > 50, `Expected racing speed > 50 km/h, got ${race.hud.speedKmh}`);
  assert(race.hero.position[2] > 10, 'Hero Z position must advance along stage centreline');
  assertEquals(race.atmosphere.stageHaze, Math.fround(stageHaze(state, state.karts[0].z * 0.06)));
  assertEquals(race.hud.eq.map((v: number) => Number(v.toFixed(2))), eq);
  assert(race.rival.active, 'Rival car must be active in solo run');
  assert(race.traffic.length > 0 && race.traffic.length <= 12, 'Traffic slice must be populated and bounded to 12');

  // Verify replay cut moments packing
  const replayBuf = packPoseBuffer(state, {
    cut: { index: 0, count: 4, from: state.tick - 60, to: state.tick + 120 },
  });
  const replay = unpackPoseBuffer(replayBuf);
  assertEquals(replay.moments.replayActive, true);
  assert(replay.moments.replayTripAlpha > 0, 'Replay cut 0 must show trip title alpha > 0');

  // Verify fail-loud error handling on invalid state
  let threwStage = false;
  try {
    packPoseBuffer({ stageId: 'non-existent-stage', karts: state.karts, timeRemaining: 60 });
  } catch {
    threwStage = true;
  }
  assert(threwStage, 'packPoseBuffer must throw on unknown stageId');
});

Deno.test('native_runtime_entry: decodeNativeStepInputs matches Web decodeCommand and decodeInputs bit-for-bit', () => {
  let webDuel = apexrunEngine.initState(0x7777, { stageId: 'coconut-beach', duel: true });
  let nativeDuel = apexrunEngine.initState(0x7777, { stageId: 'coconut-beach', duel: true });

  for (let tick = 0; tick < 120; tick++) {
    const s0Cmd = {
      up: tick > 10,
      down: false,
      left: tick % 15 < 5,
      right: tick % 15 >= 10,
      drift: tick > 40 && tick < 70,
      nitro: tick === 80,
      enter: tick === 0,
      gear: tick > 60 ? 'high' : 'low',
    };
    // Seat 1 tests idle (no direction bits) + nitro/drift combinations
    const s1Cmd = {
      up: tick > 30 && tick < 90,
      down: false,
      left: false,
      right: tick % 20 < 8,
      drift: tick === 25 || tick === 55,
      nitro: tick === 20 || tick === 85,
    };

    const mask0 = encodeCommand(s0Cmd)[0];
    const mask1 = encodeInput(s1Cmd);
    const gearMode = s0Cmd.gear === 'high' ? 2 : 1;

    const [w0, w1] = decodeInputs(Uint8Array.of(mask0 & 0x3f, mask1 & 0x3f), [false, false]);
    const webInputs = Object.assign([{ ...w0, gear: s0Cmd.gear }, w1], { enter: s0Cmd.enter });

    const nativeInputs = decodeNativeStepInputs(mask0, mask1, gearMode, true);

    webDuel = apexrunEngine.advanceFrame(webDuel, webInputs);
    nativeDuel = apexrunEngine.advanceFrame(nativeDuel, nativeInputs);
  }

  assertEquals(
    apexrunEngine.saveState(nativeDuel),
    apexrunEngine.saveState(webDuel),
    'Native and Web duel simulation state must match bit-for-bit',
  );
  assert(!('shrub' in PROP_RADIUS), 'shrub is non-collidable ground foliage');
  assert(!('shrub' in PROP_FOOTPRINT), 'shrub uses direct groundY + 0.06m sink');
});

Deno.test('stage_gltf & stage_look: 20-band 3D terrain topography, smooth normals, and cloudCards', () => {
  assertEquals(DRY_TERRAIN_OFFSETS.length, 20, 'Dry terrain must have 20 lateral bands out to 1400m');
  assertEquals(WET_TERRAIN_OFFSETS.length, 6, 'Wet coastal terrain must have 6 lateral bands');

  const p = { x: 0, y: 0, z: 180 };
  assertEquals(terrainHeightAt('alpine-peaks', p, 0, -2.2, 1, 0, false), -0.05, 'Verge shoulder at offset 0 must sit at roadShoulderY (-0.05)');
  const alpinePeak = terrainHeightAt('alpine-peaks', p, 0, -2.2, 1, 160, false);
  const canyonMesa = terrainHeightAt('desert-canyons', { x: 0, y: 0, z: 120 }, 0, -2.2, -1, 160, false);
  assert(Math.abs(alpinePeak) > 2, `Alpine peaks at 160m should have 3D relief, got ${alpinePeak}`);
  assert(Math.abs(canyonMesa) > 1, `Desert canyons at 160m should have 3D relief, got ${canyonMesa}`);

  // Wet-side beach dune, foreshore, and water plane boundary continuity
  assertEquals(terrainHeightAt('coconut-beach', p, 0, -2.2, -1, 0, true), -0.05);
  assertEquals(terrainHeightAt('coconut-beach', p, 0, -2.2, -1, 5.5, true), -0.05);
  const wetDuneCrest = terrainHeightAt('coconut-beach', p, 0, -2.2, -1, 10.75, true);
  assert(wetDuneCrest > -0.05, `Wet beach dune crest at 10.75m should rise above shoulder, got ${wetDuneCrest}`);
  assert(
    Math.abs(terrainHeightAt('coconut-beach', p, 0, -2.2, -1, 16, true) - -0.05) < 1e-6,
    'Wet dune foot at 16m must return to roadShoulderY (-0.05)',
  );
  assertEquals(terrainHeightAt('coconut-beach', p, 0, -2.2, -1, 30, true), -2.2);
  assertEquals(terrainHeightAt('coconut-beach', p, 0, -2.2, -1, 50, true), -2.2);

  // Destination stage end-fade flattens relief at road end so destination landmarks sit flush
  const zEnd = 2400;
  const destBeforeFade = terrainHeightAt('destination-castle', { x: 0, y: 0, z: zEnd - 150 }, 0, -2.2, 1, 120, false, zEnd);
  const destAtEnd = terrainHeightAt('destination-castle', { x: 0, y: 0, z: zEnd - 10 }, 0, -2.2, 1, 120, false, zEnd);
  assert(Math.abs(destBeforeFade) > 0.5, `Destination terrain 150m before end should carry relief, got ${destBeforeFade}`);
  assertEquals(destAtEnd, 0, 'Destination terrain within 15m of zEnd must flatten to macroY (0)');

  const { glb } = buildStageGltf('coconut-beach', { segmentLimit: 30, textureSize: 8 });
  const { gltf: json, bin } = parseGlb(glb);
  const stk = json.scenes[0].extras.stk;
  assert(Array.isArray(stk.cloudCards) && stk.cloudCards.length === 14, 'Sunlit stage must include 14 3D cumulus cloudCards across 3 banks');

  const glbCloudMat = json.materials.find((m: { name: string }) => m.name === 'bCloudMat');
  assertEquals(glbCloudMat?.extras?.stk?.cloud, true, 'Exported bCloudMat material in GLB must have cloud: true');

  const nightStage = parseGlb(buildStageGltf('metropolis-night', { segmentLimit: 10, textureSize: 8 }).glb);
  assertEquals(nightStage.gltf.scenes[0].extras.stk.cloudCards.length, 0, 'Night stage must omit cumulus cloudCards');

  const terrainNode = json.nodes.find((n: { name: string }) => n.name === 'bTerrainR');
  assert(terrainNode, 'bTerrainR node must exist');
  const prim = json.meshes[terrainNode.mesh].primitives[0];
  const normAcc = json.accessors[prim.attributes.NORMAL];
  const normBv = json.bufferViews[normAcc.bufferView];
  const normals = new Float32Array(bin.buffer, bin.byteOffset + normBv.byteOffset, normAcc.count * 3);
  let nonVerticalNormals = 0;
  for (let i = 0; i < normAcc.count; i++) {
    const nx = normals[i * 3];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];
    const len = Math.hypot(nx, ny, nz);
    assert(Math.abs(len - 1.0) < 1e-3, `Terrain normal must be unit length, got ${len}`);
    if (Math.abs(nx) > 0.02 || Math.abs(nz) > 0.02) nonVerticalNormals++;
  }
  assert(nonVerticalNormals > normAcc.count * 0.25, 'Sculpted 3D terrain must have sloped 3D normals');
});
