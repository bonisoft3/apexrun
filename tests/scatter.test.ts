import { assert, assertEquals } from "jsr:@std/assert@1";
import { MID_BAND, NEAR_BAND, scatterVerge, VERGE_SCATTER } from "../shell/engine/scatter.js";
import { SHORE, STAGE_LOOKS } from "../shell/engine/stage_look.js";

// Bare verges beside a concept whose verges are crowded with bushes, stones
// and cacti read as empty to the owner. A stage's verges carry its own
// scenery, densest by the road.
Deno.test("scatter: every stage but the city carries verge scenery, densest by the road", () => {
  for (const id of Object.keys(STAGE_LOOKS)) {
    const items = scatterVerge(id, 380, 12);
    if (id === "metropolis-night") {
      assertEquals(items.length, 0, "the city's verges are pavement");
      continue;
    }
    const metres = 378 * 12;
    for (const side of [-1, 1]) {
      const ours = items.filter((s) => s.side === side);
      assert(ours.length / metres >= 0.5, `${id} side ${side}: ${(ours.length / metres).toFixed(2)} items a metre`);
      const near = ours.filter((s) => s.offset < NEAR_BAND[1]).length;
      assert(near > ours.length - near, `${id} side ${side}: most by the road (${near} of ${ours.length})`);
    }
    const kinds = new Set((VERGE_SCATTER as any)[id].map((s: any) => s.kind));
    for (const s of items) {
      assert(kinds.has(s.kind), `${id} scatters only its own kinds: ${s.kind}`);
      assert(s.offset >= NEAR_BAND[0] && s.offset <= MID_BAND[1], `${id}: ${s.offset} m past the rumble edge`);
      assert(s.along >= 0 && s.along < 1 && s.i >= 0 && s.i < 379, `${id}: a place on the road`);
      const look: any = STAGE_LOOKS[id as keyof typeof STAGE_LOOKS];
      const wet = look.water && (look.water.side === "left") === (s.side < 0);
      if (wet) assert(s.offset <= SHORE - 4, `${id}: dry land on the sea side, at ${s.offset}`);
    }
  }
  assertEquals(JSON.stringify(scatterVerge("desert-canyons", 380, 12)), JSON.stringify(scatterVerge("desert-canyons", 380, 12)), "the same every time");
  const desert = new Set(scatterVerge("desert-canyons", 380, 12).map((s) => s.kind));
  // The concept's desert verge is dense scrub; its saguaros are the pack's
  // props along the road, one every segment (stage_look.js).
  assert(desert.has("bush") && !desert.has("cactus"), "the desert's verge is scrub");
  const alpine = VERGE_SCATTER["alpine-peaks"].map((s: any) => s.kind);
  assert(alpine.includes("drift"), "the alpine verge has snow drifts");
});

// DESIGN.md "Ghibli gouache": lush verges banked with bushes up to 2.4 m hid
// the signature props; the owner: "too many bushes around the stage, it
// prevent us from seeing the tulips and the coconut trees". The verges stay
// green and flowered but low and sparse, and the tulip field has no bushes
// before it at all.
Deno.test("scatter: the verges are low and sparse, the tulip field unhidden", () => {
  for (const id of Object.keys(STAGE_LOOKS)) {
    if (id === "metropolis-night") continue;
    const items = scatterVerge(id, 380, 12);
    const perMetreSide = items.length / (378 * 12) / 2;
    assert(perMetreSide <= 1.3, `${id}: ${perMetreSide.toFixed(2)} items a metre a side`);
    // A cactus stands alone and a snow drift lies low, under half its size tall.
    for (const s of items) assert(s.size <= 1.2 || ["cactus", "drift"].includes(s.kind), `${id}: a ${s.kind} ${s.size.toFixed(2)} m across`);
  }
  const tulips = new Set((VERGE_SCATTER as any)["tulip-gardens"].map((s: any) => s.kind));
  assert(!tulips.has("bush"), "no bushes before the tulip field");
  for (const kind of tulips) assert(["flower", "poppies", "tuft"].includes(kind as string), `the tulip verge grows only low ${kind}`);
  // The concept's road runs between dense orange poppies (t30 had a few dots).
  assert(tulips.has("poppies"), "poppies line the tulip road");
});
