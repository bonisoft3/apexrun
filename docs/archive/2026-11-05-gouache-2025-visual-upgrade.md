---
type: decision
title: "2025 gouache visual and offline RTX 4090 asset upgrade without forking the game"
description: Archived — upgrades Apex Run from procedural cartoon primitives to 2025-grade Kazuo Oga gouache art and lighting via offline RTX 4090 asset generation (2048×2048 multi-view albedo/normal/AO baking, alpha-card foliage and craggy headland meshes) and Level-0 presenter enhancements (multi-band roadside topography, cascaded shadows, GTAO, volumetric cloud banks and surf), while keeping the 60 Hz Jessie simulation, prop collision radii, and WebGPU/Native GGRS online play 100% shared and bit-identical.
status: archived (built; contract moved to [[../../DESIGN|DESIGN.md]])
---

# 2025 gouache visual and offline RTX 4090 asset upgrade

Apex Run runs on native Metal (`ApexRun.app` on macOS, `ApexRun-iOS.app` on iOS) alongside the browser WebGPU presenter (`shell/engine/renderer.js`) at 120 fps at full Retina resolution with zero JS worker serialization.

While the lighting and frame rate feel like a native desktop game, the visual execution still falls short of a 2025 AAA stylized racer (`journal.html` and the round-2 Kazuo Oga gouache concepts in [[../../DESIGN|DESIGN.md]]). The bottleneck is no longer frame budget on a Mac mini browser worker; it is the underlying **3D geometry silhouettes** (extruded-strip palm fronds, smooth metaball bushes, cylindrical "green muffin" sea cliffs), **texture resolution** (`512×512` tiles in the `4096×4096` 64-tile prop mega-atlas without tangent-space brushwork normals), **coarse lateral terrain ribbons**, and **missing native shadow cascades / GTAO**.

This record specifies the five-pillar offline RTX 4090 (`vengeance`) and dual-presenter upgrade that closes that gap while preserving a single cross-platform game.

## Non-negotiable invariant: one game, WebGPU + Native, cross-platform online lockstep

Upgrading the visuals must **never fork the game**:

1. **Single 60 Hz simulation and GGRS rollback contract.**
   `shell/engine/simulation.js`, `shell/engine/prng.js`, `shell/engine/stage_look.js` (`STAGE_LOOKS`, `placeProps`, `PROP_RADIUS`), and `shell/engine/scatter.js` remain the sole source of truth across Chromium/Firefox/Safari WebGPU, macOS/Windows/Linux Desktop (`rquickjs` + native `ggrs`), and iOS/Android Phone (`JavaScriptCore` / `QuickJS` + `ggrs`). Every platform evaluates the same IEEE-754 double-precision step, exchanges the same 1-byte GGRS seat inputs, and lifts identical `(frame, kind, checksum)` milestones so a browser player and a native desktop or mobile player can race each other in `apexrun_duel` with zero desync (`tests/sync.test.ts`, `tests/online-machine.test.ts`).
2. **Identical prop coordinates and collision footprints across LODs.**
   Every rebuilt `.glb` in `assets/manifest.json` (`model/<id>/lod0..2`) keeps its world-space origin at the ground contact point (`y = 0` with a `-0.08 m` underground root/base skirt) and fits within its declared `PROP_RADIUS[kind]` cylinder at road height. Replacing a cylindrical cliff or an extruded palm with a high-detail mesh never alters where obstacles sit or how a car collides with them.
3. **WebGPU continues to work first-class alongside Native.**
   Because the kinetic presenter is **Level 0 (pure projection)** of `{frame, state, prev, alpha, historical, levels, cut}`, visual upgrades live strictly in:
   - **Shared asset upgrades** (`assets/manifest.json` + `.seed-assets/`), where `lod0` carries high-poly geometry and `2048×2048` textures for desktop/capable GPUs while `lod1` and `lod2` carry lighter mip/triangle tiers for WebGL2 and mobile thermal budgets;
   - **Shared deterministic stage geometry** (`shell/engine/stage_gltf.js` and `shell/engine/renderer.js`), where visual-only lateral terrain subdivision leaves the drivable road surface (`|x| <= roadHalf`) mathematically identical to `simulation.js`;
   - **Target-specific presenter passes** (`shell/engine/renderer.js` for WebGPU/Babylon and `plugins/omnishell/desktop/bevy-presenter` + `apple_host_common.h` for Native Metal/wgpu).

| Layer | Shared or per-target | Cross-platform online impact |
| --- | --- | --- |
| `simulation.js`, `prng.js`, `stage_look.js` (`placeProps`, `PROP_RADIUS`) | Shared byte-for-byte | Bit-exact `saveState` checksums across Web, Desktop, Phone |
| `.seed-assets/` (`model/*/lod0..2`, `tex/*`, `sky/*`, `backdrop/*`) | Shared manifest (`manifest.json`), content-addressed in GCS | Collision bounds pinned to `PROP_RADIUS`; LOD chosen per target |
| Visual roadside terrain & cloud banks (`stage_gltf.js`, `renderer.js`) | Shared deterministic math outside `\|x\| <= roadHalf` | Zero effect on car physics, wheel contact, or replay scrubbing |
| Shaders, CSM shadows, GTAO, particles (`renderer.js`, `apple_host_common.h`) | Target-specific Level-0 projection | Purely visual; raises no events back to the simulation |

---

## Pillar 1: Offline RTX 4090 multi-view gouache albedo, tangent normal, and ray-traced AO baking

Today, most roadside models have no UV unwrap (`assets/tools/upgrade_2025_assets.py` injects vertex-color ambient occlusion, and the shader projects a procedural triplanar stroke tile), while `apple_host_common.h` packs up to 64 `512×512` prop and stage tiles into a `4096×4096` 2D mega-atlas (`sPropAtlasTex`). At chase-camera distance, a 15 m palm or a 55 m mesa spans hundreds of screen pixels, making flat vertex colors and `512×512` tiles immediately visible.

Using the RTX 4090 on `vengeance`:

1. **UV unwrapping (`xatlas`) across `lod0` and `lod1`.**
   Unwrap every hero prop (`palm-coast`, `palm-queen`, `cypress`, `tree-broadleaf`, `fir`, `sea-stack`, `mesa-a..c`, `cliff-a..c`, `arch`, `column`, `windmill`, `lighthouse`, and all 15 stage landmarks) with non-overlapping islands and consistent texel density.
2. **12-view SDXL / Flux + ControlNet Depth & Normal gouache synthesis.**
   Render each prop on the 4090 from 8 azimuths and 4 elevations (depth, world normal, cavity, and base palette). Run SDXL/Flux img2img with ControlNet Depth + Normal conditioned on the Kazuo Oga gouache palette so every rock facet, bark ridge, and masonry course receives directional impasto brushwork that respects the 3D form.
3. **Back-projection into `2048×2048` PBR-toon maps.**
   Project the multi-view paintings onto the UV atlas weighted by view-normal cosine and visibility, emitting three textures per prop (`tex/<prop>/color.webp`, `tex/<prop>/normal.webp`, `tex/<prop>/orm.webp`):
   - **Gouache Albedo (`2048×2048`)**: opaque pigment washes with warm sunlit tops and cool indigo crevices.
   - **Tangent-Space Impasto Normal (`2048×2048`)**: high-frequency canvas tooth and directional bristle ridges so the directional sun light catches the paint relief as the camera sweeps past.
   - **Ray-Traced Bent-Normal + Ambient Occlusion (`2048×2048`)**: 256-sample OptiX ray-traced ambient occlusion and cavity mask baked on the 4090 with a ground plane at `y = 0`, grounding every trunk base, arch plinth, and rock crevice.
4. **Expanded texture arrays in Native Metal and WebGPU.**
   Replace the `512×512`-tile 2D atlases in `apple_host_common.h` and `stage_gltf.js` with `2048×2048` 2D texture arrays (`MTLTextureType2DArray` / BC7 or ASTC on Native, WebP/KTX2 on WebGPU) and add tangent-space normal perturbation to the 3-step Oga toon lighting equation.

---

## Pillar 2: Botanical and geological 3D mesh overhaul

No shader or texture upscale can disguise primitive silhouettes when they cross the bright painted sky. The four worst geometry offenders are rebuilt offline on `vengeance`:

1. **Palms (`assets/tools/cartoon/plants/palm.py`) — from solid extruded prism strips to curved rachis spines + painted pinnae cards.**
   - Current `palm-coast` and `palm-queen` fronds are thick solid extruded strips that read like green banana peels.
   - Replace each crown with 18–24 arched central rachis stems carrying layered, slightly cupped leaf cards with alpha-tested (`alphaMode: "MASK"`, `alphaCutoff: 0.45`) gouache-painted pinnae fingers, individual leaflet droop, and a custom **Transferred Dome Normal** buffer pointing radially outward from the crown center.
   - In both `renderer.js` and `apple_host_common.h`, evaluate subsurface sun transmission (`pow(saturate(dot(V, -L)), 3.0) * frondMask`) so backlit fronds glow warm golden-green against the sunset sky while individual leaflet tips flutter on the wind phase.
2. **Shrubs and broadleaf trees (`assets/tools/cartoon/plants/broadleaf.py`) — from smooth metaball blobs to Ghibli leaf-cluster card arrays.**
   - Current shrubs (`shrub-tropical`, `shrub-b`, `shrub-desert`) and broadleaf canopies are marching-cubes metaballs whose silhouettes are smooth mathematical curves.
   - Replace them with the modern stylized-AAA foliage technique: a dark interior occlusion core wrapped in 300–800 oriented gouache brushstroke leaf-cluster cards (`lod0`), simplifying to 120 cards (`lod1`) and 40 cards (`lod2`).
   - Transfer vertex normals from a puffed bounding ellipsoid so diffuse toon shading (`dot(N, L)`) steps cleanly across broad sunlit domes while the alpha-tested silhouette edge breaks into crisp painted leaves.
   - Anchor all woody stems and basal skirts to `-0.085 * ymax` (plus the `-0.06 m` instance placement sink) with vertex-height wind pinning (`smoothstep(0.06, 0.85, localY)`) so roots never slide or float.
3. **Coastal cliffs, sea stacks, and mesas (`assets/tools/props/landforms.py`) — from cylindrical "green muffins" to stratified geological headlands.**
   - Current `sea-stack` and `cliff-*` models are radially symmetric fluted cylinders topped with a round green cap.
   - Generate asymmetric, craggy coastal headlands and stratified canyon buttes on the 4090 (Hunyuan3D-2 base meshes refined with Voronoi rock cleavage planes, stepped horizontal ledges, overhanging turf cornices, and wave-undercut basal notches).
   - Keep the base cross-section within `PROP_RADIUS` at `y = 0` so collision detection in `simulation.js` is untouched.
4. **Hero car and traffic (`model/car-hero`, `model/traffic-*`) — panel-gap normal maps and interior cockpit detail.**
   - Keep the curved GT silhouette and Ghibli rider rigs, and bake a `2048×2048` normal + occlusion map for door shutlines, hood louver vents, pop-up headlamp seams, dashboard gauges, and deep-dish alloy rim spokes, plus dual-lobe clearcoat reflection in `car_fs` and `renderer.js`.

---

## Pillar 3: Multi-band 3D sculpted roadside terrain topography

Today, the terrain on each side of the road in `renderer.js` is a two-band lateral strip (`5 m → 35 m` verge and `35 m → 1400 m` outer plane) and in `stage_gltf.js` is a three-band ramp (`TERRAIN_OFFSETS = [0, 40, 440, 1400]`: flat shelf to `40 m`, linear slope to `440 m`, flat plane to `1400 m`). Because the ground has only 2–3 lateral spans per side, every stage looks like a highway laid across a flat ironing board, and large cliffs or mesas appear stuck onto a flat shelf.

1. **24-band lateral × longitudinal terrain ribbon outside the road.**
   Subdivide the terrain ribbon laterally into 24 bands per side (`0.5 m` steps across the shoulder and first `10 m` of verge, expanding logarithmically out to `1,400 m`).
   - **Road surface invariant**: For `|x| <= roadHalf`, vertex heights remain 100% identical to `simulation.js` (`p.y`), so car physics, camera height, and opponent wheels are completely unchanged.
   - **Stage-specific lateral profiles (`stage_look.js` / `scenery.js`)**:
     - *Coconut Beach & Coastal Cliffs*: rolling sand dunes and a rising coastal bluff on the landward side; stepped stone promenade, sea wall, and sloping wet-sand foreshore slipping beneath the water plane on the ocean side.
     - *Desert Canyons & Gateway Pass*: raised rocky road-cut embankments (`+2 m` to `+12 m` within `8–30 m` of the shoulder) and talus scree slopes framing the highway before rising into the mesas.
     - *Alpine Peaks & Wilderness Run*: banked snowdrifts, roadside drainage swales, and rolling forested knolls.
2. **Slope- and altitude-driven gouache material splatting.**
   Compute vertex slope (`1.0 - normal.y`) and relative height above the road to blend three painted ground layers per stage in the shader: steep slopes (>38°) expose striated cliff rock; gentle crests show sunlit meadow grass or dry scrub; roadside hollows accumulate warm sand, soil, or snowdrifts, with a painted brushstroke transition mask rather than a smooth linear fade.
3. **Exact vertical planting for props and scatter.**
   Evaluate the same deterministic lateral height function `terrainHeightAt(stageId, segIdx, lateralOffset)` inside `stage_gltf.js` and `renderer.js` when emitting prop and scatter instance transforms, so every palm, shrub, boulder, and cliff sits flush in the sculpted embankment.

---

## Pillar 4: Real-time Cascaded Shadow Mapping (CSM) and Ground-Truth Ambient Occlusion (GTAO)

On WebGPU (`renderer.js`), three-cascade directional sun shadows and SSAO2 ground the palms and cars to the asphalt. On Native Metal (`apple_host_common.h`), shadows are currently approximated with an analytical palm-row stripe and a car contact ellipse, which leaves mesas, arches, buildings, and shrubs casting no directional shadows across the road and verge.

1. **Three-cascade directional sun shadow maps (`2048×2048×3` depth texture array).**
   - Render splits at `0–35 m` (hero car, riders, flagman, near verge), `35–140 m` (palm avenues, arches, traffic), and `140–550 m` (mesas, sea stacks, landmarks) from the stage's directional sun vector (`sunDir`).
   - Filter with a 4-tap Poisson disk + painterly brushstroke dither so shadow edges read as soft gouache brush washes rather than hard digital pixels or blurry Gaussian gradients.
   - Feed the shadow factor directly into the first step of the Oga toon ramp (`lit` → `cool indigo shade`), so passing through a palm avenue or under a Gateway Pass stone arch stripes the red GT hood and asphalt in rhythmic cool-blue shade bands.
2. **Screen-space Ground-Truth Ambient Occlusion (GTAO) pass.**
   - Run a half-resolution horizon-based GTAO compute/render pass over the native depth and normal buffer before the paper-grain composite pass.
   - Multiply GTAO into the ambient sky term (`skyLight`), grounding dense grass tufts, shrub bases, stone walls, and wheel wells without darkening direct sunlit highlights.

---

## Pillar 5: Volumetric painted cumulus banks, GPU drift smoke, sea-spray mist, and Gerstner ocean surf

1. **World-anchored 3D painted cumulus cloud banks in `stage_gltf.js`.**
   - `renderer.js` builds 14 world-anchored painted cumulus cards in three depth banks (`1.3 km`, `2.2 km`, `3.4 km`) across 7 distinct cloud silhouettes (`cumulusCard`), whereas `stage_gltf.js` currently leaves cloud banks out of the stage `.glb`.
   - Emit the 14 world-anchored cumulus cards (and a multi-plane impostor cluster per cloud with baked puff normals for silver-lining rim light) directly in `stage_gltf.js` with `material.extras.stk.cloud = true`, so both WebGPU and Native drive past the same towering Oga cumulus banks with true lateral parallax.
2. **GPU gouache particle ribbons for tire drift smoke, off-road dust, and coastal sea spray.**
   - Driven by the existing deterministic `pose_buffer.js` telemetry (`drift`, off-road surface flag, `nitro`, and ocean-side stage layout), render instanced billboarding gouache puff cards with eroded paper-edge alpha:
     - Warm cream-grey tire smoke curling off the rear tires during sustained drifts;
     - Ochre/sage dust plumes when two wheels drop onto the shoulder;
     - Low backlit sea-spray mist drifting across the Coconut Beach seawall and Coastal Cliffs headlands.
3. **Gerstner shore waves and painted whitewater surf lace.**
   - Displace the ocean ribbon vertices (`water: true`) with a 4-wave Gerstner swell train and compute shore distance to the sculpted foreshore and sea-stack bases, drawing two-tone painted whitewater foam bands that roll in, break against the seawall, and recede.

---

## Execution order and verification gates

Each slice builds offline on `vengeance` or in the Level-0 presenters and is gated by `sayt` (`deno test`, `cargo test`) plus visual inspection in both WebGPU and `ApexRun.app`:

| Phase | Scope | Verification gate |
| --- | --- | --- |
| **Phase 1: Botanical & geological meshes (Pillar 2)** | Rebuild `palm-coast`, `palm-queen`, `shrub-*`, `tree-broadleaf`, `fir`, `sea-stack`, `cliff-*`, `mesa-*` on `vengeance`; update `manifest.json` | `tests/renderer.test.ts` & `tests/stage_gltf.test.ts` pass; `PROP_RADIUS` collision parity unchanged; zero floating plants |
| **Phase 2: 2048×2048 multi-view gouache + normal + AO baking (Pillar 1)** | Run `xatlas` + 12-view SDXL ControlNet Depth/Normal + OptiX AO bake on `vengeance`; wire 2048² texture arrays + tangent normals in `renderer.js` and `apple_host_common.h` | All 15 stages load under 1.5 s; 120 fps on macOS Metal, 60 fps on WebGPU |
| **Phase 3: Multi-band roadside topography (Pillar 3)** | 24-band lateral terrain mesh + slope/height splatting + `terrainHeightAt` prop placement in `stage_gltf.js` and `renderer.js` | `tests/sync.test.ts` bit-exact checksum parity; road surface `\|x\| <= roadHalf` unchanged |
| **Phase 4: Native CSM shadows & GTAO (Pillar 4)** | 3-cascade shadow depth pass + GTAO pass in `apple_host_common.h` / `bevy-presenter` | Shadow bands match Oga indigo shade tone; zero shadow acne on road |
| **Phase 5: Cumulus banks, particles & Gerstner surf (Pillar 5)** | Export 3-bank cumulus cards in `stage_gltf.js`; add drift smoke, dust, sea spray and shore surf foam | Cross-platform online duel verified between WebGPU and `ApexRun.app` |

## Rejected

- **Forking `simulation.js` or `stage_look.js` for a "Desktop HD edition"** — breaks cross-platform online duels (`apexrun_duel`) and invalidates shared high-score milestone replays between browser, desktop, and mobile players.
- **Full-screen Kuwahara / painterly post-processing filters** — rejected in [[../../DESIGN#Review|DESIGN.md]]; a post-process blur cannot invent missing leaflet silhouettes or craggy rock strata, softens distant readouts at 280 km/h, and wastes per-pixel bandwidth.
- **Photorealistic PBR foliage and Megascans rock shaders** — clashes with the Kazuo Oga gouache skies, painted horizon rings, and toon-lit characters; high-resolution geometry and normals must serve the 3-step gouache lighting model (broad sunlit washes, cool indigo shade, and canvas-tooth normal relief), never photoreal micro-specular noise.
- **Runtime UV unwrapping or runtime procedural SDF meshing** — adds seconds of CPU stall on stage transitions; all high-poly meshing, `xatlas` parameterization, OptiX AO ray-tracing, and SDXL multi-view projection belong offline on `vengeance`, shipped as content-addressed `.glb` and `.webp`/`.ktx2` artifacts in `manifest.json`.
