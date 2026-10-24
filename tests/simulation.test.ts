import { assertEquals, assert } from "jsr:@std/assert@1";
import { heroSegment } from "../shell/engine/stage_look.js";
import { ARRIVAL_METRES, ARRIVAL_TICKS, LANDMARK_LEAD_METRES, METRES_PER_UNIT, milestones, milestoneSnapshots } from "../shell/engine/simulation.js";
import { ARCH_LEAD, CRUISE_KMH, DEPART_TICKS, INTRO_TICKS, apexrunEngine, CHARACTERS, stageSegments, scoreBreakdown, OUTRUN_STAGES, ENDINGS, FINAL_STAGE, CLOCK_START_S, MAX_KMH, KMH_TO_UNITS_PER_TICK, SCORE_CEILING, clockBudgetS, runEntry, NITRO_SHOT, NITRO_TICKS, nitroStatus } from "../shell/engine/simulation.js";

Deno.test("apexrunEngine: kart accelerates forward when pressing up", () => {
  let state = apexrunEngine.initState(0x1111, { stageState: "racing" });
  state.countdown = 0;
  const player0 = state.karts.find((k) => k.isPlayer)!;
  assertEquals(player0.speed, 0);

  // Accelerate for 20 frames
  for (let i = 0; i < 20; i++) {
    state = apexrunEngine.advanceFrame(state, { up: true });
  }

  const player1 = state.karts.find((k) => k.isPlayer)!;
  assert(player1.speed > 10, `Expected speed > 10, got ${player1.speed}`);
  assert(player1.z > 0, `Expected distance z > 0, got ${player1.z}`);
});

// Running wide at 335 km/h dropped the car to 45 in one tick, a dead stop
// the owner felt as the nitro cutting out. The grass now brakes it hard,
// a few km/h a tick.
Deno.test("apexrunEngine: the grass slows a fast car hard, not instantly", () => {
  let state = apexrunEngine.initState(0x2222, { stageState: "racing", playerSpeed: 300 }) as any;
  state.countdown = 0;
  state.traffic = [];
  me(state).x = 1.5;
  let prev = me(state).speed;
  for (let i = 0; i < 10; i++) {
    state = apexrunEngine.advanceFrame(state, { up: true });
    assert(prev - me(state).speed < 6, `tick ${i} on the grass sheds ${prev - me(state).speed}`);
    prev = me(state).speed;
  }
  assert(prev < 270, `ten ticks on the grass brake it hard: ${prev}`);
});

Deno.test("apexrunEngine: off-road penalty clamps max speed", () => {
  let state = apexrunEngine.initState(0x2222, { stageState: "racing" });
  state.countdown = 0;
  const player = state.karts.find((k) => k.isPlayer)!;
  player.x = 1.5; // Off-road in the grass

  for (let i = 0; i < 100; i++) {
    state = apexrunEngine.advanceFrame(state, { up: true });
  }

  const playerAfter = state.karts.find((k) => k.isPlayer)!;
  assert(playerAfter.speed <= 45, `Off-road speed must be capped at 45 km/h, got ${playerAfter.speed}`);
});

Deno.test("apexrunEngine: drift accumulation triggers mini-turbo upon release", () => {
  let state = apexrunEngine.initState(0x3333, { stageState: "racing" });
  state.countdown = 0;
  const player = state.karts.find((k) => k.isPlayer)!;
  player.speed = 90;

  // Hold drift while turning for 45 frames
  for (let i = 0; i < 45; i++) {
    state = apexrunEngine.advanceFrame(state, { up: true, left: true, drift: true });
  }

  const driftingPlayer = state.karts.find((k) => k.isPlayer)!;
  assert(driftingPlayer.drift, "Kart should be drifting");
  assert(driftingPlayer.driftCharge >= 40, `Expected drift charge >= 40, got ${driftingPlayer.driftCharge}`);

  // Release drift
  state = apexrunEngine.advanceFrame(state, { up: true });
  const releasedPlayer = state.karts.find((k) => k.isPlayer)!;
  assert(!releasedPlayer.drift, "Kart should have exited drift");
  assert(releasedPlayer.turboTimer > 0, "Mini-turbo should be active");
});

Deno.test("apexrunEngine: nitro booster increases top speed and drains fuel", () => {
  let state = apexrunEngine.initState(0x4444, { stageState: "racing" });
  state.countdown = 0;
  const player = state.karts.find((k) => k.isPlayer)!;
  player.speed = 130;
  const initialFuel = player.nitroFuel;

  for (let i = 0; i < 20; i++) {
    state = apexrunEngine.advanceFrame(state, { up: true, nitro: true });
  }

  const boostedPlayer = state.karts.find((k) => k.isPlayer)!;
  assert(boostedPlayer.isNitro, "Nitro state should be active");
  assert(boostedPlayer.nitroFuel < initialFuel, "Nitro fuel must be consumed");
  assert(boostedPlayer.speed > 130, `Boosted speed should exceed 130, got ${boostedPlayer.speed}`);
});

const me = (s: any) => s.karts.find((k: any) => k.isPlayer);
const tick = (s: any, nitro: boolean) => apexrunEngine.advanceFrame(s, { up: true, nitro });

// Nitro burnt only while the key was held: a tap, the way an arcade boost is
// fired, gave a burst of a few frames and the tank read 100% again a second
// later. A press now commits a whole burst.
Deno.test("apexrunEngine: a tap fires a whole nitro burst and spends one charge", () => {
  let state = apexrunEngine.initState(0x4444, { stageState: "racing", playerSpeed: 200 }) as any;
  state.countdown = 0;
  state = tick(state, true);
  const after = me(state).nitroFuel;
  assert(Math.abs(100 - NITRO_SHOT - after) < 0.5, `a shot costs ${100 - after}`);
  for (let i = 1; i < NITRO_TICKS; i++) {
    state = tick(state, false);
    assert(me(state).isNitro, `released, tick ${i} still boosts`);
  }
  state = tick(state, false);
  assert(!me(state).isNitro, "the burst ends");
});

// The burst's 40 km/h vanished in one tick when it ended: the cap fell and
// the speed was clamped to it, and the owner felt the nitro stop dead. The
// excess now bleeds off over a second or so.
Deno.test("apexrunEngine: the end of a nitro burst eases the speed down", () => {
  let state = apexrunEngine.initState(0x4444, { stageState: "racing", playerSpeed: 290 }) as any;
  state.countdown = 0;
  state.traffic = [];
  for (const k of state.karts) if (!k.isPlayer) k.z = -1e6;
  state = tick(state, true);
  while (me(state).isNitro) state = tick(state, false);
  const top = me(state).speed;
  let prev = top;
  let worst = 0;
  let settled = -1;
  for (let i = 0; i < 180; i++) {
    state = tick(state, false);
    worst = Math.max(worst, prev - me(state).speed);
    prev = me(state).speed;
    if (settled < 0 && prev <= 300) settled = i;
  }
  assert(top > 320, `the burst reached ${top}`);
  assert(worst < 1, `no tick sheds more than 1 km/h: ${worst}`);
  assert(settled > 40 && settled < 150, `back to the car's top speed after ${settled} ticks`);
});

Deno.test("apexrunEngine: holding nitro fires once", () => {
  let state = apexrunEngine.initState(0x4444, { stageState: "racing", playerSpeed: 200 }) as any;
  state.countdown = 0;
  for (let i = 0; i < NITRO_TICKS * 2; i++) state = tick(state, true);
  assert(!me(state).isNitro, "a held key does not refire");
  assertEquals(nitroStatus(me(state)).charges, 2, "one shot spent, refilling since");
});

Deno.test("apexrunEngine: the tank holds three charges, then refills", () => {
  let state = apexrunEngine.initState(0x4444, { stageState: "racing", playerSpeed: 200 }) as any;
  state.countdown = 0;
  for (let shot = 0; shot < 3; shot++) {
    state = tick(state, true);
    for (let i = 0; i < NITRO_TICKS; i++) state = tick(state, false);
  }
  assertEquals(nitroStatus(me(state)).state, "charging");
  state = tick(state, true);
  assert(!me(state).isNitro, "an empty tank fires nothing");
  while (nitroStatus(me(state)).state === "charging") state = tick(state, false);
  state = tick(state, true);
  assert(me(state).isNitro, "a refilled charge fires");
});

// A spin or the end of the race skipped the nitro step, so a car crashed or
// parked while boosting kept isNitro: the gauge read BOOST and the camera,
// blur and flame stayed on nitro through the spin and the results.
Deno.test("apexrunEngine: a spin or a parked car is not boosting", () => {
  let state = apexrunEngine.initState(0x4444, { stageState: "racing", playerSpeed: 200 }) as any;
  state.countdown = 0;
  state = tick(state, true);
  assert(me(state).isNitro);
  me(state).spinTimer = 10;
  state = tick(state, false);
  assert(!me(state).isNitro, "a spin ends the burst");
  me(state).spinTimer = 0;
  state = tick(state, true);
  assert(me(state).isNitro);
  state.stageState = "finished";
  state = tick(state, false);
  assert(!me(state).isNitro, "the race's end ends the burst");
});

Deno.test("apexrunEngine: three bursts empty the tank to zero, not below", () => {
  let state = apexrunEngine.initState(0x4444, { stageState: "racing", playerSpeed: 200 }) as any;
  state.countdown = 0;
  for (let shot = 0; shot < 3; shot++) {
    state = tick(state, true);
    for (let i = 1; i < NITRO_TICKS; i++) state = tick(state, false);
  }
  assert(me(state).nitroFuel >= 0, `fuel ${me(state).nitroFuel}`);
});

// A burst fired before the arch burnt on under the autopilot, and a key held
// through the hand-over fired the moment the wheel came back.
Deno.test("apexrunEngine: the autopilot ends a burst, and a held key does not fire after it", () => {
  const start = apexrunEngine.initState(0x7777, { stageState: "racing" }) as any;
  start.countdown = 0;
  const player = start.karts.find((k: any) => k.isPlayer);
  player.x = -0.4;
  player.z = start.trackLength - ARCH_LEAD - 30;
  player.speed = 200;
  let state = tick(start, true);
  assert(me(state).isNitro, "fired before the arch");
  while (state.stageState !== "checkpoint") state = tick(state, true);
  state = tick(state, true);
  assert(!me(state).isNitro, "the autopilot cruises");
  while (state.stageState !== "racing") state = tick(state, true);
  state = tick(state, true);
  assert(!me(state).isNitro, "the held key must come up first");
});

Deno.test("apexrunEngine: the nitro status counts charges", () => {
  assertEquals(nitroStatus({ nitroFuel: 100, nitroTimer: 0 }), { state: "ready", fill: 1, charges: 3 });
  assertEquals(nitroStatus({ nitroFuel: 40, nitroTimer: 0 }), { state: "ready", fill: 0.4, charges: 1 });
  assertEquals(nitroStatus({ nitroFuel: 20, nitroTimer: 0 }), { state: "charging", fill: 0.2, charges: 0 });
  assertEquals(nitroStatus({ nitroFuel: 40, nitroTimer: 5 }), { state: "boost", fill: 0.4, charges: 1 });
});

/** Drive the player from just before the arch until the next stage is underway. */
function throughCheckpoint(state: any, x: number, inputs: (t: number) => any = () => ({ up: true })) {
  const player = state.karts.find((k: any) => k.isPlayer);
  player.x = x;
  player.z = state.trackLength - ARCH_LEAD - 1;
  player.speed = 200;
  const seen: string[] = [];
  for (let t = 0; t < 600 && !(state.stageNum === 2 && state.stageState === "racing"); t++) {
    state = apexrunEngine.advanceFrame(state, inputs(t));
    if (seen.at(-1) !== state.stageState) seen.push(state.stageState);
  }
  return { state, seen };
}

Deno.test("apexrunEngine: completing a stage increases currentLap counter", () => {
  const start = apexrunEngine.initState(0x6666, { stageState: "racing" });
  start.countdown = 0;
  const { state } = throughCheckpoint(start, -0.4);
  assertEquals(state.karts.find((k: any) => k.isPlayer).currentLap, 2);
});

Deno.test("apexrunEngine: highway fork routes left or right based on kart.x with time extension", () => {
  const left = apexrunEngine.initState(0x7777, { stageState: "racing" });
  left.countdown = 0;
  const initialTime = left.timeRemaining;
  const { state: l } = throughCheckpoint(left, -0.4);
  assertEquals(l.stageId, "desert-canyons");
  assertEquals(l.stageNum, 2);
  assert(l.timeRemaining > initialTime, "Time remaining must increase from checkpoint bonus");

  const right = apexrunEngine.initState(0x8888, { stageState: "racing" });
  right.countdown = 0;
  const { state: r } = throughCheckpoint(right, 0.4);
  assertEquals(r.stageId, "gateway-pass");
  assertEquals(r.stageNum, 2);
});

// The stage used to switch the instant the car crossed the road's end: the
// world was rebuilt under a car still at full throttle. The owner asked for
// the car to drive itself for a while instead, as in Mario Kart.
Deno.test("apexrunEngine: the checkpoint arch hands the car to the autopilot and freezes the clock", () => {
  let state = apexrunEngine.initState(0x7777, { stageState: "racing" }) as any;
  state.countdown = 0;
  const player = state.karts.find((k: any) => k.isPlayer);
  player.x = -0.4;
  player.z = state.trackLength - ARCH_LEAD + 5;
  player.speed = 250;
  const before = state.timeRemaining;
  state = apexrunEngine.advanceFrame(state, { up: true });
  assertEquals(state.stageState, "checkpoint");
  assert(state.events.some((e: any) => e.type === "checkpoint-extended"), "the arch extends the clock");
  const extended = state.timeRemaining;
  assert(extended > before + 40, "+45 s at the arch");
  for (let t = 0; t < 30; t++) state = apexrunEngine.advanceFrame(state, { left: true, down: true });
  const p = state.karts.find((k: any) => k.isPlayer);
  assertEquals(state.timeRemaining, extended, "the clock waits while the car drives itself");
  assert(Math.abs(p.speed - CRUISE_KMH) < 25, `cruising at ${p.speed}`);
  assert(p.x < 0 && p.x > -1, "it keeps the chosen branch and stays on the road");
  assertEquals(state.stageNum, 1, "the stage has not switched yet");
});

Deno.test("apexrunEngine: the stage swaps at the road's end and the car drives on until handed back", () => {
  const start = apexrunEngine.initState(0x7777, { stageState: "racing" });
  start.countdown = 0;
  const { state, seen } = throughCheckpoint(start, -0.4);
  assertEquals(seen, ["checkpoint", "racing"]);
  assertEquals(state.stageId, "desert-canyons");

  // Enter after the swap takes the wheel back on the next tick.
  let early = apexrunEngine.initState(0x7777, { stageState: "racing" }) as any;
  early.countdown = 0;
  const p = early.karts.find((k: any) => k.isPlayer);
  p.x = -0.4;
  p.z = early.trackLength - 1;
  p.speed = 200;
  early.stageState = "checkpoint";
  early.nextStageId = "desert-canyons";
  early = apexrunEngine.advanceFrame(early, {});
  assertEquals([early.stageNum, early.stageState, early.departTimer], [2, "checkpoint", DEPART_TICKS]);
  early = apexrunEngine.advanceFrame(early, { enter: true });
  assertEquals(early.stageState, "racing");
});

// The hand-over gave the wheel back with a "take the wheel" prompt and no
// signal, often straight into a car the new stage had spawned just ahead.
Deno.test("apexrunEngine: the wheel comes back on GO, on an open road", () => {
  const start = apexrunEngine.initState(0x7777, { stageState: "racing" });
  start.countdown = 0;
  const { state } = throughCheckpoint(start, -0.4, () => ({}));
  const p = state.karts.find((k: any) => k.isPlayer);
  assert(state.goTimer > 0, "GO shows as the wheel comes back");
  const ahead = state.traffic.map((t: any) => t.z - p.z).filter((d: number) => d > -50);
  assert(ahead.every((d: number) => d > 1500), `traffic ${Math.min(...ahead).toFixed(0)} units ahead`);
});

// Nothing said the stage was cleared or what came next.
Deno.test("apexrunEngine: the arch names the next stage and the swap keeps what was cleared", () => {
  let state = apexrunEngine.initState(0x7777, { stageState: "racing" }) as any;
  state.countdown = 0;
  const p = state.karts.find((k: any) => k.isPlayer);
  p.x = -0.4;
  p.z = state.trackLength - ARCH_LEAD - 1;
  p.speed = 200;
  while (state.stageState !== "checkpoint") state = apexrunEngine.advanceFrame(state, { up: true });
  assertEquals(state.nextStageId, "desert-canyons");
  while (state.stageNum === 1) state = apexrunEngine.advanceFrame(state, {});
  assertEquals(state.stageClear.stageNum, 1);
  assert(["beaten", "ahead"].includes(state.stageClear.rival), `rival ${state.stageClear.rival}`);
});

// The results card covered the scene the instant the car crossed the line,
// so the goal had no moment of its own.
Deno.test("apexrunEngine: an ended run counts the moment it holds before the results", () => {
  let state = apexrunEngine.initState(0x7777, { stageState: "racing" }) as any;
  assertEquals(state.endTicks, 0);
  state.stageState = "finished";
  for (let i = 0; i < 10; i++) state = apexrunEngine.advanceFrame(state, {});
  assertEquals(state.endTicks, 10);
});

Deno.test("apexrunEngine: the start runs the camera swoop, then 3-2-1", () => {
  let state = apexrunEngine.initState(0x1111, { stageState: "title" }) as any;
  state = apexrunEngine.advanceFrame(state, { enter: true });
  assertEquals(state.stageState, "warmup");
  assertEquals(state.countdown, INTRO_TICKS + 180);
  for (let t = 0; t < INTRO_TICKS + 180; t++) state = apexrunEngine.advanceFrame(state, {});
  assertEquals(state.stageState, "racing");
  assert(state.goTimer > 0, "the flag is still sweeping down");
});

Deno.test("apexrunEngine: timer depletion transitions race into game_over", () => {
  let state = apexrunEngine.initState(0x9999, { stageState: "racing" });
  state.countdown = 0;
  state.timeRemaining = 0.01;

  state = apexrunEngine.advanceFrame(state, { up: true });
  assertEquals(state.stageState, "game_over");
  assert(state.events.some((e: any) => e.type === "time-out"), "Must emit time-out event");
});

Deno.test("apexrunEngine: civilian traffic collision triggers spinout and near-miss increments score", () => {
  let state = apexrunEngine.initState(0xAAAA, { stageState: "racing" });
  state.countdown = 0;
  const targetTraffic = state.traffic[0];
  const player = state.karts.find((k) => k.isPlayer)!;
  player.speed = 250;
  player.x = targetTraffic.x;
  player.z = targetTraffic.z - 50;

  // Advance frame into collision (player at 250 sweeps past traffic at ~120)
  state = apexrunEngine.advanceFrame(state, { up: true });
  const hitPlayer = state.karts.find((k) => k.isPlayer)!;
  assert(hitPlayer.spinTimer > 0, "Colliding with traffic must trigger spinout timer");
  assert(state.events.some((e: any) => e.type === "traffic-collision"), "Must emit traffic-collision event");

  // Near-miss pass test
  let statePass = apexrunEngine.initState(0xBBBB, { stageState: "racing" });
  statePass.countdown = 0;
  const passTarget = statePass.traffic[0];
  const passPlayer = statePass.karts.find((k) => k.isPlayer)!;
  passPlayer.speed = 250;
  passPlayer.x = passTarget.x + 0.35; // Close lane passing
  passPlayer.z = passTarget.z + 10;
  const prevScore = statePass.score;

  statePass = apexrunEngine.advanceFrame(statePass, { up: true });
  assert(statePass.closePassCount > 0, "Close pass count must increment");
  assert(statePass.score > prevScore, "Score must increase from near-miss drafting bonus");
});

Deno.test("apexrunEngine: 2-speed transmission governs top speed between low and high gear", () => {
  let state = apexrunEngine.initState(0xCCCC, { stageState: "racing" });
  state.countdown = 0;
  state.traffic = []; // Dyno test without civilian traffic obstacles
  const player = state.karts.find((k) => k.isPlayer)!;
  player.speed = 180;

  // In low gear, speed must not exceed 185
  for (let i = 0; i < 40; i++) {
    state.karts[0].x = 0; // Maintain center lane on straightaway
    state = apexrunEngine.advanceFrame(state, { up: true, gear: "low" });
  }
  const lowPlayer = state.karts.find((k) => k.isPlayer)!;
  assert(lowPlayer.speed <= 185, `Low gear speed must be <= 185, got ${lowPlayer.speed}`);

  // In high gear, speed continues accelerating towards 295
  for (let i = 0; i < 100; i++) {
    state.karts[0].x = 0; // Maintain center lane on straightaway
    state = apexrunEngine.advanceFrame(state, { up: true, gear: "high" });
  }
  const highPlayer = state.karts.find((k) => k.isPlayer)!;
  assert(highPlayer.speed > 220, `High gear speed should exceed 220, got ${highPlayer.speed}`);
});

Deno.test("apexrunEngine: civilian traffic spawns diverse archetypes with distinct base speeds and dimensions", () => {
  const state = apexrunEngine.initState(0x4242, { stageState: "racing" });
  assert(state.traffic && state.traffic.length > 0, "Must spawn traffic");

  const typesFound = new Set(state.traffic.map((t: any) => t.type));
  assert(typesFound.has("truck"), "Must spawn trucks");
  assert(typesFound.has("convertible"), "Must spawn convertibles");
  assert(typesFound.has("sedan"), "Must spawn sedans");
  assert(typesFound.has("pickup"), "Must spawn pickups");

  const trucks = state.traffic.filter((t: any) => t.type === "truck");
  const convertibles = state.traffic.filter((t: any) => t.type === "convertible");

  for (const trk of trucks) {
    assert(trk.width >= 0.35, "Truck must have wide profile");
    assert(trk.baseSpeed <= 125, "Truck speed must be slower than sports cars");
  }

  for (const conv of convertibles) {
    assert(conv.baseSpeed >= 145, "Convertible must be faster than trucks");
  }
});

Deno.test("apexrunEngine: civilian traffic lane change AI interpolates lateral position and signals blinker", () => {
  let state = apexrunEngine.initState(0x7777, { stageState: "racing" });
  state.countdown = 0;

  // Find a traffic car and trigger lane change
  const car = state.traffic[0];
  car.laneTimer = 1; // triggers lane change on next frame

  state = apexrunEngine.advanceFrame(state, { up: false });
  const updatedCar = state.traffic[0];
  assert(updatedCar.targetX !== undefined, "Car must have targetX assigned");

  // Advance several frames and observe movement toward targetX
  const initialX = updatedCar.x;
  for (let i = 0; i < 20; i++) {
    state = apexrunEngine.advanceFrame(state, { up: false });
  }
  const movedCar = state.traffic[0];
  if (movedCar.targetX !== initialX) {
    assert(movedCar.x !== initialX, "Traffic car must move laterally towards targetX");
  }
});

Deno.test("apexrunEngine: civilian traffic brakes when trailing slower car ahead", () => {
  let state = apexrunEngine.initState(0x8888, { stageState: "racing" });
  state.countdown = 0;

  // Place car B directly behind slower car A in the same lane
  const carA = state.traffic[0];
  const carB = state.traffic[1];
  carA.x = 0.22;
  carA.targetX = 0.22;
  carA.speed = 90;
  carA.baseSpeed = 90;

  carB.x = 0.22;
  carB.targetX = 0.22;
  carB.speed = 150;
  carB.baseSpeed = 150;
  carB.z = carA.z - 150; // within 250 brake distance

  state = apexrunEngine.advanceFrame(state, { up: false });
  const updatedB = state.traffic[1];
  assert(updatedB.brake === 1, "Trailing traffic car must activate brake state");
  assert(updatedB.speed < 150, "Trailing car must decelerate when following slower vehicle");
});

Deno.test("apexrunEngine: 5-stage Sega route tree forms valid 15-stage branching pyramid DAG", () => {
  const { OUTRUN_STAGES } = apexrunEngine as any;
  assert(OUTRUN_STAGES, "OUTRUN_STAGES must be exported");

  const stages = Object.values(OUTRUN_STAGES) as any[];
  assertEquals(stages.length, 15, "Sega route pyramid must have exactly 15 stages (1+2+3+4+5)");

  const byTier: Record<number, any[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const s of stages) {
    assert(s.stageNum >= 1 && s.stageNum <= 5, `Stage ${s.id} must have stageNum between 1 and 5`);
    byTier[s.stageNum].push(s);
  }

  assertEquals(byTier[1].length, 1, "Tier 1 must have 1 stage (Coconut Beach)");
  assertEquals(byTier[2].length, 2, "Tier 2 must have 2 stages");
  assertEquals(byTier[3].length, 3, "Tier 3 must have 3 stages");
  assertEquals(byTier[4].length, 4, "Tier 4 must have 4 stages");
  assertEquals(byTier[5].length, 5, "Tier 5 must have 5 destinations (A, B, C, D, E)");

  // Validate branching integrity: each branch must point to a valid stage in the next tier
  for (let tier = 1; tier <= 4; tier++) {
    for (const s of byTier[tier]) {
      assert(s.fork, `Stage ${s.id} in Tier ${tier} must define a fork`);
      const left = OUTRUN_STAGES[s.fork.leftBranch];
      const right = OUTRUN_STAGES[s.fork.rightBranch];
      assert(left, `Left branch ${s.fork.leftBranch} of ${s.id} must exist in OUTRUN_STAGES`);
      assert(right, `Right branch ${s.fork.rightBranch} of ${s.id} must exist in OUTRUN_STAGES`);
      assertEquals(left.stageNum, tier + 1, `Left branch ${left.id} must belong to tier ${tier + 1}`);
      assertEquals(right.stageNum, tier + 1, `Right branch ${right.id} must belong to tier ${tier + 1}`);
    }
  }

  // Tier 5 destinations must not fork further
  for (const dest of byTier[5]) {
    assertEquals(dest.fork, null, `Tier 5 destination ${dest.id} must terminate without a fork`);
  }
});

Deno.test("apexrunEngine: fork approach triggers forkActive and emits fork-approach event", () => {
  let state = apexrunEngine.initState(0x9999, { stageState: "racing" });
  state.countdown = 0;

  const player = state.karts.find((k: any) => k.isPlayer) as any;
  player.z = 320 * 200; // at forkSegment
  assertEquals(state.forkActive, false);

  state = apexrunEngine.advanceFrame(state, { up: true });
  assertEquals(state.forkActive, true, "state.forkActive must activate when approaching fork");

  const forkEvent = state.events.find((e: any) => e.type === "fork-approach") as any;
  assert(forkEvent, "Must emit fork-approach event");
  assertEquals(forkEvent.leftLabel, "DESERT CANYONS");
  assertEquals(forkEvent.rightLabel, "GATEWAY PASS");
});

Deno.test("apexrunEngine: player steering left at fork selects leftBranch with +45s extension and resets z", () => {
  let state = apexrunEngine.initState(0xAAAA, { stageState: "racing" });
  state.countdown = 0;
  const initialTime = state.timeRemaining;

  const player = state.karts.find((k: any) => k.isPlayer) as any;
  player.speed = 100;
  player.x = -0.5; // Steer left into Desert Canyons
  player.z = state.trackLength - 2; // Right before fork boundary

  state = apexrunEngine.advanceFrame(state, { up: true });

  const updatedPlayer = state.karts.find((k: any) => k.isPlayer) as any;
  assertEquals(state.stageId, "desert-canyons", "Must transition to left branch (desert-canyons)");
  assertEquals(state.stageNum, 2, "Must advance to Stage 2");
  assertEquals(state.routeHistory, ["coconut-beach", "desert-canyons"]);
  assert(state.timeRemaining >= initialTime + 40, "Must add +45s checkpoint extension");
  assert(state.nextStageId, "the arch names the stage ahead");
  assert(updatedPlayer.z < 200, "Player z must wrap into new stage");
});

Deno.test("apexrunEngine: player steering right at fork selects rightBranch", () => {
  let state = apexrunEngine.initState(0xBBBB, { stageState: "racing" });
  state.countdown = 0;

  const player = state.karts.find((k: any) => k.isPlayer) as any;
  player.speed = 100;
  player.x = 0.5; // Steer right into Gateway Pass
  player.z = state.trackLength - 2;

  state = apexrunEngine.advanceFrame(state, { up: true });

  assertEquals(state.stageId, "gateway-pass", "Must transition to right branch (gateway-pass)");
  assertEquals(state.stageNum, 2, "Must advance to Stage 2");
  assertEquals(state.routeHistory, ["coconut-beach", "gateway-pass"]);
});

Deno.test("apexrunEngine: completing stage 5 destination triggers race-finish and finished state", () => {
  let state = apexrunEngine.initState(0xCCCC, {
    stageState: "racing",
    stageId: "destination-marina",
  });
  state.countdown = 0;
  state.stageNum = 5;

  const player = state.karts.find((k: any) => k.isPlayer) as any;
  player.speed = 100;
  player.z = state.trackLength - 2;

  state = apexrunEngine.advanceFrame(state, { up: true });

  assertEquals(state.stageState, "finished", "Completing stage 5 destination must finish the game");
  assertEquals(state.winnerId, player.id, "Player must be declared winner");
  const finishEv = state.events.find((e: any) => e.type === "race-finish");
  assert(finishEv, "Must emit race-finish event");
});



// DESIGN.md "End of a run": the finish parked the car at the road's very
// end, facing the void. Past the final arch it now drives itself on into
// its ending's destination, as the checkpoint's autopilot does, slows and
// pulls up before the place, and its riders wave, all while the score holds.
Deno.test("apexrunEngine: past the final arch the car drives itself into its destination and pulls up in the set piece", () => {
  for (const stageId of Object.keys(ENDINGS)) {
    for (const speed of [300, 140, 60]) {
      let state = apexrunEngine.initState(0xCCCC, { stageState: "racing", stageId, playerZ: (OUTRUN_STAGES as any)[stageId].segmentCount * 200 - 10, playerSpeed: speed, playerX: 0.9 }) as any;
      while (state.stageState !== "finished") state = apexrunEngine.advanceFrame(state, { up: true });
      const { score, timeBonus } = state;
      let last = state.karts.find((k: any) => k.isPlayer).z;
      let waved = false;
      while (state.endTicks < ARRIVAL_TICKS) {
        state = apexrunEngine.advanceFrame(state, { up: true, left: true, nitro: state.tick % 2 === 0 });
        const p = state.karts.find((k: any) => k.isPlayer);
        assert(p.z >= last, `${stageId} at ${speed}: the car never backs up`);
        last = p.z;
        if (state.events.some((e: any) => e.type === "arrived")) waved = p.waveTimer > 0;
      }
      const p = state.karts.find((k: any) => k.isPlayer);
      assertEquals(p.z, state.trackLength + ARRIVAL_METRES / METRES_PER_UNIT, `${stageId} at ${speed}: pulled up ARRIVAL_METRES past the arch`);
      assertEquals(p.speed, 0);
      assert(Math.abs(p.x) <= 0.65 + 1e-9, `${stageId} at ${speed}: in a lane, ${p.x}`);
      assert(state.parkedAt !== null && state.parkedAt <= ARRIVAL_TICKS - 60, `${stageId} at ${speed}: parked with a second to wave, at ${state.parkedAt}`);
      assert(waved, `${stageId} at ${speed}: the boy waves as it stops`);
      assertEquals([state.score, state.timeBonus], [score, timeBonus], "the score holds from the arch");
    }
  }
});

// The replay of a run's road trip opens a window short of each stage's hero
// landmark: the milestone it is lifted from, once a stage, never in a duel.
Deno.test("apexrunEngine: a stage's landmark opens its replay window once, in a solo run only", () => {
  for (const options of [{ stageState: "racing", stageId: "coconut-beach" }, { duel: true, stageId: "coconut-beach" }]) {
    let state = apexrunEngine.initState(0x4242, options) as any;
    state.countdown = 0;
    state.stageState = "racing";
    state.traffic = [];
    for (const k of state.karts.filter((k: any) => k.isPlayer)) {
      k.z = 0.5 * state.trackLength;
      k.speed = 200;
    }
    const seen: number[] = [];
    for (let i = 0; i < 2400; i++) {
      state = apexrunEngine.advanceFrame(state, options.duel ? [{ up: true }, { up: true }] : { up: true });
      if (milestones(state).some((m: any) => m.kind === "landmark")) seen.push(state.karts.find((k: any) => k.isPlayer).z);
    }
    if (options.duel) {
      assertEquals(seen, [], "a duel has no road trip");
      continue;
    }
    assertEquals(seen.length, 1, "once a stage");
    const hero = heroSegment("coconut-beach", state.segmentCount) * state.segmentLength;
    const ahead = (hero - seen[0]) * METRES_PER_UNIT;
    assert(ahead > LANDMARK_LEAD_METRES - 5 && ahead <= LANDMARK_LEAD_METRES, `${ahead} m short of the landmark`);
    assert(milestoneSnapshots.includes("landmark"), "its row carries the frame's state");
  }
});

// Rivals never take forks, so they lap the player's stage; a lap count used
// to crown one of them after ~20s of play with the clock still running.
Deno.test("apexrunEngine: rivals lapping the stage never end the race", () => {
  let state = apexrunEngine.initState(0xDDDD, { stageState: "racing" });
  state.countdown = 0;
  const rival = state.karts.find((k: any) => !k.isPlayer) as any;
  rival.currentLap = FINAL_STAGE;
  rival.speed = 200;
  rival.z = state.trackLength - 2;

  state = apexrunEngine.advanceFrame(state, {});

  assertEquals(state.stageState, "racing");
  assertEquals(state.winnerId, null);
});

// Distance once advanced a full km/h value per tick, so a stage took ~8s
// against a 75s clock that grants +45s per checkpoint.
Deno.test("apexrunEngine: a stage at top speed takes about a minute of the clock", () => {
  let state = apexrunEngine.initState(0xEEEE, { stageState: "racing" });
  state.countdown = 0;
  state.traffic = [];
  const startStage = state.stageId;

  let ticks = 0;
  while (state.stageId === startStage && ticks < 120 * 60) {
    const x = (state.karts.find((k: any) => k.isPlayer) as any).x;
    state = apexrunEngine.advanceFrame(state, { up: true, gear: "high", left: x > 0.05, right: x < -0.05 });
    ticks++;
  }

  const seconds = ticks / 60;
  assert(seconds >= 45 && seconds <= 70, `stage took ${seconds.toFixed(1)}s`);
});

// A fixed collision width let the player clip through a truck's flank and be
// paid a close-pass bonus for it.
Deno.test("apexrunEngine: a truck collides across its full width", () => {
  let state = apexrunEngine.initState(0x4242, { stageState: "racing" });
  const truck = state.traffic.find((t: any) => t.type === "truck") as any;
  const player = state.karts.find((k: any) => k.isPlayer) as any;
  player.speed = 250;
  player.x = truck.x + (truck.width + 0.25) / 2;
  player.z = truck.z - 50;

  state = apexrunEngine.advanceFrame(state, { up: true });

  assert(state.events.some((e: any) => e.type === "traffic-collision"), "Must collide with the truck's flank");
  assertEquals(state.closePassCount, 0);
});

// Past the fork the renderer draws each sign of x on its own branch, so a car
// on the other branch is far away, not alongside.
Deno.test("apexrunEngine: past the fork, traffic on the other branch never collides", () => {
  let state = apexrunEngine.initState(0x4242, { stageState: "racing" });
  const fork = (apexrunEngine as any).OUTRUN_STAGES[state.stageId].fork;
  const car = state.traffic[0] as any;
  car.x = car.targetX = -0.1;
  car.z = (fork.forkSegment + 10) * state.segmentLength;
  const player = state.karts.find((k: any) => k.isPlayer) as any;
  player.speed = 250;
  player.x = 0.1;
  player.z = car.z - 50;

  state = apexrunEngine.advanceFrame(state, { up: true });

  assert(!state.events.some((e: any) => e.type === "traffic-collision"), "Must not collide across the divider");
});

Deno.test("apexrunEngine: the title screen holds until Enter, then the grid counts down", () => {
  let state = apexrunEngine.initState(0xA1A1, { stageState: "title" });
  for (let i = 0; i < 300; i++) state = apexrunEngine.advanceFrame(state, { up: true });
  assertEquals(state.stageState, "title");
  assertEquals(state.timeRemaining, 75);

  state = apexrunEngine.advanceFrame(state, { enter: true });
  assertEquals(state.stageState, "warmup");
  assert(state.countdown > 0, "the grid countdown must run after Enter");
});

// The banner was a wall-clock setTimeout in the screen, so scrubbing the
// timeline re-fired it out of step with the sim it reports on.
Deno.test("apexrunEngine: a close pass raises a banner timer that lives in sim state", () => {
  let state = apexrunEngine.initState(0xA3A3, { stageState: "racing" });
  const player = state.karts.find((k: any) => k.isPlayer) as any;
  player.speed = 220;
  player.x = 0;
  state.traffic = [{ ...state.traffic[0], x: 0.4, z: player.z + 5, speed: 0, baseSpeed: 0, width: 0.25, laneTimer: 9999, passed: false }];

  state = apexrunEngine.advanceFrame(state, { up: true });
  assert(state.closePassBannerTimer > 0, "a close pass must start the banner timer");
  assertEquals(state.closePassBonus, 50);
  const t = state.closePassBannerTimer;
  state = apexrunEngine.advanceFrame(state, { up: true });
  assertEquals(state.closePassBannerTimer, t - 1);
});

Deno.test("apexrunEngine: each stage names a rival that starts ahead at a catchable pace", () => {
  let state = apexrunEngine.initState(0xB1B1, { stageState: "racing" });
  const player = state.karts.find((k: any) => k.isPlayer) as any;
  const rival = state.karts.find((k: any) => k.id === state.rival.kartId) as any;
  assert(rival && !rival.isPlayer, "the rival is one of the AI cars");
  assert(rival.z > player.z, "the rival starts ahead");
  for (let i = 0; i < 600; i++) state = apexrunEngine.advanceFrame(state, {});
  const after = state.karts.find((k: any) => k.id === state.rival.kartId) as any;
  assert(after.speed <= 255, `the rival paces at a catchable speed, got ${after.speed}`);
});

Deno.test("apexrunEngine: passing the rival pays 1,000 once and counts it", () => {
  let state = apexrunEngine.initState(0xB2B2, { stageState: "racing" });
  state.traffic = [];
  const player = state.karts.find((k: any) => k.isPlayer) as any;
  const rival = state.karts.find((k: any) => k.id === state.rival.kartId) as any;
  player.z = rival.z - 1;
  player.speed = 290;
  rival.speed = 100;
  const before = state.score;
  state = apexrunEngine.advanceFrame(state, { up: true });
  assert(state.rival.beaten, "overtaking beats the rival");
  assertEquals(state.rivalsBeaten, 1);
  assert(state.events.some((e: any) => e.type === "rival-beaten"));
  assert(state.rivalBannerTimer > 0, "the RIVAL BEATEN banner is driven by sim state");
  assert(state.score - before >= 1000);
  const score = state.score;
  for (let i = 0; i < 30; i++) state = apexrunEngine.advanceFrame(state, { up: true });
  assertEquals(state.rivalsBeaten, 1, "the bonus is paid once per stage");
  assert(state.score - score < 1000);
});

Deno.test("apexrunEngine: a rival that reaches the checkpoint first escapes and pays nothing", () => {
  let state = apexrunEngine.initState(0xB3B3, { stageState: "racing" });
  const rival = state.karts.find((k: any) => k.id === state.rival.kartId) as any;
  rival.z = state.trackLength - 1;
  rival.speed = 250;
  state = apexrunEngine.advanceFrame(state, {});
  assert(state.rival.escaped, "reaching the line first is an escape");
  const player = state.karts.find((k: any) => k.isPlayer) as any;
  player.z = state.trackLength - 2;
  player.speed = 290;
  state = apexrunEngine.advanceFrame(state, { up: true });
  assertEquals(state.rivalsBeaten, 0);
});

Deno.test("apexrunEngine: the score breaks down into distance, close passes, rivals and the time bonus", () => {
  let state = apexrunEngine.initState(0xB4B4, { stageState: "racing", stageId: "destination-marina" });
  state.traffic = [];
  const player = state.karts.find((k: any) => k.isPlayer) as any;
  player.z = state.trackLength - 2;
  player.speed = 200;
  state.closePassCount = 3;
  state.rivalsBeaten = 1;
  state.rival.beaten = true;
  state.timeRemaining = 12.4;
  state = apexrunEngine.advanceFrame(state, { up: true });
  assertEquals(state.stageState, "finished");
  const lines = scoreBreakdown(state);
  const points = Object.fromEntries(lines.map((l: any) => [l.key, l.points]));
  assertEquals(points.closePasses, 150);
  assertEquals(points.rivals, 1000);
  assertEquals(points.timeBonus, Math.round(state.timeRemaining * 1000));
  assertEquals(points.distance, Math.round(state.metresDriven * 10));
  assertEquals(state.score, lines.reduce((sum: number, l: any) => sum + l.points, 0), "the total is the sum of its lines");
});

// The high-score table (program.cue HighScore) states the engine's clock and
// ceiling as literals, since CEL has no arithmetic; these hold them equal.
const program = await Deno.readTextFile(new URL("../program.cue", import.meta.url));
const stages = Array.from({ length: FINAL_STAGE }, (_, i) => i + 1);
const letters = Object.values(ENDINGS);

/** The clock rule, as the engine keeps it. */
function obeysClock(entry: { outcome: string; stage: number; run_ms: number }) {
  if (letters.includes(entry.outcome)) return entry.stage === FINAL_STAGE && entry.run_ms < clockBudgetS(FINAL_STAGE) * 1000;
  return entry.outcome === "time_over" && entry.run_ms === clockBudgetS(entry.stage) * 1000;
}

function drive(seed: number, policy: (s: any) => Record<string, unknown>) {
  let state = apexrunEngine.initState(seed, { stageState: "racing" });
  state.countdown = 0;
  let peak = 0;
  while (state.stageState === "racing") {
    state = apexrunEngine.advanceFrame(state, policy(state));
    peak = Math.max(peak, state.score);
  }
  return { state, peak };
}

const player = (s: any) => s.karts.find((k: any) => k.isPlayer);

Deno.test("high score: the program states the engine's ceiling and clock", () => {
  assert(program.includes(`"this >= 0 && this <= ${SCORE_CEILING}"`), `program.cue's score bound is not ${SCORE_CEILING}`);
  assert(program.includes(`"this > 0 && this <= ${clockBudgetS(FINAL_STAGE) * 1000}"`), "program.cue's run_ms bound is not the full clock");
  assert(program.includes(`"this >= 1 && this <= ${FINAL_STAGE}"`), "program.cue's stage bound is not the final stage");
  const goal = `this.outcome in [${letters.map((l) => `'${l}'`).join(", ")}] && this.stage == ${FINAL_STAGE} && this.run_ms < ${clockBudgetS(FINAL_STAGE) * 1000}`;
  const timeouts = stages.map((s) => `(this.stage == ${s} && this.run_ms == ${clockBudgetS(s) * 1000})`).join(" || ");
  const clock = `(${goal}) || (this.outcome == 'time_over' && (${timeouts}))`;
  assert(program.includes(`_runClockCel: "${clock}"`), `program.cue's clock invariant is not\n${clock}`);
});

Deno.test("high score: the five destinations map to A..E", () => {
  const destinations = Object.values(OUTRUN_STAGES).filter((s: any) => s.stageNum === FINAL_STAGE) as any[];
  assertEquals(destinations.map((s) => s.id).sort(), Object.keys(ENDINGS).sort());
  assertEquals([...letters].sort(), ["A", "B", "C", "D", "E"]);
  for (const s of destinations) {
    assertEquals(s.fork, null);
    assert(s.name.endsWith(`[Ending ${ENDINGS[s.id as keyof typeof ENDINGS]}]`), `${s.id} is named ${s.name}`);
  }
});

Deno.test("high score: a goal records its letter with clock left", () => {
  let state = apexrunEngine.initState(0xCCCD, { stageState: "racing", stageId: "destination-castle" });
  state.countdown = 0;
  state.stageNum = FINAL_STAGE;
  state.timeRemaining = 12.5;
  player(state).speed = 100;
  player(state).z = state.trackLength - 2;
  state = apexrunEngine.advanceFrame(state, { up: true });
  const entry = runEntry(state);
  assertEquals({ outcome: entry.outcome, stage: entry.stage }, { outcome: "C", stage: FINAL_STAGE });
  assert(obeysClock(entry), JSON.stringify(entry));
  assertEquals(entry.score, state.score);
});

// Elapsed time, stepped in floats, lands up to a tick past the budget; the
// entry counts the clock spent instead, so a timeout is exact.
Deno.test("high score: a time over records exactly its stage's budget", () => {
  for (const stage of [1, 3]) {
    let state = apexrunEngine.initState(0x7100 + stage, { stageState: "racing" });
    state.countdown = 0;
    state.stageNum = stage;
    state.timeRemaining = clockBudgetS(stage) - 0.5;
    while (state.stageState === "racing") state = apexrunEngine.advanceFrame(state, {});
    assertEquals(runEntry(state), { outcome: "time_over", stage, run_ms: clockBudgetS(stage) * 1000, score: state.score });
  }
});

// The karts once moved on the tick the clock ran out: a car on the line then
// crossed a checkpoint with the run already over (TIME OVER with 45 s left) or
// reached its goal on an empty clock, and either entry broke the clock rule.
Deno.test("high score: the tick the clock runs out, no line is crossed", () => {
  for (const stageId of ["coconut-beach", "destination-castle"]) {
    let state = apexrunEngine.initState(0x7150, { stageState: "racing", stageId });
    state.countdown = 0;
    if (stageId !== "coconut-beach") state.stageNum = FINAL_STAGE;
    state.timeRemaining = 1 / 120;
    player(state).speed = 290;
    player(state).z = state.trackLength - 1;
    state = apexrunEngine.advanceFrame(state, { up: true });
    assertEquals(state.stageState, "game_over");
    assert(obeysClock(runEntry(state)), JSON.stringify(runEntry(state)));
  }
});

Deno.test("high score: a run that has not ended has no entry", () => {
  const state = apexrunEngine.initState(0x7200, { stageState: "racing" });
  let threw = false;
  try {
    runEntry(state);
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("high score: no run scores past the ceiling", () => {
  const flatOut = (s: any) => ({ up: true, nitro: true, gear: "high", left: player(s).x > 0.05, right: player(s).x < -0.05 });
  const weave = (s: any) => ({ up: true, nitro: true, item: true, gear: "high", left: Math.floor(s.tick / 90) % 2 === 0, right: Math.floor(s.tick / 90) % 2 === 1 });
  for (const [seed, policy] of [[0x7301, flatOut], [0x7302, weave]] as const) {
    const { state, peak } = drive(seed, policy);
    assert(peak <= SCORE_CEILING, `seed ${seed} scored ${peak} past ${SCORE_CEILING}`);
    assert(obeysClock(runEntry(state)), JSON.stringify(runEntry(state)));
  }
});

// The cadence trigger (services/database/sql/010_high_score_writes.sql) admits
// one row per player per CLOCK_START_S, which is only one row per run if no run
// ends sooner: the shortest route at the top speed is the fastest goal.
Deno.test("high score: no run ends sooner than the clock's opening budget", () => {
  const length = (id: string): number => {
    const s = (OUTRUN_STAGES as any)[id];
    const here = s.segmentCount * s.segmentLength;
    return s.fork === null ? here : here + Math.min(length(s.fork.leftBranch), length(s.fork.rightBranch));
  };
  const fastestGoalS = length("coconut-beach") / (MAX_KMH * KMH_TO_UNITS_PER_TICK) / 60;
  assert(fastestGoalS >= CLOCK_START_S, `the shortest route takes ${fastestGoalS.toFixed(1)}s at ${MAX_KMH} km/h`);
});

// Roadside props lived only in the renderer, so the car drove through palms.
Deno.test("apexrunEngine: driving into a palm crashes the car", async () => {
  const { placeProps, PROP_RADIUS } = await import("../shell/engine/stage_look.js");
  const stage = OUTRUN_STAGES["coconut-beach"];
  const palm = placeProps("coconut-beach", stage.segmentCount, stage.fork.forkSegment).find((p: any) => p.kind === "palm" && p.i > 20 && p.offset < 6);
  let state = apexrunEngine.initState(0x1111, { stageState: "racing" }) as any;
  state.countdown = 0;
  const player = state.karts.find((k: any) => k.isPlayer);
  player.z = palm.i * stage.segmentLength - 20;
  player.x = palm.side * (1 + palm.offset / 8);
  player.speed = 40;
  state = apexrunEngine.advanceFrame(state, { up: true });
  const after = state.karts.find((k: any) => k.isPlayer);
  assert(after.spinTimer > 0, "the car spins out against the trunk");
  assert(state.events.some((e: any) => e.type === "prop-crash" && e.kind === "palm"), "a prop-crash event");
  assert(PROP_RADIUS.palm > 0);
});

Deno.test("apexrunEngine: the open road and soft scatter never crash the car", async () => {
  const { placeProps } = await import("../shell/engine/stage_look.js");
  const stage = OUTRUN_STAGES["coconut-beach"];
  let state = apexrunEngine.initState(0x1111, { stageState: "racing" }) as any;
  state.countdown = 0;
  for (let t = 0; t < 600; t++) {
    state = apexrunEngine.advanceFrame(state, { up: true });
    assert(!state.events.some((e: any) => e.type === "prop-crash"), `crashed on the road at tick ${t}`);
  }
  const grass = placeProps("coconut-beach", stage.segmentCount, stage.fork.forkSegment).find((p: any) => p.kind === "grassTuft" && p.i > 20);
  state = apexrunEngine.initState(0x1111, { stageState: "racing" }) as any;
  state.countdown = 0;
  const player = state.karts.find((k: any) => k.isPlayer);
  player.z = grass.i * stage.segmentLength - 20;
  player.x = grass.side * (1 + grass.offset / 8);
  player.speed = 40;
  state = apexrunEngine.advanceFrame(state, { up: true });
  assert(!state.events.some((e: any) => e.type === "prop-crash"), "grass is driven through");
});

// A crash left the car against the trunk, so throttle hit it again and again.
Deno.test("apexrunEngine: a crash slides the car back onto the road", async () => {
  const { placeProps } = await import("../shell/engine/stage_look.js");
  const stage = OUTRUN_STAGES["coconut-beach"];
  const palm = placeProps("coconut-beach", stage.segmentCount, stage.fork.forkSegment).find((p: any) => p.kind === "palm" && p.i > 20 && p.offset < 6);
  let state = apexrunEngine.initState(0x1111, { stageState: "racing" }) as any;
  state.countdown = 0;
  const player = state.karts.find((k: any) => k.isPlayer);
  player.z = palm.i * stage.segmentLength - 20;
  player.x = palm.side * (1 + palm.offset / 8);
  player.speed = 40;
  let crashes = 0;
  for (let t = 0; t < 120; t++) {
    state = apexrunEngine.advanceFrame(state, { up: true });
    crashes += state.events.filter((e: any) => e.type === "prop-crash").length;
  }
  const after = state.karts.find((k: any) => k.isPlayer);
  assertEquals(crashes, 1, "one crash, not a pinned loop");
  assert(Math.abs(after.x) <= 1, `back on the road at x=${after.x}`);
});

Deno.test("apexrunEngine: a pit-lane scenario can start the player anywhere along the stage", () => {
  const state = apexrunEngine.initState(0x1111, { stageState: "racing", playerZ: 5000, playerSpeed: 200, playerX: -0.3 }) as any;
  const p = state.karts.find((k: any) => k.isPlayer);
  assertEquals([p.z, p.speed, p.x], [5000, 200, -0.3]);
});

// Five seconds of intro on every retry; the swoop is the skippable part,
// the 3-2-1 is not.
Deno.test("apexrunEngine: Enter skips the swoop but never the 3-2-1", async () => {
  const { COUNTDOWN_TICKS } = await import("../shell/engine/simulation.js");
  let state = apexrunEngine.initState(0x1111, { stageState: "title" }) as any;
  state = apexrunEngine.advanceFrame(state, { enter: true });
  state = apexrunEngine.advanceFrame(state, {});
  state = apexrunEngine.advanceFrame(state, { enter: true });
  assertEquals(state.countdown, COUNTDOWN_TICKS - 1);
  state = apexrunEngine.advanceFrame(state, {});
  state = apexrunEngine.advanceFrame(state, { enter: true });
  assertEquals(state.countdown, COUNTDOWN_TICKS - 3, "a second press does not shorten 3-2-1");
});

// A car merged into a lane with a car in it, and a follower never slowed
// below 80 km/h, so it drove through anything slower: the owner saw a car
// pass through a truck.
Deno.test("apexrunEngine: traffic never drives through traffic", () => {
  let state = apexrunEngine.initState(0x7171, { stageState: "racing" }) as any;
  state.countdown = 0;
  const lane = state.traffic[0].x;
  state.traffic = [
    { ...state.traffic[0], z: 5000, x: lane, targetX: lane, speed: 60, baseSpeed: 60, laneTimer: 99999, type: "truck" },
    { ...state.traffic[0], z: 4700, x: lane, targetX: lane, speed: 200, baseSpeed: 200, laneTimer: 99999, type: "sedan" },
    { ...state.traffic[0], z: 5000, x: lane + 0.43, targetX: lane + 0.43, speed: 60, baseSpeed: 60, laneTimer: 1, type: "pickup" },
  ];
  const overlaps = (a: any, b: any) => Math.abs(a.x - b.x) < 0.28 && Math.abs(a.z - b.z) < 77;
  for (let t = 0; t < 600; t++) {
    state = apexrunEngine.advanceFrame(state, {});
    const [truck, sedan, pickup] = state.traffic;
    assert(!overlaps(truck, sedan), `tick ${t}: the follower ran into the truck`);
    assert(!overlaps(truck, pickup), `tick ${t}: the pickup merged into the truck`);
  }
});

// Each stage was one random mix of props from start to end: the owner found
// the scenes repetitive. A spec may hold to a zone, a span of the stage, and
// every route stage runs through at least three.
Deno.test("placeProps: a spec holds to its zone, and every route stage has three or more", async () => {
  const { placeProps, STAGE_LOOKS } = await import("../shell/engine/stage_look.js");
  for (const [id, look] of Object.entries(STAGE_LOOKS) as [string, any][]) {
    const stage = (OUTRUN_STAGES as Record<string, any>)[id];
    const count = stage.segmentCount;
    const fork = stage.fork?.forkSegment ?? count;
    for (const p of placeProps(id, count, fork)) {
      const [from, to] = look.props[p.k].zone ?? [0, 1];
      assert(p.i >= from * count && p.i < to * count, `${id} ${p.kind} at ${p.i} outside ${from}..${to}`);
    }
    if (id.startsWith("destination-")) continue;
    const starts = new Set(look.props.map((s: any) => (s.zone ?? [0, 1])[0]));
    assert(starts.size >= 3, `${id} has ${starts.size} zones`);
  }
});

// Coconut Beach's boats stood on the sand and against the sea wall, 24 m out
// where the shore is at 30, and the owner asked for fewer, in the sea. A
// sailboat is on the water or nowhere, on every stage.
Deno.test("placeProps: every sailboat floats on the sea, and Coconut Beach has a few", async () => {
  const { placeProps, STAGE_LOOKS, SHORE, BOAT_CLEARANCE } = await import("../shell/engine/stage_look.js");
  for (const [id, look] of Object.entries(STAGE_LOOKS) as [string, any][]) {
    const stage = (OUTRUN_STAGES as Record<string, any>)[id];
    const boats = placeProps(id, stage.segmentCount, stage.fork?.forkSegment ?? stage.segmentCount).filter((p: any) => p.kind === "sailboat");
    for (const b of boats) {
      assert(look.water && (look.water.side === "left") === (b.side < 0), `${id}: a boat on the dry side`);
      assert(b.offset >= SHORE + BOAT_CLEARANCE, `${id}: a boat ${b.offset.toFixed(0)} m out, on the beach`);
    }
    if (id === "coconut-beach") assert(boats.length > 0 && boats.length <= 16, `coconut-beach has ${boats.length} boats`);
  }
});

// Steering moved x straight from the stick, tuned by feel. It now follows a
// kinematic bicycle model with the two standard arcade aids: the wheel's
// reach shrinks with speed, and the heading self-aligns to the road when the
// wheel is let go. The car moves sideways because it points sideways.
Deno.test("apexrunEngine: steering follows a bicycle model with speed-sensitive reach and self-alignment", async () => {
  const { maxWheel, LATERAL_UNITS: L } = await import("../shell/engine/simulation.js");
  assert(maxWheel(280) < maxWheel(120) && maxWheel(120) < maxWheel(40), "the wheel reaches less as speed builds");
  let state = apexrunEngine.initState(0x6161, { stageState: "racing" }) as any;
  state.countdown = 0;
  state.traffic = [];
  const me = () => state.karts.find((k: any) => k.isPlayer);
  for (const k of state.karts) if (!k.isPlayer) k.z = -1e6;
  me().speed = 250;
  me().x = -0.6;
  const headings: number[] = [];
  for (let i = 0; i < 40; i++) {
    const before = me().x;
    const steered = me().speed;
    state = apexrunEngine.advanceFrame(state, { up: true, right: true });
    const v = steered / 3.6;
    headings.push(me().heading);
    // As it points, give or take the road's own curve push.
    const step = (me().x - before) * L;
    const pointed = v * Math.sin(me().heading) / 60;
    if (me().heading > 0.02) assert(Math.abs(step - pointed) < 0.05 * pointed, `it moves sideways as it points: ${step} vs ${pointed}`);
  }
  assert(headings[39] > 0.05 && headings[39] < 0.25, `holding right it points a little right: ${headings[39]}`);
  for (let i = 0; i < 120; i++) state = apexrunEngine.advanceFrame(state, { up: true });
  assert(Math.abs(me().heading) < 0.01, `released, it straightens up: ${me().heading}`);
});

// The car was a rigid block: it tilted by a fixed share of the steer and
// never moved on its springs, and the owner found it static. The body now
// rides damped springs in the sim's own step, so a replay or a scrub poses
// it the same.
const bodyRun = (setup: (me: any) => void) => {
  let state = apexrunEngine.initState(0x7171, { stageState: "racing" }) as any;
  state.countdown = 0;
  state.traffic = [];
  for (const k of state.karts) if (!k.isPlayer) k.z = -1e6;
  setup(state.karts.find((k: any) => k.isPlayer));
  return {
    me: () => state.karts.find((k: any) => k.isPlayer),
    step: (inputs: Record<string, boolean>) => { state = apexrunEngine.advanceFrame(state, inputs); return state.karts.find((k: any) => k.isPlayer).body; },
  };
};

// The body pitched 2.6° and rolled on springs damped at 0.4, kicked by the
// rate the wheel turned: every tap on the stick rocked it, and the owner saw
// a car shaking all the time. A road car pitches and rolls about 2.5–3° per
// g, and its dampers settle a move with one small overshoot.
const BODY_MAX = 0.022;

Deno.test("apexrunEngine: the body squats under throttle, dives under braking and settles at a steady speed", () => {
  const run = bodyRun((me) => { me.speed = 0; });
  let squat = 0;
  for (let i = 0; i < 20; i++) squat = Math.max(squat, run.step({ up: true }).pitch);
  assert(squat > 0.008 && squat <= BODY_MAX, `the nose lifts a little as it pulls away: ${squat}`);
  run.me().speed = 200;
  let dive = 0;
  for (let i = 0; i < 20; i++) dive = Math.min(dive, run.step({ down: true }).pitch);
  assert(dive < -0.012 && dive >= -BODY_MAX, `the nose dips a little under braking: ${dive}`);
  const cruise = bodyRun((me) => { me.speed = 315; me.gear = "high"; });
  let body: any;
  for (let i = 0; i < 120; i++) body = cruise.step({ up: true });
  assert(Math.abs(body.pitch) < 0.003 && Math.abs(body.pitchV) < 0.01, `level at a steady speed: ${JSON.stringify(body)}`);
});

Deno.test("apexrunEngine: a lane change rolls the body out of the move a little and settles without rocking", () => {
  const run = bodyRun((me) => { me.speed = 200; me.gear = "high"; me.x = -0.6; });
  const rolls: number[] = [];
  for (let i = 0; i < 30; i++) rolls.push(run.step({ up: true, right: true }).roll);
  const peak = Math.max(...rolls);
  assert(Math.min(...rolls) > -0.001, `no lean against the move: ${Math.min(...rolls)}`);
  assert(peak > 0.006 && peak <= BODY_MAX, `it rolls out of the move, a little: ${peak}`);
  let body: any;
  const after: number[] = [];
  for (let i = 0; i < 90; i++) { body = run.step({ up: true }); after.push(body.roll); }
  // Straightening is the move's second half: the body rolls the other way
  // once while the nose comes back, then settles with no further swing.
  const crossings = after.filter((r, i) => i > 0 && Math.sign(r) !== Math.sign(after[i - 1]) && Math.abs(r - after[i - 1]) > 1e-6).length;
  assert(crossings <= 1, `one roll back as it straightens, no rocking: ${crossings} crossings`);
  assert(Math.abs(body.roll) < 0.002 && Math.abs(body.rollV) < 0.01, `and settles: ${JSON.stringify(body)}`);
});

Deno.test("apexrunEngine: small corrections on the stick do not rock the body", () => {
  const run = bodyRun((me) => { me.speed = 250; me.gear = "high"; });
  const rolls: number[] = [];
  for (let i = 0; i < 180; i++) rolls.push(run.step({ up: true, right: i % 20 < 3, left: i % 20 >= 10 && i % 20 < 13 }).roll);
  const swing = Math.max(...rolls) - Math.min(...rolls);
  assert(swing < 0.01, `taps either way move the body under half a degree: ${swing}`);
});

Deno.test("apexrunEngine: nitro's kick stretches the body a little, then it settles", () => {
  const run = bodyRun((me) => { me.speed = 200; me.gear = "high"; });
  run.step({ up: true });
  let peak = 0;
  for (let i = 0; i < 12; i++) peak = Math.max(peak, run.step({ up: true, nitro: i === 0 }).stretch);
  assert(run.me().isNitro, "nitro fired");
  assert(peak > 0.03 && peak < 0.12, `a subtle stretch: ${peak}`);
  let body: any;
  for (let i = 0; i < 60; i++) body = run.step({ up: true });
  assert(Math.abs(body.stretch) < 0.004, `settled: ${body.stretch}`);
});

// The owner: "the guy waving non-stop makes no sense". The passenger waves
// only at a moment that earns it (the start, a close pass, beating the
// rival, a checkpoint, nitro's kick), for about a second and a quarter;
// the moment lives in the sim's state, so a replay waves at the same ticks.
Deno.test("apexrunEngine: the passenger waves for a moment at an event, not otherwise", async () => {
  const { WAVE_TICKS } = await import("../shell/engine/simulation.js");
  assert(WAVE_TICKS >= 60 && WAVE_TICKS <= 90, `a short wave: ${WAVE_TICKS} ticks`);
  let state = apexrunEngine.initState(0x4444, { stageState: "racing", playerSpeed: 200 }) as any;
  state.countdown = 0;
  state.traffic = [];
  for (let i = 0; i < 120; i++) state = tick(state, false);
  assertEquals(me(state).waveTimer, 0, "cruising, he rides without waving");
  state = tick(state, true);
  assertEquals(me(state).waveTimer, WAVE_TICKS, "nitro's kick sets off a wave");
  for (let i = 0; i < WAVE_TICKS; i++) state = tick(state, false);
  assertEquals(me(state).waveTimer, 0, "and it ends");
  const start = apexrunEngine.initState(0x4444, { stageState: "warmup" }) as any;
  let s: any = start;
  let waved = false;
  for (let i = 0; i < 400 && !waved; i++) { s = apexrunEngine.advanceFrame(s, {}); waved = me(s).waveTimer > 0; }
  assert(waved, "the start (GO) sets off a wave");
});

// The step rebuilt every segment of its stage each tick, 60 times a second.
Deno.test("apexrunEngine: a stage's segments are built once and shared", () => {
  const stage = OUTRUN_STAGES["coconut-beach"];
  const segments = stageSegments(stage);
  assertEquals(segments.length, stage.segmentCount);
  assert(stageSegments(stage) === segments, "the same segments on every tick");
  assert(Object.isFrozen(segments) && segments.every(Object.isFrozen), "and no tick can change them for the next");
});

// A duel (pronto's kinetic-machine record): one stage, a car per seat, each
// read from its own input; the first car under the arch wins, and the end is
// one event a machine consumes.
// deno-lint-ignore no-explicit-any
type Duel = any;
const duelRacing = (): Duel => {
  let s: Duel = apexrunEngine.initState(0x1337, { duel: true, stageId: "coconut-beach" });
  while (s.stageState !== "racing") s = apexrunEngine.advanceFrame(s, [{}, {}]);
  return s;
};

Deno.test("apexrunEngine: a duel seats two cars on one stage, raced on the hero car's numbers, with no rival", () => {
  const s: Duel = apexrunEngine.initState(0x1337, { duel: true, stageId: "coconut-beach" });
  assertEquals(s.karts.map((k: Duel) => [k.seat, k.isPlayer, k.car]), [[0, true, "tux"], [1, true, "tux"]]);
  assertEquals(s.rival.kartId, "");
  assertEquals(s.duel, { goal: [null, null], winner: null });
});

Deno.test("apexrunEngine: each seat's car answers its own input", () => {
  let s: Duel = duelRacing();
  for (let i = 0; i < 60; i++) s = apexrunEngine.advanceFrame(s, [{ up: true }, { up: true, right: true }]);
  const [a, b] = s.karts;
  assert(a.speed > 0 && b.speed > 0, "both throttles");
  assert(b.x > a.x + 0.1, `seat 1 steered right (${a.x}, ${b.x})`);
});

Deno.test("apexrunEngine: the first car under the arch wins the duel, in one event", () => {
  let s: Duel = duelRacing();
  s.karts[1].z = s.trackLength - ARCH_LEAD - 1;
  s.karts[1].speed = 200;
  s = apexrunEngine.advanceFrame(s, [{ up: true }, { up: true }]);
  assertEquals(s.stageState, "finished");
  assertEquals(s.duel.winner, 1);
  assertEquals(s.events.filter((e: Duel) => e.type === "duel-end"), [{ type: "duel-end", winner: 1, goal: [null, s.tick], ticks: s.tick }]);
  const after = apexrunEngine.advanceFrame(s, [{ up: true }, { up: true }]);
  assertEquals(after.events.filter((e: Duel) => e.type === "duel-end"), [], "the end is told once");
});

Deno.test("apexrunEngine: at time over the car farther along wins the duel; level, neither does", () => {
  const s: Duel = duelRacing();
  s.timeRemaining = 1 / 120;
  s.karts[0].z = 5000;
  s.karts[1].z = 4000;
  const ahead: Duel = apexrunEngine.advanceFrame(s, [{}, {}]);
  assertEquals([ahead.stageState, ahead.duel.winner], ["finished", 0]);
  s.karts[1].z = 5000;
  const level: Duel = apexrunEngine.advanceFrame(s, [{}, {}]);
  assertEquals([level.stageState, level.duel.winner], ["finished", null]);
});

Deno.test("apexrunEngine: each seat sees its own car as the player's hero car", async () => {
  const { viewForSeat } = await import("../shell/engine/simulation.js");
  const s: Duel = apexrunEngine.initState(0x1337, { duel: true, stageId: "coconut-beach" });
  for (const seat of [0, 1]) {
    const view = viewForSeat(s, seat);
    assertEquals(view.karts.map((k: Duel) => [k.seat, k.isPlayer, k.character]), [[0, seat === 0, seat === 0 ? "tux" : "suzanne"], [1, seat === 1, seat === 1 ? "tux" : "suzanne"]]);
  }
  const solo = apexrunEngine.initState(0x1337);
  assert(viewForSeat(solo, 0) === solo, "a run alone is its own view");
});
