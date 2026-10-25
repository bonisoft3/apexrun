// The kinetic host's sync test (GGPO's SyncTestSession) over recorded runs:
// every tick rolls back eight frames, reloads that snapshot and re-simulates
// the logged commands, and any frame whose state differs from the forward
// run's fails, named. Between them the runs cross the title, the swoop and
// countdown, two full first stages, both sides of its fork, the arch's
// autopilot and the stage swap, a time over, three endings and the drive into
// each, and a duel's two seats racing to its goal. A run that no
// longer covers what it was recorded for is re-recorded with
// tests/record-runs.ts.
//
// The engine under test is the one the page steps: the graph pronto linked
// (shell/engines/apexrun.json), imported by the terminal's cage. The same
// run on the simulation imported as a plain module ends in the same state,
// so the cage changes nothing a frame computes.
import { assertEquals } from "jsr:@std/assert@1";
import { apexrunEngine } from "../shell/engine/simulation.js";
import { createKineticHost, ggrsWasm, evaluateEngine, createRollbackHost } from "./platform.ts";
const caged = await evaluateEngine(JSON.parse(await Deno.readTextFile(new URL("../shell/engines/apexrun.json", import.meta.url))));

for (const name of ["title-left-fork-time-over", "right-fork-time-over", "castle-ending", "ruins-oasis-ending", "cliffs-aerodrome-ending", "duel"]) {
  Deno.test(`sync test: ${name} re-simulates every frame eight back to the forward run`, async () => {
    const run = JSON.parse(await Deno.readTextFile(new URL(`runs/${name}.json`, import.meta.url)));
    const host = createKineticHost({ engine: caged, seed: run.seed, initOptions: run.initOptions, syncTest: 8, historyLimit: 64 });
    const plain = createKineticHost({ engine: apexrunEngine, seed: run.seed, initOptions: run.initOptions, historyLimit: 64 });
    const stages = [host.getState().stageId];
    for (const [count, input] of run.inputs) {
      for (let i = 0; i < count; i++) {
        const state = host.stepTick(input);
        plain.stepTick(input);
        if (stages.at(-1) !== state.stageId) stages.push(state.stageId);
      }
    }
    const end = host.getState();
    assertEquals({ stages, end: end.stageState, ticks: end.tick, ...(end.duel ? { duel: end.duel } : {}) }, run.covers);
    assertEquals(caged.saveState(end), apexrunEngine.saveState(plain.getState()));
  });
}

// The duel under GGRS's own sync test (pronto's kinetic-machine record): the
// session the two peers race in rolls every frame back seven and re-simulates
// it, its inputs through the byte each seat sends, and the run still ends
// where it was recorded.
Deno.test("GGRS's sync test: the recorded duel through the rollback session ends where it was recorded", async () => {
  const run = JSON.parse(await Deno.readTextFile(new URL("runs/duel.json", import.meta.url)));
  const host = await createRollbackHost({
    engine: caged, module: ggrsWasm, session: "synctest", checkDistance: 7, seed: run.seed, initOptions: run.initOptions,
    encode: caged.encodeInput, decode: caged.decodeInputs,
  });
  for (const [count, input] of run.inputs) for (let i = 0; i < count; i++) host.step(input);
  const end = host.getState();
  assertEquals({ stages: [end.stageId], end: end.stageState, ticks: end.tick, duel: end.duel }, run.covers);
  host.dispose();
});
