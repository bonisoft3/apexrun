// Pure deterministic stage glTF 2.0 (.glb) builder for native 3D presenters
// (Desktop Bevy wgpu & Phone Filament Vulkan/Metal).
//
// Translates any stage in OUTRUN_STAGES into a self-contained glTF 2.0 scene:
//   - Road, rumble, fork, sea-wall/promenade, terrain, and water ribbons
//   - Roadside props (placeProps) and verge scatter (scatterVerge) chunked by
//     SCATTER_CHUNK = 25 road segments via Khronos EXT_mesh_gpu_instancing
//   - Material extras (`material.extras.stk`) matching renderer.js's toon,
//     gouache brushwork, leaf masses, wind sway, tints, lifts, and depth offsets
//   - Embedded RGBA procedural textures (frondTexture, waveNormals, brushStrokes,
//     flowerCarpet) and .ktx2 prefiltered IBL sky descriptor.

import { ARCH_LEAD, LATERAL_UNITS, METRES_PER_UNIT, OUTRUN_STAGES } from './simulation.js';
import {
  DRY_TERRAIN_OFFSETS,
  PROP_FOOTPRINT,
  SHORE,
  STAGE_LOOKS,
  WATER_OFFSETS,
  WET_TERRAIN_OFFSETS,
  placeProps,
  terrainHeightAt,
} from './stage_look.js';
import { VERGE_SCATTER, scatterVerge } from './scatter.js';
import { NIGHT_STAGES, brushStrokes, flowerCarpet, frondTexture, waveNormals } from './scenery.js';
import {
  BACKDROP_LAYERS,
  LOD_FAR,
  LOD_SIZE,
  LOD_SPLITS,
  MODEL_TURN,
  ROAD_ALBEDO,
  STAGE_ART,
  modelScales,
} from './art.js';
import MANIFEST from '../../assets/manifest.json' with { type: 'json' };
import {
  CLOUD_BANKS,
  CLOUD_KINDS,
  GRADE,
  LEAD_IN_METRES,
  LEAD_OUT_METRES,
  MATERIAL_LIFT,
  MATERIAL_TINTS,
  PROMENADE,
  SEA_WALL,
  STYLE,
  SURFACE_OVERLAYS,
  brushed,
  buildStageLandmarks,
  cloudLook,
  grainOf,
  promenadeBed,
  runOnMetres,
  toonable,
} from './renderer.js';
import {
  BinaryCollector,
  buildRibbonPrimitive,
  hexToRgba,
  packGlb,
  parseGlb,
  yawToQuat,
} from '/omnishell/interpreter/gltf.js';

export { packGlb, parseGlb };

export const SCATTER_CHUNK = 25;
export const SCATTER_BEHIND = 30;
export const SCATTER_AHEAD = 360;
export const SWAYING = new Set(['frond', 'frond_dry', 'grass', 'leaf']);

function getCurve(stage, segIdx) {
  for (const c of stage.curves) {
    if (segIdx >= c.start && segIdx < c.start + c.length) return c.curve;
  }
  return 0;
}

function getPitch(stage, segIdx) {
  for (const c of stage.curves) {
    if (segIdx >= c.start && segIdx < c.start + c.length) return c.pitch;
  }
  return 0;
}

/** Deterministic stage centreline, right vectors, headings, and fork divergence matching renderer.js. */
export function buildStageCenterline(stageId) {
  const stage = OUTRUN_STAGES[stageId];
  if (!stage) throw new Error(`stage_gltf: unknown stage ${stageId}`);

  const segLen = stage.segmentLength * METRES_PER_UNIT;
  const rumbleW = LATERAL_UNITS;
  const halfW = rumbleW * 0.94;

  const pts = [];
  let x = 0;
  let dx = 0;
  let y = 0;
  let dy = 0;

  for (let i = 0; i < stage.segmentCount; i++) {
    const z = i * segLen;
    const c = getCurve(stage, i);
    dx += (c * segLen / 10 - dx) * 0.08;
    x += dx;

    const p = getPitch(stage, i);
    dy += (p * segLen / 75 - dy) * 0.08;
    y += dy;

    pts.push({ x, y, z });
  }

  const rights = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)];
    const c = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(c.x - a.x, c.z - a.z) || 1;
    return { x: (c.z - a.z) / len, y: 0, z: -(c.x - a.x) / len };
  });

  const headings = rights.map((r) => Math.atan2(-r.z, r.x));
  const forkStart = stage.fork ? stage.fork.forkSegment : pts.length;
  const forkLength = Math.max(1, pts.length - forkStart - 1);
  const forkDiverge = pts.map((_, i) =>
    i < forkStart ? 0 : ((i - forkStart) / forkLength) ** 2 * halfW * 2.0
  );

  // Lead-in straight behind start line (-400m) and lead-out straight past finish
  const run = Math.hypot(pts[1].x - pts[0].x, pts[1].z - pts[0].z) || 1;
  const back = { x: (pts[0].x - pts[1].x) / run, z: (pts[0].z - pts[1].z) / run };
  const leadSegs = Math.ceil(LEAD_IN_METRES / segLen);
  const leadPts = [];
  for (let k = leadSegs; k > 0; k--) {
    leadPts.push({ x: pts[0].x + back.x * k * segLen, y: pts[0].y, z: pts[0].z + back.z * k * segLen });
  }
  leadPts.push(pts[0]);
  const leadRights = leadPts.map(() => rights[0]);

  const last = pts.length - 1;
  const endRun = Math.hypot(pts[last].x - pts[last - 1].x, pts[last].z - pts[last - 1].z) || 1;
  const endOn = { x: (pts[last].x - pts[last - 1].x) / endRun, z: (pts[last].z - pts[last - 1].z) / endRun };
  const leadOutPts = [pts[last]];
  const outSegs = Math.ceil(runOnMetres(stageId) / segLen);
  for (let k = 1; k <= outSegs; k++) {
    leadOutPts.push({ x: pts[last].x + endOn.x * k * segLen, y: pts[last].y, z: pts[last].z + endOn.z * k * segLen });
  }
  const leadOutRights = leadOutPts.map(() => rights[last]);
  const look = STAGE_LOOKS[stageId];
  const ahead = placeProps(stageId, pts.length, forkStart);
  const destination = look?.destination
    ? look.destination.map((piece) => ({
        ...piece,
        x: pts[last].x + endOn.x * piece.beyond + rights[last].x * piece.across,
        y: pts[last].y - 0.05,
        z: pts[last].z + endOn.z * piece.beyond + rights[last].z * piece.across,
        yaw: Math.atan2(-endOn.x, -endOn.z),
      }))
    : [];
  const spot = (pl) => {
    const i = Math.max(0, Math.min(pts.length - 1, pl.i));
    const p = pts[i];
    const r = rights[i];
    const d = pl.side === 0 ? 0 : rumbleW + (forkDiverge[i] || 0) + pl.offset;
    return {
      x: p.x + r.x * pl.side * d,
      y: p.y + (pl.yOffset || 0),
      z: p.z + r.z * pl.side * d,
    };
  };
  const landmarks = buildStageLandmarks(ahead, destination, spot, pts, forkStart);

  return {
    stage,
    segLen,
    rumbleW,
    halfW,
    pts,
    rights,
    headings,
    forkStart,
    forkDiverge,
    endOn,
    landmarks,
    leadPts,
    leadRights,
    leadOutPts,
    leadOutRights,
  };
}

/** Compute the deterministic `material.extras.stk` contract for native Bevy and Filament shaders. */
export function materialStkExtras(name, options = {}) {
  const shortKey = name.includes('#') ? name.split('#').pop() : name;
  const modelMatKey = options.modelKey ? `${options.modelKey}/${shortKey}` : name;
  const toon = toonable(name);
  const isPainted = options.painted === true;
  const isBrushed = toon && !isPainted && brushed(name);
  const isSway = SWAYING.has(shortKey);
  const depthOffset = SURFACE_OVERLAYS[modelMatKey] ?? SURFACE_OVERLAYS[name] ?? 0;
  const tint = MATERIAL_TINTS[shortKey] ?? MATERIAL_TINTS[name] ?? null;
  const lift = MATERIAL_LIFT[modelMatKey] ?? MATERIAL_LIFT[name] ?? 1.0;
  const grain = grainOf(name);

  return {
    toon,
    painted: isPainted,
    brushed: isBrushed,
    sway: isSway,
    depthOffset,
    tint,
    lift,
    grain,
    ...((options.cloud || name === 'bCloudMat') ? { cloud: true } : {}),
  };
}

function buildMultiBandRibbonPrimitive(bin, paths, materialIndex, uvScale = 0.05) {
  const m = paths.length;
  const n = paths[0]?.length ?? 0;
  const totalV = m * n;
  const positions = new Float32Array(totalV * 3);
  const normals = new Float32Array(totalV * 3);
  const uvs = new Float32Array(totalV * 2);
  const indices = new Uint32Array(Math.max(0, m - 1) * Math.max(0, n - 1) * 6);

  for (let b = 0; b < m; b++) {
    const path = paths[b];
    const pathPrev = paths[Math.max(0, b - 1)];
    const pathNext = paths[Math.min(m - 1, b + 1)];
    for (let i = 0; i < n; i++) {
      const p = path[i];
      const pPrevB = pathPrev[i];
      const pNextB = pathNext[i];
      const pPrevI = path[Math.max(0, i - 1)];
      const pNextI = path[Math.min(n - 1, i + 1)];
      const ux = pNextB.x - pPrevB.x;
      const uy = pNextB.y - pPrevB.y;
      const uz = pNextB.z - pPrevB.z;
      const vx = pNextI.x - pPrevI.x;
      const vy = pNextI.y - pPrevI.y;
      const vz = pNextI.z - pPrevI.z;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      if (ny < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const nLen = Math.hypot(nx, ny, nz) || 1;
      const v = b * n + i;
      positions[v * 3 + 0] = p.x;
      positions[v * 3 + 1] = p.y;
      positions[v * 3 + 2] = p.z;
      normals[v * 3 + 0] = nx / nLen;
      normals[v * 3 + 1] = ny / nLen;
      normals[v * 3 + 2] = nz / nLen;
      uvs[v * 2 + 0] = p.x * uvScale;
      uvs[v * 2 + 1] = p.z * uvScale;
    }
  }

  let idx = 0;
  for (let b = 0; b < m - 1; b++) {
    for (let i = 0; i < n - 1; i++) {
      const v0 = b * n + i;
      const v1 = (b + 1) * n + i;
      const v2 = b * n + (i + 1);
      const v3 = (b + 1) * n + (i + 1);
      indices[idx++] = v0;
      indices[idx++] = v2;
      indices[idx++] = v1;
      indices[idx++] = v1;
      indices[idx++] = v2;
      indices[idx++] = v3;
    }
  }

  return {
    attributes: {
      POSITION: bin.addFloatAccessor(positions, 'VEC3', totalV),
      NORMAL: bin.addFloatAccessor(normals, 'VEC3', totalV),
      TEXCOORD_0: bin.addFloatAccessor(uvs, 'VEC2', totalV),
    },
    indices: bin.addIndexAccessor(indices),
    material: materialIndex,
  };
}

function buildUnitProxyPrimitive(bin, materialIndex) {
  const positions = new Float32Array([
    -0.5, 0, -0.5,
     0.5, 0, -0.5,
     0.5, 1, -0.5,
    -0.5, 1, -0.5,
    -0.5, 0,  0.5,
     0.5, 0,  0.5,
     0.5, 1,  0.5,
    -0.5, 1,  0.5,
  ]);
  const normals = new Float32Array([
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  ]);
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
  ]);
  return {
    attributes: {
      POSITION: bin.addFloatAccessor(positions, 'VEC3', 8),
      NORMAL: bin.addFloatAccessor(normals, 'VEC3', 8),
    },
    indices: bin.addIndexAccessor(indices),
    material: materialIndex,
  };
}

/**
 * Deterministically build the stage glTF 2.0 JSON, binary buffer, and `.glb` byte stream
 * for `stageId`.
 */
export function buildStageGltf(stageId, options = {}) {
  const {
    stage,
    segLen,
    rumbleW,
    halfW,
    pts,
    rights,
    headings,
    forkStart,
    forkDiverge,
    leadPts,
    leadRights,
    leadOutPts,
    leadOutRights,
  } = buildStageCenterline(stageId);

  const art = STAGE_ART[stageId];
  const look = STAGE_LOOKS[stageId];
  const shoreSide = look?.water?.side === 'left' ? -1 : look?.water?.side === 'right' ? 1 : 0;
  const isNight = NIGHT_STAGES.has(stageId);
  const bin = new BinaryCollector();

  const materials = [];
  const matIndexByName = new Map();
  const ensureMaterial = (name, baseColor, matOptions = {}) => {
    if (matIndexByName.has(name)) return matIndexByName.get(name);
    const idx = materials.length;
    const stk = materialStkExtras(name, matOptions);
    const rgba = stk.tint ? hexToRgba(stk.tint) : baseColor;
    materials.push({
      name,
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorFactor: rgba,
        metallicFactor: matOptions.metallic ?? 0.0,
        roughnessFactor: matOptions.roughness ?? 0.9,
      },
      extras: { stk },
    });
    matIndexByName.set(name, idx);
    return idx;
  };

  const groundRgba = look?.ground ? hexToRgba(look.ground) : [0.46, 0.56, 0.36, 1.0];
  const waterRgba = look?.water?.color ? hexToRgba(look.water.color) : [0.14, 0.42, 0.62, 1.0];
  const foamRgba = look?.water?.foam ? hexToRgba(look.water.foam) : [0.92, 0.97, 0.99, 1.0];
  const roadMatIdx = ensureMaterial('bRoadMat', [ROAD_ALBEDO, ROAD_ALBEDO, ROAD_ALBEDO, 1.0], { roughness: 0.85 });
  const groundMatIdx = ensureMaterial('bGroundMat', groundRgba, { roughness: 0.95 });
  const rumbleMatIdx = ensureMaterial('bRumbleRedMat', hexToRgba('#ECEFF1'), { roughness: 0.8 });
  const waterMatIdx = ensureMaterial('bWaterMat', waterRgba, { roughness: 0.15 });
  const foamMatIdx = ensureMaterial('bFoamMat', foamRgba, { roughness: 0.35 });
  const promenadeMatIdx = ensureMaterial('bPromenadeMat', hexToRgba(PROMENADE.paving), { roughness: 0.85 });
  const seaWallMatIdx = ensureMaterial('bSeaWallMat', hexToRgba(PROMENADE.face), { roughness: 0.85 });

  // Representative pack materials used across stage props and verge foliage so native
  // shader compilers (Bevy TOON_WGSL and Filament .filamat) see every material.extras.stk flag:
  ensureMaterial('prop#cactus', hexToRgba(MATERIAL_TINTS.cactus), {});
  ensureMaterial('prop#cactus_tip', hexToRgba(MATERIAL_TINTS.cactus_tip), {});
  ensureMaterial('cypress#foliage', [0.22, 0.42, 0.24, 1.0], { modelKey: 'cypress' });
  ensureMaterial('tree-broadleaf-a#foliage', [0.26, 0.48, 0.24, 1.0], { modelKey: 'tree-broadleaf-a' });
  ensureMaterial('palm#frond', [0.24, 0.50, 0.22, 1.0], { modelKey: 'palm' });
  ensureMaterial('verge#grass', [0.30, 0.54, 0.25, 1.0], { modelKey: 'verge' });
  ensureMaterial('castle-tower#iron', [0.25, 0.26, 0.28, 1.0], { modelKey: 'castle-tower' });
  ensureMaterial('landmark#painted', [0.85, 0.78, 0.68, 1.0], { painted: true });
  ensureMaterial('bCloudMat', [0.98, 0.94, 0.86, 1.0], { cloud: true, roughness: 0.95 });
  ensureMaterial('kart_hero_paint', [0.86, 0.14, 0.14, 1.0], { metallic: 0.1, roughness: 0.18 });

  // 1. Embed procedural RGBA textures from scenery.js as valid glTF 2.0 PNG images
  const texSize = options.textureSize ?? 16;
  const images = [];
  const textures = [];
  const encodeRgbaToPng = (width, height, rgba) => {
    const rawRowLen = width * 4 + 1;
    const rawData = new Uint8Array(rawRowLen * height);
    for (let y = 0; y < height; y++) {
      const rowStart = y * rawRowLen;
      rawData[rowStart] = 0; // filter type 0 (None)
      rawData.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
    }
    // Zlib stored block (no compression, deterministic, valid RFC 1950 + RFC 1951)
    const len = rawData.byteLength;
    const zlib = new Uint8Array(2 + 5 + len + 4);
    zlib[0] = 0x78;
    zlib[1] = 0x01;
    zlib[2] = 0x01; // BFINAL=1, BTYPE=00 (stored)
    zlib[3] = len & 0xff;
    zlib[4] = (len >>> 8) & 0xff;
    const nlen = (~len) & 0xffff;
    zlib[5] = nlen & 0xff;
    zlib[6] = (nlen >>> 8) & 0xff;
    zlib.set(rawData, 7);
    let s1 = 1;
    let s2 = 0;
    for (let i = 0; i < len; i++) {
      s1 = (s1 + rawData[i]) % 65521;
      s2 = (s2 + s1) % 65521;
    }
    const adler = ((s2 << 16) | s1) >>> 0;
    const adlerOff = 7 + len;
    zlib[adlerOff] = (adler >>> 24) & 0xff;
    zlib[adlerOff + 1] = (adler >>> 16) & 0xff;
    zlib[adlerOff + 2] = (adler >>> 8) & 0xff;
    zlib[adlerOff + 3] = adler & 0xff;

    const crc32 = (bytes) => {
      let c = 0xffffffff;
      for (let i = 0; i < bytes.length; i++) {
        c ^= bytes[i];
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      return (c ^ 0xffffffff) >>> 0;
    };
    const makeChunk = (typeStr, data) => {
      const out = new Uint8Array(12 + data.length);
      const dv = new DataView(out.buffer);
      dv.setUint32(0, data.length, false);
      for (let i = 0; i < 4; i++) out[4 + i] = typeStr.charCodeAt(i);
      out.set(data, 8);
      dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
      return out;
    };
    const ihdr = new Uint8Array(13);
    const ihdrDv = new DataView(ihdr.buffer);
    ihdrDv.setUint32(0, width, false);
    ihdrDv.setUint32(4, height, false);
    ihdr[8] = 8; // bit depth 8
    ihdr[9] = 6; // RGBA
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const cIhdr = makeChunk('IHDR', ihdr);
    const cIdat = makeChunk('IDAT', zlib);
    const cIend = makeChunk('IEND', new Uint8Array(0));
    const png = new Uint8Array(sig.length + cIhdr.length + cIdat.length + cIend.length);
    png.set(sig, 0);
    png.set(cIhdr, sig.length);
    png.set(cIdat, sig.length + cIhdr.length);
    png.set(cIend, sig.length + cIhdr.length + cIdat.length);
    return png;
  };
  const embedRgbaTexture = (name, rgbaObj) => {
    const pngBytes = encodeRgbaToPng(rgbaObj.width, rgbaObj.height, rgbaObj.pixels);
    const viewIndex = bin.addBytes(pngBytes);
    const imgIndex = images.length;
    images.push({
      name,
      bufferView: viewIndex,
      mimeType: 'image/png',
      extras: {
        width: rgbaObj.width,
        height: rgbaObj.height,
        format: 'RGBA8',
      },
    });
    const texIndex = textures.length;
    textures.push({ name, source: imgIndex });
    return texIndex;
  };

  embedRgbaTexture('frondTexture', frondTexture(texSize, texSize));
  embedRgbaTexture('waveNormals', waveNormals(texSize, texSize, 23));
  embedRgbaTexture('brushStrokes', brushStrokes(texSize, 7, 64));
  if (art.carpet) {
    embedRgbaTexture('flowerCarpet', flowerCarpet(texSize, 42, art.carpet));
  }

  // 2. Build track ribbons matching renderer.js (lines 1828-1910 & 2860-2910):
  //    - Terrain follows the road's height out to 40m (so roadside scenery and hills
  //      sit on a solid 40m embankment shelf at road height), then slopes smoothly
  //      down to baseY over 40..440m and extends to 1400m.
  //    - Wet sides stay level to 18m, then slope down a beach to sea level (waterY) at SHORE (30m).
  //    - Main trunk road stops cleanly at forkStart when a fork is present so bForkRoadL,
  //      bForkRoadR, and bForkDivider take over without overlapping asphalt in the middle.
  const baseY = Math.min(...pts.map((p) => p.y)) - 2;
  const waterY = baseY - 1;
  const zEnd = pts[pts.length - 1]?.z ?? Infinity;
  const isWet = (side) => shoreSide !== 0 && ((shoreSide < 0) === (side < 0));
  const groundY = (p, side, offset) =>
    terrainHeightAt(stageId, p, baseY, waterY, side, offset, isWet(side), zEnd);

  const fullPts = [...leadPts.slice(0, -1), ...pts, ...leadOutPts.slice(1)];
  const fullRights = [...leadRights.slice(0, -1), ...rights, ...leadOutRights.slice(1)];
  const endDiv = forkDiverge[forkDiverge.length - 1] ?? 0;
  const fullDiverge = [
    ...leadPts.slice(0, -1).map(() => 0),
    ...forkDiverge,
    ...leadOutPts.slice(1).map(() => endDiv),
  ];

  // Trunk road stops at forkStart when stage has a fork; otherwise runs to end + leadOut
  const trunkPts = stage.fork && forkStart < pts.length
    ? [...leadPts.slice(0, -1), ...pts.slice(0, Math.min(pts.length, forkStart + 2))]
    : fullPts;
  const trunkRights = stage.fork && forkStart < pts.length
    ? [...leadRights.slice(0, -1), ...rights.slice(0, Math.min(pts.length, forkStart + 2))]
    : fullRights;

  const leftPath = [];
  const rightPath = [];
  for (let i = 0; i < trunkPts.length; i++) {
    const p = trunkPts[i];
    const b = trunkRights[i];
    leftPath.push({ x: p.x - b.x * halfW, y: p.y + 0.02, z: p.z - b.z * halfW });
    rightPath.push({ x: p.x + b.x * halfW, y: p.y + 0.02, z: p.z + b.z * halfW });
  }

  // Outer rumbles shift outward with forkDiverge past forkStart
  const leftRumbleInner = [];
  const leftRumbleOuter = [];
  const rightRumbleInner = [];
  const rightRumbleOuter = [];
  for (let i = 0; i < fullPts.length; i++) {
    const p = fullPts[i];
    const b = fullRights[i];
    const div = fullDiverge[i];
    leftRumbleInner.push({ x: p.x - b.x * (div + halfW), y: p.y + 0.025, z: p.z - b.z * (div + halfW) });
    leftRumbleOuter.push({ x: p.x - b.x * (div + rumbleW), y: p.y + 0.015, z: p.z - b.z * (div + rumbleW) });
    rightRumbleInner.push({ x: p.x + b.x * (div + halfW), y: p.y + 0.025, z: p.z + b.z * (div + halfW) });
    rightRumbleOuter.push({ x: p.x + b.x * (div + rumbleW), y: p.y + 0.015, z: p.z + b.z * (div + rumbleW) });
  }

  const buildBandPaths = (side, offsets) => {
    const paths = offsets.map((offset) =>
      fullPts.map((p, i) => {
        const b = fullRights[i];
        const d = rumbleW + fullDiverge[i] + offset;
        return {
          x: p.x + side * b.x * d,
          y: groundY(p, side, offset),
          z: p.z + side * b.z * d,
        };
      })
    );
    return side > 0 ? paths.reverse() : paths;
  };

  const meshes = [];
  const nodes = [];

  const addRibbonNode = (name, pathA, pathB, matIdx, extras = {}) => {
    const meshIdx = meshes.length;
    meshes.push({
      name,
      primitives: [buildRibbonPrimitive(bin, pathA, pathB, matIdx)],
    });
    const nodeIdx = nodes.length;
    nodes.push({ name, mesh: meshIdx, extras });
    return nodeIdx;
  };

  const addMultiBandNode = (name, paths, matIdx, extras = {}) => {
    const meshIdx = meshes.length;
    meshes.push({
      name,
      primitives: [buildMultiBandRibbonPrimitive(bin, paths, matIdx)],
    });
    const nodeIdx = nodes.length;
    nodes.push({ name, mesh: meshIdx, extras });
    return nodeIdx;
  };

  addRibbonNode('bRoad', leftPath, rightPath, roadMatIdx, { role: 'road', textureSet: art.road });
  addRibbonNode('bRumbleL', leftRumbleInner, leftRumbleOuter, rumbleMatIdx, { role: 'rumble-left' });
  addRibbonNode('bRumbleR', rightRumbleOuter, rightRumbleInner, rumbleMatIdx, { role: 'rumble-right' });

  const leftOffsets = isWet(-1) ? WET_TERRAIN_OFFSETS : DRY_TERRAIN_OFFSETS;
  const rightOffsets = isWet(1) ? WET_TERRAIN_OFFSETS : DRY_TERRAIN_OFFSETS;
  addMultiBandNode('bTerrainL', buildBandPaths(-1, leftOffsets), groundMatIdx, {
    role: 'terrain-left',
    textureSet: art.ground,
  });
  addMultiBandNode('bTerrainR', buildBandPaths(1, rightOffsets), groundMatIdx, {
    role: 'terrain-right',
    textureSet: art.ground,
  });

  if (art.carpet && art.carpet.length > 0) {
    const carpetMatIdx = ensureMaterial('bCarpet', hexToRgba(art.carpet[0]), { roughness: 0.95 });
    for (const side of [-1, 1]) {
      const carpetInner = [];
      const carpetOuter = [];
      for (let i = 0; i < fullPts.length; i++) {
        const p = fullPts[i];
        const b = fullRights[i];
        const div = fullDiverge[i];
        const dIn = rumbleW + div + 0.4;
        const dOut = rumbleW + div + 6.0;
        carpetInner.push({ x: p.x + side * b.x * dIn, y: p.y + 0.05, z: p.z + side * b.z * dIn });
        carpetOuter.push({ x: p.x + side * b.x * dOut, y: p.y + 0.05, z: p.z + side * b.z * dOut });
      }
      if (side < 0) {
        addRibbonNode('bCarpetL', carpetInner, carpetOuter, carpetMatIdx, { role: 'carpet-left' });
      } else {
        addRibbonNode('bCarpetR', carpetOuter, carpetInner, carpetMatIdx, { role: 'carpet-right' });
      }
    }
  }

  if (stage.fork && forkStart < pts.length) {
    const forkPts = [...pts.slice(forkStart), ...leadOutPts.slice(1)];
    const forkRights = [...rights.slice(forkStart), ...leadOutRights.slice(1)];
    const forkDivs = [...forkDiverge.slice(forkStart), ...leadOutPts.slice(1).map(() => endDiv)];

    const forkLeftRoadL = [];
    const forkLeftRoadR = [];
    const forkRightRoadL = [];
    const forkRightRoadR = [];
    const forkDivL = [];
    const forkDivR = [];
    const forkInnerRumbleLL = [];
    const forkInnerRumbleLR = [];
    const forkInnerRumbleRL = [];
    const forkInnerRumbleRR = [];

    for (let i = 0; i < forkPts.length; i++) {
      const p = forkPts[i];
      const b = forkRights[i];
      const diverge = forkDivs[i];
      const gap = Math.max(0, diverge - 0.6);
      const at = (offset, lift) => ({
        x: p.x + b.x * offset,
        y: p.y + lift,
        z: p.z + b.z * offset,
      });
      forkLeftRoadL.push(at(-(diverge + rumbleW), 0.03));
      forkLeftRoadR.push(at(-gap, 0.03));
      forkRightRoadL.push(at(gap, 0.03));
      forkRightRoadR.push(at(diverge + rumbleW, 0.03));
      forkDivL.push(at(-gap, 0.015));
      forkDivR.push(at(gap, 0.015));
      if (gap > 0.01) {
        forkInnerRumbleLL.push(at(-(gap + 0.55), 0.035));
        forkInnerRumbleLR.push(at(-gap, 0.035));
        forkInnerRumbleRL.push(at(gap, 0.035));
        forkInnerRumbleRR.push(at(gap + 0.55, 0.035));
      }
    }
    addRibbonNode('bForkRoadL', forkLeftRoadL, forkLeftRoadR, roadMatIdx, { role: 'fork-left' });
    addRibbonNode('bForkRoadR', forkRightRoadL, forkRightRoadR, roadMatIdx, { role: 'fork-right' });
    addRibbonNode('bForkDivider', forkDivR, forkDivL, groundMatIdx, { role: 'fork-divider' });
    if (forkInnerRumbleLL.length >= 2) {
      addRibbonNode('bForkRumbleL', forkInnerRumbleLL, forkInnerRumbleLR, rumbleMatIdx, { role: 'rumble-fork-left' });
      addRibbonNode('bForkRumbleR', forkInnerRumbleRL, forkInnerRumbleRR, rumbleMatIdx, { role: 'rumble-fork-right' });
    }
  }

  if (shoreSide !== 0) {
    const seaWallTopMatIdx = ensureMaterial('bSeaWallTopMat', hexToRgba(PROMENADE.top), { roughness: 0.85 });
    const seaWallBackMatIdx = ensureMaterial('bSeaWallBackMat', hexToRgba('#A89C86'), { roughness: 0.9 });
    const promInner = [];
    const promOuter = [];
    const wallTopInner = [];
    const wallTopOuter = [];
    const wallBackBot = [];
    const foamInner = [];
    const foamOuter = [];
    const waterBands = WATER_OFFSETS.map(() => []);

    for (let i = 0; i < fullPts.length; i++) {
      const p = fullPts[i];
      const b = fullRights[i];
      const div = fullDiverge[i];
      const s = shoreSide;
      const rEdge = s * (rumbleW + div);
      const wInner = s * (rumbleW + div + SEA_WALL.wall);
      const wOuter = s * (rumbleW + div + SEA_WALL.out);
      const shoreInner = s * (rumbleW + div + SHORE - 2.2);
      const shoreFoamOuter = s * (rumbleW + div + SHORE + 5.8);
      promInner.push({ x: p.x + b.x * rEdge, y: p.y + 0.03, z: p.z + b.z * rEdge });
      promOuter.push({ x: p.x + b.x * wInner, y: p.y + 0.05, z: p.z + b.z * wInner });
      wallTopInner.push({ x: p.x + b.x * wInner, y: p.y + SEA_WALL.height, z: p.z + b.z * wInner });
      wallTopOuter.push({ x: p.x + b.x * wOuter, y: p.y + SEA_WALL.height, z: p.z + b.z * wOuter });
      wallBackBot.push({ x: p.x + b.x * wOuter, y: p.y - 1.5, z: p.z + b.z * wOuter });
      foamInner.push({ x: p.x + b.x * shoreInner, y: waterY + 0.10, z: p.z + b.z * shoreInner });
      foamOuter.push({ x: p.x + b.x * shoreFoamOuter, y: waterY + 0.04, z: p.z + b.z * shoreFoamOuter });
      for (let bi = 0; bi < WATER_OFFSETS.length; bi++) {
        const seaOff = s * (rumbleW + div + SHORE + WATER_OFFSETS[bi]);
        waterBands[bi].push({ x: p.x + b.x * seaOff, y: waterY, z: p.z + b.z * seaOff });
      }
    }
    addRibbonNode('bPromenade', promInner, promOuter, promenadeMatIdx, { role: 'promenade', shoreSide });
    addRibbonNode('bSeaWallFace', promOuter, wallTopInner, seaWallMatIdx, { role: 'sea-wall-face', shoreSide });
    addRibbonNode('bSeaWall', wallTopInner, wallTopOuter, seaWallTopMatIdx, { role: 'sea-wall', shoreSide });
    addRibbonNode('bSeaWallBack', wallTopOuter, wallBackBot, seaWallBackMatIdx, { role: 'sea-wall-back', shoreSide });
    addRibbonNode('bFoam', foamInner, foamOuter, foamMatIdx, { role: 'foam', shoreSide });
    addMultiBandNode('bWater', shoreSide < 0 ? waterBands : [...waterBands].reverse(), waterMatIdx, { role: 'water', shoreSide });
  }

  // 3. Group roadside props (placeProps) and verge scatter (scatterVerge) into
  // spatial chunks of SCATTER_CHUNK = 25 road segments using EXT_mesh_gpu_instancing.
  const foliageMatIdx = matIndexByName.get('palm#frond');
  if (foliageMatIdx === undefined) {
    throw new Error('stage_gltf: missing palm#frond material');
  }
  const unitProxyPrimitive = buildUnitProxyPrimitive(bin, foliageMatIdx);
  const meshIndexByKind = new Map();
  const ensureKindMesh = (kind) => {
    const existing = meshIndexByKind.get(kind);
    if (existing !== undefined) return existing;
    const parts = kind.split(':');
    const meshName = parts[0] === 'prop' && parts[2]
      ? `model/${parts[2]}/lod0`
      : parts[0] === 'prop'
        ? `model/${parts[1]}/lod0`
        : `scatter/${parts[1]}`;
    const idx = meshes.length;
    meshes.push({
      name: meshName,
      primitives: [unitProxyPrimitive],
      extras: { kind },
    });
    meshIndexByKind.set(kind, idx);
    return idx;
  };

  const rawProps = placeProps(stageId, stage.segmentCount, forkStart);
  const seaSide = art.seaWall ? shoreSide : 0;
  const isOnPromenade = (pl) =>
    pl.side === seaSide && pl.offset < SEA_WALL.out && (pl.kind === 'grassTuft' || pl.kind === 'shrub');
  const props = rawProps.filter((pl) => !isOnPromenade(pl));
  const vergeItems = scatterVerge(stageId, stage.segmentCount, segLen);

  // Bucket instances by (chunkIndex, kind)
  const chunkBuckets = new Map();
  const addInstance = (segIdx, kind, worldX, worldY, worldZ, yaw, scaleX, scaleY, scaleZ) => {
    const clampedSeg = Math.max(0, Math.min(stage.segmentCount - 1, Math.floor(segIdx)));
    const chunkIndex = Math.floor(clampedSeg / SCATTER_CHUNK);
    const key = `${chunkIndex}:${kind}`;
    let bucket = chunkBuckets.get(key);
    if (!bucket) {
      const startSeg = chunkIndex * SCATTER_CHUNK;
      const endSeg = Math.min(stage.segmentCount - 1, startSeg + SCATTER_CHUNK - 1);
      bucket = {
        chunkIndex,
        kind,
        startSegment: startSeg,
        endSegment: endSeg,
        zMin: Math.min(pts[startSeg].z, worldZ),
        zMax: Math.max(pts[endSeg].z + segLen, worldZ),
        translations: [],
        rotations: [],
        scales: [],
      };
      chunkBuckets.set(key, bucket);
    } else {
      bucket.zMin = Math.min(bucket.zMin, worldZ);
      bucket.zMax = Math.max(bucket.zMax, worldZ);
    }
    bucket.translations.push(worldX, worldY, worldZ);
    const q = yawToQuat(yaw);
    bucket.rotations.push(q[0], q[1], q[2], q[3]);
    bucket.scales.push(scaleX, scaleY, scaleZ);
  };

  // Match renderer.js spotAhead: place props on groundY across their footprint reach
  const spotProp = (p) => {
    const segIdx = Math.max(0, Math.min(pts.length - 1, p.i));
    const nextIdx = Math.min(pts.length - 1, segIdx + 1);
    const pt = pts[segIdx];
    const nextPt = pts[nextIdx];
    const rt = rights[segIdx];
    const scale = p.scale || 1;
    const offset = p.offset || 0;
    const reach = (PROP_FOOTPRINT[p.kind] ?? 0) * scale;
    const d = p.side === 0 ? 0 : rumbleW + forkDiverge[segIdx] + offset;
    let wy = pt.y;
    if (p.kind === 'sailboat') {
      wy = waterY;
    } else if (p.side !== 0) {
      const span = Math.ceil(reach / segLen);
      wy = Infinity;
      for (let j = Math.max(0, segIdx - span); j <= Math.min(pts.length - 1, segIdx + span); j++) {
        for (const o of [offset - reach, offset, offset + reach]) {
          wy = Math.min(wy, groundY(pts[j], p.side, o));
        }
      }
      if (!Number.isFinite(wy)) wy = groundY(pt, p.side, offset);
      if (p.kind === 'shrub' || p.kind === 'grassTuft') wy -= 0.06;
    }
    wy += p.lift || 0;
    const wx = pt.x + p.side * rt.x * d;
    const wz = pt.z + p.side * rt.z * d;
    const roadYaw = Math.atan2(nextPt.x - pt.x, nextPt.z - pt.z) + (p.side < 0 ? Math.PI : 0);
    const baseYaw = p.yaw ?? roadYaw;
    return { segIdx, wx, wy, wz, baseYaw, scale };
  };

  const leadSegs = leadPts.length - 1;
  const p0 = pts[0];
  const emitProp = (p, n, models, scales, behind = false) => {
    let { segIdx, wx, wy, wz, baseYaw, scale } = spotProp(p);
    if (behind) {
      const pt = pts[segIdx];
      wx = wx + 2 * (p0.x - pt.x);
      wy = wy - pt.y + p0.y;
      wz = wz + 2 * (p0.z - pt.z);
    } else if (p.side !== 0 && stage.fork && segIdx >= Math.max(0, forkStart - 6)) {
      const pt = pts[segIdx];
      const rt = rights[segIdx];
      const lat = Math.abs((wx - pt.x) * rt.x + (wz - pt.z) * rt.z);
      if (lat < rumbleW + forkDiverge[segIdx] + 2.8) return;
    }
    const targetSeg = behind ? 0 : segIdx;
    if (models && scales) {
      const modelId = models[n % models.length];
      const sc = scale * scales[n % models.length];
      const yaw = baseYaw + (MODEL_TURN[modelId] ?? 0);
      addInstance(targetSeg, `prop:${p.kind}:${modelId}`, wx, wy, wz, yaw, sc, sc, sc);
    } else {
      addInstance(targetSeg, `prop:${p.kind}`, wx, wy, wz, baseYaw, scale, scale, scale);
    }
  };

  look.props.forEach((spec, k) => {
    const ours = props.filter((pl) => pl.k === k);
    const models = art.models?.[spec.kind];
    const scales = models ? modelScales(MANIFEST, spec.kind, models) : null;
    ours.forEach((p, n) => {
      emitProp(p, n, models, scales, false);
      if (p.i <= leadSegs && !p.landmark) {
        emitProp(p, n, models, scales, true);
      }
    });
  });

  if (look.destination && leadOutPts.length > 1) {
    const endPt = leadOutPts[0];
    const nextEnd = leadOutPts[1];
    const endLen = Math.hypot(nextEnd.x - endPt.x, nextEnd.z - endPt.z) || 1;
    const onX = (nextEnd.x - endPt.x) / endLen;
    const onZ = (nextEnd.z - endPt.z) / endLen;
    const b = leadOutRights[0];
    const destYaw = Math.atan2(-onX, -onZ);
    for (const piece of look.destination) {
      const models = art.models?.[piece.kind];
      if (!models) continue;
      const [modelId] = models;
      const sc = (piece.scale || 1) * modelScales(MANIFEST, piece.kind, models)[0];
      const wx = endPt.x + onX * piece.beyond + b.x * piece.across;
      const wy = endPt.y - 0.05;
      const wz = endPt.z + onZ * piece.beyond + b.z * piece.across;
      const yaw = destYaw + (MODEL_TURN[modelId] ?? 0);
      addInstance(pts.length - 1, `prop:${piece.kind}:${modelId}`, wx, wy, wz, yaw, sc, sc, sc);
    }
  }

  // Emit overhead Sega Route Fork Gantry at forkStart & Checkpoint Arches on both branches
  if (stage.fork && forkStart < pts.length) {
    const gPt = pts[forkStart];
    const gYaw = headings[forkStart];
    addInstance(forkStart, 'prop:forkGantry', gPt.x, gPt.y, gPt.z, gYaw, halfW, 1.0, 1.0);

    const archZ = (stage.segmentCount * stage.segmentLength - ARCH_LEAD) * METRES_PER_UNIT;
    const archSeg = Math.max(forkStart, Math.min(pts.length - 1, Math.floor(archZ / segLen)));
    const aPt = pts[archSeg];
    const aRt = rights[archSeg];
    const aYaw = headings[archSeg];
    const aDiv = forkDiverge[archSeg];
    for (const side of [-1, 1]) {
      const shift = side * (aDiv + 0.45 * rumbleW);
      addInstance(
        archSeg,
        side < 0 ? 'prop:checkpointArchL' : 'prop:checkpointArchR',
        aPt.x + aRt.x * shift,
        aPt.y,
        aPt.z + aRt.z * shift,
        aYaw,
        halfW * 0.55,
        1.0,
        1.0,
      );
    }
  } else {
    const finIdx = pts.length - 1;
    const finPt = pts[finIdx];
    const finYaw = headings[finIdx];
    addInstance(finIdx, 'prop:finishGantry', finPt.x, finPt.y, finPt.z, finYaw, halfW, 1.0, 1.0);
  }

  const palette = VERGE_SCATTER[stageId];
  if (!palette) {
    throw new Error(`stage_gltf: missing VERGE_SCATTER palette for stage "${stageId}"`);
  }
  for (let vi = 0; vi < vergeItems.length; vi++) {
    const v = vergeItems[vi];
    const isBlossom = v.kind === 'flower' || v.kind === 'poppies';
    if (!isBlossom && vi % 2 !== 0) continue;
    const segIdx = Math.max(0, Math.min(pts.length - 1, v.i));
    const nextIdx = Math.min(pts.length - 1, segIdx + 1);
    let offset = v.offset;
    if (shoreSide !== 0 && v.side === shoreSide && offset < SEA_WALL.out + 0.3) {
      const bed = promenadeBed(v.kind);
      if (bed === null) continue;
      offset = bed;
    }
    const pt = pts[segIdx];
    const qt = pts[nextIdx];
    const rt = rights[segIdx];
    const along = v.along || 0;
    const d = rumbleW + forkDiverge[segIdx] + offset;
    const wx = pt.x + (qt.x - pt.x) * along + v.side * rt.x * d;
    const sink = v.kind === 'bush' || v.kind === 'tuft' ? -0.06 : 0;
    const wy = groundY(pt, v.side, offset) * (1 - along) + groundY(qt, v.side, offset) * along + sink;
    const wz = pt.z + (qt.z - pt.z) * along + v.side * rt.z * d;
    if (stage.fork && segIdx >= Math.max(0, forkStart - 6)) {
      const lat = Math.abs((wx - pt.x) * rt.x + (wz - pt.z) * rt.z);
      if (lat < rumbleW + forkDiverge[segIdx] + 2.8) continue;
    }
    const sc = v.size;
    const paletteEntry = palette[v.k];
    if (!paletteEntry) {
      throw new Error(`stage_gltf: missing VERGE_SCATTER palette entry ${v.k} for stage "${stageId}"`);
    }
    const colour = paletteEntry.colour;
    addInstance(segIdx, `scatter:${v.kind}:${colour}`, wx, wy, wz, v.yaw || 0, sc, sc, sc);
    if (segIdx < leadSegs) {
      addInstance(
        0,
        `scatter:${v.kind}:${colour}`,
        wx - 2 * (pt.x - p0.x),
        wy - pt.y + p0.y,
        wz - 2 * (pt.z - p0.z),
        v.yaw || 0,
        sc,
        sc,
        sc,
      );
    }
  }

  for (const bucket of chunkBuckets.values()) {
    const instanceCount = bucket.translations.length / 3;
    if (instanceCount === 0) continue;
    const transAcc = bin.addFloatAccessor(new Float32Array(bucket.translations), 'VEC3', instanceCount);
    const rotAcc = bin.addFloatAccessor(new Float32Array(bucket.rotations), 'VEC4', instanceCount);
    const scaleAcc = bin.addFloatAccessor(new Float32Array(bucket.scales), 'VEC3', instanceCount);
    const kindMeshIdx = ensureKindMesh(bucket.kind);

    nodes.push({
      name: `chunk_${bucket.chunkIndex}_${bucket.kind}`,
      mesh: kindMeshIdx,
      extensions: {
        EXT_mesh_gpu_instancing: {
          attributes: {
            TRANSLATION: transAcc,
            ROTATION: rotAcc,
            SCALE: scaleAcc,
          },
        },
      },
      extras: {
        chunkIndex: bucket.chunkIndex,
        startSegment: bucket.startSegment,
        endSegment: bucket.endSegment,
        zMin: bucket.zMin,
        zMax: bucket.zMax,
        kind: bucket.kind,
        instanceCount,
      },
    });
  }

  // 4. Deterministic 3-bank 3D cumulus cloud cards matching stage art look on sunlit stages
  const cloudSeen = new Set();
  const cloudCards = [];
  let cloudCardIdx = 0;
  if (!isNight) {
    CLOUD_BANKS.forEach((bank, bankIdx) => {
      for (let slot = 0; slot < bank.cards; slot++) {
        const cLook = cloudLook(stageId, cloudCardIdx++);
        const mirrored = cloudSeen.has(cLook.kind);
        cloudSeen.add(cLook.kind);
        const aspect = CLOUD_KINDS[cLook.kind];
        const roll = (n) => ((Math.imul(cLook.seed, 2654435761) >>> n) & 1023) / 1023;
        const metres = bank.metres[0] + (bank.metres[1] - bank.metres[0]) * roll(3);
        const along = ((slot + 0.15 + 0.7 * roll(7)) / bank.cards) * bank.span;
        const side = (slot % 2 ? 1 : -1) * bank.distance * (0.45 + 0.6 * roll(13));
        const tall = cLook.kind === 'bank' || cLook.kind === 'ridge' ? 0.6 : 1;
        const rise = (metres * tall) / 2;
        cloudCards.push({
          bank: bankIdx,
          slot,
          seed: cLook.seed,
          kind: cLook.kind,
          mirrored,
          metres,
          along,
          side,
          rise,
          width: metres * aspect * tall,
          height: metres * tall,
          span: bank.span,
          lift: bank.lift,
          haze: bank.haze,
        });
      }
    });
  }

  const binBytes = bin.finish();

  const gltf = {
    asset: {
      version: '2.0',
      generator: 'apexrun/stage_gltf.js',
    },
    extensionsUsed: ['EXT_mesh_gpu_instancing'],
    scene: 0,
    scenes: [
      {
        name: stageId,
        nodes: nodes.map((_, idx) => idx),
        extras: {
          stk: {
            stageId,
            stageName: stage.name,
            segmentCount: stage.segmentCount,
            segmentLengthMetres: segLen,
            scatterChunkSegments: SCATTER_CHUNK,
            scatterBehindMetres: SCATTER_BEHIND,
            scatterAheadMetres: SCATTER_AHEAD,
            leadInMetres: LEAD_IN_METRES,
            leadOutMetres: LEAD_OUT_METRES,
            runOnMetres: runOnMetres(stageId),
            lodFarMetres: LOD_FAR,
            lodSplitsMetres: LOD_SPLITS,
            lodMinSizeMetres: LOD_SIZE,
            isNight,
            shoreSide,
            skyKtx2: `sky/${art.sky}.ktx2`,
            backdropLayers: BACKDROP_LAYERS.map((layer) => `backdrop/${art.backdrop || art.sky}/${layer}.ktx2`),
            cloudCards,
            style: STYLE,
            grade: GRADE,
            destination: STAGE_LOOKS[stageId]?.destination ?? null,
            lookColors: {
              ground: look.ground,
              lightGround: look.light.ground,
              fogDensity: look.fog.density,
              water: look.water?.color ?? null,
              sun: look.sun?.color ?? null,
            },
          },
        },
      },
    ],
    nodes,
    meshes,
    materials,
    textures,
    images,
    accessors: bin.accessors,
    bufferViews: bin.bufferViews,
    buffers: [
      {
        byteLength: binBytes.byteLength,
      },
    ],
  };

  const glb = packGlb(gltf, binBytes);
  return { gltf, bin: binBytes, glb };
}
