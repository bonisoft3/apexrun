import { assertAlmostEquals, assertEquals, assertRejects, assert } from "jsr:@std/assert@1";
import { apexrunEngine } from "../shell/engine/simulation.js";

// Mock BABYLON environment for headless testing
// Babylon 7 keeps components behind accessors, so `{ ...v }` copies none of them.
class MockVector3 {
  private _x: number; private _y: number; private _z: number;
  constructor(x = 0, y = 0, z = 0) { this._x = x; this._y = y; this._z = z; }
  get x() { return this._x; } set x(v: number) { this._x = v; }
  get y() { return this._y; } set y(v: number) { this._y = v; }
  get z() { return this._z; } set z(v: number) { this._z = v; }
  set(x: number, y: number, z: number) { this._x = x; this._y = y; this._z = z; }
  static Dot(a: MockVector3, b: MockVector3) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  static Distance(a: MockVector3, b: MockVector3) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  static Lerp(a: MockVector3, b: MockVector3, t: number) { return new MockVector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }
  // Row vectors, as Babylon's: v · M, translation ignored.
  static TransformCoordinates(v: MockVector3, m: MockMatrix) {
    const k = m.m;
    return new MockVector3(v.x * k[0] + v.y * k[4] + v.z * k[8] + k[12], v.x * k[1] + v.y * k[5] + v.z * k[9] + k[13], v.x * k[2] + v.y * k[6] + v.z * k[10] + k[14]);
  }
  static TransformNormal(v: MockVector3, m: MockMatrix) {
    const k = m.m;
    return new MockVector3(v.x * k[0] + v.y * k[4] + v.z * k[8], v.x * k[1] + v.y * k[5] + v.z * k[9], v.x * k[2] + v.y * k[6] + v.z * k[10]);
  }
  add(o: MockVector3) { return new MockVector3(this.x + o.x, this.y + o.y, this.z + o.z); }
  scale(k: number) { return new MockVector3(this.x * k, this.y * k, this.z * k); }
  subtract(o: MockVector3) { return new MockVector3(this.x - o.x, this.y - o.y, this.z - o.z); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { const l = this.length() || 1; this.set(this.x / l, this.y / l, this.z / l); return this; }
  copyFrom(o: MockVector3) { this.set(o.x, o.y, o.z); return this; }
}

// Colours keep the hex they came from, so a test can tell one stage's light from another's.
class MockColor3 {
  hex = "";
  constructor(public r = 0, public g = 0, public b = 0) {}
  static FromHexString(s: string) { return Object.assign(new MockColor3(1, 1, 1), { hex: s.toUpperCase() }); }
  static Lerp(a: MockColor3, b: MockColor3, t: number) { return new MockColor3(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t); }
  scale(k: number) { return new MockColor3(this.r * k, this.g * k, this.b * k); }
  set(r: number, g: number, b: number) { this.r = r; this.g = g; this.b = b; return this; }
  clone() { return new MockColor3(this.r, this.g, this.b); }
}

class MockColor4 {
  hex = "";
  constructor(public r = 0, public g = 0, public b = 0, public a = 1) {}
  static FromHexString(s: string) { return Object.assign(new MockColor4(1, 1, 1, 1), { hex: s.toUpperCase() }); }
}

/** A 4×4 row-major matrix, as Babylon's, translation in m[12..14]. */
class MockMatrix {
  constructor(public m: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) {}
  static Identity() { return new MockMatrix(); }
  clone() { return new MockMatrix([...this.m]); }
  multiply(o: MockMatrix) {
    const r = new Array(16).fill(0);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += this.m[i * 4 + k] * o.m[k * 4 + j];
    return new MockMatrix(r);
  }
  // Only the parts' identity world matrices are ever inverted here.
  invert() {
    if (this.m.some((v, i) => v !== (i % 5 === 0 ? 1 : 0))) throw new Error("MockMatrix inverts the identity only");
    return this;
  }
  copyToArray(a: Float32Array, o: number) { a.set(this.m, o); }
}

const PACK_MATERIALS = ["paint", "glass", "trim", "headlight", "taillight", "rubber", "rim", "chrome", "stone", "dark", "wood", "iron", "door", "window", "shade", "shade_deep"];

class MockMesh {
  position = new MockVector3();
  rotation = new MockVector3();
  scaling = new MockVector3(1, 1, 1);
  isVisible = true;
  material: any = null;
  parent: any = null;
  setParent(_p: any) {}
  setPivotPoint(_p: MockVector3) {}
  bakeTransformIntoVertices(_m: MockMatrix) {}
  makeGeometryUnique() {}
  createInstance(name: string) { return Object.assign(new MockMesh(), { name }); }
  freezeWorldMatrix() {}
  thinMatrices: Float32Array | null = null;
  thinInstanceSetBuffer(_kind: string, buffer: Float32Array) { this.thinMatrices = buffer; }
  thinInstanceBufferUpdated(_kind: string) {}
  thinInstanceRefreshBoundingInfo() {}
  setEnabled(val: boolean) { this.isVisible = val; }
  dispose() { this.isVisible = false; }
  children: MockMesh[] = [];
  getChildMeshes() { return this.children; }
  getDescendants(): MockMesh[] { return this.children.flatMap((c) => [c, ...c.getDescendants()]); }
  getChildren() { return this.children; }
  rotationQuaternion: any = null;
  vertices: Record<string, Float32Array> = {
    position: new Float32Array([0, 0, 5.26, 0, 1, 5.26, 1, 0, 5.26]),
    normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  };
  getVerticesData(kind: string) { return this.vertices[kind] ?? null; }
  setVerticesData(kind: string, data: Float32Array) { this.vertices[kind] = data; }
  getTotalVertices() { return 3; }
  computeWorldMatrix() { return MockMatrix.Identity(); }
  clone(_name?: string) {
    const m = new MockMesh();
    m.isVisible = this.isVisible;
    return m;
  }
}

// As the glTF loader's: every pack material is a PBR material.
class MockPBRMaterial {
  albedoColor = new MockColor3();
  emissiveColor = new MockColor3();
  metallic = 0;
  roughness = 1;
  alpha = 1;
  backFaceCulling = true;
  clearCoat: any = { isEnabled: false, intensity: 0, roughness: 0 };
  albedoTexture: any = null;
  bumpTexture: any = null;
  reflectionTexture: any = null;
  dispose() {}
  getClassName() { return "PBRMaterial"; }
  clone(name: string) { return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { name, clearCoat: { ...this.clearCoat }, albedoColor: Object.assign(new MockColor3(), this.albedoColor), emissiveColor: Object.assign(new MockColor3(), this.emissiveColor) }); }
  constructor(public name: string, public scene: any = null) {}
}

class MockEngine {
  hardwareScalingLevel = 1.0;
  resized = false;
  forced = false;
  resize(force = false) { this.resized = true; this.forced = force; }
  setHardwareScalingLevel(lvl: number) { this.hardwareScalingLevel = lvl; }
  getHardwareScalingLevel() { return this.hardwareScalingLevel; }
  frames: string[] = [];
  beginFrame() { this.frames.push("begin"); }
  endFrame() { this.frames.push("end"); }
}

/**
 * The riders' girl's skin, as the pack's: three pieces, her face and her two
 * arms, the outer one (+X) reaching forward from her shoulder to the wheel.
 */
function girlSkin(name: (n: string) => string) {
  const positions = [0, 0.6, 0.05, 0.05, 0.62, 0.05, 0, 0.66, 0.05, 0.16, 0.38, 0.02, 0.18, 0.3, 0.2, 0.14, 0.39, 0.47, -0.16, 0.38, 0.02, -0.18, 0.3, 0.2, -0.14, 0.39, 0.47];
  const skin: any = Object.assign(new MockMesh(), { name: name("girl_primitive0"), material: { name: "skin" }, indices: [0, 1, 2, 3, 4, 5, 6, 7, 8] });
  skin.getVerticesData = (kind: string) => (kind === "position" ? positions : kind === "normal" ? positions.map(() => 0) : null);
  skin.getIndices = () => skin.indices;
  skin.setIndices = (indices: number[]) => { skin.indices = indices; };
  return skin;
}

/** Where a thin-instanced prop part is placed, one entry per instance. */
function placedAt(mesh: any) {
  const m = mesh.thinMatrices ?? new Float32Array();
  const out = [];
  for (let o = 0; o < m.length; o += 16) out.push({ x: m[o + 12], y: m[o + 13], z: m[o + 14] });
  return out;
}

const MANIFEST = JSON.parse(await Deno.readTextFile(new URL("../assets/manifest.json", import.meta.url)));

/** A renderer drawing its first stage, every stage's art loaded from the mock. */
async function makeRenderer(canvas: any = { width: 960, height: 540 }, dpr = 1): Promise<any> {
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const { STAGE_ART } = await import("../shell/engine/art.js");
  const renderer = new ApexrunRenderer(canvas, null, null, MANIFEST, { dpr, locate: async (url: string) => ({ url, release() {} }) }) as any;
  await renderer.ready;
  await Promise.all(Object.keys(STAGE_ART).map((stage) => renderer.art.loadStage(stage)));
  return renderer;
}

/** A stage as built in full: a change of stage builds part of it a frame at a time. */
function buildStage(renderer: any, stageId: string) {
  renderer._rebuildTrackForStage(stageId);
  while (renderer.stageJobs.length) renderer.stageJobs.shift()();
}

function setupMockBabylon() {
  const BABYLON: any = {
    Vector3: MockVector3,
    Vector2: class { constructor(public x = 0, public y = 0) {} },
    Quaternion: { RotationYawPitchRoll: (y: number, p: number, r: number) => ({ y, p, r }) },
    Matrix: {
      // Yaw only, Babylon's left-handed turn: +Z goes to (sin, 0, cos).
      Compose: (_s: any, q: any, t: any) => {
        const c = Math.cos(q?.y ?? 0), n = Math.sin(q?.y ?? 0);
        return new MockMatrix([c, 0, -n, 0, 0, 1, 0, 0, n, 0, c, 0, t.x, t.y, t.z, 1]);
      },
      RotationY: (a: number) => new MockMatrix([Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1]),
      Scaling: (x: number, y: number, z: number) => new MockMatrix([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]),
      RotationX: (a: number) => new MockMatrix([1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1]),
      RotationZ: (a: number) => new MockMatrix([Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      FromArray: (a: ArrayLike<number>, o = 0) => new MockMatrix(Array.from({ length: 16 }, (_, i) => a[o + i])),
      Identity: () => MockMatrix.Identity(),
      Translation: (x: number, y: number, z: number) => new MockMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]),
    },
    Texture: class {
      static SKYBOX_MODE = 5;
      static WRAP_ADDRESSMODE = 1;
      static TRILINEAR_SAMPLINGMODE = 3;
      uScale = 1; vScale = 1; wrapU = 0; wrapV = 0; coordinatesMode = 0;
      constructor(public url: string, _scene: any, _noMip: boolean, _invertY: boolean, _sampling: number, onLoad: () => void) {
        queueMicrotask(onLoad);
      }
    },
    CubeTexture: class {
      _texture: any;
      constructor(public url: string, _s: any, _e: any, _n: boolean, _f: any, onLoad: () => void) { this._texture = { url }; queueMicrotask(onLoad); }
      clone() { return { url: this.url, _texture: this._texture, dispose() {} }; }
    },
    // A pack model: one part per material the generator names. As Babylon's,
    // an instance shares the container's materials unless asked to clone them.
    LoadAssetContainerAsync: async (url: string) => {
      const frond = { name: "frond", emissiveColor: new MockColor3(0, 0, 0) };
      return {
      url,
      instantiateModelsToScene: (name: (n: string) => string, cloneMaterials = false) => {
        const root = Object.assign(new MockMesh(), { name: name("__root__") });
        root.children = [
          ...PACK_MATERIALS.map((m) => Object.assign(new MockMesh(), { name: name(m), material: new MockPBRMaterial(name(m)) })),
          ...["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"].map((w) => Object.assign(new MockMesh(), { name: name(w), material: new MockPBRMaterial(name("rubber")) })),
          Object.assign(new MockMesh(), { name: name("sails"), material: new MockPBRMaterial(name("trim")) }),
          Object.assign(new MockMesh(), { name: name("lamp_primitive0"), material: { name: name("lamp"), emissiveColor: new MockColor3(1, 0.8, 0.5) } }),
          Object.assign(new MockMesh(), { name: name("crown"), material: cloneMaterials ? { ...frond } : frond }),
          Object.assign(new MockMesh(), { name: name("arm_R"), material: { name: name("trim") } }),
          Object.assign(new MockMesh(), { name: name("flag"), material: { name: name("flag") } }),
          ...["girl", "girl_hair", "girl_ribbon", "boy", "boy_scarf", "boy_wave", "boy_rest", "boy_head"].map((n) => Object.assign(new MockMesh(), { name: name(n), material: { name: name("skin") } })),
          girlSkin(name),
        ];
        for (const child of root.children) {
          child.parent = root;
          child.material.clone ??= function (this: any, name: string) { return { ...this, name }; };
        }
        return { rootNodes: [root] };
      },
      };
    },
    Color3: MockColor3,
    Color4: MockColor4,
    NullEngine: MockEngine,
    Engine: MockEngine,
    TransformNode: class extends MockMesh {},
    Scene: class {
      static FOGMODE_EXP2 = 2;
      clearColor = new MockColor4();
      fogMode = 0;
      fogDensity = 0;
      fogColor = new MockColor3();
      render() {}
    },
    ShaderMaterial: class {
      uniforms: Record<string, any> = {};
      backFaceCulling = true;
      constructor(public name: string, public scene: any, public path: any, public opts: any) {}
      setColor3(k: string, v: any) { this.uniforms[k] = v; return this; }
      setVector3(k: string, v: any) { this.uniforms[k] = v; return this; }
      setVector2(k: string, v: any) { this.uniforms[k] = v; return this; }
      setFloat(k: string, v: any) { this.uniforms[k] = v; return this; }
      setTexture(k: string, v: any) { this.uniforms[k] = v; return this; }
    },
    TargetCamera: class {
      fov = 0.85;
      position = new MockVector3();
      target: any = null;
      setTarget(tgt: any) { this.target = tgt; }
      getForwardRay() { return { direction: new MockVector3(0, 0, 1) }; }
      constructor(public name: string, pos: any, public scene: any) {
        if (pos) this.position.set(pos.x, pos.y, pos.z);
      }
    },
    HemisphericLight: class {
      intensity = 1;
      diffuse = new MockColor3();
      groundColor = new MockColor3();
      constructor(public name: string, public dir: any, public scene: any) {}
    },
    DirectionalLight: class {
      intensity = 1;
      diffuse = new MockColor3();
      constructor(public name: string, public dir: any, public scene: any) {}
    },
    PointLight: class {
      intensity = 1;
      range = 10;
      diffuse = new MockColor3();
      position = new MockVector3();
      constructor(public name: string, public pos: any, public scene: any) {}
      setEnabled(_val: boolean) {}
    },
    Mesh: class extends MockMesh {
      static DOUBLESIDE = 2;
      static MergeMeshes = (meshes: MockMesh[]) => Object.assign(new MockMesh(), { name: (meshes[0] as any).name, merged: meshes.length });
      constructor(public name: string, public scene: any = null) { super(); }
    },
    VertexBuffer: { PositionKind: "position", NormalKind: "normal", ColorKind: "color" },
    VertexData: class {
      positions: number[] = [];
      normals: number[] = [];
      colors: number[] | null = null;
      indices: number[] = [];
      applyToMesh(mesh: any) { mesh.vertexData = this; }
    },
    MeshBuilder: {
      CreateGround: (name: string) => Object.assign(new MockMesh(), { name }),
      CreateSphere: (name: string) => Object.assign(new MockMesh(), { name }),
      CreateCylinder: (name: string) => Object.assign(new MockMesh(), { name }),
      CreateBox: (name: string) => Object.assign(new MockMesh(), { name }),
      CreateLineSystem: (name: string, opts: any) => Object.assign(new MockMesh(), { name, lines: opts.lines }),
      CreateRibbon: (name: string, opts: any) => Object.assign(new MockMesh(), { name, pathArray: opts.pathArray, uvs: opts.uvs }),
      CreatePlane: (name: string) => Object.assign(new MockMesh(), { name }),
      CreateDisc: (name: string) => Object.assign(new MockMesh(), { name }),
      CreateTorus: (name: string) => Object.assign(new MockMesh(), { name }),
    },
    StandardMaterial: class {
      diffuseColor = new MockColor3();
      emissiveColor = new MockColor3();
      specularColor = new MockColor3();
      backFaceCulling = true;
      disableLighting = false;
      alpha = 1;
      useAlphaFromDiffuseTexture = false;
      transparencyMode = 0;
      dispose() {}
      constructor(public name: string, public scene: any) {}
    },
    PBRMaterial: MockPBRMaterial,
    Material: { MATERIAL_ALPHATEST: 1, MATERIAL_ALPHABLEND: 2 },
    DynamicTexture: class {
      texts: string[] = [];
      getContext() {
        const texts = this.texts;
        return {
          fillStyle: '',
          fillRect() {},
          clearRect() {},
          font: '',
          textAlign: '',
          fillText(t: string) { texts.push(t); },
          createRadialGradient() {
            return { addColorStop() {} };
          },
        };
      }
      update() {}
      uScale = 1;
      vScale = 1;
      hasAlpha = false;
      constructor(public name: string, public opt: any, public scene: any, public gen: boolean) {}
    },
    Effect: { ShadersStore: {} },
    ShaderStore: { ShadersStoreWGSL: {} },
    ShaderLanguage: { GLSL: 0, WGSL: 1 },
    ParticleSystem: class {
      colorGradients: { t: number; color: MockColor4 }[] = [];
      sizeGradients: { t: number; size: number }[] = [];
      addColorGradient(t: number, color: MockColor4) { this.colorGradients.push({ t, color }); }
      addSizeGradient(t: number, size: number) { this.sizeGradients.push({ t, size }); }
      start() {}
      stop() {}
      isStarted() { return false; }
      color1 = new MockColor4();
      color2 = new MockColor4();
      colorDead = new MockColor4();
      minSize = 0.1; maxSize = 0.5;
      minLifeTime = 0.1; maxLifeTime = 0.5;
      emitRate = 10;
      minEmitPower = 1; maxEmitPower = 2;
      updateSpeed = 0.01;
      emitter = null;
      direction1 = new MockVector3();
      direction2 = new MockVector3();
      gravity = new MockVector3();
    },
    DefaultRenderingPipeline: class {
      imageProcessing: any = { vignetteEnabled: false };
      constructor(public name: string, public h: boolean, public s: any, public c: any[]) {}
    },
  };
  (globalThis as any).BABYLON = BABYLON;
  return BABYLON;
}

// Drawn at CSS pixels, a Retina display showed half its own resolution,
// stretched: the cartoon's clean edges came out as pixels.
Deno.test("renderer: a high-density display is drawn at its own pixels, up to two per CSS pixel", async () => {
  setupMockBabylon();
  for (const [ratio, drawn] of [[2, 2], [3, 2], [1, 1]]) {
    const renderer = await makeRenderer({ width: 960, height: 540 } as any, ratio);
    assertEquals(renderer.engine.getHardwareScalingLevel(), 1 / drawn, `ratio ${ratio}`);
    renderer.setResolutionScale(0.5);
    assertEquals(renderer.engine.getHardwareScalingLevel(), 1 / (0.5 * drawn), `ratio ${ratio} at half scale`);
  }
});

Deno.test("renderer: setResolutionScale clamps scale and adjusts engine hardware scaling", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const canvas = { width: 960, height: 540 };
  const renderer = (await makeRenderer(canvas as any));

  assertEquals(renderer.getResolutionScale(), 1.0);

  renderer.setResolutionScale(0.75);
  assertEquals(renderer.getResolutionScale(), 0.75);
  assertEquals(renderer.engine.getHardwareScalingLevel(), 1.0 / 0.75);

  renderer.setResolutionScale(0.2);
  assertEquals(renderer.getResolutionScale(), 0.5);
  assertEquals(renderer.engine.getHardwareScalingLevel(), 2.0);

  renderer.setResolutionScale(1.5);
  assertEquals(renderer.getResolutionScale(), 1.0);
  assertEquals(renderer.engine.getHardwareScalingLevel(), 1.0);
});

Deno.test("renderer: setAdaptiveResolution configures parameters", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const canvas = { width: 960, height: 540 };
  const renderer = (await makeRenderer(canvas as any));

  renderer.setAdaptiveResolution(false);
  assertEquals(renderer.adaptiveResolution, false);

  renderer.setAdaptiveResolution(true, { minScale: 0.6, maxScale: 0.9, targetFps: 120 });
  assertEquals(renderer.adaptiveResolution, true);
  assertEquals(renderer.minResolutionScale, 0.6);
  assertEquals(renderer.maxResolutionScale, 0.9);
  assertEquals(renderer.targetFrameTimeMs, 1000 / 120);
});

Deno.test("renderer: resize updates canvas size and preserves hardware scaling level", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const canvas = { width: 960, height: 540 };
  const renderer = (await makeRenderer(canvas as any));

  renderer.setResolutionScale(0.8);
  renderer.resize(1920, 1080);

  assertEquals(renderer.width, 1920);
  assertEquals(renderer.height, 1080);
  assertEquals(canvas.width, 1920);
  assertEquals(canvas.height, 1080);
  assert(renderer.engine.resized, "engine.resize should have been called");
  assertEquals(renderer.engine.getHardwareScalingLevel(), 1.0 / 0.8);
});

Deno.test("renderer: interpolates kart position at alpha=0.5 and respects lap wrap gate", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const canvas = { width: 960, height: 540 };
  const renderer = (await makeRenderer(canvas as any));

  const state1 = apexrunEngine.initState(0x1337, { stageState: "racing" });
  state1.countdown = 0;
  state1.karts[0].z = 100;
  state1.karts[0].x = 0;

  const state2 = JSON.parse(JSON.stringify(state1));
  state2.karts[0].z = 120;
  state2.karts[0].x = 10;

  renderer.render(state2, false, state1, 0.5);
  const r = renderer as any;
  const tuxMesh = r.bKartMeshes.get("tux");
  assert(tuxMesh, "tux mesh must exist");

  const expectedZ = 110 * r.trackScale;
  assertEquals(Math.round(tuxMesh.root.position.z * 100) / 100, Math.round(expectedZ * 100) / 100);

  const wrapStatePrev = JSON.parse(JSON.stringify(state1));
  wrapStatePrev.karts[0].z = state1.trackLength - 10;
  const wrapStateCurr = JSON.parse(JSON.stringify(state1));
  wrapStateCurr.karts[0].z = 20;

  renderer.render(wrapStateCurr, false, wrapStatePrev, 0.5);
  const expectedWrapZ = (20 % state1.trackLength) * r.trackScale;
  assertEquals(Math.round(tuxMesh.root.position.z * 100) / 100, Math.round(expectedWrapZ * 100) / 100);
});

Deno.test("renderer: adaptive resolution scales down under load and recovers under headroom", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const canvas = { width: 960, height: 540 };
  const renderer = (await makeRenderer(canvas as any));

  assertEquals(renderer.getResolutionScale(), 1.0);

  for (let i = 0; i < 60; i++) renderer.recordFrameTime(16.7);
  for (let i = 0; i < 60; i++) renderer.recordFrameTime(25.0);
  for (let i = 0; i < 40; i++) renderer.recordFrameTime(16.7);
  assert(renderer.getResolutionScale() < 1.0, "scale must decrease when frame time exceeds target");
  const reducedScale = renderer.getResolutionScale();

  for (let i = 0; i < 100; i++) renderer.recordFrameTime(16.7);
  assertEquals(renderer.getResolutionScale(), reducedScale, "two steady seconds are not enough to climb, so it does not hunt");
  for (let i = 0; i < 200; i++) renderer.recordFrameTime(16.7);
  assert(renderer.getResolutionScale() > reducedScale, "scale must recover after sustained headroom");
});

// A hidden tab or the pause card stalls the clock for seconds; read as load,
// one stall knocked the race down to the floor resolution.
Deno.test("renderer: adaptive resolution ignores stalls longer than a quarter second", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  for (let i = 0; i < 60; i++) renderer.recordFrameTime(16.7);
  for (let i = 0; i < 60; i++) renderer.recordFrameTime(2000);
  assertEquals(renderer.getResolutionScale(), 1.0);
});

// Measured against a fixed 60 Hz target, a display capped at 30 Hz (battery
// saver, some phones) read as permanent load and sank to half resolution.
Deno.test("renderer: adaptive resolution holds on a display that caps the frame rate", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  let t = 0;
  const raf = (cb: (t: number) => void) => queueMicrotask(() => cb(t += 33.3));
  assertAlmostEquals(await renderer.calibrateRefresh(raf), 33.3, 0.01);
  for (let i = 0; i < 600; i++) renderer.recordFrameTime(33.3);
  assertEquals(renderer.getResolutionScale(), 1.0);
  for (let i = 0; i < 60; i++) renderer.recordFrameTime(50);
  assert(renderer.getResolutionScale() < 1.0, "a capped display still steps down under real load");
});

// The refresh was once taken as the fastest interval seen, so a GPU slow
// from its first frame read its own slowness as the display and never dropped.
Deno.test("renderer: a GPU slow from the first frame still steps down", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  for (let i = 0; i < 60; i++) renderer.recordFrameTime(25);
  assert(renderer.getResolutionScale() < 1.0);
});

// Climbing on steady frames alone pulsed the resolution every few seconds on
// a GPU that only just held a given scale.
Deno.test("renderer: a climb that is undone waits longer before the next", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js") as any;
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  for (let i = 0; i < 60; i++) renderer.recordFrameTime(16.7);
  renderer.setResolutionScale(0.8);
  // Holds 0.8 at refresh rate, falls behind above it.
  const frame = () => renderer.recordFrameTime(renderer.getResolutionScale() > 0.8 ? 25 : 16.7);
  const climbs = (n: number) => {
    let count = 0;
    for (let i = 0; i < n; i++) {
      const before = renderer.getResolutionScale();
      frame();
      if (renderer.getResolutionScale() > before) count++;
    }
    return count;
  };
  const early = climbs(1800);
  const late = climbs(1800);
  assert(early >= 2, `it probes upward (${early})`);
  assert(late < early, `then backs off (${early} then ${late})`);
});

// With one counter shared by the climb and the drop, a steady run left it past
// the drop threshold, so a single 60 ms hitch stepped the scale down at once.
Deno.test("renderer: adaptive resolution does not step down for a single hitch", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  for (let i = 0; i < 100; i++) renderer.recordFrameTime(16.7);
  renderer.recordFrameTime(60);
  for (let i = 0; i < 40; i++) renderer.recordFrameTime(16.7);
  assertEquals(renderer.getResolutionScale(), 1.0);
});

Deno.test("renderer: adaptive resolution sheds and restores multi-pass effects as scale steps down and up", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any)) as any;
  const events: string[] = [];
  renderer.plan = { msaa: 4 };
  renderer.pipeline = { samples: 4, bloomEnabled: true };
  renderer.carProbe = { refreshRate: 3 };
  renderer.ssao = {};
  renderer._ssaoAttached = true;
  renderer.scene.postProcessRenderPipelineManager = {
    attachCamerasToRenderPipeline: (name: string) => events.push(`attach:${name}`),
    detachCamerasFromRenderPipeline: (name: string) => events.push(`detach:${name}`),
  };
  renderer.bCamera.attachPostProcess = (p: any) => events.push(`attach:${p.name}`);
  renderer.bCamera.detachPostProcess = (p: any) => events.push(`detach:${p.name}`);
  renderer.godRays = { name: "bGodRays" };
  renderer._godRaysAttached = true;
  renderer.depthRenderer = { enabled: true };
  renderer.stylePass = { name: "bStyle" };
  renderer._styleAttached = true;
  renderer.inkAA = { name: "bInkAA" };
  renderer._inkAAAttached = true;
  renderer.speedBlur = { name: "bSpeedBlur" };
  renderer._speedBlurAttached = true;
  renderer.shadows = { usePercentageCloserFiltering: true, numCascades: 3 };
  renderer.glow = { isEnabled: true };

  renderer.setResolutionScale(0.9);
  assertEquals(renderer.pipeline.samples, 1);
  assertEquals(renderer.pipeline.bloomEnabled, true);
  assertEquals(renderer.carProbe.refreshRate, 0);
  assertEquals(renderer._ssaoAttached, true);
  assertEquals(renderer._godRaysAttached, true);
  assertEquals(renderer.depthRenderer.enabled, true);
  assertEquals(renderer._styleAttached, true);
  assertEquals(renderer._inkAAAttached, true);
  assertEquals(renderer._speedBlurAttached, true);
  assertEquals(renderer.shadows.usePercentageCloserFiltering, true);
  assertEquals(renderer.shadows.numCascades, 3);
  assertEquals(renderer.bSun.shadowEnabled, true);
  assertEquals(renderer.glow.isEnabled, true);

  renderer.setResolutionScale(0.8);
  assertEquals(renderer._ssaoAttached, false);
  assertEquals(renderer._godRaysAttached, false);
  assertEquals(renderer.depthRenderer.enabled, true);
  assertEquals(renderer.shadows.usePercentageCloserFiltering, false);
  assertEquals(renderer.shadows.numCascades, 3);
  assertEquals(renderer.bSun.shadowEnabled, true);
  assertEquals(renderer.glow.isEnabled, true);
  assertEquals(events, ["detach:bSsao", "detach:bGodRays"]);

  renderer.setResolutionScale(0.7);
  assertEquals(renderer.depthRenderer.enabled, false);
  assertEquals(renderer._styleAttached, false);
  assertEquals(renderer._inkAAAttached, false);
  assertEquals(renderer._speedBlurAttached, false);
  assertEquals(renderer.shadows.numCascades, 2);
  assertEquals(renderer.bSun.shadowEnabled, true);
  assertEquals(renderer.glow.isEnabled, false);
  assertEquals(renderer.pipeline.bloomEnabled, true);
  assertEquals(events, ["detach:bSsao", "detach:bGodRays", "detach:bStyle", "detach:bInkAA", "detach:bSpeedBlur"]);

  renderer.setResolutionScale(0.6);
  assertEquals(renderer.pipeline.bloomEnabled, false);
  assertEquals(renderer.bSun.shadowEnabled, false);

  renderer.setResolutionScale(1.0);
  assertEquals(renderer.pipeline.samples, 4);
  assertEquals(renderer.pipeline.bloomEnabled, true);
  assertEquals(renderer.carProbe.refreshRate, 3);
  assertEquals(renderer._ssaoAttached, true);
  assertEquals(renderer._godRaysAttached, true);
  assertEquals(renderer.depthRenderer.enabled, true);
  assertEquals(renderer._styleAttached, true);
  assertEquals(renderer._inkAAAttached, true);
  assertEquals(renderer._speedBlurAttached, true);
  assertEquals(renderer.shadows.usePercentageCloserFiltering, true);
  assertEquals(renderer.shadows.numCascades, 3);
  assertEquals(renderer.bSun.shadowEnabled, true);
  assertEquals(renderer.glow.isEnabled, true);
  assertEquals(events, [
    "detach:bSsao", "detach:bGodRays", "detach:bStyle", "detach:bInkAA", "detach:bSpeedBlur",
    "attach:bSsao", "attach:bGodRays", "attach:bStyle", "attach:bInkAA", "attach:bSpeedBlur",
  ]);
});

Deno.test("renderer: phone viewports start at 0.6 scale and high-DPI screens can step down to half CSS resolution", async () => {
  setupMockBabylon();
  // Phone held in landscape: 844x390 CSS pixels at dpr 3 (2532x1170 device pixels).
  const phone = await makeRenderer({ width: 2532, height: 1170 } as any, 3);
  assertEquals(phone.getResolutionScale(), 0.6, "phone starts at 0.6 instead of 1.0");
  assertEquals(phone.minResolutionScale, 0.25, "pixelRatio=2 allows stepping down to 0.5 CSS pixels");
  assertEquals(phone.bSun.shadowEnabled, false, "cascaded shadows shed at 0.6 startup scale");
  buildStage(phone, "desert-canyons");
  assertEquals(phone.bSun.shadowEnabled, false, "stage swap keeps shadows shed at <= 0.6");
  phone.setResolutionScale(0.1);
  assertEquals(phone.getResolutionScale(), 0.25);
  assertEquals(phone.engine.getHardwareScalingLevel(), 2.0, "floor is half CSS resolution");
});

// Recorded after _renderBabylon, a slow frame that stepped the resolution
// down reset canvas.width and canvas.height after scene.render(), wiping the
// OffscreenCanvas to transparent black for that presented frame.
Deno.test("renderer: adaptive resolution steps resize the canvas before scene.render(), never wiping the drawn frame", async () => {
  setupMockBabylon();
  const canvas = { width: 960, height: 540 };
  const renderer = (await makeRenderer(canvas as any)) as any;
  const state = apexrunEngine.initState(0xABCD, { stageState: "racing" });
  state.countdown = 0;
  renderer.isGPU = true;
  let clock = 0;
  renderer.now = () => clock;
  const order: string[] = [];
  const origSet = renderer.setResolutionScale.bind(renderer);
  renderer.setResolutionScale = (s: number) => {
    order.push("resize");
    origSet(s);
  };
  renderer.scene.render = () => order.push("render");

  renderer.render(state);
  for (let i = 0; i < 30; i++) {
    order.length = 0;
    clock += 25;
    renderer.render(state);
    if (order.includes("resize")) {
      assertEquals(order, ["resize", "render"], "canvas resize happens before scene.render()");
    }
  }
  assert(renderer.getResolutionScale() < 1.0, "stepped down during the slow run");
});

Deno.test("renderer: castle-tower and building surface overlays push vertices along normals and carry polygon zOffset", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any)) as any;
  buildStage(renderer, "destination-castle");
  const tower = renderer.bModelSets.find((m: any) => m.id === "castle-tower");
  assert(tower, "destination-castle places castle-tower");
  for (const { parts } of tower.lods) {
    const partOf = (name: string) => parts.find((p: any) => p.mesh.material?.name.endsWith(`#${name}`))?.mesh;
    const stone = partOf("stone");
    const dark = partOf("dark");
    const wood = partOf("wood");
    const iron = partOf("iron");
    assertEquals(stone?.material?.zOffset ?? 0, 0, "stone wall stays at 0");
    assertAlmostEquals(stone?.getVerticesData("position")[2], 5.26, 1e-5, "stone vertices stay in place");
    assert((dark?.material?.zOffset ?? 0) < 0, "arrow slits and arched windows carry polygon zOffset");
    assert(dark?.getVerticesData("position")[2] > 5.32, "dark vertices push outward along their normal");
    assert((wood?.material?.zOffset ?? 0) < 0, "portal oak door carries polygon zOffset");
    assert(wood?.getVerticesData("position")[2] > 5.32, "wood door vertices push outward clear of the stone surround");
    assert(iron?.getVerticesData("position")[2] > wood?.getVerticesData("position")[2] + 0.04, "iron straps sit in front of the oak door");
  }
  assert(renderer.bCamera.minZ >= 0.5 && renderer.bCamera.maxZ <= 4000, "tight near/far planes preserve depth precision at distance");
});

// Scrubbed history once fed the live timer, so the first live frame after a
// scrub counted the whole scrub as one interval.
Deno.test("renderer: scrubbed history neither counts as load nor leaves a gap", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const state = apexrunEngine.initState(0xABCD, { stageState: "racing" });
  state.countdown = 0;
  renderer.isGPU = true;
  let clock = 0;
  renderer.now = () => clock;
  const recorded: number[] = [];
  renderer.recordFrameTime = (ms: number) => recorded.push(ms);

  renderer.render(state);
  clock = 16;
  renderer.render(state);
  clock = 116;
  renderer.render(state, true);
  clock = 132;
  renderer.render(state);
  clock = 148;
  renderer.render(state);
  assertEquals(recorded, [16, 16]);
});

// The cockpit camera once sat 0.65 above the car's origin, below the 0.725
// top of the interior dash it was built inside, so the view was a black wall
// with the dash display floating in the sky.
// There is no camera toggle: a car alongside takes the camera fully onto the
// hood, for concentration.
Deno.test("renderer: a car alongside puts the camera on the hood, over the front deck, looking down the road", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const state = apexrunEngine.initState(0x1337, { stageState: "racing" }) as any;
  state.countdown = 0;
  const player = state.karts.find((k: any) => k.isPlayer) as any;
  player.z = 20000;
  state.traffic = [{ z: player.z, x: player.x + 0.5, type: "sedan", blinker: 0, brake: false }];
  for (let i = 0; i < 600; i++) renderer.render(state, true, state, 1);

  const car = renderer.bKartMeshes.get(player.character).root;
  const cam = renderer.bCamera;
  assert(car.isVisible, "the car stays visible so its hood frames the view");
  assert(cam.position.y > car.position.y + 0.6, "the eye clears the car's deck");
  assert(cam.position.y < car.position.y + 1.4, "the eye stays low on the hood");
  assert(cam.position.z > car.position.z, "the eye sits forward of the car's centre");
  assert(cam.target.z > cam.position.z + 10, "the view looks down the road");

  // The eye rides ahead of the windscreen, over the hero car's bonnet,
  // which stands 0.86 m tall where it meets the screen.
  assert(cam.position.y - car.position.y > 0.86 + 0.1, "the bonnet stays under the eye");
});

// The car pitched with the road but the hood eye stayed level: climbing, the
// hood filled a fifth of the screen; descending, it dropped out of view.
Deno.test("renderer: the hood cam keeps the hood in the same place on any grade", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const view = (seg: number) => {
    const state = apexrunEngine.initState(0x1337, { stageState: "racing", stageId: "alpine-peaks", playerZ: seg * 200 }) as any;
    state.countdown = 0;
    const me = state.karts.find((k: any) => k.isPlayer);
    state.traffic = [{ z: me.z, x: me.x + 0.5, type: "sedan", blinker: 0, brake: false }];
    for (let i = 0; i < 600; i++) renderer.render(state, false, state, 1);
    const root = renderer.bKartMeshes.get(state.karts.find((k: any) => k.isPlayer).character).root;
    const cam = renderer.bCamera;
    const pitch = -root.rotation.x;
    const dy = cam.position.y - root.position.y;
    const dz = cam.position.z - root.position.z;
    return {
      pitch,
      look: Math.atan2(cam.target.y - cam.position.y, cam.target.z - cam.position.z) - pitch,
      up: dy * Math.cos(pitch) - dz * Math.sin(pitch),
    };
  };
  const flat = view(10);
  for (const seg of [88, 130]) {
    const v = view(seg);
    assert(Math.abs(v.pitch) > 0.1, `segment ${seg} is a steep grade`);
    assertAlmostEquals(v.look, flat.look, 0.01, `look against the car at segment ${seg}`);
    assertAlmostEquals(v.up, flat.up, 0.02, `eye height over the deck at segment ${seg}`);
  }
});

Deno.test("renderer: _rebuildTrackForStage updates track geometry and rebuilds fork ribbons & gantry", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const canvas = { width: 960, height: 540 };
  const renderer = (await makeRenderer(canvas as any));

  // Initial stage is coconut-beach with fork
  assertEquals(renderer.currentStageId, "coconut-beach");
  assert(renderer.bForkGantry, "Fork gantry must exist for coconut-beach");
  // The gantry's boards were bare colour: they now name where each lane goes.
  const words = renderer.bForkSigns.flatMap((m: any) => m.material.diffuseTexture?.texts ?? []).join(" ");
  assert(words.includes("DESERT CANYONS") && words.includes("GATEWAY PASS"), `the boards read: ${words}`);

  // Rebuild for desert-canyons
  buildStage(renderer, "desert-canyons");
  assertEquals(renderer.currentStageId, "desert-canyons");
  assert(renderer.trackPts.length > 0, "Track points must be calculated");
  assert(renderer.bForkGantry, "Fork gantry must exist for desert-canyons");

  // Rebuild for stage 5 destination (no fork, has finish gantry)
  buildStage(renderer, "destination-marina");
  assertEquals(renderer.currentStageId, "destination-marina");
  assertEquals(renderer.bForkGantry, null, "Stage 5 destination must have no fork gantry");
  assert(renderer.bFinishGantry, "Stage 5 destination must have finish gantry");
});

Deno.test("renderer: rebuilding a stage applies its haze, its pack sky and light, its ground and road, and exactly its props", async () => {
  setupMockBabylon();
  const { STAGE_LOOKS } = await import("../shell/engine/stage_look.js");
  const { STAGE_ART, artUrl } = await import("../shell/engine/art.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));

  for (const [id, look] of Object.entries(STAGE_LOOKS) as [string, any][]) {
    buildStage(renderer, id);
    assertEquals(renderer.scene.fogMode, 2, `${id} fog mode`);
    const { CLEAR_AIR } = await import("../shell/engine/renderer.js");
    assertAlmostEquals(renderer.scene.fogDensity, look.fog.density * CLEAR_AIR, 1e-12, `${id} fog density`);
    assert(CLEAR_AIR < 1, "a painted afternoon's air is clearer than the backlit haze");
    const art = (STAGE_ART as any)[id];
    const { acesFit } = await import("../shell/engine/renderer.js");
    const horizon = MANIFEST[`sky/${art.sky}.paint.jpg`].horizon_srgb;
    assertAlmostEquals(acesFit(renderer.scene.fogColor.r) ** (1 / 2.2), horizon[0], 0.01, `${id} fog fades into its sky's horizon`);
    const sky = MANIFEST[`sky/${art.sky}.env`];
    // One environment texture stays the scene's and takes each stage's sky:
    // setting a new one marked every material dirty at a change of stage.
    assertEquals(renderer.scene.environmentTexture._texture.url, artUrl(MANIFEST, `sky/${art.sky}.env`), `${id} sky light`);
    assertEquals(renderer.bSun.intensity, Math.max(0, ...(sky.sun_light_rgb ?? [])), `${id} sun`);
    // A sunless sky's light is [0, 0, 0]: normalised by its peak it was NaN,
    // and every material the sun reached drew black.
    assert([renderer.bSun.diffuse.r, renderer.bSun.diffuse.g, renderer.bSun.diffuse.b].every(Number.isFinite), `${id} sun colour`);
    assertEquals(renderer.bHemi.intensity, Math.max(...sky.irradiance_up), `${id} sky irradiance`);
    assertEquals(renderer.bHemi.groundColor.hex, look.light.ground, `${id} ground bounce`);
    assertEquals(renderer.bGroundMat.albedoTexture.url, artUrl(MANIFEST, `tex/${art.ground}/albedo`), `${id} ground`);
    assertEquals(renderer.bMaterials.road.albedoTexture.url, artUrl(MANIFEST, "tex/asphalt/albedo"), `${id} asphalt`);
    const procedural = new Set(renderer.bDecorMeshes.map((m: any) => m.name.split("#")[0]));
    const kinds = look.props.map((p: any) => p.kind);
    assertEquals([...procedural].sort(), kinds.filter((k: string) => !art.models[k]).sort(), `${id} procedural props`);
    const modelled = new Set(kinds.flatMap((k: string) => art.models[k] ?? []));
    for (const set of renderer.bModelSets) assert(modelled.has(set.id), `${id} draws ${set.id}, which none of its kinds use`);
    for (const set of renderer.bModelSets) {
      for (const s of set.spots) assert([s.x, s.y, s.z, s.scale].every(Number.isFinite), `${set.id} is placed at a non-finite position`);
    }
    assertEquals(renderer.bWater.length > 0, !!look.water, `${id} water`);
    for (const m of renderer.bDecorMeshes) {
      for (const at of placedAt(m)) assert([at.x, at.y, at.z].every(Number.isFinite), `${m.name} is placed at a non-finite position`);
    }
  }
});

Deno.test("renderer: the road carries four-lane markings", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  assertEquals(renderer.bLaneLines.map((m: any) => m.name).sort(), ["bEdge_0", "bEdge_1", "bLane_0", "bLane_1", "bLane_2"]);
});

Deno.test("stage looks: every stage has one and no fork leads to the same props, haze or sky", async () => {
  const { STAGE_LOOKS } = await import("../shell/engine/stage_look.js");
  const { OUTRUN_STAGES } = await import("../shell/engine/simulation.js");
  const { STAGE_ART } = await import("../shell/engine/art.js");
  const kinds = (id: string) => (STAGE_LOOKS as any)[id].props.map((p: any) => p.kind).sort().join(",");
  const haze = (id: string) => (STAGE_ART as any)[id].sky;

  assertEquals(Object.keys(STAGE_LOOKS).sort(), Object.keys(OUTRUN_STAGES).sort());
  for (const [id, stage] of Object.entries(OUTRUN_STAGES) as [string, any][]) {
    if (!stage.fork) continue;
    const { leftBranch: l, rightBranch: r } = stage.fork;
    for (const [a, b] of [[id, l], [id, r], [l, r]]) {
      assert(kinds(a) !== kinds(b), `${a} and ${b} share signature props`);
      assert(haze(a) !== haze(b), `${a} and ${b} share haze and sky`);
    }
  }
});



// Pitch and curve once accumulated into the slope and heading without easing
// back: a +12 hill left Coconut Beach climbing at ~60°, putting the chase
// camera below the car, and successive bends coiled the road into a spiral.
Deno.test("renderer: every stage's road stays drivable and straightens after hills and bends", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const { OUTRUN_STAGES } = await import("../shell/engine/simulation.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));

  for (const id of Object.keys(OUTRUN_STAGES)) {
    buildStage(renderer, id);
    const pts = renderer.trackPts;
    const rate = (axis: "x" | "y", i: number) => Math.abs(pts[i][axis] - pts[i - 1][axis]) / renderer.segLen;
    let steepest = 0;
    let sharpest = 0;
    for (let i = 1; i < pts.length; i++) {
      steepest = Math.max(steepest, rate("y", i));
      sharpest = Math.max(sharpest, rate("x", i));
    }
    assert(steepest < 2.1 / 6.2, `${id} climbs at slope ${steepest.toFixed(2)}`);
    assert(sharpest < 0.45, `${id} bends at heading ${sharpest.toFixed(2)}`);
    assert(rate("y", pts.length - 1) < 0.02, `${id} ends on a slope`);
    assert(rate("x", pts.length - 1) < 0.05, `${id} ends mid-bend`);
  }
});

// The fork's branches once diverged by less than their own half-width, so they
// never separated and the divider ribbon spanned the overlap inverted, painting
// a yellow slab over the lanes the player drives through.
Deno.test("renderer: fork branches separate and the divider fills only the gap between them", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "coconut-beach");

  const [divR, divL] = renderer.bForkDivider.pathArray;
  for (let i = 0; i < divL.length; i++) {
    assert(divR[i].x - divL[i].x >= 0, `divider inverted at fork point ${i}`);
  }
  const [, leftR] = renderer.bForkRoadL.pathArray;
  const [rightL] = renderer.bForkRoadR.pathArray;
  const last = leftR.length - 1;
  assert(rightL[last].x - leftR[last].x > 0, "branches must not overlap at the end of the stage");
});

Deno.test("renderer: past the fork a kart steering left rides the left branch", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));

  const state = apexrunEngine.initState(0x1337, { stageState: "racing" });
  const player = state.karts.find((k: any) => k.isPlayer) as any;
  player.x = -0.3;
  player.z = state.trackLength - 300;
  renderer.render(state, true, state, 1);

  const [leftL, leftR] = renderer.bForkRoadL.pathArray;
  const i = Math.floor((player.z * renderer.trackScale) / renderer.segLen) - renderer.trackPts.length + leftL.length;
  const x = renderer.bKartMeshes.get(player.character).root.position.x;
  assert(x > leftL[i].x && x < leftR[i].x, `kart at ${x.toFixed(1)} is off the left branch [${leftL[i].x.toFixed(1)}, ${leftR[i].x.toFixed(1)}]`);
});

// The sim parks a finished player at trackLength; wrapping it drew the car and
// camera back on the start line behind the results card.
Deno.test("renderer: a finished player stays at the end of the stage", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const state = apexrunEngine.initState(0x1337, { stageState: "finished", stageId: "destination-marina" });
  const player = state.karts.find((k: any) => k.isPlayer) as any;
  player.z = state.trackLength;
  renderer.render(state, true, state, 1);
  assertEquals(renderer.bKartMeshes.get(player.character).root.position.z, state.trackLength * renderer.trackScale);
});

// Owner: "the stage end has not improved, it is still driving into the void."
// A new stage respawns its traffic at random, and building its cars at the
// change of stage was 160 ms of the frame that froze there.
Deno.test("renderer: a change of stage draws its new traffic from cars built ahead of it", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const state = apexrunEngine.initState(0x4242, { stageState: "racing" });
  const types = ["sedan", "convertible", "pickup", "truck"];
  for (let frame = 0; frame < state.traffic.length * types.length; frame++) renderer.render(state, true, state, 1);
  let built = 0;
  const create = renderer._createTrafficMesh.bind(renderer);
  renderer._createTrafficMesh = (...args: any[]) => (built++, create(...args));
  for (const [i, car] of state.traffic.entries()) car.type = types[(types.indexOf(car.type) + 1 + i) % types.length];
  renderer.render(state, true, state, 1);
  assertEquals(built, 0);
  assertEquals(renderer.bTrafficMeshes.map((m: any) => m.type), state.traffic.map((t: any) => t.type));
  assertEquals([...renderer.trafficPool.values()].filter((m: any) => m.root.isVisible).length, state.traffic.length);
});

// Meshes were typed by slot while the sim types traffic at random, so a wide
// truck could be drawn as a convertible.
Deno.test("renderer: each traffic car is drawn as the archetype the sim spawned", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  for (const seed of [0x4242, 0x5353]) {
    const state = apexrunEngine.initState(seed, { stageState: "racing" });
    renderer.render(state, true, state, 1);
    assertEquals(renderer.bTrafficMeshes.map((m: any) => m.type), state.traffic.map((t: any) => t.type));
  }
});

// Branches once kept no lane markings: every line stopped at the fork, and
// each branch was centred on the trunk so its two lanes ran off one half.
Deno.test("renderer: past the fork each side's lane dashes ride its branch and the centre divider stops", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const { OUTRUN_STAGES } = await import("../shell/engine/simulation.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "coconut-beach");
  const forkStart = OUTRUN_STAGES["coconut-beach"].fork.forkSegment;

  const [leftOuter, leftInner] = renderer.bForkRoadL.pathArray;
  const [rightInner, rightOuter] = renderer.bForkRoadR.pathArray;
  const pastFork = (lane: number) => renderer.laneDashes
    .filter((d: any) => d.lane === lane && d.segment >= forkStart + 2)
    .map((d: any) => ({ i: d.segment, x: d.x }));

  assertEquals(pastFork(1).length, 0, "the centre divider runs into the gore");
  const left = pastFork(0);
  const right = pastFork(2);
  assert(left.length > 0 && right.length > 0, "both branches carry a lane divider");
  for (const { i, x } of left) {
    const k = i - forkStart;
    assert(x > leftOuter[k].x && x < leftInner[k].x, `left divider at segment ${i} leaves its branch`);
  }
  for (const { i, x } of right) {
    const k = i - forkStart;
    assert(x > rightInner[k].x && x < rightOuter[k].x, `right divider at segment ${i} leaves its branch`);
  }
});

// DESIGN.md "Ghibli gouache": the concept's road carries a yellow centre
// line between white lane lines and edges.
Deno.test("renderer: the centre line is yellow, the other lines white", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "coconut-beach");
  const lane = (k: number) => renderer.bLaneLines.find((m: any) => m.name === `bLane_${k}`).material;
  const rgb = (c: any) => [c.r, c.g, c.b];
  const [r, g, b] = rgb(lane(1).diffuseColor);
  assert(r > 0.8 && g > 0.6 && b < 0.35, `the centre line is yellow: ${[r, g, b]}`);
  for (const k of [0, 2]) assert(rgb(lane(k).diffuseColor).every((c: number) => c > 0.85), `lane line ${k} is white`);
});

// Every lane dash was its own instance: 540 scene meshes, each culled every
// frame and each marked dirty when a stage swapped its light, which held the
// frame for a third of a second. A lane's dashes are now one mesh's thin
// instances, drawn where each dash lies.
Deno.test("renderer: each lane's dashes are one mesh's thin instances", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "coconut-beach");
  const lanes = renderer.bLaneLines.filter((m: any) => m.name.startsWith("bLane_"));
  assertEquals(lanes.length, 3, "one mesh a lane");
  for (const [k, mesh] of lanes.entries()) {
    const dashes = renderer.laneDashes.filter((d: any) => d.lane === k);
    assert(dashes.length > 50, `lane ${k} has its dashes`);
    assertEquals(mesh.thinMatrices.length, dashes.length * 16, `lane ${k} draws each dash`);
    const last = dashes.length - 1;
    assertEquals([...mesh.thinMatrices.slice(last * 16 + 12, last * 16 + 15)].map((v) => Math.round(v * 100)), [dashes[last].x, dashes[last].y, dashes[last].z].map((v) => Math.round(Math.fround(v) * 100)), "at the dash's place");
  }
});

/** A racing frame pair on a curving, climbing stretch: `step` moves the
    player from prev to next between two sim ticks. */
async function tickPair(step: (prev: any, next: any) => void) {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const prev = apexrunEngine.initState(0x1337, { stageState: "racing" }) as any;
  prev.countdown = 0;
  const player = prev.karts.find((k: any) => k.isPlayer);
  player.z = 22000;
  player.x = 0.2;
  const next = JSON.parse(JSON.stringify(prev));
  step(prev.karts.find((k: any) => k.isPlayer), next.karts.find((k: any) => k.isPlayer));
  const frame = (alpha: number) => {
    renderer.render(next, false, prev, alpha);
    const root = renderer.bKartMeshes.get(player.character).root;
    const car = root.position;
    const cam = renderer.bCamera.position;
    return { car: { x: car.x, y: car.y, z: car.z, yaw: root.rotation.y }, cam: { x: cam.x, y: cam.y, z: cam.z } };
  };
  return { renderer, frame, next };
}

// Steering moved the car by its interpolated x while the chase camera read
// the tick's raw x, so between ticks the car lurched sideways against the
// camera: the "little teleports" the owner saw on every steer.
Deno.test("renderer: steering keeps the car steady against the chase camera between ticks", async () => {
  const { frame } = await tickPair((_prev, next) => { next.x = 0.6; next.z += 3; });
  const offsets = [0, 0.25, 0.5, 0.75, 1].map((a) => {
    const f = frame(a);
    return f.car.x - f.cam.x;
  });
  for (const o of offsets) assertAlmostEquals(o, offsets[0], 0.05, `car-to-camera offsets ${offsets}`);
});

// Steering only tilted the car and turned its nose a fixed fraction of the
// wheel, then by heuristics: the car now points where the sim's bicycle model
// heads it, interpolated between ticks.
Deno.test("renderer: the car points where the sim heads it", async () => {
  const run = async (prevHeading: number, nextHeading: number, alpha = 1) => {
    const { renderer, frame } = await tickPair((prev, next) => { next.z += 22; prev.heading = prevHeading; next.heading = nextHeading; });
    const f = frame(alpha);
    return f.car.yaw - renderer._roadAt(f.car.z, 0.2).yaw;
  };
  assertAlmostEquals(await run(0.1, 0.1), 0.1, 1e-9);
  assertAlmostEquals(await run(-0.05, -0.05), -0.05, 1e-9);
  assertAlmostEquals(await run(0, 0.1, 0.5), 0.05, 1e-9, "interpolated between ticks");
});

// The camera trailed the car sideways, so on every turn the car slid across
// the frame and back on release, unlike any racing game. The camera stays
// behind the car and looks a little along its heading instead.
Deno.test("renderer: steering, the camera stays behind the car and looks into the turn", async () => {
  const view = async (heading: number) => {
    const { renderer, frame } = await tickPair((prev, next) => { next.z += 22; prev.heading = next.heading = heading; });
    const f = frame(1);
    return { offset: f.car.x - f.cam.x, look: renderer.bCamera.target.x - f.cam.x };
  };
  const still = await view(0);
  const right = await view(0.1);
  const left = await view(-0.1);
  assertAlmostEquals(right.offset, still.offset, 1e-6, "the camera stays behind the car");
  assert(right.look > still.look + 0.5 && left.look < still.look - 0.5, `it looks into the turn: ${left.look} ${still.look} ${right.look}`);
});

// Each segment's start point was read without interpolation, so the car and
// the camera stepped sideways and up at every segment seam; the heading was
// each segment's chord, so the car snapped round at every seam too.
Deno.test("renderer: the car moves smoothly across a curving road segment seam", async () => {
  const { renderer } = await tickPair(() => {});
  const pts = renderer.trackPts;
  const seg = pts.findIndex((p: any, i: number) =>
    i > 10 && i < pts.length - 2 && Math.abs(pts[i + 1].x - p.x) > 0.05 && Math.abs(pts[i + 1].y - p.y) > 0.05);
  assert(seg > 0, "the stage has a curving, climbing segment");
  const seamZ = ((seg + 1) * renderer.segLen) / renderer.trackScale;
  const at = async (z: number) => {
    const { frame } = await tickPair((prev, next) => { prev.z = z; next.z = z; });
    return frame(1).car;
  };
  const before = await at(seamZ - 0.01);
  const after = await at(seamZ + 0.01);
  assertAlmostEquals(after.x, before.x, 0.01);
  assertAlmostEquals(after.y, before.y, 0.01);
  assertAlmostEquals(after.yaw, before.yaw, 0.001);
});

// The car's root was lifted 0.35 above the road for a kart whose wheels hung
// below it; the GT's wheels stop at the root, so it floated over its shadow.
Deno.test("renderer: the car's wheels rest on the road", async () => {
  const { renderer, frame } = await tickPair(() => {});
  const car = frame(1).car;
  const road = renderer._roadAt(car.z, 0.2);
  assertAlmostEquals(car.y, road.y, 0.01);
});

// The car sat level on every grade, so on Alpine Peaks' climbs its nose and
// tail sank into the asphalt and the body read as part of the road.
// Traffic took the hero car's wheelbase, so a truck's rear axle, three metres
// further back, floated or sank wherever the grade changed under it.
Deno.test("renderer: on a climb, a crest and a descent every axle rests on the road", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const onRoad = (root: any, x: number, axles: number[], label: string) => {
    const pitch = -root.rotation.x;
    for (const axle of axles) {
      const z = root.position.z + Math.cos(pitch) * axle;
      const y = root.position.y + Math.sin(pitch) * axle;
      assertAlmostEquals(y, renderer._roadAt(z, x).y, 0.03, `${label}, axle at ${axle}`);
    }
  };
  for (const seg of [88, 109, 130]) {
    const state = apexrunEngine.initState(0x1337, { stageState: "racing", stageId: "alpine-peaks", playerZ: seg * 200, playerX: 0.2 }) as any;
    state.countdown = 0;
    state.traffic = [{ z: seg * 200, x: -0.5, type: "truck", blinker: 0, brake: false }];
    renderer.render(state, false, state, 1);
    const player = state.karts.find((k: any) => k.isPlayer);
    onRoad(renderer.bKartMeshes.get(player.character).root, 0.2, [renderer.heroAxles.front, -renderer.heroAxles.rear], `segment ${seg} car`);
    const truck = renderer.bTrafficMeshes[0];
    onRoad(truck.root, -0.5, [truck.axleFront, -truck.axleRear], `segment ${seg} truck`);
  }
});

// Tulip beds scattered beside the road read as obstacles; the field is the
// ground itself, stripes 4 m wide, so its texture tiles over 16 m, not 4.
Deno.test("renderer: a stage's ground tiles at its own scale", async () => {
  setupMockBabylon();
  const { STAGE_ART, TILE_METRES } = await import("../shell/engine/art.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  for (const id of ["tulip-gardens", "coconut-beach"]) {
    buildStage(renderer, id);
    const tile = (STAGE_ART as any)[id].groundTile ?? TILE_METRES.ground;
    const terrain = renderer.bTerrain[0];
    const v = terrain.pathArray.flat()[7];
    assertAlmostEquals(terrain.uvs[7].x, v.x / tile, 1e-9, `${id} tiles every ${tile} m`);
  }
  assertEquals((STAGE_ART as any)["tulip-gardens"].ground, "tulip-field");
});

// The scatter is a layout's small scenery: never on the asphalt, never inside
// a prop or the flagman, and drawn only where the camera can see it, in
// chunks a few hundred metres long.
// The concept's verges are scrub and wildflowers: low, dense, textured
// masses. Ours were rounded blobs (four spheres a bush), which read as
// cotton balls beside it.
Deno.test("renderer: verge bushes are clumps of sprigs and tufts are blades, not rounded blobs", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const B = (globalThis as any).BABYLON;
  for (const kind of ["bush", "tuft", "flower"]) {
    const mesh = renderer._scatterMesh(B, kind, "#4E7A3A", 0);
    assert(mesh.merged >= (kind === "flower" ? 4 : 7), `${kind} is a clump of ${mesh.merged ?? 1} parts`);
  }
  // The concept's snow lies in soft continuous banks; ours were cotton balls.
  assert(renderer._scatterMesh(B, "drift", "#EEF3F7", 0).merged >= 3, "a drift is mounds strung along the road");
  // The concept's cacti are saguaros with arms; ours were green capsules.
  assert(renderer._scatterMesh(B, "cactus", "#3E6B33", 0).merged >= 7, "a cactus is a saguaro: a trunk and two elbowed arms");
});

Deno.test("renderer: verge scatter stands off the road and out of the props, drawn near the camera", async () => {
  setupMockBabylon();
  const { PROP_RADIUS } = await import("../shell/engine/stage_look.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "coconut-beach");
  assert(renderer.bScatter.length > 10, `scatter in chunks: ${renderer.bScatter.length}`);
  const at = renderer.bScatter.flatMap((c: any) => placedAt(c.mesh));
  assert(at.length > 5000, `hundreds a stretch: ${at.length} in all`);
  assert(at.some((p: any) => p.z < renderer.trackPts[0].z - 20), "and behind the start");
  const pts = renderer.trackPts;
  const rumble = renderer.lateralScale;
  for (const p of at.filter((_: any, n: number) => n % 37 === 0)) {
    if (p.z < pts[0].z) continue;
    const guess = Math.floor((p.z - pts[0].z) / renderer.segLen);
    let lateral = Infinity;
    for (let j = Math.max(0, guess - 4); j <= Math.min(pts.length - 1, guess + 4); j++) {
      const b = renderer.rights[j];
      const along = Math.abs((p.x - pts[j].x) * b.z - (p.z - pts[j].z) * b.x);
      if (along <= renderer.segLen / 2 + 0.5) lateral = Math.min(lateral, Math.abs((p.x - pts[j].x) * b.x + (p.z - pts[j].z) * b.z));
    }
    assert(lateral >= rumble + 0.2, `off the asphalt: ${lateral.toFixed(2)} from the centreline at z ${p.z.toFixed(0)}`);
  }
  const props = renderer.propPlacements.filter((pl: any) => !pl.behind && pl.side !== 0 && pl.kind in PROP_RADIUS).map((pl: any) => ({ ...renderer.propSpot(pl), r: (PROP_RADIUS as any)[pl.kind] * pl.scale }));
  for (const p of at.filter((_: any, n: number) => n % 11 === 0)) {
    for (const q of props) assert(Math.hypot(p.x - q.x, p.z - q.z) >= q.r * 0.9, `scatter at ${p.x.toFixed(1)},${p.z.toFixed(1)} inside a prop`);
  }
  const marshal = renderer.bMarshal.root.position;
  assert(at.every((p: any) => Math.hypot(p.x - marshal.x, p.z - marshal.z) >= 1), "clear of the flagman");
  const state = apexrunEngine.initState(0x1337, { stageState: "racing", stageId: "coconut-beach", playerZ: 20000 }) as any;
  state.countdown = 0;
  renderer.render(state, false, state, 1);
  const cam = renderer.bCamera.position.z;
  const shown = renderer.bScatter.filter((c: any) => c.mesh.isVisible);
  assert(shown.length > 0 && shown.length < renderer.bScatter.length / 2, `only chunks near the camera draw: ${shown.length} of ${renderer.bScatter.length}`);
  for (const c of shown) assert(c.z1 > cam - 40 && c.z0 < cam + 400, `a drawn chunk spans ${c.z0.toFixed(0)}-${c.z1.toFixed(0)} with the camera at ${cam.toFixed(0)}`);
});

// The start's swoop looked back over the car into grey nothing: the road
// and its world began at the grid. They run on behind it now.
Deno.test("renderer: the road, the land and the scenery run on behind the start", async () => {
  setupMockBabylon();
  const { LEAD_IN_METRES } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "coconut-beach");
  const z0 = renderer.trackPts[0].z;
  const reach = (name: string) => {
    const mesh = [renderer.bRoadLead, ...renderer.bTerrain].find((m: any) => m?.name === name);
    assert(mesh, `${name} is built`);
    return z0 - Math.min(...mesh.pathArray.flat().map((v: any) => v.z));
  };
  assert(LEAD_IN_METRES >= 300, `a lead-in long enough for the swoop: ${LEAD_IN_METRES}`);
  assert(reach("bRoadLead") >= LEAD_IN_METRES - 1, "the road runs on behind the grid");
  for (const side of [-1, 1]) assert(reach(`bTerrainLead_${side}`) >= LEAD_IN_METRES - 1, `the land on side ${side} too`);
  const behind = renderer.bModelSets.flatMap((set: any) => set.spots).filter((s: any) => s.z < z0 - 20);
  assert(behind.length > 10, `scenery stands behind the start: ${behind.length}`);
  assert(renderer.landmarks.every((m: any) => m.z >= z0), "and none of it is a landmark the camera turns to");
});

// The owner, of the end of a stage: "the stage end has not improved, it is
// still driving into the void." The road ran out where the stage did, so
// past the arch the car drove at an edge with nothing beyond, and then the
// next stage cut in. Through the whole checkpoint the road now runs on under
// and ahead of the car, the world hazes out into the switch and back in
// after it, and the camera never looks past the end of a road.
Deno.test("renderer: through a stage change the road runs on under and ahead of the car on every frame", async () => {
  setupMockBabylon();
  const { ARCH_LEAD, OUTRUN_STAGES } = await import("../shell/engine/simulation.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const stage = OUTRUN_STAGES["coconut-beach"];
  const L = stage.segmentCount * stage.segmentLength;
  let state = apexrunEngine.initState(0x1337, { stageState: "racing", stageId: "coconut-beach", playerZ: L - ARCH_LEAD - 3200, playerSpeed: 280, playerX: -0.4 }) as any;
  state.countdown = 0;
  const roads = () => [renderer.bRoad, renderer.bForkRoadL, renderer.bForkRoadR, renderer.bRoadLead, ...(renderer.bLeadOut ?? [])].filter(Boolean)
    .filter((m: any) => m.pathArray && m.isVisible !== false);
  const hazes: number[] = [];
  let switched = -1;
  for (let f = 0; f < 600; f++) {
    const prev = state;
    state = apexrunEngine.advanceFrame(state, { up: true });
    if (switched < 0 && state.stageId !== prev.stageId) switched = f;
    renderer.render(state, true, prev, 1);
    const car = renderer.bKartMeshes.get(state.karts.find((k: any) => k.isPlayer).character).root.position;
    const spans = roads().map((m: any) => { const zs = m.pathArray.flat().map((v: any) => v.z); return [Math.min(...zs), Math.max(...zs)]; });
    assert(spans.some(([lo, hi]: number[]) => lo <= car.z && hi >= car.z), `frame ${f}: a road under the car at ${car.z.toFixed(0)}`);
    const ahead = Math.max(...spans.map(([, hi]: number[]) => hi)) - car.z;
    assert(ahead >= 250, `frame ${f}: the road runs ${ahead.toFixed(0)} m ahead of the car`);
    hazes.push(renderer.transitionHaze);
  }
  assert(switched > 0, "the run reaches the next stage");
  assertEquals(hazes[0], 0, "clear air on the way to the arch");
  assert(hazes[switched] > 0.95, `the world is hazed out at the switch: ${hazes[switched]}`);
  assert(hazes.at(-1)! < 0.05, `and clear again once the next stage is under way: ${hazes.at(-1)}`);
  for (let f = 1; f < hazes.length; f++) assert(Math.abs(hazes[f] - hazes[f - 1]) < 0.1, `frame ${f}: the haze eases, ${hazes[f - 1]} to ${hazes[f]}`);
});

// The owner, of the end of the run: "finishing the last stage still drives
// the car into the void." The final stage's road ended at the finish line,
// so the car crossed it at speed toward an edge with nothing beyond, and the
// camera parked there looked at the void. Every ending's road now runs on
// past the final arch into its destination: the car drives itself in and
// pulls up before the place, on road and between land the whole way, the
// camera pulled up over the place and the haze held back.
Deno.test("renderer: every ending's road runs on into its destination, road and land under the car to the stop", async () => {
  setupMockBabylon();
  const { ARRIVAL_TICKS, OUTRUN_STAGES, METRES_PER_UNIT } = await import("../shell/engine/simulation.js") as any;
  const { STAGE_LOOKS, PROP_FOOTPRINT } = await import("../shell/engine/stage_look.js") as any;
  const { landmarkPull } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const endings = Object.keys(OUTRUN_STAGES).filter((id) => OUTRUN_STAGES[id].fork === null);
  assertEquals(endings.length, 5, "five endings");
  for (const stageId of endings) {
    const stage = OUTRUN_STAGES[stageId];
    const L = stage.segmentCount * stage.segmentLength;
    let state = apexrunEngine.initState(0x1337, { stageState: "racing", stageId, playerZ: L - 400 / METRES_PER_UNIT, playerSpeed: 280, playerX: -0.4 }) as any;
    state.traffic = [];
    renderer.render(state, true, state, 1);
    const spans = (meshes: any[]) => meshes.filter((m: any) => m?.pathArray).map((m: any) => {
      const zs = m.pathArray.flat().map((v: any) => v.z);
      return [Math.min(...zs), Math.max(...zs)];
    });
    const covers = (meshes: any[], z: number) => spans(meshes).some(([lo, hi]: number[]) => lo <= z && hi >= z);
    const roads = () => [renderer.bRoad, renderer.bRoadEnd];
    const land = (side: number) => renderer.bTerrain.filter((m: any) => m.name.endsWith(`_${side}`));
    let ended = -1;
    for (let f = 0; ended < 0 || state.endTicks < ARRIVAL_TICKS; f++) {
      assert(f < 2000, `${stageId}: the run ends and its set piece plays out`);
      const prev = state;
      state = apexrunEngine.advanceFrame(state, { up: true });
      if (ended < 0 && state.stageState === "finished") ended = f;
      renderer.render(state, false, prev, 1);
      const car = renderer.bKartMeshes.get(state.karts.find((k: any) => k.isPlayer).character).root.position;
      assert(covers(roads(), car.z), `${stageId}, frame ${f}: a road under the car at ${car.z.toFixed(0)}`);
      for (const side of [-1, 1]) assert(covers(land(side), car.z), `${stageId}, frame ${f}: land on side ${side} beside the car`);
      assertEquals(renderer.transitionHaze, 0, `${stageId}, frame ${f}: the haze is held back`);
    }
    const player = state.karts.find((k: any) => k.isPlayer);
    assertEquals([player.speed, state.parkedAt !== null], [0, true], `${stageId}: the car has pulled up`);
    const car = renderer.bKartMeshes.get(player.character).root.position;
    const [place] = STAGE_LOOKS[stageId].destination;
    const hero = renderer.landmarks.at(-1);
    assert(hero.hero && hero.z > car.z, `${stageId}: the place is the camera's last moment, ahead`);
    const gap = Math.hypot(hero.x - car.x, hero.z - car.z) - PROP_FOOTPRINT[place.kind] * place.scale;
    assert(gap > 20, `${stageId}: the car stops ${gap.toFixed(0)} m short of the place`);
    assertEquals(landmarkPull(hero.z - car.z), 1, `${stageId}: the camera pulls up over the place`);
    const far = Math.max(...spans([...land(-1), ...land(1)]).map(([, hi]: number[]) => hi));
    assert(far - hero.z >= 400, `${stageId}: land runs ${(far - hero.z).toFixed(0)} m on past the place`);
    assert(covers(renderer.bLeadOut.filter((m: any) => m.name === "bGroundEnd"), hero.z), `${stageId}: the place stands on ground`);
  }
});

// DESIGN.md "End of a run": pulled up at the ending, the driver waves. The
// pack bakes both her arms into her skin, hands on the wheel, so her outer
// arm is cut out as its own mesh at load and turns about her shoulder.
Deno.test("renderer: pulled up at her ending, the girl lifts her outer arm from the wheel and waves", async () => {
  setupMockBabylon();
  const { ARRIVAL_METRES, METRES_PER_UNIT } = await import("../shell/engine/simulation.js") as any;
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "destination-castle");
  const state = apexrunEngine.initState(0x1337, { stageState: "racing", stageId: "destination-castle" }) as any;
  const player = state.karts.find((k: any) => k.isPlayer);
  const { greet, riders } = renderer.bKartMeshes.get(player.character);
  const skin = riders[0].flatMap((r: any) => [r, ...r.getDescendants()]).find((n: any) => n.name.endsWith("girl_primitive0"));
  assertEquals(skin.indices, [0, 1, 2, 6, 7, 8], "her face and her inner arm stay in her skin");
  assertEquals(greet.arm.vertexData.positions.length, 9, "her outer arm is a mesh of its own");
  const hand = greet.arm.vertexData.positions.slice(6, 9);
  const B = (globalThis as any).BABYLON;
  const lifted = () => B.Vector3.TransformCoordinates(B.Vector3.TransformCoordinates(new MockVector3(hand[0], hand[1], hand[2]), B.Matrix.RotationX(greet.raise.rotation.x)), B.Matrix.RotationZ(greet.shoulder.rotation.z));
  state.stageState = "finished";
  player.z = state.trackLength + ARRIVAL_METRES / METRES_PER_UNIT;
  state.parkedAt = null;
  renderer.render(state, true, state, 1);
  assertEquals(greet.raise.rotation.x, 0, "both hands on the wheel while the car rolls");
  state.parkedAt = 0;
  state.endTicks = 60;
  renderer.render(state, true, state, 1);
  const up = lifted();
  assert(up.y > hand[1] + 0.3, `she lifts her hand: ${hand[1]} to ${up.y}`);
  assert(up.x > hand[0] + 0.1, `out past her hair, on her outer side: ${hand[0]} to ${up.x}`);
});

// DESIGN.md "End of a run": the road trip's cameras are the renderer's own,
// cosmetic and a pure function of the window and its frame, since a replay
// hands the renderer frames that jump back at every cut.
Deno.test("renderer: a replay window is cut from a helicopter, the landmark pull and the roadside, the same frame framed alike", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "ancient-ruins");
  const hero = renderer.landmarks.find((m: any) => m.hero);
  let state = apexrunEngine.initState(0x1337, { stageState: "racing", stageId: "ancient-ruins", playerZ: (hero.z - 360) / renderer.trackScale, playerSpeed: 250 }) as any;
  state.traffic = [];
  const frames = [state];
  for (let f = 0; f < 420; f++) frames.push(state = apexrunEngine.advanceFrame(state, { up: true }));
  const cut = { index: 0, count: 1, from: frames[0].tick, frames: 420 };
  const shot = (f: number) => {
    renderer.render(frames[f], false, frames[f - 1], 1, cut);
    const car = renderer.bKartMeshes.get(frames[f].karts.find((k: any) => k.isPlayer).character).root.position;
    const cam = renderer.bCamera.position;
    return { car: { x: car.x, y: car.y, z: car.z }, cam: { x: cam.x, y: cam.y, z: cam.z }, fov: renderer.bCamera.fov };
  };
  const heli = shot(60);
  assert(heli.cam.y - heli.car.y > 15 && heli.cam.z < heli.car.z, `a helicopter high behind the car: ${JSON.stringify(heli)}`);
  const pull = shot(200);
  assert(pull.cam.y - pull.car.y > 3 && pull.cam.z < pull.car.z - 8, `the chase camera pulled up and back: ${JSON.stringify(pull)}`);
  const side = shot(380);
  const road = renderer._roadAt(side.cam.z, 0);
  assert(Math.abs(side.cam.y - road.y - 1.4) < 0.01 && Math.abs(side.cam.x - road.x) > renderer.lateralScale, `a camera at the roadside: ${JSON.stringify(side)}`);
  assertEquals(renderer.speedBlurStrength, 0, "a camera off the car feels no speed");
  assertEquals(shot(60), heli, "a frame seen again after a jump back is framed alike");
});

// Building the next stage's verge models and scatter in the frame that
// changed stage was most of its freeze, the build and the first draw both.
Deno.test("renderer: a change of stage builds its verge a job a frame, all of it, inside the haze", async () => {
  setupMockBabylon();
  const { ARCH_LEAD, OUTRUN_STAGES } = await import("../shell/engine/simulation.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const stage = OUTRUN_STAGES["coconut-beach"];
  const L = stage.segmentCount * stage.segmentLength;
  let state = apexrunEngine.initState(0x1337, { stageState: "racing", stageId: "coconut-beach", playerZ: L - ARCH_LEAD - 50, playerSpeed: 280 }) as any;
  state.countdown = 0;
  let switched = -1;
  const built: number[] = [];
  for (let f = 0; f < 600 && (switched < 0 || renderer.stageJobs.length); f++) {
    const prev = state;
    state = apexrunEngine.advanceFrame(state, { up: true });
    renderer.render(state, true, prev, 1);
    if (switched < 0 && state.stageId !== prev.stageId) {
      switched = f;
      assertEquals(renderer.bModelSets.length + renderer.bScatter.length, 0, "the frame that changes stage builds no verge");
    }
    if (switched >= 0) {
      built.push(renderer.bModelSets.length + renderer.bScatter.length);
      assert(renderer.transitionHaze > 0.95, `frame ${f}: the verge builds in the haze, ${renderer.transitionHaze}`);
    }
  }
  assert(switched >= 0 && !renderer.stageJobs.length, "the run changes stage and builds out its verge");
  assert(built.length > 3, `over several frames: ${built.length}`);
  const deferred = { models: renderer.bModelSets.length, scatter: renderer.bScatter.length, shadowed: renderer.bModelSets.every((m: any) => m.lods) };
  buildStage(renderer, state.stageId);
  assertEquals(deferred, { models: renderer.bModelSets.length, scatter: renderer.bScatter.length, shadowed: true }, "the verge a full build has");
});

Deno.test("renderer: the haze thickens the fog and fades the painted sky, distance and clouds toward it", async () => {
  setupMockBabylon();
  const { ARCH_LEAD, OUTRUN_STAGES } = await import("../shell/engine/simulation.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const stage = OUTRUN_STAGES["coconut-beach"];
  const L = stage.segmentCount * stage.segmentLength;
  const at = (z: number, stageState: string) => {
    const s = apexrunEngine.initState(0x1337, { stageState, stageId: "coconut-beach", playerZ: z, playerSpeed: 280 }) as any;
    s.countdown = 0;
    renderer.render(s, true, s, 1);
    return { fog: renderer.scene.fogDensity, sky: renderer.bSkyMat.uniforms.haze, mid: renderer.bBackdropMats.mid.uniforms.haze, cloud: renderer.bClouds[0].visibility };
  };
  const clear = at(L - ARCH_LEAD - 4200, "racing");
  const thick = at(L - 1, "checkpoint");
  assert(thick.fog > 10 * clear.fog, `the fog thickens: ${clear.fog} to ${thick.fog}`);
  assertEquals(clear.sky, 0);
  assert(thick.sky > 0.95 && thick.mid > 0.95, `the sky and the painted distance fade into the haze: ${thick.sky}, ${thick.mid}`);
  assert(thick.cloud < 0.05, `and the clouds with them: ${thick.cloud}`);
});

// A 6 m grass verge kept the tulips off the asphalt, and the owner found the
// field poorer for it: tulips do not grow in the asphalt, but they grow right
// up to its edge.
Deno.test("renderer: the tulip field runs up to the asphalt's edge", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "tulip-gardens");
  for (const side of [-1, 1]) {
    const field = renderer.bTerrain.find((m: any) => m.name === `bTerrain_${side}`);
    const edge = side > 0 ? field.pathArray[field.pathArray.length - 1] : field.pathArray[0];
    const roadEdge = side > 0 ? renderer.bRumbleR.pathArray[0] : renderer.bRumbleL.pathArray[1];
    const gap = Math.hypot(edge[50].x - roadEdge[50].x, edge[50].z - roadEdge[50].z);
    assert(gap < 1e-6, `side ${side}: the field starts at the road's edge, ${gap} m off`);
  }
  assert(!renderer.bTerrain.some((m: any) => m.name.startsWith("bVerge")), "no verge between them");
});

// Metropolis Night's towers stood at their centre's ground height: climbing,
// the ground fell away under their downhill side and the owner saw their
// undersides.
Deno.test("renderer: a tower on a climb stands on the lowest ground along its footprint", async () => {
  setupMockBabylon();
  const { placeProps, PROP_FOOTPRINT } = await import("../shell/engine/stage_look.js");
  const { OUTRUN_STAGES } = await import("../shell/engine/simulation.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "metropolis-night");
  const stage = (OUTRUN_STAGES as any)["metropolis-night"];
  const towers = placeProps("metropolis-night", stage.segmentCount, stage.fork.forkSegment).filter((p: any) => p.kind === "tower");
  const pts = renderer.trackPts;
  assert(towers.length > 0, "the stage has towers");
  for (const pl of towers) {
    const y = renderer.propSpot(pl).y;
    const span = Math.ceil((PROP_FOOTPRINT as any).tower * pl.scale / renderer.segLen);
    for (let j = Math.max(0, pl.i - span); j <= Math.min(pts.length - 1, pl.i + span); j++) {
      assert(y <= renderer.groundY(pts[j], pl.side, pl.offset) + 1e-6, `the tower at ${pl.i} floats over segment ${j}`);
    }
  }
});

// A car's height came from the centreline at its own z, but the road and the
// ground beside it run out along each point's right vector: on a climbing
// curve the surface under a car off the centre is a point further along, so
// the car floated on one side and sank into the road or the snow on the other.
Deno.test("renderer: off the centreline on a climbing curve the car rests on the surface under it", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const surfaceY = (X: number, Z: number) => {
    const pts = renderer.trackPts, rights = renderer.rights;
    let best = { dist: Infinity, y: NaN };
    const i0 = Math.floor(Z / renderer.segLen);
    for (let f = Math.max(0, i0 - 4); f < Math.min(pts.length - 1, i0 + 4); f += 0.005) {
      const i = Math.floor(f), t = f - i;
      const px = pts[i].x + (pts[i + 1].x - pts[i].x) * t, pz = pts[i].z + (pts[i + 1].z - pts[i].z) * t;
      const rx = rights[i].x + (rights[i + 1].x - rights[i].x) * t, rz = rights[i].z + (rights[i + 1].z - rights[i].z) * t;
      const d = (X - px) * rx + (Z - pz) * rz;
      const dist = Math.hypot(px + rx * d - X, pz + rz * d - Z);
      if (dist < best.dist) best = { dist, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    }
    return best.y;
  };
  for (const x of [-1.4, -0.6, 0.6, 1.4]) {
    const state = apexrunEngine.initState(0x1337, { stageState: "racing", stageId: "alpine-peaks", playerZ: 8183, playerX: x }) as any;
    state.countdown = 0;
    renderer.render(state, false, state, 1);
    const root = renderer.bKartMeshes.get(state.karts.find((k: any) => k.isPlayer).character).root;
    assertAlmostEquals(root.position.y, surfaceY(root.position.x, root.position.z), 0.05, `x ${x}`);
  }
});

// The chase camera aimed at the road 16 m ahead: on a climb that is 5 m up,
// the view tilted up and the car slid down out of the frame, leaving its
// roof over the road; on a crest the road between hid its lower half.
Deno.test("renderer: the chase camera holds the car in the same place in the frame on any grade", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const view = (stage: string, seg: number) => {
    const state = apexrunEngine.initState(0x1337, { stageState: "racing", stageId: stage, playerZ: seg * 200 }) as any;
    state.countdown = 0;
    // Nothing nearby: traffic draws the camera back on purpose.
    state.traffic = [];
    for (const k of state.karts) if (!k.isPlayer) k.z = -1e6;
    renderer.render(state, false, state, 1);
    // A landmark's moment draws the camera back on purpose too.
    renderer.landmarks = [];
    renderer.render(state, false, state, 1);
    const root = renderer.bKartMeshes.get(state.karts.find((k: any) => k.isPlayer).character).root;
    const cam = renderer.bCamera;
    const toCar = Math.atan2(root.position.y - cam.position.y, root.position.z - cam.position.z);
    const look = Math.atan2(cam.target.y - cam.position.y, cam.target.z - cam.position.z);
    return { pitch: -root.rotation.x, below: look - toCar };
  };
  // A crest ahead lifts the camera on purpose (the camera breathes test), so
  // the framing holds on a steady grade: one that does not change ahead.
  const steady = (stage: string) => {
    buildStage(renderer, stage);
    const pts = renderer.trackPts;
    const grade = (i: number) => (pts[i + 1].y - pts[i].y) / renderer.segLen;
    for (let i = 20; i < pts.length - 10; i++) {
      if (Math.abs(grade(i)) > 0.06 && [1, 2, 3, 4].every((k) => Math.abs(grade(i + k) - grade(i)) < 0.002)) return i;
    }
    throw new Error(`${stage} has no steady grade`);
  };
  const flat = view("alpine-peaks", 10);
  for (const stage of ["alpine-peaks", "ancient-ruins", "desert-canyons"]) {
    const seg = steady(stage) * renderer.segLen / renderer.trackScale / 200;
    const v = view(stage, seg);
    assert(Math.abs(v.pitch) > 0.05, `${stage} ${seg} is on a grade`);
    assertAlmostEquals(v.below, flat.below, 0.01, `${stage} ${seg}: the car sits as far below the view's centre as on the flat`);
  }
});

// The concept's polder road runs under a power line: poles alone read as
// posts (t31). Wires hang from pole to pole, three a span, sagging.
Deno.test("renderer: the tulip road's power line carries sagging wires", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "tulip-gardens");
  const lines = renderer.bWires.lines;
  assert(lines.length >= 30 && lines.length % 3 === 0, `${lines.length} wires`);
  for (const w of lines.slice(0, 6)) {
    const mid = w[Math.floor(w.length / 2)];
    assert(mid.y < (w[0].y + w.at(-1).y) / 2 - 0.3, "a wire sags mid-span");
  }
  // At speed instanced poppies read as dots: the verge is painted as a
  // flower carpet both sides, the heads standing on it near the camera.
  assertEquals(renderer.bCarpet.map((m: any) => m.name).sort(), ["bCarpet_-1", "bCarpet_1"]);
  buildStage(renderer, "desert-canyons");
  assertEquals(renderer.bWires, null, "no poles, no wires");
  assertEquals(renderer.bCarpet.length, 0, "and no carpet");
});

// The owner chose the Ghibli concepts' composition: a higher, further,
// longer-lensed view with the car small at the foot of the frame, the road
// running to a low horizon and the sky about 35-40% of the frame, where the
// old close chase filled a third of the width with the car.
Deno.test("renderer: the chase camera frames the concept: a small car, a long lens, sky over a third of the frame", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const state = apexrunEngine.initState(0x1337, { stageState: "racing", stageId: "tulip-gardens", playerZ: 2000, playerSpeed: 120 }) as any;
  state.countdown = 0;
  state.traffic = [];
  for (const k of state.karts) if (!k.isPlayer) k.z = -1e6;
  renderer.render(state, false, state, 1);
  renderer.landmarks = []; // the resting frame, away from any landmark's moment
  for (let i = 0; i < 120; i++) renderer.render(state, false, state, 1);
  const cam = renderer.bCamera;
  const car = renderer.bKartMeshes.get(state.karts.find((k: any) => k.isPlayer).character).root.position;
  const half = Math.tan(cam.fov / 2);
  const pitch = Math.atan2(cam.position.y - cam.target.y, Math.hypot(cam.target.x - cam.position.x, cam.target.z - cam.position.z));
  const sky = 0.5 - Math.tan(pitch) / (2 * half);
  assert(sky >= 0.35 && sky <= 0.4, `sky ${sky.toFixed(3)} of the frame`);
  assert(cam.fov <= 0.72, `a long lens: ${cam.fov.toFixed(3)}`);
  const distance = Math.hypot(car.x - cam.position.x, car.z - cam.position.z);
  // The car's tail is nearest the lens and widest in the frame.
  const [lo, hi] = MANIFEST["model/car-hero/lod0"].bounds_m;
  const tail = distance - Math.max(-lo[2], hi[2]);
  const width = (hi[0] - lo[0]) / (tail * 2 * half * 16 / 9);
  assert(width >= 0.22 && width <= 0.28, `the car's tail spans ${width.toFixed(3)} of a 16:9 frame`);
  const below = Math.atan2(cam.position.y - car.y, distance) - pitch;
  const foot = 0.5 + Math.tan(below) / (2 * half);
  assert(foot >= 0.7 && foot <= 0.87, `the car sits at ${foot.toFixed(3)} down the frame`);
});

// Upright on a phone the vertical lens cropped the frame to its middle: the
// car filled the screen's width and the road ran off its sides.
Deno.test("renderer: a screen narrower than 16:9 keeps the 16:9 frame's width in view", async () => {
  const { coverFov } = await import("../shell/engine/renderer.js");
  const across = (fov: number, aspect: number) => Math.tan(fov / 2) * aspect;
  assertEquals(coverFov(0.68, 16 / 9), 0.68);
  assertEquals(coverFov(0.68, 21 / 9), 0.68);
  assertAlmostEquals(across(coverFov(0.68, 390 / 844), 390 / 844), across(0.68, 16 / 9), 1e-9);
});

// The chase camera sat at one fixed offset: the owner found it boring. It now
// breathes with speed, lifts over crests and swings wide past landmarks, all
// as smooth functions of the state, so replays and scrubs frame the same.
Deno.test("renderer: the camera pulls back as speed builds", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const gap = (speed: number) => {
    const state = apexrunEngine.initState(0x1337, { stageState: "racing", stageId: "alpine-peaks", playerZ: 2000, playerSpeed: speed }) as any;
    state.countdown = 0;
    state.traffic = [];
    for (const k of state.karts) if (!k.isPlayer) k.z = -1e6;
    renderer.render(state, false, state, 1);
    const car = renderer.bKartMeshes.get(state.karts.find((k: any) => k.isPlayer).character).root.position;
    return car.z - renderer.bCamera.position.z;
  };
  assert(gap(300) > gap(60) + 0.6, `${gap(60)} -> ${gap(300)}`);
});

// A car close by draws the camera in toward the hood, all the way when it
// is kept alongside, for concentration; nitro is what pushes it back. The
// owner found the camera snapping in as a car came near: it eases over
// seconds, so a passing car draws it only part way.
Deno.test("renderer: traffic close by draws the camera in, slowly", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const gap = (trafficAhead: number | null, frames = 600) => {
    const state = apexrunEngine.initState(0x1337, { stageState: "racing", stageId: "alpine-peaks", playerZ: 2000, playerSpeed: 200 }) as any;
    state.countdown = 0;
    for (const k of state.karts) if (!k.isPlayer) k.z = -1e6;
    const player = state.karts.find((k: any) => k.isPlayer);
    state.traffic = trafficAhead === null ? [] : [{ z: player.z + trafficAhead / renderer.trackScale, x: player.x + 0.4, type: "sedan", blinker: 0, brake: false }];
    for (let i = 0; i < frames; i++) renderer.render(state, false, state, 1);
    const car = renderer.bKartMeshes.get(player.character).root.position;
    return car.z - renderer.bCamera.position.z;
  };
  const alone = gap(null);
  const held = gap(5);
  assert(held < alone - 0.6, `a car kept alongside: ${held} vs ${alone}`);
  gap(null);
  const passing = gap(5, 60);
  assert(passing > held + 0.3 && passing < alone, `a second alongside draws it part way: ${passing} (held ${held}, alone ${alone})`);
  gap(null);
  assert(gap(70) < alone - 0.05, `a car seen 70 m ahead starts drawing it in: ${gap(70)} vs ${alone}`);
  gap(null, 3000);
  assert(Math.abs(gap(150) - alone) < 0.05, "a car far ahead changes nothing");
  gap(5);
  const leaving = gap(null, 60);
  assert(leaving < held + (alone - held) * 0.4, `a second after the car is gone, the camera is still mostly in: ${leaving} (held ${held}, alone ${alone})`);
});

// The owner: "I think we had this idea that each scenario had a unique
// landmark? I dont see them [...] The zoom out camera trick on parts of the
// scenario was also very nice, is it still there?" It was, but it landed on
// whichever mesa, cliff or windmill came first, often at the start, and was
// fullest as the landmark passed beside the car, out of the frame. Each
// stage now has one hero landmark of its own; the camera pulls back while it
// stands ahead, turns toward it, and lets go as it passes.
Deno.test("renderer: every stage has a hero landmark of its own, and the camera turns to frame it", async () => {
  setupMockBabylon();
  const { STAGE_LOOKS } = await import("../shell/engine/stage_look.js");
  const { STAGE_ART } = await import("../shell/engine/art.js");
  const heroes = new Map<string, string>();
  for (const [id, look] of Object.entries(STAGE_LOOKS) as [string, any][]) {
    const specs = look.props.filter((p: any) => p.landmark);
    assert(specs.length >= 1, `${id} has a hero landmark`);
    for (const spec of specs) {
      assert((STAGE_ART as any)[id].models[spec.kind], `${id}'s ${spec.kind} is a painted model`);
      assert(!heroes.has(spec.kind) || heroes.get(spec.kind) === id, `${spec.kind} is ${heroes.get(spec.kind)}'s, not also ${id}'s`);
      heroes.set(spec.kind, id);
    }
  }
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  for (const stageId of ["desert-canyons", "alpine-peaks", "coconut-beach", "ancient-ruins"]) {
    buildStage(renderer, stageId);
    const hero = renderer.landmarks.find((m: any) => m.hero);
    assert(hero, `${stageId}: the camera has a moment for its hero`);
    assert(hero.z - renderer.trackPts[0].z >= 400, `${stageId}: not at the start`);
    for (const ahead of [400, 220, 150, 100]) {
      const state = apexrunEngine.initState(0x1337, { stageState: "racing", stageId, playerZ: (hero.z - ahead) / renderer.trackScale, playerSpeed: 200 }) as any;
      state.countdown = 0;
      state.traffic = [];
      for (const k of state.karts) if (!k.isPlayer) k.z = -1e6;
      renderer.render(state, false, state, 1);
      const cam = renderer.bCamera;
      const look = Math.atan2(cam.target.x - cam.position.x, cam.target.z - cam.position.z);
      const to = Math.atan2(hero.x - cam.position.x, hero.z - cam.position.z);
      const across = Math.atan(Math.tan(cam.fov / 2) * 16 / 9);
      assert(Math.abs(to - look) < across * 0.85, `${stageId}, ${ahead} m out: the hero ${(to - look).toFixed(2)} rad off the aim, the frame ±${across.toFixed(2)}`);
    }
  }
});

// The owner, of the moment above: "The camera pull may be a bit too subtle
// and a bit too short, I think it was more noticeable before. It is there,
// but I think there is room for more." The pre-Ghibli pull nearly doubled
// the close chase's distance and height; on today's long lens the same
// metres read as half the move. It now more than doubles both, widens the
// lens, and holds from 450 m out to the last 90 m. Then: "camera pull
// improved, but may be a bit too much now, tune it down just a little": at
// 2.7 times its resting height it overshot, so it rises about a fifth less,
// over the same distance.
Deno.test("renderer: a landmark ahead draws the camera well up and wide, for long, then lets it settle", async () => {
  const { landmarkPull } = await import("../shell/engine/renderer.js");
  assert(landmarkPull(560) > 0.15 && landmarkPull(450) > 0.97, `it builds from far out: ${landmarkPull(560)}, ${landmarkPull(450)}`);
  for (const ahead of [450, 300, 150, 90]) assert(landmarkPull(ahead) > 0.97, `and holds at ${ahead} m`);
  assertEquals(landmarkPull(-60), 0, "gone once passed");

  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "destination-colosseum");
  const mark = renderer.landmarks[0];
  assert(mark, "the colosseum stage has a landmark");
  const lift = (z: number) => {
    const state = apexrunEngine.initState(0x1337, { stageState: "racing", stageId: "destination-colosseum", playerZ: z / renderer.trackScale, playerSpeed: 200 }) as any;
    state.countdown = 0;
    state.traffic = [];
    for (const k of state.karts) if (!k.isPlayer) k.z = -1e6;
    renderer.render(state, false, state, 1);
    const car = renderer.bKartMeshes.get(state.karts.find((k: any) => k.isPlayer).character).root.position;
    return renderer.bCamera.position.y - car.y;
  };
  const near = lift(mark.z - 150);
  const far = lift(mark.z - 800);
  assert(near > 2.1 * far && near < 2.5 * far, `the camera rises to a little over twice its height: near ${near}, far ${far}`);
  for (let d = -200; d < 200; d += 2) {
    assert(Math.abs(lift(mark.z + d + 2) - lift(mark.z + d)) < 0.15, `no jump at ${d} m`);
  }
});

// The horizon was the terrain ribbon fading into fog, then flat ridge
// ribbons; the owner chose the Ghibli concepts, whose distance is painted:
// "continuous wide painted backdrops in 2-3 parallax layers". Strips laid
// along the road showed only as a sliver at the vanishing point, so they are
// rings about the camera, as the sky is.
Deno.test("renderer: every stage paints its distance as rings of backdrop that keep their painted aspect", async () => {
  setupMockBabylon();
  const { STAGE_LOOKS } = await import("../shell/engine/stage_look.js");
  const { stageArtIds, artUrl } = await import("../shell/engine/art.js");
  const { BACKDROP_ASPECT } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  for (const [id, look] of Object.entries(STAGE_LOOKS) as [string, any][]) {
    buildStage(renderer, id);
    const ids = stageArtIds(id);
    assertEquals(renderer.bHorizon.map((m: any) => m.backdrop.layer), ["far", "mid"], id);
    const [far, mid] = renderer.bHorizon;
    assert(far.backdrop.radius > mid.backdrop.radius && far.backdrop.height > mid.backdrop.height, `${id} far stands behind and above mid`);
    for (const m of renderer.bHorizon) {
      assert(ids.includes(`backdrop/${id}.${m.backdrop.layer}`), `${id} loads its ${m.backdrop.layer} backdrop`);
      assertEquals(m.applyFog, false, `${id} strips carry their painted haze`);
      assertEquals(m.material.uniforms.backdropTexture.url, artUrl(MANIFEST, `backdrop/${id}.${m.backdrop.layer}`));
      const top = m.pathArray[1];
      assertAlmostEquals(top[0].x, top.at(-1).x, 1e-6, `${id} ring closes`);
      assertEquals(m.uvs.at(-1).x % 1, 0, `${id} ${m.backdrop.layer} wraps on a whole tile`);
      const tileWidth = (2 * Math.PI * m.backdrop.radius) / m.uvs.at(-1).x;
      assertAlmostEquals(tileWidth, m.backdrop.height * BACKDROP_ASPECT, tileWidth * 0.05, `${id} ${m.backdrop.layer} keeps its aspect`);
    }
    // The mid ring opens around the road; across water only the far shore shows.
    assertEquals(far.material.uniforms.gap, 0);
    assertEquals(mid.material.uniforms.gap, 1);
    assertEquals(mid.material.uniforms.waterSide, look.water ? (look.water.side === "left" ? -1 : 1) : 0, id);
  }
});

Deno.test("renderer: the palm is a hero model", async () => {
  setupMockBabylon();
  const { PROP_BUILDERS } = await import("../shell/engine/stage_look.js");
  const B = (globalThis as any).BABYLON;
  const parts = PROP_BUILDERS.palm(B, {}, () => ({}));
  const named = (p: string) => parts.filter((m: any) => m.name.startsWith(`palm#${p}`));
  assert(named("trunk").length >= 8, "a curved trunk in rings");
  assert(named("frond").length >= 12, "a full crown");
  assert(named("coconut").length >= 3, "a coconut cluster");
  assert(named("dry").length >= 2, "a skirt of dry fronds");
  const trunk = named("trunk").map((m: any) => m.position);
  assert(trunk.at(-1).x > trunk[0].x + 0.5, "the trunk leans and curves");
});

Deno.test("renderer: scatter fills the ground on the stages it belongs to", async () => {
  setupMockBabylon();
  const { PROP_BUILDERS, STAGE_LOOKS } = await import("../shell/engine/stage_look.js");
  for (const kind of ["rock", "shrub", "grassTuft"] as const) assert(PROP_BUILDERS[kind], `${kind} builder`);
  const scattered = Object.values(STAGE_LOOKS).filter((l: any) => l.props.some((p: any) => ["rock", "shrub", "grassTuft"].includes(p.kind)));
  assertEquals(scattered.length, 13, "scatter on every stage but the marina and the metropolis");
});

// A ribbon's default UVs run 0..1 along each path, so the ground detail map
// stretched once over kilometres of route and a few metres across it.
Deno.test("renderer: the ground detail keeps one texel size along and across the road", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  for (const terrain of renderer.bTerrain) {
    const points = terrain.pathArray.flat();
    assertEquals(terrain.uvs.length, points.length, `${terrain.name} has a UV per vertex`);
    const along = Math.hypot(points[1].x - points[0].x, points[1].z - points[0].z);
    const uvAlong = Math.hypot(terrain.uvs[1].x - terrain.uvs[0].x, terrain.uvs[1].y - terrain.uvs[0].y);
    const n = terrain.pathArray[0].length;
    const across = Math.hypot(points[n].x - points[0].x, points[n].z - points[0].z);
    const uvAcross = Math.hypot(terrain.uvs[n].x - terrain.uvs[0].x, terrain.uvs[n].y - terrain.uvs[0].y);
    assertAlmostEquals(uvAlong / along, uvAcross / across, 1e-9);
  }
});

// Coastal Cliffs stood its 22 m cliff block 14 m from the rumble edge at up
// to 1.6x with a random yaw, so its corners reached over the road and walled
// off half the screen.
Deno.test("renderer: no solid prop's footprint reaches the road", async () => {
  setupMockBabylon();
  const { STAGE_LOOKS } = await import("../shell/engine/stage_look.js");
  // Half the widest horizontal diagonal of each solid builder, at scale 1.
  const reach: Record<string, number> = { cliff: Math.hypot(22, 30) / 2, rock: 1.57 };
  for (const [id, look] of Object.entries(STAGE_LOOKS) as [string, any][]) {
    for (const spec of look.props) {
      if (!(spec.kind in reach)) continue;
      assert(reach[spec.kind] * spec.scale[1] <= spec.near, `${id} ${spec.kind} at ${spec.near} m reaches ${reach[spec.kind] * spec.scale[1]} m`);
    }
  }
});

// Fronds blended rather than cut out sort per mesh, not per instance, so a
// crown's back fronds drew over its front ones.
Deno.test("renderer: palm fronds are alpha-tested cut-outs", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const B = (globalThis as any).BABYLON;
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const frond = renderer._propMaterial(B, "#FFFFFF", "#1C3A14", "frond");
  assertEquals(frond.transparencyMode, B.Material.MATERIAL_ALPHATEST);
  assertEquals(frond.backFaceCulling, false);
});

// Every CHARACTERS entry got a hero mesh, but only four race; the unused
// red one stayed on the start grid, a clone the player drove away from.
Deno.test("renderer: only the cars in the race are drawn", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const state = apexrunEngine.initState(0x1337, { stageState: "racing" }) as any;
  renderer.render(state);
  const racing = new Set(state.karts.map((k: any) => k.character));
  for (const [character, mesh] of renderer.bKartMeshes) {
    assertEquals(mesh.root.isVisible, racing.has(character), `${character} drawn`);
  }
});

// Shore scatter used the dry side's reach, so shrubs and grass past the
// waterline stood on nothing over the sea.
Deno.test("renderer: land props stay on land on the sea side", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const { STAGE_LOOKS } = await import("../shell/engine/stage_look.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  for (const [id, look] of Object.entries(STAGE_LOOKS) as [string, any][]) {
    if (!look.water) continue;
    buildStage(renderer, id);
    const wet = look.water.side === "left" ? -1 : 1;
    const pts = renderer.trackPts;
    for (const m of renderer.bDecorMeshes) {
      const kind = m.name.split("#")[0];
      if (kind === "sailboat") continue;
      for (const at of placedAt(m)) {
        const i = Math.max(0, Math.min(pts.length - 1, Math.round(at.z / renderer.segLen)));
        const r = renderer.rights[i];
        const lateral = (at.x - pts[i].x) * r.x + (at.z - pts[i].z) * r.z;
        if (Math.sign(lateral) !== wet) continue;
        const shore = renderer.lateralScale + renderer.forkDiverge[i] + 30;
        assert(Math.abs(lateral) <= shore + 3, `${id} ${m.name} stands ${Math.abs(lateral).toFixed(1)} out, past the shore at ${shore}`);
      }
    }
  }
});

// Placements on the sea side stood at the road's height, so sailboats past
// the shore hovered metres over the water.
// The sea was one flat plane set out from the stage's middle, while the
// beach follows the road: where the road bent away from the sea, haze showed
// between the shore and the water's edge, and the owner saw the boats there
// standing in the sand. The sea starts at the shore all along the road.
Deno.test("renderer: the sea meets the shore all along the road, under every boat", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "coconut-beach");
  const sea = renderer.bWater.find((m: any) => m.name === "bWater");
  const beach = renderer.bTerrain.find((m: any) => m.name === "bTerrain_-1");
  // The left side's paths run from the road outward.
  const shore = beach.pathArray[beach.pathArray.length - 1];
  const inner = sea.pathArray[0];
  const outer = sea.pathArray[sea.pathArray.length - 1];
  for (const k of [0, 50, 200, shore.length - 1]) {
    assert(Math.hypot(inner[k].x - shore[k].x, inner[k].z - shore[k].z) < 1e-6, `segment ${k}: the sea starts where the beach ends`);
  }
  assert(Math.hypot(outer[0].x - inner[0].x, outer[0].z - inner[0].z) > 1000, "and runs out to the horizon");
  const boats = renderer.bModelSets.filter((s: any) => s.id === "sailboat").flatMap((s: any) => s.spots);
  for (const b of boats) assert(b.y === inner[0].y, `a boat at ${b.x.toFixed(0)}, ${b.z.toFixed(0)} floats at sea level`);
});

Deno.test("renderer: sailboats past the shore float on the sea", async () => {
  setupMockBabylon();
  const { placeProps, SHORE } = await import("../shell/engine/stage_look.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "destination-marina");
  const n = renderer.trackPts.length;
  const afloat = renderer.propPlacements.filter((p: any) => p.kind === "sailboat" && p.offset >= SHORE).length;
  assert(afloat > placeProps("destination-marina", n, n).filter((p: any) => p.kind === "sailboat" && p.offset >= SHORE).length, "boats float behind the start too");
  const sea = renderer.bWater[0].pathArray[0][0].y;
  const boats = renderer.bModelSets.filter((s: any) => s.id === "sailboat").flatMap((s: any) => s.spots);
  assert(afloat > 0, "the marina has sailboats past its shore");
  assertEquals(boats.filter((s: any) => s.y === sea).length, afloat);
});

// Traffic was lofted primitives; it is the pack's 80s bodies, and the paint
// is each car's own, so recolouring one does not recolour the rest.
Deno.test("renderer: traffic is the pack's cars, each in its own paint", async () => {
  const B = setupMockBabylon();
  const { TRAFFIC_MODELS } = await import("../shell/engine/art.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  for (const type of Object.keys(TRAFFIC_MODELS)) {
    const a = renderer._createTrafficMesh(B, 0, type);
    const b = renderer._createTrafficMesh(B, 1, type);
    assert(a.matBody.name.endsWith("paint") && a.matTail.name.endsWith("taillight"), `${type} drives its paint and tail lights`);
    assert(a.matBody !== b.matBody && a.matBody.albedoColor.hex !== b.matBody.albedoColor.hex, `${type} cars are painted apart`);
    const hubs = MANIFEST[`model/${TRAFFIC_MODELS[type as keyof typeof TRAFFIC_MODELS]}/lod1`].wheels;
    assertEquals([a.axleFront, a.axleRear], [hubs.find((w: any) => w.name === "wheel_FL").hub[2], -hubs.find((w: any) => w.name === "wheel_RL").hub[2]], `${type} pitches on its own axles`);
  }
});

Deno.test("renderer: WebGPU first, WebGL2 when the browser has no adapter", async () => {
  const B = setupMockBabylon();
  const { createEngine } = await import("../shell/engine/renderer.js");
  const made: string[] = [];
  B.WebGPUEngine = class { isWebGPU = true; constructor() { made.push("webgpu"); } async initAsync() {} };
  B.Engine = class { isWebGPU = false; constructor() { made.push("webgl"); } };
  const canvas = {};
  const gpu = { requestAdapter: async () => ({}) };
  assertEquals((await createEngine(B, canvas, gpu)).isWebGPU, true);
  assertEquals((await createEngine(B, canvas, { requestAdapter: async () => null })).isWebGPU, false);
  assertEquals((await createEngine(B, canvas, undefined)).isWebGPU, false);
  assertEquals(made, ["webgpu", "webgl", "webgl"]);
});

// The game drives scene.render() from its own loop. WebGPU acquires and
// presents the swap-chain texture in beginFrame/endFrame, so without them
// every frame submitted to a destroyed texture and the canvas stayed black.
Deno.test("renderer: each scene render is bracketed by an engine frame", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const state = apexrunEngine.initState(0x1337, { stageState: "racing" });
  let rendered = 0;
  renderer.scene.render = () => { renderer.engine.frames.push("render"); rendered++; };
  renderer.render(state);
  renderer.render(state);
  assertEquals(rendered, 2);
  assertEquals(renderer.engine.frames, ["begin", "render", "end", "begin", "render", "end"]);
});

// Every placement was its own instance node, about 16,000 on Coconut Beach,
// and culling them cost ~24 ms of CPU a frame under WebGPU.
Deno.test("renderer: props draw as thin instances, one mesh per part", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const { placeProps } = await import("../shell/engine/stage_look.js");
  const { OUTRUN_STAGES } = await import("../shell/engine/simulation.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "destination-aerodrome");
  const stage = OUTRUN_STAGES["destination-aerodrome"];
  const lights = renderer.propPlacements.filter((p: any) => p.kind === "runwayLight").length;
  assert(lights > placeProps("destination-aerodrome", stage.segmentCount, stage.segmentCount).filter((p: any) => p.kind === "runwayLight").length, "and behind the start");
  const lamp = renderer.bDecorMeshes.find((m: any) => m.name === "runwayLight#lamp");
  assertEquals(placedAt(lamp).length, lights, "every runway light is a thin instance of the one lamp");
  assert(renderer.bDecorMeshes.length < 200, `${renderer.bDecorMeshes.length} decor meshes`);
});

// The road's maps each carried their own tiling, so each cost the shader a UV
// varying; with fog and shadows that was 17 fragment inputs, past the 16
// Apple's GPUs allow, and every surface pipeline failed: a black screen.
Deno.test("renderer: the road and ground tile their maps through the mesh's own UVs", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  for (const mat of [renderer.bMaterials.road, renderer.bGroundMat]) {
    for (const t of [mat.albedoTexture, mat.bumpTexture, mat.metallicTexture]) {
      assertEquals([t.uScale, t.vScale], [1, 1], `${mat.name} maps share one UV set`);
    }
  }
  const uvs = renderer.bRoad.uvs ?? [];
  assert(uvs.length > 0, "the road ribbon carries its own UVs");
  const { TILE_METRES } = await import("../shell/engine/art.js");
  const length = renderer.trackPts.length * renderer.segLen;
  assertAlmostEquals(Math.max(...uvs.map((v: any) => v.x)), length / TILE_METRES.road, length / TILE_METRES.road * 0.05, "u counts tiles along the road");
});

// The pack's exposure assumes the sky lights a surface once; the hemispheric
// fill lit the road, ground and models a second time, about a stop too bright.
Deno.test("renderer: what the sky lights, the hemispheric fill leaves out", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "alpine-peaks");
  const mask = renderer.bHemi.excludeWithLayerMask;
  assert(mask, "the fill excludes a layer");
  const lit = [renderer.bRoad, ...renderer.bTerrain, ...renderer.bModelSets.flatMap((s: any) => s.lods.flatMap((l: any) => l.parts.map((p: any) => p.mesh)))];
  for (const m of lit) assert(m.layerMask & mask, `${m.name} is lit by the sky alone`);
});

// Direction B, "Stylised AAA" (DESIGN.md): one pass draws the ink outlines,
// the toon light and the saturation over every asset alike.
Deno.test("renderer: the stylising pass ships in GLSL and WGSL", async () => {
  const B = setupMockBabylon();
  await makeRenderer({ width: 960, height: 540 } as any);
  for (const k of ["depthSampler", "outline", "saturation", "inkFar"]) {
    assert(B.Effect.ShadersStore.stkStylePixelShader?.includes(k), `GLSL style has ${k}`);
    assert(B.ShaderStore.ShadersStoreWGSL.stkStylePixelShader?.includes(k), `WGSL style has ${k}`);
  }
});

// The painted skies are finished images: run through ACES and the exposure
// again they washed out, so the dome undoes both before the pipeline redoes them.
Deno.test("renderer: the sky dome draws the stage's painted sky through the tone curve unchanged", async () => {
  const B = setupMockBabylon();
  const { acesFit, untoneMap } = await import("../shell/engine/renderer.js");
  const { STAGE_ART, artUrl } = await import("../shell/engine/art.js");
  for (const c of [0.02, 0.2, 0.5, 0.8, 0.95]) assertAlmostEquals(acesFit(untoneMap(c)), c, 1e-6, `${c} round-trips`);
  const renderer = await makeRenderer({ width: 960, height: 540 } as any);
  for (const lang of [B.Effect.ShadersStore.stkSkyFragmentShader, B.ShaderStore.ShadersStoreWGSL.stkSkyFragmentShader]) {
    assert(lang?.includes("2.43") && lang.includes("exposure"), "the sky shader undoes ACES and the exposure");
  }
  for (const id of ["coconut-beach", "metropolis-night"]) {
    buildStage(renderer, id);
    const sky = (STAGE_ART as any)[id].sky;
    assertEquals(renderer.bSkyMat.uniforms.skyTexture.url, artUrl(MANIFEST, `sky/${sky}.paint.jpg`), `${id} paints its own sky`);
    assertEquals(renderer.scene.environmentIntensity, (STAGE_ART as any)[id].skyLight ?? 1, `${id} is lit as its art says`);
  }
});

// A pack tree is 40,000 triangles: drawn at full detail at every placement,
// Alpine Peaks alone would be 30 million.
Deno.test("renderer: pack models draw each placement once, its detail falling with distance", async () => {
  setupMockBabylon();
  const { fogVisible, lodFor } = await import("../shell/engine/art.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "desert-canyons");
  const eye = new MockVector3(0, 2, 300);
  renderer._updateLods(eye);
  // Thin-instance matrices are float32: 4 km out they hold a decimetre, not a centimetre.
  const key = (p: any) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`;
  const visible = fogVisible(renderer.scene.fogDensity);
  for (const set of renderer.bModelSets) {
    for (const lod of [0, 1, 2]) {
      const mesh = set.lods[lod].parts[0].mesh;
      const drawn = mesh.isVisible ? placedAt(mesh).map(key).sort() : [];
      const want = set.spots.filter((s: any) => lodFor(Math.hypot(s.x - eye.x, s.z - eye.z), s.size, visible) === lod).map(key).sort();
      assertEquals(drawn, want, `${set.id} draws exactly its level-${lod} placements`);
    }
  }
});

// The hangar is modelled doors on +Z, the procedural one doors to the road:
// placed at the road's heading it would show the road a blank wall.
Deno.test("renderer: hangar doors face the road", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "destination-aerodrome");
  const set = renderer.bModelSets.find((s: any) => s.id === "hangar");
  const thin = set.lods[0].parts[0].thin;
  // The road runs on past the finish to the doors of the hangar it arrives at.
  const end = renderer.bRoadEnd.pathArray[0];
  set.spots.forEach((spot: any, n: number) => {
    const road = [...renderer.leadPts, ...renderer.trackPts, ...end].reduce((a: any, b: any) => Math.hypot(b.x - spot.x, b.z - spot.z) < Math.hypot(a.x - spot.x, a.z - spot.z) ? b : a);
    const doors = { x: thin[n * 16 + 8], z: thin[n * 16 + 10] };
    assert(doors.x * (road.x - spot.x) + doors.z * (road.z - spot.z) > 0.9 * Math.hypot(road.x - spot.x, road.z - spot.z), `hangar ${n} faces the road`);
  });
});

// Sails are a node of their own about the hub, so a windmill's turn is one
// rotation ahead of its placement; the mill itself stands.
Deno.test("renderer: windmill sails turn and the mill stands", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "tulip-gardens");
  const set = renderer.bModelSets.find((s: any) => s.id === "windmill");
  renderer._updateLods(new MockVector3(set.spots[0].x, 2, set.spots[0].z));
  const parts = set.lods[0].parts;
  const sails = parts.find((p: any) => p.mesh.name.endsWith("#sails"));
  const mill = parts.find((p: any) => p.mesh.name.endsWith("#paint"));
  const at = (t: number) => {
    renderer._turnSails(t);
    return [Array.from(sails.mesh.thinMatrices as Float32Array), Array.from(mill.mesh.thinMatrices as Float32Array)];
  };
  const [sails0, mill0] = at(0);
  const [sails1, mill1] = at(1);
  assert(sails0.length > 0 && sails0.some((v: number, i: number) => Math.abs(v - sails1[i]) > 1e-3), "the sails turn");
  assertEquals(mill0, mill1, "the mill stands");
  assertEquals(sails0.filter((_, i) => i % 16 >= 12), sails1.filter((_, i) => i % 16 >= 12), "the sails turn about their hub");
  assert(!parts.find((p: any) => p.mesh.name.endsWith("#lamp_primitive0")).spin, "only the named node turns");
});

// Model fronds, grass and leaves stood still: the wind was hooked only into
// procedural props. Model materials are shared across stages, so hooking them
// on every rebuild would stack the wind.
Deno.test("renderer: a model's fronds, grass and leaves sway, hooked once", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "coconut-beach");
  const fronds = renderer.bModelSets.flatMap((s: any) => s.lods.flatMap((l: any) => l.parts)).filter((p: any) => p.mesh.material.name === "frond");
  assert(fronds.length > 0 && fronds.every((p: any) => renderer.swaying.has(p.mesh.material)), "fronds sway");
  let hooked = 0;
  const sway = renderer._sway.bind(renderer);
  renderer._sway = (B: any, mat: any) => { hooked++; sway(B, mat); };
  buildStage(renderer, "coconut-beach");
  assertEquals(hooked, 0, "a rebuild hooks nothing twice");
});

Deno.test("renderer: a model's lamps glow", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "metropolis-night");
  const lamps = renderer.bModelSets.flatMap((s: any) => s.lods.flatMap((l: any) => l.parts)).filter((p: any) => p.mesh.material.name.endsWith("lamp"));
  assert(lamps.length > 0 && lamps.every((p: any) => p.mesh.__glowColor), "every lamp part glows");
});

// Direction B was a filter over shaded 3D: every surface still ran a smooth
// light-to-shadow gradient. The toon look replaces the lit colour itself with
// hard bands, in both shading languages, keeping fog and lamps.
Deno.test("renderer: toon shading bands the light, keeps fog and lamps, in GLSL and WGSL", async () => {
  setupMockBabylon();
  const { TOON_GLSL, TOON_WGSL } = await import("../shell/engine/renderer.js");
  for (const [lang, code] of [["GLSL", TOON_GLSL], ["WGSL", TOON_WGSL]] as const) {
    for (const k of ["diffuseBase", "surfaceAlbedo", "finalEmissive", "CalcFogFactor", "toonShade", "toonSun", "toonRim", "finalColor"]) {
      assert(code.includes(k), `${lang} toon uses ${k}`);
    }
  }
});

// DESIGN.md "Ghibli gouache": everything is painted, not only the ground.
// The railway grained foliage as foam and rock as plaster; the owner could
// not tell the gouache build from it ("the changes are too incremental").
// Foliage is painted as leaf masses, warm where they turn to the light and
// cool blue-green where they turn away; the models have no UVs, so they are
// world-space noise.
Deno.test("renderer: foliage is painted as leaf masses", async () => {
  setupMockBabylon();
  const { TOON_GLSL, TOON_WGSL, TOON_DEFS_GLSL, TOON_DEFS_WGSL, grainOf } = await import("../shell/engine/renderer.js");
  for (const [lang, code, defs] of [["GLSL", TOON_GLSL, TOON_DEFS_GLSL], ["WGSL", TOON_WGSL, TOON_DEFS_WGSL]] as const) {
    assert(code.includes("#ifdef STK_LEAVES"), `${lang} paints leaf masses`);
    assert(!/STK_FOAM|STK_PLASTER/.test(code), `${lang} has no railway grain`);
    assert(code.includes("LEAF_WARM") && code.includes("LEAF_COOL"), `${lang} splits leaves warm and cool`);
    assert(defs.includes("stkGrain") && defs.includes("LEAF_PER_METRE"), `${lang} defines the noise and its scale`);
  }
  assertEquals(grainOf("tree-broadleaf-a#0#foliage"), "leaves");
  // The concept paints canopies and palm crowns as clustered leaf masses with
  // dark between them; noise blotches read as lumps (t29).
  assertEquals(grainOf("palm-a#0#frond"), "leaves");
  // A baked painting (assets/tools/ghibli/bake) carries its own brushwork and
  // shade: the toon light only modulates it, with no strokes or leaf cells over it.
  const { painterly } = await import("../shell/engine/renderer.js");
  assert(painterly({ metadata: { gltf: { extras: { painted: true } } } }), "a baked material is painted");
  assert(!painterly({ albedoTexture: {} }), "a textured ground is not");
  for (const [lang, code, defs] of [["GLSL", TOON_GLSL, TOON_DEFS_GLSL], ["WGSL", TOON_WGSL, TOON_DEFS_WGSL]] as const) {
    assert(code.includes("#ifdef STK_PAINTED") && defs.includes("PAINTED_FLOOR"), `${lang} softens the light on a painting`);
  }
  for (const [lang, code, defs] of [["GLSL", TOON_GLSL, TOON_DEFS_GLSL], ["WGSL", TOON_WGSL, TOON_DEFS_WGSL]] as const) {
    assert(code.includes("stkCells") && defs.includes("LEAF_GAP"), `${lang} paints leaves as cells with gaps`);
  }
  assertEquals(grainOf("foliage"), "leaves");
  for (const other of ["granite", "tree-broadleaf-a#0#bark", "paint", "cactus"]) assertEquals(grainOf(other), null, other);
});

// The owner chose the Ghibli concepts, where every model is painted: noise
// mottle read as dirty plastic beside them. One plugin lays a tile of gouache
// strokes on every model in world space (three planes, one tile: the models
// have no UVs), warms the tops and cools the feet, and softly darkens the
// contour; the ground and the road carry their own painted sets and none.
Deno.test("renderer: every model is brushed, warm on top, cool at the foot, softly contoured", async () => {
  setupMockBabylon();
  const { TOON_GLSL, TOON_WGSL, TOON_DEFS_GLSL, TOON_DEFS_WGSL, TOON_VERTEX_GLSL, TOON_VERTEX_WGSL, brushed } = await import("../shell/engine/renderer.js");
  for (const [lang, code, defs, vertex] of [["GLSL", TOON_GLSL, TOON_DEFS_GLSL, TOON_VERTEX_GLSL], ["WGSL", TOON_WGSL, TOON_DEFS_WGSL, TOON_VERTEX_WGSL]] as const) {
    const fetches = (defs.match(/texture(2D|Sample)\(stkBrush/g) ?? []).length;
    assertEquals(fetches, 3, `${lang}: one fetch per plane`);
    // At driving distance a fixed 1.25 m tile averaged to grey and the owner
    // saw smooth models: the tile grows with distance, blended across octaves.
    assert(defs.includes("BRUSH_NEAR") && /stkBrushTone\([^)]*,[^)]*,[^)]*\)/.test(code), `${lang} sizes the strokes by distance`);
    assert(code.includes("stkBrushTone(") && code.includes("#ifdef STK_BRUSH"), `${lang} lays the strokes`);
    assert(code.includes("vStkLift") && vertex.CUSTOM_VERTEX_MAIN_END.includes("vStkLift"), `${lang} cools the foot by height over the model's base`);
    assert(code.includes("CONTOUR"), `${lang} darkens the contour`);
  }
  for (const name of ["palm-a#0#foliage", "granite", "kart_tux_interior", "riders#girl_dress", "windmill#0#paint"]) assert(brushed(name), name);
  for (const name of ["bGroundMat", "bRoadMat"]) assert(!brushed(name), name);
});

// DESIGN.md "Ghibli gouache": a painted frame, not an inked one. The heavy
// ink and the railway's look fought the painting; the frame now carries a
// paper grain and gently quantised colour, with only a soft edge left.
Deno.test("renderer: the frame is painted on paper, with only a soft edge", async () => {
  const B = setupMockBabylon();
  const { STYLE, GRADE } = await import("../shell/engine/renderer.js");
  (await makeRenderer({ width: 960, height: 540 } as any));
  assert(STYLE.outline <= 0.15, `a soft painted edge, not ink: ${STYLE.outline}`);
  // The concepts' colour is luminous and a little held back: pushed to 1.28,
  // t28's desert land measured saturation 0.70 against the concept's 0.39.
  assert(STYLE.saturation <= 1.12, `colour barely pushed: ${STYLE.saturation}`);
  assert(GRADE.globalSaturation <= 0 && GRADE.highlightsDensity <= 12 && GRADE.contrast <= 1.1, "a soft, clear grade: no orange highlights");
  for (const store of [B.Effect.ShadersStore, B.ShaderStore.ShadersStoreWGSL]) {
    assert(store.stkStylePixelShader.includes("paper"), "a paper grain");
    assert(store.stkStylePixelShader.includes("quantise"), "gently quantised colour");
  }
});

// The first railway build's scenery grain was painted 4 m to a tile and the
// ground's colour was one even wash: at driving distance both averaged out
// and the owner saw plain ground. The tile now spans 9 m, and the ground is
// broken into patches tens of metres across, lighter and darker, as a
// layout's hand-laid scatter is.
Deno.test("renderer: the ground's grain reads at driving distance and its colour comes in patches", async () => {
  setupMockBabylon();
  const { TOON_GLSL, TOON_WGSL, TOON_DEFS_GLSL, TOON_DEFS_WGSL, grainOf } = await import("../shell/engine/renderer.js");
  const { TILE_METRES } = await import("../shell/engine/art.js");
  assert(TILE_METRES.ground >= 8, `a tile spans ${TILE_METRES.ground} m`);
  assertEquals(grainOf("bGroundMat"), "patch");
  for (const [lang, code, defs] of [["GLSL", TOON_GLSL, TOON_DEFS_GLSL], ["WGSL", TOON_WGSL, TOON_DEFS_WGSL]] as const) {
    assert(code.includes("#ifdef STK_PATCH"), `${lang} has the patches`);
    assert(defs.includes("PATCH_PER_METRE"), `${lang} sizes them`);
  }
});

// DESIGN.md "Ghibli gouache": the concept's skies tower with cumulus above
// the horizon ahead; ours were painted on the dome, behind the treetops and
// the HUD. Painted cumulus cards rise over the road's horizon: lobes heaped
// on a flat base, sunlit tops warm and bellies blue-grey, clear outside.
Deno.test("renderer: painted cumulus cards tower over the horizon ahead", async () => {
  setupMockBabylon();
  const { cumulusCard } = await import("../shell/engine/renderer.js");
  const card = cumulusCard(128, 128, 7, "tower");
  const at = (x: number, y: number) => Array.from(card.pixels.slice((y * card.width + x) * 4, (y * card.width + x) * 4 + 4));
  assertEquals(at(0, 0)[3], 0, "clear in the corner");
  assertEquals(JSON.stringify(cumulusCard(128, 128, 7, "tower").pixels.slice(0, 4096)), JSON.stringify(card.pixels.slice(0, 4096)), "the same card every time");
  let lit: number[] | null = null;
  let belly: number[] | null = null;
  for (let y = 0; y < 128 && !lit; y++) for (let x = 40; x < 88; x++) if (at(x, y)[3] > 250) { lit = at(x, y + 4); break; }
  for (let y = 127; y >= 0 && !belly; y--) for (let x = 40; x < 88; x++) if (at(x, y)[3] > 250) { belly = at(x, y - 3); break; }
  assert(lit && belly, "an opaque body");
  // At 30 levels apart the tone curve flattened the cards to white cut-outs
  // beside the concept's sunlit volumes (t28): the belly sits well under the top.
  assert(lit![0] > belly![0] + 90 && lit![0] >= lit![2], `a warm lit top over a cooler belly: ${lit} over ${belly}`);
  assert(belly![2] >= belly![0], `a blue-grey belly: ${belly}`);
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "coconut-beach");
  assert(renderer.bClouds.length >= 5, `cards over the horizon: ${renderer.bClouds.length}`);
  for (const c of renderer.bClouds) assert(c.metres >= 240, `towering: ${c.metres} m`);
  // The owner: "the cloud in the first stage and in tulip all look the same
  // and look like cut in half". The card's rows run top down and went up
  // unflipped, so each drew upside down, its flat base on top; and every
  // stage drew the same three cards. Each card of each stage is its own,
  // drawn the right way up.
  // The owner, after: "all the clouds looking the same is not great either,
  // specially given they are shown together": distinct seeds drew one kind
  // of tower at one size. Cards seen together differ in kind and silhouette.
  const profile = (c: any) => {
    const { pixels, width, height } = cumulusCard(c.cloudSize[0], c.cloudSize[1], c.cloudSeed, c.cloudKind);
    const bins = 16;
    return Array.from({ length: bins }, (_, b) => {
      const x = Math.floor(((c.mirrored ? bins - 1 - b : b) + 0.5) / bins * width);
      let y = 0;
      while (y < height && pixels[(y * width + x) * 4 + 3] < 128) y++;
      return 1 - y / height;
    });
  };
  const { STAGE_LOOKS } = await import("../shell/engine/stage_look.js");
  for (const id of Object.keys(STAGE_LOOKS)) {
    buildStage(renderer, id);
    const cards = renderer.bClouds;
    for (const bank of new Set(cards.map((c: any) => c.bank))) {
      const own = cards.filter((c: any) => c.bank === bank);
      assertEquals(new Set(own.map((c: any) => c.cloudKind)).size, own.length, `${id}: every card of a bank is its own kind`);
    }
    const profiles = cards.map(profile);
    for (let a = 0; a < cards.length; a++) {
      for (let b = a + 1; b < cards.length; b++) {
        const d = profiles[a].reduce((sum: number, v: number, k: number) => sum + Math.abs(v - profiles[b][k]), 0) / 16;
        // Banks at other distances also differ in size and haze, so a kind's
        // two cards need differ less in outline than two of one bank.
        const least = cards[a].bank === cards[b].bank ? 0.06 : 0.04;
        assert(d > least, `${id}: cards ${a} and ${b} share a silhouette (${d.toFixed(3)})`);
      }
    }
  }
  const seeds = (id: string) => (buildStage(renderer, id), renderer.bClouds.map((c: any) => c.cloudSeed));
  const coast = seeds("coconut-beach");
  const tulips = seeds("tulip-gardens");
  assertEquals(new Set(coast).size, coast.length, "no card repeats within a stage");
  assert(coast.every((k: number) => !tulips.includes(k)), "nor across stages");
  assert(cumulusCard(32, 32, 1, "puff").topDown, "its rows run top down, so it uploads flipped and draws base down");
});

// The owner chose the concepts' skies, where cumulus stand in banks one
// behind another: one ring of cards pinned to the camera read as a flat
// backdrop. Banks stand at three distances, each card anchored in the world
// so a nearer bank slides by faster as the car drives, all drifting on the
// wind, and each comes round ahead again once passed.
Deno.test("renderer: cloud banks stand in depth, drift on the wind and slide by as the car drives", async () => {
  setupMockBabylon();
  const { CLOUD_BANKS, cloudPlace } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "coconut-beach");
  const cards = renderer.bClouds;
  assert(CLOUD_BANKS.length >= 3, `banks: ${CLOUD_BANKS.length}`);
  assert(cards.length >= 12, `cards: ${cards.length}`);
  const distances = CLOUD_BANKS.map((b: any) => b.distance);
  assert(distances.every((d: number, k: number) => k === 0 || d > distances[k - 1] * 1.3), `banks one behind another: ${distances}`);
  const at = (c: any, z: number, t: number) => cloudPlace(c, 0, 0, z, t);
  const near = cards.find((c: any) => c.bank === 0);
  const far = cards.find((c: any) => c.bank === CLOUD_BANKS.length - 1);
  // Driving 50 m on, the world-anchored cards stay put while the camera moves.
  const slide = (c: any) => at(c, 0, 0).z - at(c, 50, 0).z;
  assertAlmostEquals(slide(near), 0, 1e-6, "a near card stays put in the world");
  const bearing = (c: any, z: number) => Math.atan2(at(c, z, 0).x, at(c, z, 0).z - z);
  assert(Math.abs(bearing(near, 200) - bearing(near, 0)) > Math.abs(bearing(far, 200) - bearing(far, 0)), "a near bank slides by faster than a far one");
  const drift = Math.hypot(at(near, 0, 60).x - at(near, 0, 0).x, at(near, 0, 60).z - at(near, 0, 0).z);
  assert(drift > 30, `a minute on the wind moves it: ${drift.toFixed(1)} m`);
  for (const z of [0, 5000, 23000]) {
    for (const c of cards) {
      const ahead = at(c, z, 30).z - z;
      const span = CLOUD_BANKS[c.bank].span;
      assert(ahead > -span * 0.25 && ahead < span * 0.75, `bank ${c.bank} comes round ahead at ${z} m: ${ahead.toFixed(0)}`);
    }
  }
});

// DESIGN.md "Ghibli gouache": the concept's coast road runs beside a pale
// promenade and a low sea wall. Coconut Beach's sea side has one: a sidewalk
// from the rumble edge, then the wall, the beach beyond; palms grow out of
// the promenade, but no grass, shrub or verge scatter covers it.
Deno.test("renderer: the coast road runs beside a promenade and a low sea wall", async () => {
  setupMockBabylon();
  const { SEA_WALL } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "coconut-beach");
  const names = renderer.bSeaWall.map((m: any) => m.name);
  for (const part of ["bPromenade", "bSeaWallTop", "bSeaWallFace"]) assert(names.includes(part), `the coast has ${part}`);
  const top = renderer.bSeaWall.find((m: any) => m.name === "bSeaWallTop").pathArray;
  const road = renderer.trackPts[100];
  const rise = top[0][100].y - road.y;
  assert(rise > 0.7 && rise < 1.1, `a low wall: ${rise.toFixed(2)} m`);
  assert(top[0][100].x < road.x, "on the sea side (left)");
  for (const { offset, side, kind } of renderer.propPlacements) {
    if (side < 0 && ["grassTuft", "shrub"].includes(kind)) assert(offset >= SEA_WALL.out, `a ${kind} on the promenade at ${offset.toFixed(1)} m`);
  }
  // The concept's pavement is a painted mid-grey; ours was pale sand (t30).
  const { PROMENADE, MATERIAL_TINTS } = await import("../shell/engine/renderer.js");
  const hsv = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);
    const max = Math.max(r, g, b);
    return { v: max, s: (max - Math.min(r, g, b)) / max };
  };
  assert(hsv(PROMENADE.paving).v < 0.6 && hsv(PROMENADE.paving).s < 0.15, `a mid-grey pavement: ${PROMENADE.paving}`);
  // Measured against the concepts, the cypress and broadleaf stages' land
  // sat at luminance 0.11-0.16 against 0.27 (t31): their foliage is lifted.
  const { MATERIAL_LIFT } = await import("../shell/engine/renderer.js");
  for (const key of ["cypress/foliage", "tree-broadleaf-a/foliage"]) assert((MATERIAL_LIFT as any)[key] > 1.2, `${key} is lifted`);
  // The concept's saguaros are a muted sage, not the pack's toy green.
  assert(hsv(MATERIAL_TINTS.cactus).s < 0.45, `sage saguaros: ${MATERIAL_TINTS.cactus}`);
  // The concept's wall has greenery and flowers at its foot; the rest of the
  // promenade stays bare paving.
  const { promenadeBed } = await import("../shell/engine/renderer.js");
  for (const kind of ["bush", "flower"]) assertAlmostEquals(promenadeBed(kind)!, SEA_WALL.wall - 0.45, 1e-9, `${kind} grows in the wall's bed`);
  for (const kind of ["tuft", "stone"]) assertEquals(promenadeBed(kind), null, `no ${kind} on the promenade`);
  buildStage(renderer, "desert-canyons");
  assertEquals(renderer.bSeaWall.length, 0, "an inland stage has none");
});

// Resizing the window at full resolution left the frame black for seconds:
// the page writes the canvas's size before the engine resizes, the engine
// then saw no change and skipped its own resize, and WebGPU's multisampled
// target kept the old size against the new swap chain (validation errors
// every frame). The renderer forces the engine's resize.
Deno.test("renderer: a resize forces the engine to rebuild its targets", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  renderer.resize(1344, 768);
  assert(renderer.engine.forced, "the engine resizes even when the canvas already has the new size");
});

// The owner saw "a strange vertical line that stays flashing, it is thin and
// cover the whole screen vertically, it is at around one third from left to
// right": the sky dome's seam. Its longitude came from atan2 per pixel and
// jumped from 1 to 0 across one column, where the derivatives blew up and
// the smallest mip was sampled; the afternoon sun turned the seam into view.
// The longitude now has no jump to differentiate: of two longitudes half a
// turn apart, each pixel samples the one whose derivative is small, over a
// sky that repeats around the dome.
Deno.test("renderer: the sky dome has no seam", async () => {
  const B = setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  for (const code of [B.Effect.ShadersStore.stkSkyFragmentShader, B.ShaderStore.ShadersStoreWGSL.stkSkyFragmentShader]) {
    assert(code.includes("fwidth"), "the longitude is picked by its derivative");
    assert(/fract\(/.test(code), "from two longitudes half a turn apart");
  }
  buildStage(renderer, "coconut-beach");
  assertEquals(renderer.bSkyMat.uniforms.skyTexture.wrapU, B.Texture.WRAP_ADDRESSMODE, "the sky repeats around the dome");
});

// The concept's frame is anchored by a low sun on the horizon ahead; the
// painted dome's own sun was a faint smudge in the haze.
Deno.test("renderer: the toon sun is a hard disc inside a soft halo", async () => {
  const { sunGlow } = await import("../shell/engine/renderer.js");
  const alpha = (g: any, x: number, y: number) => g.pixels[(y * g.width + x) * 4 + 3];
  const core = sunGlow(64, 1);
  const halo = sunGlow(64, 0.35);
  assertEquals([alpha(core, 32, 32), alpha(core, 0, 0)], [255, 0], "the core is opaque inside and clear outside");
  assert(alpha(core, 32, 2) === 255 && alpha(core, 32, 0) < 128, "its rim falls off within a pixel or two");
  assert(alpha(halo, 32, 32) > alpha(halo, 32, 16) && alpha(halo, 32, 16) > alpha(halo, 32, 4) && alpha(halo, 32, 4) > 0, "the halo fades smoothly outward");
});

// DESIGN.md "Ghibli gouache": a painted afternoon. The backlit low sun put
// every face into shade and the owner could not tell the gouache build from
// the railway one; the concept's light comes from behind the viewer and to
// one side, high enough to light the faces it falls on, through clear air.
Deno.test("renderer: every stage with a sun lights it from behind the viewer, in the afternoon", async () => {
  setupMockBabylon();
  const { STAGE_ART } = await import("../shell/engine/art.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  for (const id of Object.keys(STAGE_ART)) {
    buildStage(renderer, id);
    if (!renderer.hasSun) {
      assertEquals(renderer.bSky.rotation.y, 0, `${id} keeps its sky`);
      continue;
    }
    const azimuth = Math.atan2(renderer.sunDir.x, renderer.sunDir.z);
    assert(Math.abs(azimuth) > Math.PI / 2, `${id}'s sun stands behind the viewer: ${azimuth}`);
    assert(Math.abs(Math.abs(azimuth) - Math.PI) > 0.3, `${id}'s sun stands to one side, so faces model: ${azimuth}`);
    const elevation = Math.asin(renderer.sunDir.y);
    assert(elevation >= 0.45 && elevation <= 0.75, `${id}'s sun is an afternoon sun: ${elevation}`);
  }
});

// DESIGN.md Review, "Toward 2025-era graphics": the full stack where WebGPU
// runs, a lighter one on WebGL2.
Deno.test("renderer: the quality plan follows the engine", async () => {
  setupMockBabylon();
  const { qualityPlan } = await import("../shell/engine/renderer.js");
  assertEquals(qualityPlan(true), { shadowMap: 2048, ssao: true, carProbe: true, godRays: true, speedBlur: true, msaa: 4, grade: true, style: true });
  assertEquals(qualityPlan(false), { shadowMap: 1024, ssao: false, carProbe: false, godRays: true, speedBlur: true, msaa: 1, grade: true, style: true });
});

// The procedural car looked like a toy beside the photoscanned scenery.
Deno.test("renderer: every car is the pack's hero car, in its character's paint, its front wheels steering", async () => {
  setupMockBabylon();
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const tux = renderer.bKartMeshes.get("tux");
  const wilber = renderer.bKartMeshes.get("wilber");
  assert(tux.body.material.name.endsWith("paint"), "the body is the model's paint");
  assertEquals(tux.body.material.albedoColor.hex, "#D50000");
  assertEquals(wilber.body.material.albedoColor.hex, "#FFB300");
  assert(tux.body.material !== wilber.body.material, "each car has its own paint");
  const state = apexrunEngine.initState(0x1337, { stageState: "racing" }) as any;
  state.countdown = 0;
  state.karts.find((k: any) => k.isPlayer).steerAngle = 0.4;
  renderer.render(state, false, state, 1);
  const player = renderer.bKartMeshes.get(state.karts.find((k: any) => k.isPlayer).character);
  assert(player.steered.every((w: any) => w.rotation.y !== 0), "the front pair steers");
  assert(player.wheels.slice(2).every((w: any) => w.rotation.y === 0), "the rear pair does not");
  // The axles the car is posed on are the model's own.
  for (const { hub } of MANIFEST["model/car-hero/lod0"].wheels) {
    assertAlmostEquals(Math.abs(hub[2]), hub[2] > 0 ? renderer.heroAxles.front : renderer.heroAxles.rear, 0.01);
  }
});

Deno.test("renderer: god rays ship in GLSL and WGSL", async () => {
  const B = setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  (await makeRenderer({ width: 960, height: 540 } as any));
  assert(B.Effect.ShadersStore.stkGodRaysPixelShader?.includes("sunPos"), "GLSL god rays");
  assert(B.ShaderStore.ShadersStoreWGSL.stkGodRaysPixelShader?.includes("sunPos"), "WGSL god rays");
});

// Each kart had a blob shadow plane under it as well as its cascaded shadow,
// so the ground under every car was darkened twice.
Deno.test("renderer: cars cast one shadow, not a blob as well", async () => {
  const B = setupMockBabylon();
  const made: string[] = [];
  const plane = B.MeshBuilder.CreatePlane;
  B.MeshBuilder.CreatePlane = (name: string, ...rest: any[]) => { made.push(name); return plane(name, ...rest); };
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  renderer.render(apexrunEngine.initState(0x1337, { stageState: "racing" }));
  assertEquals(made.filter((n) => n.startsWith("kartShadow")), []);
});

// DESIGN.md "Race flow", owner's Start B: the camera swoops from above the
// grid and lands on the chase pose exactly when 3-2-1 begins.
Deno.test("renderer: the start swoops down from above the grid onto the chase camera", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const { INTRO_TICKS } = await import("../shell/engine/simulation.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const at = (countdown: number) => {
    const s = apexrunEngine.initState(0x1337, { stageState: "warmup" }) as any;
    s.countdown = countdown;
    renderer.render(s);
    const c = renderer.bCamera.position;
    return { x: c.x, y: c.y, z: c.z };
  };
  const top = at(INTRO_TICKS + 180);
  const landed = at(180);
  const racing = (() => { const s = apexrunEngine.initState(0x1337, { stageState: "racing" }); renderer.render(s); const c = renderer.bCamera.position; return { x: c.x, y: c.y, z: c.z }; })();
  assert(top.y > landed.y + 10, `the swoop starts high (${top.y} vs ${landed.y})`);
  // One frame apart: the grid's rivals ease the camera toward the hood, so
  // the next frame differs by one step of that ease, never by a jump.
  assertAlmostEquals(landed.y, racing.y, 0.1);
  assertAlmostEquals(landed.z, racing.z, 0.1);
});

Deno.test("renderer: fork stages raise a checkpoint arch over each branch, and the first stage has a flag marshal", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "coconut-beach");
  assertEquals(renderer.bCheckpointArches.length, 2);
  renderer.render(apexrunEngine.initState(0x1337, { stageState: "warmup" }));
  assert(renderer.bMarshal.root.isVisible !== false, "the marshal stands at the first stage's start");
  const counting = apexrunEngine.initState(0x1337, { stageState: "warmup" }) as any;
  counting.countdown = 1;
  renderer.render(counting);
  assert(Math.abs(renderer.bMarshal.arm.rotation.z + Math.PI) <= 0.35 + 1e-9, "through 3-2-1 the flag waves overhead");
  assertEquals(renderer.bMarshal.arm.rotationQuaternion, null, "the arm is posed by its rotation, not the loader's quaternion");
  buildStage(renderer, "destination-castle");
  assertEquals(renderer.bCheckpointArches.length, 0, "the final stage ends at its goal gate instead");
  assertEquals(renderer.bMarshal, null, "the marshal stands only at the first stage's grid");
});

// The arches and marshal were disposed with their materials, which took the
// cached prop materials they share with the roadside down with them.
Deno.test("renderer: a stage swap keeps the shared prop materials alive", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "coconut-beach");
  const withMaterials: string[] = [];
  for (const node of [...renderer.bCheckpointArches, renderer.bMarshal.root]) {
    node.dispose = (_doNotRecurse?: boolean, disposeMaterials?: boolean) => { if (disposeMaterials) withMaterials.push(node.name); };
  }
  const own = [...renderer.bRaceFlowMats];
  const ownDisposed: unknown[] = [];
  for (const m of own) m.dispose = () => { ownDisposed.push(m); };
  buildStage(renderer, "desert-canyons");
  assertEquals(withMaterials, []);
  assertEquals(ownDisposed.length, own.length, "the sign and flag materials go with their stage");
});

// The owner's graphics packs (DESIGN.md "Race flow").
Deno.test("renderer: the chase camera widens with speed", async () => {
  setupMockBabylon();
  const { speedFov } = await import("../shell/engine/renderer.js");
  assertAlmostEquals(speedFov(0, 0), 0.68, 1e-9);
  assert(speedFov(300, 0) > speedFov(150, 0) && speedFov(150, 0) > speedFov(0, 0));
  assert(speedFov(300, 1) - speedFov(300, 0) >= 0.1, "nitro throws the view wide");
  assert(speedFov(400, 1) < 1.0, "it never fish-eyes");
});

// Nitro was a few small sparks and a 0.05 FOV nudge: the owner barely saw it.
Deno.test("renderer: nitro eases in a wide view, a heavier blur and a long flame", async () => {
  const { renderer, frame } = await tickPair((_prev, next) => { next.speed = 300; next.isNitro = true; });
  const blurBefore = (frame(1), renderer.speedBlurStrength);
  for (let i = 0; i < 30; i++) frame(1);
  assert(renderer.boostT > 0.95, `boost eased to ${renderer.boostT}`);
  assert(renderer.speedBlurStrength >= blurBefore + 0.08, `blur ${blurBefore} -> ${renderer.speedBlurStrength}`);
  const flames = [...renderer.bKartMeshes.values()][0].nitroParticles;
  assertEquals(flames.length, 2, "a flame from each side's exhaust");
  assert(flames[0].minEmitBox.x < 0 && flames[1].minEmitBox.x > 0, "one each side");
});

// A particle texture that failed to paint was swallowed as null, and the
// flames and sparks drew untextured squares with no error to say why.
Deno.test("renderer: a particle texture that fails to paint fails the renderer", async () => {
  setupMockBabylon();
  const B = (globalThis as any).BABYLON;
  const Dynamic = B.DynamicTexture;
  B.DynamicTexture = class extends Dynamic {
    constructor(name: string, ...rest: any[]) {
      if (name === "dt_flame") throw new Error("no canvas");
      super(name, ...rest);
    }
  };
  await assertRejects(() => makeRenderer(), Error, "no canvas");
  B.DynamicTexture = Dynamic;
  const renderer = await makeRenderer();
  for (const kart of renderer.bKartMeshes.values()) {
    for (const flame of kart.nitroParticles) assertEquals(flame.particleTexture, renderer.particleTextures.flame);
    assertEquals(kart.driftParticles.particleTexture, renderer.particleTextures.spark);
  }
});

// World-space particles left one blob per frame behind a car doing 60 m/s,
// and their overlap crossed the bloom threshold: the owner saw red balls.
// Riding the car, each below the threshold, the flame reads as a yellow jet.
// The flame went out the tick the burst ended: the owner felt the nitro
// stop abruptly. It thins out over a fraction of a second instead.
Deno.test("renderer: the nitro flame fades out after the burst", async () => {
  const { renderer, frame, next } = await tickPair((_prev, me) => { me.speed = 300; me.isNitro = true; });
  for (let i = 0; i < 30; i++) frame(1);
  const flames = [...renderer.bKartMeshes.values()][0].nitroParticles;
  const full = flames[0].emitRate;
  next.karts.find((k: any) => k.isPlayer).isNitro = false;
  frame(1);
  assert(flames[0].emitRate > full * 0.7, `still burning a frame later: ${flames[0].emitRate} of ${full}`);
  for (let i = 0; i < 120; i++) frame(1);
  assertEquals(flames[0].emitRate, 0, "out after two seconds");
});

Deno.test("renderer: the nitro flame rides the car and burns yellow under the bloom", async () => {
  const { renderer } = await tickPair(() => {});
  for (const flame of [...renderer.bKartMeshes.values()][0].nitroParticles) {
    assert(flame.isLocal, "particles move with the car");
    const [core] = flame.colorGradients;
    assert(core.t === 0 && core.color.g >= 0.9 && core.color.r >= 0.9, "a yellow-white core");
    for (const { color } of flame.colorGradients) {
      assert(color.r * color.a <= 0.6, `each particle stays under the bloom: ${JSON.stringify(color)}`);
    }
  }
});

Deno.test("renderer: the haze takes the sun's colour as the camera faces it", async () => {
  setupMockBabylon();
  const { sunHaze } = await import("../shell/engine/renderer.js");
  const fog = { r: 0.5, g: 0.5, b: 0.5 };
  const sun = { r: 1, g: 0.7, b: 0.3 };
  assertEquals(sunHaze(fog, sun, -1), fog, "facing away keeps the fog");
  const toward = sunHaze(fog, sun, 1);
  assert(toward.r > fog.r && toward.b < fog.b, `facing the sun warms the fog: ${JSON.stringify(toward)}`);
});

// DESIGN.md "Ghibli gouache": a painted background is crisp from the car to
// the horizon. With a depth blur back in, the owner said "for ghibli, remove
// the blur altogether, i cant really tell the models apart again": no lens,
// no depth softness.
Deno.test("renderer: the painted world is drawn without a lens blur", async () => {
  const B = setupMockBabylon();
  const { qualityPlan } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  assert(!("tiltShift" in qualityPlan(true)), "no lens in the quality plan");
  assert(!B.Effect.ShadersStore.stkTiltShiftPixelShader && !B.ShaderStore.ShadersStoreWGSL.stkTiltShiftPixelShader, "no lens shader");
  assert(!renderer.tiltPass, "no lens pass");
});

Deno.test("renderer: the flare and the speed blur ship in GLSL and WGSL", async () => {
  const B = setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  (await makeRenderer({ width: 960, height: 540 } as any));
  for (const store of [B.Effect.ShadersStore, B.ShaderStore.ShadersStoreWGSL]) {
    assert(store.stkGodRaysPixelShader.includes("ghost"), "flare ghosts ride the sun pass");
    assert(store.stkSpeedBlurPixelShader?.includes("strength"), "edge speed blur");
  }
});

Deno.test("renderer: night stages light a headlight pool pitched with the road grade so hills do not slice it", async () => {
  setupMockBabylon();
  const { ApexrunRenderer } = await import("../shell/engine/renderer.js");
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  buildStage(renderer, "metropolis-night");
  const night = apexrunEngine.initState(0x1337, { stageState: "racing", stageId: "metropolis-night", playerZ: 60 * 200 }) as any;
  renderer.render(night);
  const pool = renderer.bHeadlightPool;
  assertEquals(pool.isVisible, true, "lit at night");
  assertEquals(pool.material.disableDepthWrite, true, "alpha pool does not write depth");
  assert(pool.material.zOffset < 0, "polygon offset keeps the pool above the road ribbon");
  // At segment 60 metropolis-night climbs at pitch 18: the pool tilts with the
  // road across its 22 m span rather than lying horizontal and slicing into the hill.
  const z = night.karts.find((k: any) => k.isPlayer).z * renderer.trackScale;
  const pose = renderer._poseOnRoad(z + 14, 0, 11, 11);
  assert(pose.pitch > 0.01, `metropolis-night climbs at segment 60 (${pose.pitch})`);
  assertAlmostEquals(pool.rotation.x, Math.PI / 2 - pose.pitch, 1e-6, "pool pitches with the road");
  buildStage(renderer, "coconut-beach");
  renderer.render(apexrunEngine.initState(0x1337, { stageState: "racing" }));
  assertEquals(pool.isVisible, false, "dark by day");
});

Deno.test("renderer: wind sways fronds and grass in both shader languages", async () => {
  setupMockBabylon();
  const { windCode } = await import("../shell/engine/renderer.js");
  for (const lang of ["GLSL", "WGSL"]) {
    const code = windCode(lang);
    assert(code.CUSTOM_VERTEX_UPDATE_WORLDPOS.includes("windTime"), `${lang} sways by time`);
    assert(code.CUSTOM_VERTEX_DEFINITIONS.includes("stkSway"), `${lang} defines the sway`);
  }
});

// The whole car rolled by a fixed share of the steer: the owner found it
// static. The body now takes the sim's sprung pose, between ticks too, on
// its own node, so the road pose and the heading stay the root's.
Deno.test("renderer: the body rides the sim's springs, interpolated between ticks", async () => {
  const { renderer, frame } = await tickPair((prev, next) => {
    prev.body = { pitch: 0, pitchV: 0, roll: 0, rollV: 0, stretch: 0, stretchV: 0 };
    next.body = { pitch: 0.03, pitchV: 0, roll: 0.04, rollV: 0, stretch: 0.08, stretchV: 0 };
  });
  frame(0.5);
  const kart = [...renderer.bKartMeshes.values()][0];
  const chassis = kart.chassis;
  assert(Math.abs(chassis.rotation.x + 0.015) < 1e-9, `nose up is a negative x turn: ${chassis.rotation.x}`);
  assert(Math.abs(chassis.rotation.z - 0.02) < 1e-9, `roll: ${chassis.rotation.z}`);
  assert(Math.abs(chassis.scaling.z - 1.04) < 1e-9, `stretched along the car: ${chassis.scaling.z}`);
  assert(chassis.scaling.y < 1 && chassis.scaling.x < 1, "and thinner across, keeping its volume");
  assert(Math.abs(chassis.scaling.x * chassis.scaling.y * chassis.scaling.z - 1) < 1e-9, "volume kept");
  assertEquals(kart.root.rotation.z, 0, "the root carries no roll of its own");
});

// DESIGN.md "Ghibli gouache": the toon bands painted the car's lacquer and
// chrome as flat colour, and beside the concept's glossy model car the owner
// saw no model at all. A car's paint, chrome, rims and glass are lacquer:
// clear-coated, mirror-bright, lit as themselves rather than banded.
Deno.test("renderer: a car's paint and chrome are lacquer, outside the toon bands", async () => {
  setupMockBabylon();
  const { toonable } = await import("../shell/engine/renderer.js");
  for (const name of ["kart_tux_paint", "kart_gnu_chrome", "kart_tux_rim", "kart_tux_glass", "bTraffic_4_paint", "bTraffic_4_chrome"]) {
    assert(!toonable(name), `${name} is lacquer`);
  }
  for (const name of ["kart_tux_interior", "kart_tux_rubber", "bGroundMat", "windmill#0#paint", "palm-a#0#foliage"]) {
    assert(toonable(name), `${name} keeps the toon bands`);
  }
  const renderer = (await makeRenderer({ width: 960, height: 540 } as any));
  const kart = [...renderer.bKartMeshes.values()][0];
  const mat = (part: string) => kart.body.parent.children.find((m: any) => m.material?.name.endsWith(part)).material;
  const paint = mat("paint");
  assert(paint.clearCoat.isEnabled && paint.clearCoat.intensity >= 0.9 && paint.clearCoat.roughness <= 0.08, `a deep clear coat: ${JSON.stringify(paint.clearCoat)}`);
  assert(paint.roughness <= 0.25, `glossy paint under it: ${paint.roughness}`);
  const chrome = mat("chrome");
  assert(chrome.metallic === 1 && chrome.roughness <= 0.06, `mirror chrome: ${chrome.metallic}/${chrome.roughness}`);
});

// DESIGN.md "Ghibli gouache": the owner asked for "the driver should be the
// girl" and said "the people in the car deserve hero treatment as well": the
// pack's sculpted riders, the girl at the wheel and the boy beside her,
// riding the sprung body; her long hair and ribbon and his neckerchief turn
// in the wind time. "the guy waving non-stop makes no sense": he waves only
// while the sim's wave timer runs, and his head glances about on a slow
// cycle; all of it from the state, so a replay poses them alike. At rest his
// arm hung out over the door, and the owner: "the passenger hand hanging far
// outside the car the whole time feels strange, it is still charming to have
// it outside, but make it holding the door, so it doesnt feel like his arm
// will be cut off by a truck. The waving during nitro is great, keep it." So
// a resting arm of its own grips the door's edge, the waving arm only at a
// moment.
Deno.test("renderer: the sculpted riders, the girl at the wheel, the boy holding the door and waving only at a moment", async () => {
  const rig = MANIFEST["model/riders/lod0"].rig;
  assertEquals(rig.driver, "girl", "the girl drives");
  for (const node of ["girl_hair", "girl_ribbon", "boy_scarf"]) assert(rig.nodes[node].flutter_axis, `${node} moves in the wind`);
  for (const node of ["boy_wave", "boy_rest", "boy_head"]) assert(rig.nodes[node] && !rig.nodes[node].flutter_axis, `${node} is a gesture`);
  const { renderer, frame, next } = await tickPair(() => {});
  for (const [character, kart] of renderer.bKartMeshes) {
    assertEquals(kart.riders.length, 2, `${character} carries both levels of detail`);
    for (const lod of kart.riders) for (const root of lod) assertEquals(root.parent, kart.chassis, `${character}'s riders ride the body`);
    assertEquals(kart.flutter.length, 3, `${character}: hair, ribbon and neckerchief`);
    assert(kart.wave && kart.rest && kart.head, `${character}: the wave, the resting arm and the head are posed`);
  }
  const me = next.karts.find((k: any) => k.isPlayer);
  const kart = renderer.bKartMeshes.get(me.character);
  me.waveTimer = 0;
  next.tick = 30;
  frame(1);
  const rest = kart.wave.node.rotation.z;
  next.tick = 400;
  frame(1);
  assertEquals(kart.wave.node.rotation.z, rest, "no wave without a moment");
  assert(kart.rest.node.isVisible && !kart.wave.node.isVisible, "between moments his hand holds the door, not waving");
  const bounds = MANIFEST["model/riders/lod0"].bounds_m;
  assert(bounds[0][0] > -1.01, `the resting hand never reaches past the car's side: ${bounds[0][0]}`);
  me.waveTimer = 40;
  frame(1);
  assert(Math.abs(kart.wave.node.rotation.z - rest) > 0.8, "a moment lifts his arm");
  assert(kart.wave.node.isVisible && !kart.rest.node.isVisible, "and the waving arm takes the resting one's place");
  for (const twin of [...kart.wave.twins, ...kart.rest.twins]) assert(twin.isVisible === (kart.wave.twins.includes(twin)), "the light riders alike");
  const headAt = (t: number) => { next.tick = t; frame(1); return kart.head.node.rotation.y; };
  assertEquals(headAt(900), headAt(900), "the same tick turns his head the same");
  const yaws = Array.from({ length: 40 }, (_, k) => headAt(k * 45));
  assert(Math.max(...yaws) > 0.3 && Math.min(...yaws) < -0.3, "now and then he looks both ways");
  assert(yaws.filter((y) => Math.abs(y) < 0.05).length > 10, "and mostly ahead");
});

// The whole model, wheels included, pitched and rolled on the body's
// springs, so the wheels lifted off and sank into the road and the owner
// saw the car rock like something round. The wheels are unsprung: they stay
// on the road, and only the body above them moves.
Deno.test("renderer: the wheels stay on the road while the body leans", async () => {
  const { renderer, frame } = await tickPair((_prev, next) => {
    next.body = { pitch: 0.02, pitchV: 0, roll: 0.02, rollV: 0, stretch: 0.05, stretchV: 0 };
  });
  frame(1);
  const kart = [...renderer.bKartMeshes.values()][0];
  for (const wheel of kart.wheels) {
    const chain: any[] = [];
    for (let n = wheel.parent; n; n = n.parent) chain.push(n);
    assert(!chain.includes(kart.chassis), `${wheel.name} hangs off the body`);
    assert(chain.includes(kart.root), `${wheel.name} follows the car along the road`);
  }
});

// The marshal's arm rose and fell at one constant speed and the wave popped
// in at full swing: the owner asked for the smooth animation of the 1930s
// and 40s cartoons. Each move now slows in and out, winds up before it goes,
// overshoots and settles, and the flag trails the arm.
Deno.test("renderer: the flagman moves in eased arcs, winds up, overshoots, and his flag trails", async () => {
  setupMockBabylon();
  const { marshalPose } = await import("../shell/engine/renderer.js");
  const { COUNTDOWN_TICKS, GO_TICKS, INTRO_TICKS } = await import("../shell/engine/simulation.js");
  const warm = (countdown: number, tick = 0) => marshalPose({ stageState: "warmup", countdown, goTimer: 0, tick });
  const raise: number[] = [];
  for (let c = INTRO_TICKS + COUNTDOWN_TICKS; c > COUNTDOWN_TICKS; c--) raise.push(warm(c).arm);
  const steps = raise.slice(1).map((a, i) => a - raise[i]);
  const fastest = Math.max(...steps.map(Math.abs));
  assert(Math.abs(steps[0]) < 0.25 * fastest, "slow in");
  assert(Math.max(...raise.slice(0, 15)) > 0.02, "it winds back before it lifts");
  assert(Math.min(...raise) < -Math.PI - 0.02, "it overshoots overhead");
  assert(Math.abs(raise[raise.length - 1] + Math.PI) < 1e-6, "and settles straight up");
  assert(Math.abs(warm(COUNTDOWN_TICKS, 17).arm + Math.PI) < 1e-6, "the wave fades in rather than popping");
  assert(Math.abs(warm(1, 17).arm + Math.PI) > 0.05, "and swings through the count");
  const sweep: { arm: number; flag: number }[] = [];
  for (let g = GO_TICKS; g >= 0; g--) sweep.push(marshalPose({ stageState: "racing", countdown: 0, goTimer: g, tick: 0 }));
  assert(Math.max(...sweep.map((p) => p.arm)) > 0.02, "the sweep follows through past rest");
  const mid = sweep[Math.floor(GO_TICKS / 2)];
  assert(mid.flag < -0.05, `the flag trails the arm sweeping down: ${mid.flag}`);
  assertEquals(sweep[GO_TICKS].arm, 0);
  assertEquals(marshalPose({ stageState: "racing", countdown: 0, goTimer: 0, tick: 99 }).flag, 0, "at rest it hangs");
});

// The renderer is a view of the host's frames, which run backwards on a
// rewind or a seek: across the worker it holds only cosmetic state, so a jump
// back is at worst a snap, and the car is where the frame says.
Deno.test("renderer: a frame from before the last one draws, and the car is where it says", async () => {
  setupMockBabylon();
  const renderer = await makeRenderer();
  const frames = [apexrunEngine.initState(0x1337, { stageState: "racing" }) as any];
  for (let i = 0; i < 600; i++) frames.push(apexrunEngine.advanceFrame(frames[i], { up: true }) as any);
  for (let i = 1; i < frames.length; i++) renderer.render(frames[i], false, frames[i - 1], 1);
  for (const back of [400, 37, 1]) {
    renderer.render(frames[back], true, frames[back], 1);
    const player = frames[back].karts.find((k: any) => k.isPlayer);
    const root = renderer.bKartMeshes.get(player.character).root;
    assertEquals(Math.round(root.position.z * 100), Math.round(player.z * renderer.trackScale * 100), `seek to ${back}`);
  }
  for (let i = 2; i < 200; i++) renderer.render(frames[i], false, frames[i - 1], 0.5);
});

// In a worker Babylon has no CSS size to read, so it sizes the drawing buffer
// as the canvas's own size over the scaling level: the size it set last. Each
// adaptive step then scaled the last one, and a few seconds of slow frames
// drew the road at a twentieth of its pixels.
Deno.test("renderer: resolution steps scale the canvas's CSS size, not the last drawing size", async () => {
  setupMockBabylon();
  const canvas = { width: 1920, height: 1080 };
  const renderer = await makeRenderer(canvas as any, 2);
  let level = 1;
  renderer.engine.setHardwareScalingLevel = (l: number) => { level = l; renderer.engine.resize(); };
  renderer.engine.getHardwareScalingLevel = () => level;
  renderer.engine.resize = () => { canvas.width = Math.round(canvas.width / level); canvas.height = Math.round(canvas.height / level); };
  for (let i = 0; i < 5; i++) renderer.setResolutionScale(renderer.getResolutionScale() - 0.1);
  assertEquals(canvas.width, Math.round(960 * 0.5 * 2));
  let forced = 0;
  const resize = renderer.engine.resize;
  renderer.engine.resize = (force = false) => { forced += force ? 1 : 0; resize(); };
  renderer.setResolutionScale(1);
  assertEquals([canvas.width, canvas.height], [1920, 1080]);
  // Seen live: climbing back to full scale left the drawing size where _fit
  // put it, so an unforced resize saw no change, kept the multisampled target
  // at the last step's size, and every frame after drew black.
  assertEquals(forced, 1, "a step resizes the engine's targets");
  renderer.resize(2560, 1440);
  assertEquals([canvas.width, canvas.height], [2560, 1440]);
});

// Firefox drew the cars black on a race's first frames: the paint's diffuse
// light is the probe's spherical polynomial, which a probe reads back from the
// GPU after its first capture, and the paint drawn before that lands is black.
// A stage seeds it with its sky's, and a recapture swaps the new one in only
// once it is read, never emptying it.
Deno.test("renderer: the car probe always carries a polynomial for the paint", async () => {
  const B = setupMockBabylon();
  const renderer = await makeRenderer({ width: 960, height: 540 } as any);
  buildStage(renderer, "coconut-beach");
  const sky = { sky: true };
  renderer.scene.environmentTexture.sphericalPolynomial = sky;
  const read: Array<(p: unknown) => void> = [];
  B.CubeMapToSphericalPolynomialTools = { ConvertCubeMapTextureToSphericalPolynomial: () => new Promise((resolve) => read.push(resolve)) };
  const cube: any = { sphericalPolynomial: null };
  renderer.shadows ??= { addShadowCaster() {} };
  renderer.carProbe = { renderList: [], cubeTexture: cube };
  renderer._shadowStage();
  assertEquals(cube.sphericalPolynomial, sky, "a new stage's probe lights the paint with its sky");
  renderer._readCarProbe(B, 5);
  assertEquals(read.length, 1, "the stage's first capture is read back");
  assertEquals(cube.sphericalPolynomial, sky, "the paint keeps its light while the capture is read");
  const captured = { captured: true };
  read[0](captured);
  await Promise.resolve();
  assertEquals(cube.sphericalPolynomial, captured, "then takes the capture's");
  renderer._readCarProbe(B, 5);
  assertEquals(read.length, 1, "a stage's later captures are not read back");
});
