/**
 * The art pack (assets/README.md): photo skies with their light, PBR ground
 * and road, and models, every file named by its sha256 in the manifest and
 * served by the blob store.
 */

export const BLOB_BASE = '/blobs/mecha-objects/';

// For a prop up to LOD_SIZE metres tall: past LOD_FAR it is not drawn, and
// LOD_SPLITS hand each level of detail over to the next. A taller one keeps
// its detail, and its place on the horizon, as far further as it is taller,
// so a mesa is not switched on in plain view.
export const LOD_SIZE = 6;
export const LOD_FAR = 520;
export const LOD_SPLITS = [70, 200];

/** Where exponential-squared fog of this density leaves 2% of a surface. */
export function fogVisible(density) {
  return Math.sqrt(-Math.log(0.02)) / density;
}

// Metres of ground or road one texture tile covers.
export const TILE_METRES = { ground: 9, road: 6 };


// The painted asphalt's albedo factor: its dark warm wash times this is the
// concepts' charcoal road under the yellow centre line.
export const ROAD_ALBEDO = 2.4;

// A model's height in metres where it stands in for a prop kind, before the
// placement's own scale.
export const KIND_HEIGHT = {
  palm: 14, shrub: 1.3, grassTuft: 0.5, mesa: 55, cactus: 4.6, rock: 1.4, pine: 15, broadleaf: 9,
  powerPole: 9, column: 6, cliff: 24, cypress: 11, windmill: 20, brokenArch: 10, tower: 60,
  streetLamp: 8, lighthouse: 26, sailboat: 12.5, castleTower: 30, colosseum: 47.5, hangar: 13,
  rockArch: 46, seaArch: 26, chapelAlpine: 30, chapelTuscan: 34, clockTower: 40, kasbah: 30, aqueduct: 26, spire: 150,
  butte: 80, greatTree: 30, greatWindmill: 40,
};

// Kinds whose models are one set, scaled together so the set averages the
// kind's height: a stage's rocks are low slabs, boulders and tall stacks.
const SET_SIZED = new Set(['rock']);

/** Per model id, the scale that draws it at its kind's height at placement scale 1. */
export function modelScales(manifest, kind, ids) {
  const heights = ids.map((id) => artEntry(manifest, `model/${id}/lod0`).bounds_m[1][1]);
  const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
  return heights.map((h) => KIND_HEIGHT[kind] / (SET_SIZED.has(kind) ? mean : h));
}

// Radians a model turns past its placement's yaw, which points +Z along the
// road and +X away from it: the hangar's doors are on +Z, the slab tower's
// long side is X, and the aqueduct and the sea arch run along the road.
export const MODEL_TURN = { hangar: -Math.PI / 2, 'tower-b': Math.PI / 2, aqueduct: Math.PI / 2, 'sea-arch': Math.PI / 2 };

// The player's and the rivals' car (DESIGN.md "Hero car").
export const HERO_CAR = 'model/car-hero/lod0';

// The hero car's riders (DESIGN.md "Ghibli gouache"), full and light.
export const RIDERS = ['model/riders/lod0', 'model/riders/lod1'];

// The flag marshal at a stage's grid, where its art has `flagman`.
export const FLAGMAN = 'model/flagman/lod0';

// Traffic draws one level: close enough to read, light enough for a dozen cars.
export const TRAFFIC_LOD = 'lod1';

export const TRAFFIC_MODELS = { sedan: 'car-sedan', convertible: 'car-convertible', pickup: 'car-pickup', truck: 'car-boxtruck' };

const palms = ['palm-a', 'palm-b', 'palm-c'];
const sandstone = ['rock-sand-a', 'rock-sand-b', 'rock-sand-c', 'rock-sand-d', 'rock-sand-e', 'rock-sand-f'];
const granite = ['rock-granite-a', 'rock-granite-b', 'rock-granite-c', 'rock-granite-d', 'rock-granite-e'];
const limestone = ['rock-lime-a', 'rock-lime-b', 'rock-lime-c', 'rock-lime-d'];

/**
 * Per stage: the pack sky it is lit by, its ground set, and the models that
 * stand in for a prop kind. A kind with no model keeps its procedural build.
 * `groundTile` is the metres one ground tile covers where the set is not
 * TILE_METRES.ground's: the tulip field's stripes are 4 m wide. `seaWall` lays
 * a promenade and a low sea wall along the road's sea side.
 * `carpet` paints the verge as a flower carpet in these colours.
 * `groundTint` multiplies the ground set's colour where one set serves stages
 * that differ: the sunset road's red earth, held back toward its dusk.
 * `exposure` lifts a sky's own exposure where the stage must still read;
 * `skyLight` scales the light its photo sky casts where that photo is not
 * the painted sky: the night city's is a street among lit shopfronts, and
 * at full strength it floodlit every tower wall.
 */
export const STAGE_ART = {
  'coconut-beach': { sky: 'coconut-beach', ground: 'grass', flagman: true, seaWall: true, models: { palm: palms, shrub: ['shrub-tropical'], grassTuft: ['grass-beach'], sailboat: ['sailboat'], lighthouse: ['lighthouse'], cliff: ['cliff-coast-a', 'cliff-coast-b'], rock: [...granite, ...limestone] } },
  'desert-canyons': { sky: 'desert-canyons', ground: 'sand-desert', models: { rockArch: ['rock-arch'], mesa: ['mesa-a', 'mesa-b'], cactus: ['cactus'], rock: sandstone, shrub: ['shrub-desert'] } },
  'gateway-pass': { sky: 'gateway-pass', ground: 'grass', models: { chapelTuscan: ['chapel-tuscan'], cypress: ['cypress'], rock: [...granite, ...limestone], grassTuft: ['grass-tuft'] } },
  'alpine-peaks': { sky: 'alpine-peaks', ground: 'snow', models: { chapelAlpine: ['chapel-alpine'], pine: ['tree-fir-a', 'tree-fir-b', 'tree-pine-young'], rock: granite } },
  'wilderness-run': { sky: 'wilderness-run', ground: 'forest-floor', models: { greatTree: ['tree-broadleaf-a'], broadleaf: ['tree-broadleaf-a', 'tree-broadleaf-b'], shrub: ['shrub-b', 'fern'], grassTuft: ['grass-tuft'] } },
  'tulip-gardens': { sky: 'tulip-gardens', ground: 'tulip-field', groundTile: 16, carpet: ['#E8581A', '#E8581A', '#C8302A'], models: { greatWindmill: ['windmill'], windmill: ['windmill'], powerPole: ['power-pole'], grassTuft: ['grass-tuft'], broadleaf: ['tree-broadleaf-a', 'tree-broadleaf-b'] } },
  'sunset-highway': { sky: 'sunset-highway', ground: 'sand-desert', groundTint: [0.86, 0.92, 1.0], models: { butte: ['mesa-a'], powerPole: ['power-pole'], rock: sandstone, shrub: ['shrub-desert'] } },
  'ancient-ruins': { sky: 'ancient-ruins', ground: 'grass', models: { aqueduct: ['aqueduct'], column: ['column'], brokenArch: ['broken-arch'], rock: limestone, grassTuft: ['grass-tuft'] } },
  'metropolis-night': { sky: 'metropolis-night', ground: 'cobble', models: { spire: ['tower-a'], tower: ['tower-a', 'tower-b', 'tower-c'], streetLamp: ['street-lamp'] }, exposure: 2, skyLight: 0.35 },
  'coastal-cliffs': { sky: 'coconut-beach', ground: 'grass', models: { seaArch: ['sea-arch'], cliff: ['cliff-coast-a', 'cliff-coast-b'], lighthouse: ['lighthouse'], rock: [...granite, ...limestone], grassTuft: ['grass-tuft'] } },
  'destination-marina': { sky: 'coconut-beach', ground: 'sand-beach', models: { clockTower: ['clock-tower'], sailboat: ['sailboat'], palm: palms } },
  'destination-oasis': { sky: 'desert-canyons', ground: 'sand-desert', models: { kasbah: ['kasbah'], palm: palms, rock: sandstone } },
  'destination-castle': { sky: 'wilderness-run', ground: 'grass', models: { castleTower: ['castle-tower'], cypress: ['cypress'], rock: limestone, shrub: ['shrub-b'], grassTuft: ['grass-tuft'] } },
  'destination-colosseum': { sky: 'ancient-ruins', ground: 'ruins-stone', models: { colosseum: ['colosseum'], column: ['column'], shrub: ['shrub-b'] } },
  'destination-aerodrome': { sky: 'tulip-gardens', ground: 'grass', models: { hangar: ['hangar'], grassTuft: ['grass-tuft'] } },
};

/** The manifest entry for a logical id; a missing one is a broken pack. */
export function artEntry(manifest, id) {
  const entry = manifest[id];
  if (!entry) throw new Error(`art: the manifest has no ${id}`);
  return entry;
}

export function artUrl(manifest, id) {
  return BLOB_BASE + artEntry(manifest, id).file;
}

/** The painted distance's strips per stage, far to near (assets/tools/ghibli/backdrops). */
export const BACKDROP_LAYERS = ['far', 'mid'];

/** Every logical id a stage draws with, traffic and the road included. */
export function stageArtIds(stageId) {
  const art = STAGE_ART[stageId];
  if (!art) throw new Error(`art: no art for stage ${stageId}`);
  const sets = (set) => ['albedo', 'normal', 'arm'].map((map) => `tex/${set}/${map}`);
  const props = [...new Set(Object.values(art.models).flat())];
  return [
    `sky/${art.sky}.env`, `sky/${art.sky}.paint.jpg`, ...BACKDROP_LAYERS.map((layer) => `backdrop/${stageId}.${layer}`),
    ...sets(art.ground), ...(art.verge ? sets(art.verge) : []), ...sets('asphalt'),
    ...props.flatMap((m) => [0, 1, 2].map((l) => `model/${m}/lod${l}`)),
    ...Object.values(TRAFFIC_MODELS).map((m) => `model/${m}/${TRAFFIC_LOD}`),
    HERO_CAR, ...RIDERS,
    ...(art.flagman ? [FLAGMAN] : []),
  ];
}

/**
 * The level of detail for a placement `size` metres tall this far away, or
 * null past the haze; nothing draws past `visible`, where the fog has it.
 */
export function lodFor(distance, size, visible = Infinity) {
  if (!(size > 0)) throw new Error(`art: a placement ${size} metres tall`);
  if (distance > visible) return null;
  const d = distance / Math.max(1, size / LOD_SIZE);
  if (d > LOD_FAR) return null;
  return d < LOD_SPLITS[0] ? 0 : d < LOD_SPLITS[1] ? 1 : 2;
}

/**
 * Loads a stage's art once and keeps it: textures and models as asset
 * containers, held across stages because forks revisit sets. `locate(url)`
 * resolves to `{url, release}`: where this realm loads the file from, and what
 * to call once Babylon has it. A presenter's worker reaches no network, so
 * there the file's bytes come through its seat as a blob: URL.
 */
export class ArtLibrary {
  constructor(B, scene, manifest, locate) {
    this.B = B;
    this.scene = scene;
    this.manifest = manifest;
    this.locate = locate;
    this.loads = new Map();
    this.done = new Map();
    this.loadingStages = new Map();
    this.readyStages = new Set();
  }

  _load(id) {
    if (!this.loads.has(id)) {
      const B = this.B;
      const kind = artEntry(this.manifest, id).kind;
      const loading = this.locate(artUrl(this.manifest, id)).then(({ url, release }) => (kind === 'model'
        ? B.LoadAssetContainerAsync(url, this.scene, { pluginExtension: '.glb' })
        : kind === 'hdri-env'
          ? new Promise((resolve, reject) => {
            const env = new B.CubeTexture(url, this.scene, null, false, null, () => resolve(env), (message) => reject(new Error(`art: ${id}: ${message}`)), undefined, true, '.env');
          })
          : new Promise((resolve, reject) => {
            const tex = new B.Texture(url, this.scene, false, false, B.Texture.TRILINEAR_SAMPLINGMODE, () => resolve(tex), (message) => reject(new Error(`art: ${id}: ${message}`)));
          })).then((asset) => {
        release();
        return asset;
      }));
      this.loads.set(id, loading.then((asset) => {
        this.done.set(id, asset);
        return asset;
      }));
    }
    return this.loads.get(id);
  }

  loadStage(stageId) {
    if (!this.loadingStages.has(stageId)) {
      this.loadingStages.set(stageId, Promise.all(stageArtIds(stageId).map((id) => this._load(id))).then(() => {
        this.readyStages.add(stageId);
      }));
    }
    return this.loadingStages.get(stageId);
  }

  ready(stageId) {
    return this.readyStages.has(stageId);
  }

  get(id) {
    const asset = this.done.get(id);
    if (!asset) throw new Error(`art: ${id} is not loaded`);
    return asset;
  }
}
