import { assertEquals, assert, assertThrows } from "jsr:@std/assert@1";
import { apexrunEngine } from "../shell/engine/simulation.js";
import { createKineticHost } from "/omnishell/interpreter/kinetic.js";

Deno.test("kinetic-engine: saveState and loadState satisfy algebraic isomorphism", () => {
  const state0 = apexrunEngine.initState(0x1337);
  const snapshot = apexrunEngine.saveState(state0);
  const loaded = apexrunEngine.loadState(snapshot);

  assertEquals(loaded, state0);
  assertEquals(apexrunEngine.saveState(loaded), snapshot);
});

Deno.test("kinetic-engine: state remains JSON-safe without NaN or undefined under random inputs", () => {
  let state = apexrunEngine.initState(0xCAFE, { stageState: "racing" });
  state.countdown = 0;
  const inputs = [
    { up: true, right: true },
    { up: true, left: true, drift: true },
    { up: true, nitro: true },
    { down: true },
    { up: true, gear: "low" },
  ];

  for (const input of inputs) {
    state = apexrunEngine.advanceFrame(state, input);
    const serialized = JSON.stringify(apexrunEngine.saveState(state));
    assert(!serialized.includes("NaN"), "Serialized state must not contain NaN");
    assert(!serialized.includes("undefined"), "Serialized state must not contain undefined fields");
    const reloaded = apexrunEngine.loadState(JSON.parse(serialized));
    assertEquals(reloaded.tick, state.tick);
  }
});

Deno.test("kinetic-engine: advanceFrame is referentially transparent (deterministic)", () => {
  const seed = 0x5EED;
  const stateA0 = apexrunEngine.initState(seed, { stageState: "racing" });
  const stateB0 = apexrunEngine.initState(seed, { stageState: "racing" });
  stateA0.countdown = 0;
  stateB0.countdown = 0;

  let stateA = stateA0;
  let stateB = stateB0;

  for (let i = 0; i < 30; i++) {
    const input = { up: true, left: i % 4 === 0, right: i % 4 === 2, drift: i % 3 === 0 };
    stateA = apexrunEngine.advanceFrame(stateA, input);
    stateB = apexrunEngine.advanceFrame(stateB, input);
    assertEquals(stateA, stateB);
  }
});

Deno.test("kinetic-engine: replay from input log reconstructs live head bit-for-bit", () => {
  const host1 = createKineticHost({
    engine: apexrunEngine,
    initOptions: { stageState: "racing" },
    rateHz: 60,
    seed: 0x4321,
  });

  const inputs = [
    { up: true },
    { up: true, right: true },
    { up: true, nitro: true },
    { up: true, drift: true },
    { up: true },
  ];

  for (const input of inputs) host1.stepTick(input);
  const headState = host1.getState();
  const headTick = host1.getCurrentTick();

  let replayed = apexrunEngine.initState(0x4321, { stageState: "racing" });
  for (let t = 1; t <= headTick; t++) {
    const recordedInput = host1.getInputLog(t);
    replayed = apexrunEngine.advanceFrame(replayed, recordedInput);
  }

  assertEquals(replayed, headState);
});

Deno.test("kinetic-engine: host branching on alternate timeline forks deterministically", () => {
  const host = createKineticHost({
    engine: apexrunEngine,
    initOptions: { stageState: "racing" },
    rateHz: 60,
    seed: 0x7777,
  });

  for (let i = 0; i < 10; i++) {
    host.stepTick({ up: true });
  }

  // Branch at tick 5
  host.branch(5);
  assertEquals(host.getCurrentTick(), 5);

  // Take alternate actions
  for (let i = 0; i < 5; i++) {
    host.stepTick({ up: true, left: true, drift: true });
  }

  assertEquals(host.getCurrentTick(), 10);
});

Deno.test("kinetic-engine: pause cancels loop and play resumes frame progression", () => {
  let scheduled = 0;
  let cancelled = 0;

  const host = createKineticHost({
    engine: apexrunEngine,
    rateHz: 60,
    schedule: () => ++scheduled,
    cancel: () => ++cancelled,
  });

  host.play();
  assert(host.getStats().isPlaying);
  assertEquals(scheduled, 1);

  host.pause();
  assert(!host.getStats().isPlaying);
  assertEquals(cancelled, 1);
});

Deno.test("kinetic-engine: pump clamps frame delta to 250ms (spiral-of-death guard)", () => {
  let steps = 0;
  const host = createKineticHost({
    engine: apexrunEngine,
    rateHz: 60,
    schedule: () => 1,
    cancel: () => {},
    onStep: () => steps++,
  });

  host.play();
  // 5000ms elapsed clamped to 250ms -> 250 / (1000/60) = 15 frames max
  host.pump(5000);
  assert(steps <= 16, `Expected at most 16 clamped steps, got ${steps}`);
});
