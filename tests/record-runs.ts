// Records the input logs tests/sync.test.ts replays: a driver that holds the
// throttle, keeps a lane and swerves round the car ahead, run from a start
// until the run ends. What each run covered is written beside its inputs, and
// the replay holds it to that, so a change to the simulation that re-routes a
// run shows as a failure to re-record rather than as lost coverage.
//
//   deno run --allow-read --allow-write tests/record-runs.ts
import { apexrunEngine } from "../shell/engine/simulation.js";

const RUNS = [
  { name: "title-left-fork-time-over", seed: 0x1337, initOptions: {}, lane: -0.3 },
  { name: "right-fork-time-over", seed: 0x1337, initOptions: { stageState: "racing", stageId: "coconut-beach" }, lane: 0.3 },
  { name: "castle-ending", seed: 0x1337, initOptions: { stageState: "racing", stageId: "destination-castle" }, lane: -0.5 },
  // From before a fourth stage's landmark to an ending, each way out of it,
  // so a run's road trip has a window a stage.
  { name: "ruins-oasis-ending", seed: 0x1337, initOptions: { stageState: "racing", stageId: "ancient-ruins", playerZ: 34200, playerSpeed: 250 }, lane: -0.3 },
  { name: "cliffs-aerodrome-ending", seed: 0x1337, initOptions: { stageState: "racing", stageId: "coastal-cliffs", playerZ: 34200, playerSpeed: 250 }, lane: 0.3 },
];

for (const run of RUNS) await record(run);

// A duel: a driver per seat, each keeping its own lane, from the countdown to
// the duel's end. Its command is one input per seat.
await record({ name: "duel", seed: 0x1337, initOptions: { duel: true, stageId: "coconut-beach" }, lanes: [-0.4, 0.45] });

// deno-lint-ignore no-explicit-any
async function record(run: any) {
  // deno-lint-ignore no-explicit-any
  let state: any = apexrunEngine.initState(run.seed, run.initOptions);
  const inputs: [number, unknown][] = [];
  const stages = [state.stageId];
  // deno-lint-ignore no-explicit-any
  const drive = (me: any, lane: number, t: number) => {
    // deno-lint-ignore no-explicit-any
    const blocked = (state.traffic ?? []).some((c: any) => {
      const dz = (c.z % state.trackLength) - me.z;
      return dz > 0 && dz < 300 && Math.abs(c.x - me.x) < 0.3;
    });
    const target = blocked ? (me.x > lane ? lane - 0.5 : lane + 0.5) : lane;
    return { up: true, enter: t < 5, left: me.x > target + 0.05, right: me.x < target - 0.05, nitro: t % 240 === 0 };
  };
  for (let t = 0; ; t++) {
    const input = run.lanes
      // deno-lint-ignore no-explicit-any
      ? run.lanes.map((lane: number, seat: number) => drive(state.karts.find((k: any) => k.seat === seat), lane, t))
      // deno-lint-ignore no-explicit-any
      : drive(state.karts.find((k: any) => k.isPlayer), run.lane, t);
    const last = inputs.at(-1);
    if (last && JSON.stringify(last[1]) === JSON.stringify(input)) last[0]++;
    else inputs.push([1, input]);
    state = apexrunEngine.advanceFrame(state, input);
    if (stages.at(-1) !== state.stageId) stages.push(state.stageId);
    if ((state.stageState === "finished" || state.stageState === "game_over") && state.endTicks > 120) break;
  }
  const file = new URL(`runs/${run.name}.json`, import.meta.url);
  await Deno.writeTextFile(file, JSON.stringify({ seed: run.seed, initOptions: run.initOptions, covers: { stages, end: state.stageState, ticks: state.tick, ...(state.duel ? { duel: state.duel } : {}) }, inputs }) + "\n");
  console.log(`${run.name}: ${stages.join(" > ")}, ${state.stageState} at tick ${state.tick}`);
}
