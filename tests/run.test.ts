// The run machine (shell/handlers/run.js) in the terminal's cage, over a
// store of its own tables: its phases from the title to the saved score, the
// race's milestones as the rows it shows, and, through the arena's kinetic
// child as the terminal wires it (omnishell's kinetic-mount.js, the bindings
// shell.json carries), the initials a key and a gamepad both edit while
// nothing reaches the car.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { kineticChild } from "/omnishell/interpreter/kinetic-mount.js";
import { createKineticInput } from "/omnishell/interpreter/kinetic.js";
import { ARCH_LEAD, OUTRUN_STAGES } from "../shell/engine/simulation.js";
import { canonical, checksum } from "/omnishell/interpreter/kinetic.js";

(0, eval)(await Deno.readTextFile(new URL(import.meta.resolve("/omnishell/interpreter/vendor/ses.umd.min.js"))));
const { evaluateEngine, evaluateHandler } = await import("/omnishell/interpreter/jessie.js");
const read = (path: string) => Deno.readTextFile(new URL(path, import.meta.url));
const run = await evaluateHandler(await read("../shell/handlers/run.js"));
const engine = await evaluateEngine(JSON.parse(await read("../shell/engines/apexrun.json")));
const shell = JSON.parse(await read("../shell/shell.json"));
const program = await read("../program.cue");
// The run slot's empty row, as the screen's markup states it.
const empty = JSON.parse(/data-empty-row='([^']*)'/.exec(await read("../shell/screens/arena.html"))![1]);

type Row = Record<string, unknown>;
// deno-lint-ignore no-explicit-any
type Update = { op: string; entity: string; id: string; row?: any };

/** The arena as the terminal runs it: the run slot's empty row, the tables
 * the fold reads, and the seat that applies what the reduce returns — its
 * writes, then the step it asks for, with the draws and beats it asks for. */
function arena(board: Row[] = []) {
  const tables: Record<string, Row[]> = { run: [], run_input: [], run_milestone: [], run_signal: [], apexrun_duel_seat: [], board };
  const saved: Row[] = [];
  let draws = 0;
  const apply = (updates: Update[] = []) => {
    for (const u of updates) {
      const rows = tables[u.entity];
      const at = rows.findIndex((r) => r.id === u.id);
      if (u.op === "delete") rows.splice(at, 1);
      else if (u.op === "put") at < 0 ? rows.push(u.row) : (rows[at] = u.row);
      else rows[at] = { ...rows[at], ...u.row };
    }
  };
  // deno-lint-ignore no-explicit-any
  const step = (event: any, items: Row[] = [tables.run[0] ?? empty]) => {
    for (let depth = 0; event !== undefined; depth++) {
      assert(depth < 8, "the chain settles in eight steps");
      const result = run({ items, rows: structuredClone(tables) }, event);
      apply(result.updates);
      saved.push(...(result.effects ?? []).map((e: { values: Row }) => e.values));
      // A beat is the test's to give: it steps `settled` itself.
      event = result.then && !result.then.delay && { type: result.then.type, ...(result.then.seed ? { seed: 0x2468ace + draws++ } : {}), ...(result.then.with ? { with: result.then.with } : {}) };
    }
  };
  /** The seat, woken until nothing it reads is left to apply. */
  const settle = () => {
    for (let wakes = 0; tables.run_input.length > 0 || wakes === 0; wakes++) {
      assert(wakes < 64, "the fold settles");
      step({ type: "mutation" });
    }
  };
  // deno-lint-ignore no-explicit-any
  const raise = (event: any) => {
    step(event);
    settle();
  };
  const press = (...actions: string[]) => actions.forEach((action, i) => raise({ type: "menu", detail: { action, n: String(i + 1 + draws * 100) } }));
  return { tables, saved, step, settle, raise, press, get row() {
    return tables.run[0];
  } };
}

/** A milestone as the kinetic child raises it. */
const lifted = (race: number, frame: number, kind: string, detail: Row) => ({
  type: "milestone",
  detail: { race: String(race), frame, kind, detail, checksum: 1, from: 0, width: 2, inputs: "" },
});
const castle = { stageId: "destination-castle", stageNum: 5, stageName: "Castle", fork: null, score: 100, duel: false };
const finish = (score: number) => ({
  ...castle,
  score,
  holdMs: 2500,
  entry: { outcome: "C", stage: 5, run_ms: 200_000, score },
  finalStage: 5,
  metres: 12_345,
  closePasses: 3,
  perClosePass: 50,
  rivalsBeaten: 2,
  perRival: 1000,
  lines: { distance: 123_450, closePasses: 150, rivals: 2000, timeBonus: 41_000 },
});

Deno.test("run: the title starts a race on a drawn seed, which the car then drives", () => {
  const a = arena();
  a.settle();
  assertEquals(a.row.phase, "title");
  a.press("confirm");
  assertEquals(a.row.phase, "race");
  assertEquals(a.row.input, "car");
  assertEquals(a.row.clock, "play");
  assert(a.row.seed !== 0 && a.row.seed === a.row.race, "a new seed is a new race");
});

Deno.test("run: the stage the page shows changes at the checkpoint milestone", () => {
  const a = arena();
  a.settle();
  a.press("confirm");
  const race = a.row.race as number;
  const beach = { stageId: "coconut-beach", stageNum: 1, stageName: "Coconut Beach", fork: ["DESERT CANYONS", "GATEWAY PASS"], score: 0, duel: false };
  a.raise(lifted(race, 1, "grid", beach));
  assertEquals([a.row.stage_name, a.row.fork_left, a.row.fork_right, a.row.route], ["COCONUT BEACH", "DESERT CANYONS", "GATEWAY PASS", "coconut-beach"]);
  a.raise(lifted(race, 300, "start", beach));
  assertEquals(a.row.racing, "yes");
  a.raise(lifted(race, 4000, "checkpoint", { ...beach, next: { stageId: "gateway-pass", stageNum: 2, stageName: "Gateway Pass", fork: ["A", "B"] }, rival: "ahead" }));
  assertEquals([a.row.stage_num, a.row.stage_name, a.row.rival_label, a.row.route], [2, "GATEWAY PASS", "RIVAL · STAGE 2", "coconut-beach gateway-pass"]);
  a.raise(lifted(race + 1, 4100, "checkpoint", { ...beach, next: { stageId: "desert-canyons", stageNum: 2, stageName: "Desert Canyons", fork: null }, rival: "ahead" }));
  assertEquals(a.row.stage_name, "GATEWAY PASS", "another race's milestone is not this run's");
});

Deno.test("run: a finish ranks into initials, which a key edits and Enter saves; a denied word stays open", () => {
  const a = arena();
  a.settle();
  a.press("confirm");
  a.raise(lifted(a.row.race as number, 4159, "finish", finish(170_000)));
  assertEquals([a.row.phase, a.row.clock, a.row.input], ["arrival", "play", "menu"], "the goal drives on into its destination");
  a.press("confirm");
  assertEquals(a.row.phase, "arrival", "the set piece plays out");
  a.step({ type: "settled" });
  assertEquals([a.row.phase, a.row.replay], ["initials", ""], "a run that passed no landmark has no road trip");
  assertEquals([a.row.res_title, a.row.total, a.row.line4_label], ["GOAL!", "170,000", "Time left · 41.0 s × 1,000"]);
  a.press("up", "right", "down", "right", "letter_k");
  assertEquals([a.row.initial_0, a.row.initial_1, a.row.initial_2, a.row.cursor], ["B", "Z", "K", 2]);
  a.press("back", "letter_k", "back", "back", "letter_k", "confirm");
  assertEquals(a.row.denied, "yes", "KKK is refused before the table refuses it");
  assertEquals(a.saved, []);
  a.press("letter_a", "confirm");
  assertEquals(a.row.phase, "saved");
  assertEquals(a.saved, [{ initials: "KAK", score: 170_000, outcome: "C", stage: 5, run_ms: 200_000 }]);
  a.raise({ type: "refused", entity: "high_score", kind: "refused" });
  assertEquals(a.row.saved, "refused");
});

Deno.test("run: a run the board does not rank gets the board alone, and a duel its end card", () => {
  const full = Array.from({ length: 10 }, (_, i) => ({ score: 1_000_000 - i }));
  const a = arena(full);
  a.settle();
  a.press("confirm");
  a.raise(lifted(a.row.race as number, 4159, "time-over", { ...finish(900), entry: { outcome: "time_over", stage: 1, run_ms: 75_000, score: 900 } }));
  a.step({ type: "settled" });
  assertEquals([a.row.phase, a.row.res_title, a.row.res_over], ["result", "TIME OVER", "yes"]);
  assertEquals(a.row.line4_label, "", "time over pays no time");

  const d = arena();
  d.settle();
  d.press("duel");
  assertEquals(d.row.mode, "hotseat");
  d.raise(lifted(d.row.race as number, 2990, "time-over", { ...castle, duel: true }));
  assertEquals(d.row.phase, "race", "a duel's time over waits for its finish");
  d.raise(lifted(d.row.race as number, 3000, "duel-finish", { ...castle, stageName: "Coconut Beach", winner: 1, goal: [null, 2520], holdMs: 2500 }));
  d.step({ type: "settled" });
  assertEquals([d.row.phase, d.row.res_title, d.row.line1_value, d.row.line2_value], ["result", "YOU LOSE", "—", "0:42.0"]);
});

/** A racer's seat in an online duel, as apexrun_duel writes it. */
const duelSeat = (seat: string, phase: string, view: Row = {}) => ({
  id: `d1/${seat}`, instance_id: "d1", seat, phase, revision: 2,
  view: { stage: "alpine-peaks", seed: 4242, peer: "", described: false, lifted: [], winner: "", goal_a: -1, goal_b: -1, dispute: "", silent: [], deadline: 0, phase, ...view },
});

Deno.test("run: a duel the lobby opened is the race, from its seed on its stage, seen from this racer's seat", () => {
  const a = arena();
  a.settle();
  a.tables.apexrun_duel_seat.push(duelSeat("b", "signalling"));
  a.raise({ type: "mutation" });
  assertEquals([a.row.phase, a.row.mode, a.row.seed, a.row.race, a.row.seat, a.row.duel, a.row.duel_stage, a.row.input], ["race", "online", 4242, 4242, 1, "d1", "alpine-peaks", "car"]);
  // The race describes its side; the description waits as a row for the lobby to send.
  a.raise({ type: "describe", detail: { race: "4242", description: '{"type":"answer"}' } });
  assertEquals(a.tables.run_signal, [{ id: "4242", description: '{"type":"answer"}' }]);
  a.tables.apexrun_duel_seat[0] = duelSeat("b", "racing", { peer: '{"type":"offer"}' });
  a.raise({ type: "mutation" });
  assertEquals([a.row.peer, a.row.verdict], ['{"type":"offer"}', "pending"], "the peer's description reaches the race");
  a.press("pause");
  assertEquals(a.row.phase, "race", "an online race holds for no one");
  a.raise(lifted(4242, 4100, "duel-finish", { ...castle, stageName: "Alpine Peaks", winner: 1, goal: [null, 3790], holdMs: 2500 }));
  a.step({ type: "settled" });
  assertEquals([a.row.phase, a.row.res_title, a.row.line1_value], ["result", "YOU WIN!", "1:03.2"], "the second seat's finish is this racer's");
  a.tables.apexrun_duel_seat[0] = duelSeat("b", "finished", { winner: "b", goal_b: 3790 });
  a.raise({ type: "mutation" });
  assertEquals(a.row.verdict, "won", "the machine's result is the card's");
  a.raise({ type: "mutation" });
  assertEquals(a.row.mode, "online", "a duel is raced once, however often its seat wakes the fold");
  a.raise({ type: "click", from: "stk-res-lobby" });
  assertEquals([a.row.phase, a.row.mode, a.row.verdict, a.row.duel], ["title", "", "", "d1"]);
});

Deno.test("run: a duel its machine abandoned ends the race with no contest", () => {
  const a = arena();
  a.settle();
  a.tables.apexrun_duel_seat.push(duelSeat("a", "signalling"));
  a.raise({ type: "mutation" });
  a.tables.apexrun_duel_seat[0] = duelSeat("a", "abandoned", { silent: ["b"] });
  a.raise({ type: "mutation" });
  assertEquals([a.row.phase, a.row.res_title, a.row.verdict, a.row.input], ["result", "NO CONTEST", "abandoned", "menu"]);
});

Deno.test("run: pause holds the race and gives the keys to the menu; the radio cycles to off and back", () => {
  const a = arena();
  a.settle();
  a.press("confirm", "pause");
  assertEquals([a.row.phase, a.row.clock, a.row.input], ["paused", "hold", "menu"]);
  a.press("pause");
  assertEquals([a.row.phase, a.row.clock, a.row.input], ["race", "play", "car"]);
  const stations = [];
  for (let i = 0; i < 4; i++) {
    a.raise({ type: "click", from: "stk-radio-skip" });
    stations.push(a.row.station);
  }
  assertEquals(stations, [1, 2, -1, 0]);
});

Deno.test("run: the board refuses the words program.cue denies", async () => {
  const cel = /_initialsCel: "(.*)"/.exec(program)![1];
  const denied = [...cel.matchAll(/this != '([A-Z]{3})'/g)].map((m) => m[1]);
  const fold = await read("../shell/handlers/run.js");
  assertEquals(JSON.parse(/const DENIED = (\[.*\]);/.exec(fold)![1].replaceAll("'", '"')), denied);
});

// Regression: the car and the initials read one keyboard. The race once kept
// reading the keys after it ended, so a press meant for a letter steered.
Deno.test("run: after the race a gamepad axis and a key both edit the letters, and nothing reaches the car", () => {
  const a = arena();
  a.settle();
  const frames: ((t: number) => void)[] = [];
  const target = new EventTarget();
  const el = {
    dataset: { kinetic: "race" } as Record<string, string>,
    ownerDocument: { defaultView: { CustomEvent, addEventListener() {}, removeEventListener() {} } },
    dispatchEvent: (e: Event) => target.dispatchEvent(e),
  };
  for (const type of ["milestone", "menu"]) target.addEventListener(type, (e) => a.raise({ type, detail: (e as CustomEvent).detail }));
  const made: ReturnType<typeof createKineticInput>[] = [];
  // deno-lint-ignore no-explicit-any
  const child = kineticChild(el as any, {
    decl: shell.kinetic.race,
    engine,
    sound: null,
    presenter: { reading: 0, settled: () => Promise.resolve(), frame() {}, destroy() {} },
    makeInput: (opts: Parameters<typeof createKineticInput>[0]) => {
      const input = createKineticInput(opts);
      made.push(input);
      return input;
    },
    schedule: (fn: (t: number) => void) => frames.push(fn),
    cancel: () => {},
  });
  const [car] = made;
  const menu = made.at(-1);
  const props = () => Object.fromEntries(["seed", "phase", "mode", "input", "clock", "station", "muted", "volume"].map((k) => [k, String(a.row[k])]));
  // deno-lint-ignore no-explicit-any
  const key = (input: any, code: string) => {
    input.inputs._handleKeyEvent(code, true, { code });
    input.inputs._handleKeyEvent(code, false, { code });
  };
  child.update(props());
  key(menu, "Enter");
  child.update(props());
  assertEquals(a.row.phase, "race");
  // The race, moved to the castle's last straight: the same race, so what it
  // lifts is this run's.
  const stage = OUTRUN_STAGES["destination-castle"];
  child.host.reset(a.row.seed, { stageState: "racing", stageId: stage.id, playerZ: stage.segmentCount * stage.segmentLength - ARCH_LEAD, playerSpeed: 300 });
  car.inputs._handleKeyEvent("ArrowUp", true, { code: "ArrowUp" });
  while (a.row.phase === "race") child.host.stepTick();
  assertEquals(a.row.phase, "arrival");
  child.update(props());
  const ended = child.host.getCurrentTick();
  for (let i = 0; i < 30; i++) child.host.stepTick();
  for (let t = ended + 1; t <= ended + 30; t++) assertEquals(child.host.getInputLog(t).up, false, `frame ${t} after the end steered the car`);
  a.step({ type: "settled" });
  child.update(props());
  assertEquals(a.row.phase, "initials");

  key(menu, "ArrowUp");
  assertEquals(a.row.initial_0, "B", "a key edits the letter");
  const pads = [{ connected: true, buttons: [], axes: [0, 1] }];
  Object.defineProperty(navigator, "getGamepads", { value: () => pads, configurable: true });
  try {
    frames.shift()!(0);
  } finally {
    Object.defineProperty(navigator, "getGamepads", { value: () => [], configurable: true });
  }
  assertEquals(a.row.initial_0, "A", "a gamepad axis edits it back");
  child.host.stepTick();
  assertEquals(child.host.getInputLog(child.host.getCurrentTick()).up, false, "the held key still reaches no car");
  car.inputs._handleKeyEvent("ArrowUp", false, { code: "ArrowUp" });
  child.destroy();
});

/** The arena's kinetic child as the terminal wires it, raising into `a`, with
 * a frame clock the test turns: `turn()` runs every callback queued, one
 * sixtieth of a second on. */
// deno-lint-ignore no-explicit-any
function child(a: ReturnType<typeof arena>, presenter: any) {
  let queued: ((t: number) => void)[] = [];
  let now = 0;
  const target = new EventTarget();
  const el = {
    dataset: { kinetic: "race" } as Record<string, string>,
    ownerDocument: { defaultView: { CustomEvent, addEventListener() {}, removeEventListener() {} } },
    dispatchEvent: (e: Event) => target.dispatchEvent(e),
  };
  for (const type of ["milestone", "menu", "replayed"]) target.addEventListener(type, (e) => a.raise({ type, detail: (e as CustomEvent).detail }));
  // deno-lint-ignore no-explicit-any
  const mounted = kineticChild(el as any, {
    decl: shell.kinetic.race,
    engine,
    sound: null,
    presenter: { reading: 0, settled: () => Promise.resolve(), destroy() {}, ...presenter },
    schedule: (fn: (t: number) => void) => queued.push(fn),
    cancel: () => {},
  });
  const props = () => Object.fromEntries(["seed", "phase", "mode", "input", "clock", "station", "muted", "volume", "replay"].map((k) => [k, String(a.row[k])]));
  const turn = () => {
    const due = queued;
    queued = [];
    now += 1000 / 60;
    for (const fn of due) fn(now);
  };
  return { mounted, props, turn };
}

// DESIGN.md "End of a run": after the ending's set piece, the run's road
// trip, a window around each raced stage's landmark rebuilt from the rows the
// race lifted, played through the kinetic child back to the presenter and
// then the results. Each window is the forward run's own frames, checksum for
// checksum; the renderer gets each with the window it is cut from.
Deno.test("run: a goal's road trip replays a window a stage from the lifted rows, the forward run's frames, then the results", async () => {
  const recorded = JSON.parse(await read("runs/ruins-oasis-ending.json"));
  const a = arena();
  a.settle();
  // deno-lint-ignore no-explicit-any
  const drawn: { frame: number; sum: number; cut: any }[] = [];
  const { mounted, props, turn } = child(a, {
    // deno-lint-ignore no-explicit-any
    frame({ frame, state, cut }: any) {
      if (cut) drawn.push({ frame, sum: checksum(canonical(engine.saveState(state))), cut });
    },
  });
  mounted.update(props());
  a.press("confirm");
  mounted.update(props());
  // The recorded run on the race's own host, which lifts it as this race's.
  const forward = new Map<number, number>();
  mounted.host.reset(recorded.seed, recorded.initOptions);
  for (const [count, input] of recorded.inputs) {
    for (let i = 0; i < count && a.row.phase === "race"; i++) {
      const state = mounted.host.stepTick(input);
      forward.set(mounted.host.getCurrentTick(), checksum(canonical(engine.saveState(state))));
    }
  }
  assertEquals(a.row.phase, "arrival");
  mounted.update(props());
  a.step({ type: "settled" });
  assertEquals([a.row.phase, a.row.clock, a.row.input], ["replay", "hold", "menu"]);
  const plan = JSON.parse(a.row.replay as string);
  assertEquals(plan.windows.length, 2, "a window a stage raced");
  mounted.update(props());
  for (let t = 0; a.row.phase === "replay"; t++) {
    assert(t < 2000, "the road trip plays to its end");
    turn();
  }
  assertEquals(a.row.phase, "initials", "then the results");
  assertEquals(a.row.replay, "");
  // deno-lint-ignore no-explicit-any
  plan.windows.forEach((w: any, index: number) => {
    const frames = drawn.filter((d) => d.cut.index === index && d.frame > w.at.frame);
    assertEquals(frames.length > 0 && frames.at(-1)!.frame, w.at.frame + w.frames, `window ${index} plays to its end`);
    // An animation frame draws the latest of the frames it stepped.
    assert(frames.length > w.frames * 0.9, `window ${index} draws ${frames.length} of its ${w.frames} frames`);
    for (const d of frames) assertEquals(d.sum, forward.get(d.frame), `window ${index}, frame ${d.frame}: the forward run's`);
    assertEquals(frames[0].cut, { index, count: 2, from: w.at.frame, frames: w.frames });
  });
  mounted.destroy();
});

Deno.test("run: Enter skips the road trip to the results", async () => {
  const recorded = JSON.parse(await read("runs/castle-ending.json"));
  const a = arena();
  a.settle();
  let cut = 0;
  const { mounted, props, turn } = child(a, {
    // deno-lint-ignore no-explicit-any
    frame({ cut: c }: any) {
      if (c) cut++;
    },
  });
  mounted.update(props());
  a.press("confirm");
  mounted.update(props());
  mounted.host.reset(recorded.seed, recorded.initOptions);
  for (const [count, input] of recorded.inputs) for (let i = 0; i < count && a.row.phase === "race"; i++) mounted.host.stepTick(input);
  a.step({ type: "settled" });
  mounted.update(props());
  for (let t = 0; t < 30; t++) turn();
  assert(cut > 20, "the road trip is under way");
  a.press("confirm");
  assertEquals([a.row.phase, a.row.replay, a.row.clock], ["initials", "", "play"]);
  mounted.update(props());
  const drawn = cut;
  for (let t = 0; t < 30; t++) turn();
  assertEquals(cut, drawn, "and it stops");
  mounted.destroy();
});
