// The run's milestones lifted out of the kinetic plane (pronto's
// kinetic-machine record), over recorded runs on the caged engine: each is
// one of the moments a row is worth, and the rows alone carry the race back
// to any of them. Loading a milestone the way scrubbing the rows' history
// does lands on the forward run's own frame, checksum for checksum.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { createKineticHost, canonical, checksum } from "/omnishell/interpreter/kinetic.js";
import { unpackInputs } from "/omnishell/interpreter/kinetic-milestones.js";

(0, eval)(await Deno.readTextFile(new URL(import.meta.resolve("/omnishell/interpreter/vendor/ses.umd.min.js"))));
const { evaluateEngine } = await import("/omnishell/interpreter/jessie.js");
const caged = await evaluateEngine(JSON.parse(await Deno.readTextFile(new URL("../shell/engines/apexrun.json", import.meta.url))));
const solo = { width: 2, encode: caged.encodeCommand, decode: caged.decodeCommand, snapshots: caged.milestoneSnapshots };

const runs: Record<string, string[]> = {
  // Each run starts where it was recorded: from the title, or on the road.
  "title-left-fork-time-over": ["grid", "start", "landmark", "checkpoint", "landmark", "time-over"],
  "right-fork-time-over": ["grid", "landmark", "checkpoint", "landmark", "time-over"],
  "castle-ending": ["grid", "landmark", "finish"],
  "ruins-oasis-ending": ["grid", "landmark", "checkpoint", "landmark", "finish"],
  "cliffs-aerodrome-ending": ["grid", "landmark", "checkpoint", "landmark", "finish"],
};

for (const [name, kinds] of Object.entries(runs)) {
  Deno.test(`milestones: ${name} lifts ${kinds.join(", ")} and loads back to each`, async () => {
    const run = JSON.parse(await Deno.readTextFile(new URL(`runs/${name}.json`, import.meta.url)));
    const rows: any[] = [];
    const host = createKineticHost({ engine: caged, seed: run.seed, initOptions: run.initOptions, historyLimit: 64, milestones: { ...solo, onLift: (m: any) => rows.push(m) } });
    const forward = new Map<number, number>();
    for (const [count, input] of run.inputs) {
      for (let i = 0; i < count; i++) {
        const state = host.stepTick(input);
        forward.set(host.getCurrentTick(), checksum(canonical(caged.saveState(state))));
      }
    }
    assertEquals(rows.map((r) => r.kind), kinds);
    // Seconds to minutes apart, never per frame.
    for (let i = 1; i < rows.length; i++) assert(rows[i].frame - rows[i - 1].frame > 60, `${rows[i].kind} ${rows[i].frame - rows[i - 1].frame} frames after ${rows[i - 1].kind}`);
    const at = createKineticHost({ engine: caged, seed: run.seed, initOptions: run.initOptions, historyLimit: 64, milestones: { ...solo, onLift: () => {} } });
    rows.forEach((row, i) => {
      assertEquals(row.checksum, forward.get(row.frame));
      const loaded = at.loadMilestone(rows, i, run.seed, run.initOptions);
      assertEquals(checksum(canonical(caged.saveState(loaded))), forward.get(row.frame));
    });
    // Two bytes a frame, and a stage's landmark its frame's state: the whole
    // run's rows are its inputs, a snapshot a stage and little else.
    const bytes = rows.reduce((n, r) => n + atob(r.inputs).length, 0);
    assertEquals(bytes, rows.at(-1).frame * 2);
    assertEquals(rows.filter((r) => r.snapshot !== undefined).map((r) => r.kind), rows.filter((r) => r.kind === "landmark").map((r) => r.kind));
    // A replay window opens at a landmark, loaded from its row alone, and
    // plays on the commands the next row lifted: frame for frame the forward
    // run's, checksum for checksum.
    rows.forEach((row, i) => {
      if (row.kind !== "landmark") return;
      const commands = unpackInputs(rows[i + 1].inputs, 2);
      const player = createKineticHost({ engine: caged, seed: run.seed, initOptions: run.initOptions, historyLimit: 2, milestones: { ...solo, onLift: () => {} } });
      player.loadMilestone([{ ...row, inputs: "" }], 0, run.seed, run.initOptions);
      for (let f = 1; f <= Math.min(420, commands.length); f++) {
        const state = player.stepTick(caged.decodeCommand(commands[f - 1]));
        assertEquals(checksum(canonical(caged.saveState(state))), forward.get(row.frame + f), `${row.kind} at ${row.frame}, frame ${f} of its window`);
      }
    });
  });
}

// A duel lifts through GGRS's session, here its sync test, which rolls every
// frame back seven: the finish lifts once, settled, with both seats' bytes,
// and the rows replay the duel both cars raced.
Deno.test("milestones: the recorded duel lifts its finish once through the rollback session", async () => {
  const { createRollbackHost } = await import("/omnishell/interpreter/kinetic-session.js");
  const { loadMilestone } = await import("/omnishell/interpreter/kinetic-milestones.js");
  const module = await Deno.readFile(new URL(import.meta.resolve("/omnishell/interpreter/vendor/ggrs/ggrs_wasm_bg.wasm")));
  const run = JSON.parse(await Deno.readTextFile(new URL("runs/duel.json", import.meta.url)));
  const rows: any[] = [];
  const host = await createRollbackHost({
    engine: caged, module, session: "synctest", checkDistance: 7, seed: run.seed, initOptions: run.initOptions,
    encode: caged.encodeInput, decode: caged.decodeInputs, milestones: { onLift: (m: any) => rows.push(m) },
  });
  for (const [count, input] of run.inputs) for (let i = 0; i < count; i++) host.step(input);
  // The session settles what lies past its check distance; step it on idle.
  for (let i = 0; i < 10; i++) host.step([{}, {}]);
  assertEquals(rows.filter((r) => r.kind === "duel-finish").length, 1);
  const finish = rows.findIndex((r) => r.kind === "duel-finish");
  const replayed = loadMilestone(caged, { seed: run.seed, initOptions: run.initOptions, decode: (b: Uint8Array) => caged.decodeInputs(b, [0, 0]) }, rows, finish);
  assertEquals(replayed.duel, run.covers.duel);
  host.dispose();
});
