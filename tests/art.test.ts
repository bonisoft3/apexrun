import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { artUrl, fogVisible, KIND_HEIGHT, ROAD_ALBEDO, LOD_FAR, LOD_SIZE, LOD_SPLITS, lodFor, modelScales, STAGE_ART, stageArtIds } from "../shell/engine/art.js";
import { STAGE_LOOKS } from "../shell/engine/stage_look.js";

const manifest = JSON.parse(await Deno.readTextFile(new URL("../assets/manifest.json", import.meta.url)));

Deno.test("art: every stage draws with art, and every file it names is in the manifest", () => {
  assertEquals(Object.keys(STAGE_ART).sort(), Object.keys(STAGE_LOOKS).sort());
  for (const stage of Object.keys(STAGE_ART)) {
    for (const id of stageArtIds(stage)) assert(manifest[id], `${stage} needs ${id}`);
  }
});

// A model mapped to a kind the stage never places would load and never draw.
Deno.test("art: a stage's models stand in only for kinds it places", () => {
  for (const [stage, art] of Object.entries(STAGE_ART)) {
    const kinds = new Set((STAGE_LOOKS as Record<string, { props: { kind: string }[] }>)[stage].props.map((p: { kind: string }) => p.kind));
    for (const kind of Object.keys(art.models)) assert(kinds.has(kind), `${stage} places no ${kind}`);
  }
});

// A model is scaled to its kind's height; with none it would draw at NaN.
Deno.test("art: every kind a stage draws with models has a height", () => {
  for (const [stage, art] of Object.entries(STAGE_ART)) {
    for (const kind of Object.keys(art.models)) assert((KIND_HEIGHT as Record<string, number>)[kind] > 0, `${stage}: ${kind} has no height`);
  }
});

Deno.test("art: files are read from the blob store by their content address", () => {
  assertEquals(artUrl({ x: { file: "ab.glb" } }, "x"), "/blobs/mecha-objects/ab.glb");
  assertThrows(() => artUrl({}, "model/missing/lod0"), Error, "no model/missing/lod0");
});

Deno.test("art: detail drops with distance and nothing draws past the haze", () => {
  assertEquals(lodFor(0, 1), 0);
  assertEquals(lodFor(LOD_SPLITS[0] + 1, 1), 1);
  assertEquals(lodFor(LOD_SPLITS[1] + 1, LOD_SIZE), 2);
  assertEquals(lodFor(LOD_FAR + 1, LOD_SIZE), null);
});

Deno.test("art: nothing draws past what the fog leaves, and a placement must have a size", () => {
  assertEquals(lodFor(fogVisible(0.002) + 1, LOD_SIZE * 20, fogVisible(0.002)), null);
  assertThrows(() => lodFor(10, undefined as unknown as number), Error, "metres tall");
});

// A 40 m mesa was switched on at 520 m, in plain view, the same as a shrub.
Deno.test("art: a tall prop stays on the horizon as far further as it is taller", () => {
  assertEquals(lodFor(LOD_FAR * 5, LOD_SIZE * 6), 2);
  assertEquals(lodFor(LOD_FAR * 7, LOD_SIZE * 6), null);
  assertEquals(lodFor(LOD_SPLITS[0] * 3, LOD_SIZE * 6), 0, "and keeps its detail as far");
});

// Every rock model was stretched to the same 1.4 m: the owner saw regular
// rocks of one shape, and a flat slab stood up as a wall. A stage's rocks
// are one set, scaled together, so slabs stay low and stacks stay tall.
Deno.test("art: a stage's rocks keep their sizes relative to one another", () => {
  for (const [stage, art] of Object.entries(STAGE_ART) as [string, any][]) {
    const ids: string[] | undefined = art.models.rock;
    if (!ids) continue;
    const scales = modelScales(manifest, "rock", ids);
    assert(scales.every((s: number) => s === scales[0]), `${stage}: one scale for the whole set`);
    const heights = ids.map((id, i) => manifest[`model/${id}/lod0`].bounds_m[1][1] * scales[i]);
    const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
    assert(Math.abs(mean - KIND_HEIGHT.rock) < 1e-9, `${stage}: rocks average ${mean} m`);
    if (ids.length > 2) assert(Math.max(...heights) / Math.min(...heights) >= 2, `${stage}: low slabs and tall stacks, ${heights.map((h) => h.toFixed(2))}`);
  }
});

Deno.test("art: other kinds are each drawn at their kind's height", () => {
  const ids = STAGE_ART["coconut-beach"].models.palm;
  modelScales(manifest, "palm", ids).forEach((s: number, i: number) => {
    assert(Math.abs(manifest[`model/${ids[i]}/lod0`].bounds_m[1][1] * s - KIND_HEIGHT.palm) < 1e-9);
  });
});

// Rocks sit 3-6 m from the rumble edge; a wide boulder at the top of its
// placement scale must not reach over the asphalt.
Deno.test("art: no rock model's footprint reaches the road", () => {
  for (const [stage, art] of Object.entries(STAGE_ART) as [string, any][]) {
    const ids: string[] | undefined = art.models.rock;
    if (!ids) continue;
    const scales = modelScales(manifest, "rock", ids);
    const reach = Math.max(...ids.map((id, i) => {
      const [lo, hi] = manifest[`model/${id}/lod0`].bounds_m;
      return Math.hypot(Math.max(-lo[0], hi[0]), Math.max(-lo[2], hi[2])) * scales[i];
    }));
    for (const spec of (STAGE_LOOKS as any)[stage].props) {
      if (spec.kind !== "rock") continue;
      assert(reach * spec.scale[1] <= spec.near, `${stage} rock at ${spec.near} m reaches ${(reach * spec.scale[1]).toFixed(2)} m`);
    }
  }
});

Deno.test("art: each rock set goes where its stone is", () => {
  const sets = (stage: string) => new Set((STAGE_ART as Record<string, any>)[stage].models.rock.map((id: string) => manifest[`model/${id}/lod0`].set));
  for (const stage of ["desert-canyons", "sunset-highway", "destination-oasis"]) assertEquals(sets(stage), new Set(["desert"]), stage);
  for (const stage of ["alpine-peaks"]) assertEquals(sets(stage), new Set(["granite"]), stage);
  for (const stage of ["ancient-ruins", "destination-castle"]) assertEquals(sets(stage), new Set(["limestone"]), stage);
  for (const stage of ["gateway-pass", "coastal-cliffs", "coconut-beach"]) assertEquals(sets(stage), new Set(["granite", "limestone"]), stage);
});

// DESIGN.md "Ghibli gouache": the concept's trees are painted leaf masses,
// its palms tall and slender with long drooping fronds, its firs layered
// dark silhouettes. The cartoon pack's smooth puffs, short curving palms and
// clump foam read as the railway build, which the owner could not tell from
// the gouache one.
Deno.test("art: canopies are painted leaf masses, palms tall and slender, firs layered", () => {
  const canopies = ["tree-fir-a", "tree-fir-b", "tree-pine-young", "tree-broadleaf-a", "tree-broadleaf-b", "shrub-b", "shrub-desert", "shrub-tropical"];
  for (const id of canopies) {
    for (const lod of [0, 1, 2]) assert(manifest[`model/${id}/lod${lod}`].note.includes("painted leaf masses"), `${id} lod${lod}`);
  }
  for (const id of ["palm-a", "palm-b", "palm-c"]) {
    const [[x0, , z0], [x1, y1, z1]] = manifest[`model/${id}/lod0`].bounds_m;
    assert(y1 / Math.max(x1 - x0, z1 - z0) >= 1.0, `${id} stands taller than its crown is wide: ${y1.toFixed(1)} over ${Math.max(x1 - x0, z1 - z0).toFixed(1)}`);
  }
  assert(/7 rounded tiers/.test(manifest["model/tree-fir-a/lod0"].note), "the tall fir is layered");
  assert(KIND_HEIGHT.palm >= 12, `palms stand tall: ${KIND_HEIGHT.palm} m`);
});

// DESIGN.md "Ghibli gouache": the ground is painted, not built. The model
// railway's flock, grit and plaster sets read as material on a bench; here
// each set is a gouache repaint or, where the repaint was rejected, the
// cartoon set it was painted from.
Deno.test("art: every ground set is gouache or cartoon, none model-railway material", () => {
  const prompt = (set: string): string => manifest[`tex/${set}/albedo`]?.source?.generated?.prompt ?? "";
  for (const id of Object.keys(manifest).filter((k) => /^tex\/[^/]+\/albedo$/.test(k))) {
    assert(!/model railway/i.test(prompt(id.split("/")[1])), `${id} is still model-railway material`);
  }
  const flat = (set: string) => manifest[`tex/${set}/albedo`]?.source?.procedural?.script === "ghibli/textures/flat.py";
  for (const set of ["snow", "cobble", "rock-canyon"]) assert(/gouache/i.test(prompt(set)), `${set} is painted in gouache`);
  for (const set of ["grass", "sand-beach", "sand-desert", "asphalt"]) assert(flat(set), `${set} is painted from its palette`);
});

// DESIGN.md "Ghibli gouache": the concept's skies are Kazuo Oga's, opaque
// gouache with towering cumulus. The cel-shaded domes read as game art and
// the owner could not tell the gouache build from the railway one.
Deno.test("art: every painted sky is a gouache sky", () => {
  const skies = Object.keys(manifest).filter((k) => /^sky\/.+\.paint\.jpg$/.test(k));
  assert(skies.length >= 9, `${skies.length} painted skies`);
  for (const id of skies) {
    const gen = manifest[id].source?.generated ?? {};
    assert(/gouache/i.test(gen.prompt ?? ""), `${id} is painted as: ${(gen.prompt ?? "").slice(0, 60)}`);
    if (id !== "sky/metropolis-night.paint.jpg") assert(/cumulus/i.test(gen.prompt), `${id} towers with cumulus`);
    assert(manifest[id].horizon_srgb.length === 3, `${id} names its horizon`);
  }
});

// DESIGN.md "Ghibli gouache": the concept's earth reads warm against a dark
// road. Our repaints kept the cartoon sets' dark means and the frame read
// dull, so the sets are painted from palettes; then orange sand and bright
// greens measured twice the concepts' saturation (t28), so the desert floor
// is a warm ochre and the grass muted, still well over the road.
Deno.test("art: the painted ground is warm and held back, the road a dark wash", () => {
  const luma = (set: string) => {
    const { palette } = manifest[`tex/${set}/albedo`].source.procedural.params;
    return palette.reduce((sum: number, [hex, share]: [string, number]) => {
      const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);
      return sum + share * (0.2126 * r + 0.7152 * g + 0.0722 * b);
    }, 0);
  };
  assert(luma("sand-desert") > 0.35 && luma("sand-beach") > 0.7 && luma("grass") > 0.4, `warm earth: desert ${luma("sand-desert").toFixed(2)}, beach ${luma("sand-beach").toFixed(2)}, grass ${luma("grass").toFixed(2)}`);
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(manifest["tex/sand-desert/albedo"].source.procedural.params.palette[1][0].slice(k, k + 2), 16));
  assert(r > b + 40, "the desert is warm");
  assert((Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b) < 0.6, "and not orange");
  assert(luma("asphalt") < 0.2, `the road is a dark wash: ${luma("asphalt").toFixed(2)}`);
  // Every green stage's land measured saturation 0.5-0.6 against the concepts' 0.38 (t30).
  for (const set of ["grass", "forest-floor"]) {
    const [r, g, b] = [1, 3, 5].map((k) => parseInt(manifest[`tex/${set}/albedo`].source.procedural.params.palette[1][0].slice(k, k + 2), 16));
    assert((Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b) < 0.48, `${set} is a held-back green`);
  }
});

// The owner chose the Ghibli concepts, whose buttes are tall warm rock lit
// warm and shaded cool: ours stood 25 m off the road as banded drums, cream
// and orange strata rings round squat cylinders, and walled off the painted
// distance. They stand taller, one rock without bands.
Deno.test("art: the desert's buttes are tall unbanded rock standing back from the road", () => {
  for (const id of ["mesa-a", "mesa-b"]) {
    const entry = manifest[`model/${id}/lod0`];
    assert(!entry.materials.some((m: string) => /cream|orange/.test(m)), `${id} carries no strata bands: ${entry.materials}`);
  }
  assert(KIND_HEIGHT.mesa >= 50, `buttes stand ${KIND_HEIGHT.mesa} m`);
  const mesas = (STAGE_LOOKS as any)["desert-canyons"].props.filter((p: any) => p.kind === "mesa");
  // Pulled back to 70 m the frame went empty beside the concept's buttes,
  // which stand close enough to frame the road: the near ones stand at 35-45 m.
  assert(mesas.every((p: any) => p.near >= 35), `no butte within 35 m of the road: ${mesas.map((p: any) => p.near)}`);
  assert(mesas.some((p: any) => p.near <= 45), `some buttes frame the road: ${mesas.map((p: any) => p.near)}`);
});

// The concepts' road is charcoal, near their darkest tone; ours drew a worn
// grey at 0.16 luminance where theirs sits near 0.07 (t29), and lifted the
// whole frame's darks.
Deno.test("art: the road is drawn charcoal", () => {
  const lin = (c: number) => (c / 255) ** 2.2;
  const albedo = manifest["tex/asphalt/albedo"].source.procedural.params.palette.reduce((sum: number, [hex, share]: [string, number]) => {
    const [r, g, b] = [1, 3, 5].map((k) => lin(parseInt(hex.slice(k, k + 2), 16)));
    return sum + share * (0.2126 * r + 0.7152 * g + 0.0722 * b);
  }, 0) * ROAD_ALBEDO;
  assert(albedo < 0.08, `the road's linear albedo is ${albedo.toFixed(3)}`);
});

// The t29 audit of every stage: the coast's sea stacks were stacked
// chamfered blocks with an ochre tier and the gateway a purple slab of
// boxes, both reading as the cartoon pack beside the painted world.
Deno.test("art: headlands are rounded rock under grass, the gateway a stone arch", async () => {
  for (const id of ["cliff-coast-a", "cliff-coast-b"]) {
    assertEquals(manifest[`model/${id}/lod0`].materials.sort(), ["grass", "rock"], `${id} is rock under a grass cap`);
  }
  const { PROP_BUILDERS } = await import("../shell/engine/stage_look.js");
  const made: string[] = [];
  const box = (name: string) => (made.push(name), { name, position: { set() {} }, rotation: {}, material: null });
  const B = { MeshBuilder: { CreateBox: box } };
  // deno-lint-ignore no-explicit-any
  (PROP_BUILDERS as any).arch(B, null, (hex: string) => hex);
  assert(made.filter((n) => n === "arch#voussoir").length >= 7, `the gateway is an arch of voussoirs: ${made}`);
});

// The concept's polder carries a power line along the road and slim modern
// turbines far off, beside the windmills.
Deno.test("art: the tulip road runs under a power line, with turbines far off", async () => {
  const props = (STAGE_LOOKS as any)["tulip-gardens"].props.map((p: any) => p.kind);
  assert(props.includes("powerPole") && props.includes("turbine"), `${props}`);
  const { PROP_BUILDERS } = await import("../shell/engine/stage_look.js");
  const made: string[] = [];
  const mesh = (name: string) => (made.push(name), { name, position: { set() {} }, rotation: {}, material: null });
  // deno-lint-ignore no-explicit-any
  (PROP_BUILDERS as any).turbine({ MeshBuilder: { CreateBox: mesh, CreateCylinder: mesh } }, null, (hex: string) => hex);
  assertEquals(made.filter((n) => n === "turbine#blade").length, 3, "three blades");
});

// The sunset road shares the desert's red earth, which measured saturation
// 0.56 there against the concepts' 0.38 (t31): its ground is tinted back.
Deno.test("art: the sunset road's earth is held back from the desert's", () => {
  const [r, g, b] = (STAGE_ART as any)["sunset-highway"].groundTint;
  assert(b > r && r < 1, `a cooling tint: ${[r, g, b]}`);
});

// The owner: the props are smooth flat-shaded models where the concepts are
// painted. The biggest on-screen props carry a painted surface baked by
// projection (assets/tools/ghibli/bake), every LOD from the same paintings.
Deno.test("art: the big props carry baked paintings", () => {
  for (const model of ["mesa-a", "mesa-b", "palm-a", "palm-b", "palm-c", "tree-fir-a", "tree-fir-b", "tree-pine-young", "cypress",
    "tree-broadleaf-a", "tree-broadleaf-b", "cliff-coast-a", "cliff-coast-b", "column", "broken-arch"]) {
    for (const lod of [0, 1, 2]) {
      const baked = manifest[`model/${model}/lod${lod}`].source.baked;
      assert(baked?.script === "tools/ghibli/bake/bake.py", `${model} lod${lod} is baked`);
      assertEquals(baked.prompt, manifest[`model/${model}/lod0`].source.baked.prompt, `${model}'s LODs share one painting`);
    }
  }
});
