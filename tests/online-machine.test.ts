// The lobby's machines and the duel through their rules, in the executor PLV8
// runs: presence leases, the challenge's answers and deadline, the duel's
// signalling, its joined milestones, the desync dispute, the result and the
// disconnect timeout.
import { assertEquals } from "jsr:@std/assert@1.0.11";
import { machine, uuid } from "./online-fixture.ts";

Deno.test("presence separates a racer's visibility from its tabs' expiring leases", async () => {
  type Presence = { phase: string; name: string; leases: { id: string; until: number }[]; until: number };
  const { step } = await machine<Presence>("presence", ["owner"]);
  let state: Presence = { phase: "hidden", name: "", leases: [], until: 0 };
  assertEquals((await step(state, "show", { name: "RACER 1" })).reason, "disconnected");
  state = (await step(state, "touch", { session: uuid(1) })).state;
  // The ticker's deadline is the earliest lease's lapse.
  assertEquals(state.until, 31000);
  const shown = await step(state, "show", { name: " RACER 1 " });
  assertEquals([shown.state.phase, shown.state.name, shown.public], ["visible", "RACER 1", { name: "RACER 1" }]);
  state = (await step(shown.state, "hide")).state;
  state = (await step(state, "touch", { session: uuid(1) })).state;
  assertEquals(state.phase, "hidden", "a heartbeat cannot undo going offline");
  const lapsed = await step(state, "expire", {}, 31000);
  assertEquals([lapsed.state.leases, lapsed.state.until, lapsed.public], [[], 0, null], "a lapsed tab is no longer listed");
});

type Challenge = {
  phase: string; inviter: string; target: string; inviter_name: string; target_name: string; stage: string; seed: number; deadline: number; duel: string;
};
const offered = (): Challenge => ({
  phase: "offered", inviter: uuid(1), target: uuid(2), inviter_name: "RACER A", target_name: "RACER B", stage: "alpine-peaks", seed: 77, deadline: 2000, duel: uuid(3),
});

Deno.test("a challenge carries the challenger's stage and seed, and only its target answers it by its deadline", async () => {
  const { step, init } = await machine<Challenge>("challenge", ["inviter", "target"]);
  const { phase: _, deadline: __, ...input } = offered();
  const opened = await init(input, 500);
  assertEquals([opened.state.phase, opened.state.deadline, opened.state.stage, opened.state.seed], ["offered", 30500, "alpine-peaks", 77]);
  const state = offered();
  assertEquals((await step(state, "accept", {}, 1000, "inviter")).reason, "not_target");
  assertEquals((await step(state, "cancel", {}, 1000, "target")).reason, "not_inviter");
  assertEquals((await step(state, "accept", {}, 2000, "target")).reason, "expired");
  assertEquals((await step(state, "expire", {}, 1999)).reason, "not_due");
  for (const [kind, actor, phase] of [["accept", "target", "accepted"], ["decline", "target", "declined"], ["cancel", "inviter", "cancelled"], ["expire", "", "expired"]]) {
    const next = await step(state, kind, {}, kind === "expire" ? 2000 : 1000, actor);
    assertEquals(next.state.phase, phase);
    assertEquals((await step(next.state, "accept", {}, 1000, "target")).reason, "illegal_event", `${phase} is final`);
  }
});

type Lift = { frame: number; kind: string; checksum: string; inputs: string; winner: string; goal_a: number; goal_b: number };
type Duel = {
  phase: string; stage: string; seed: number; seats: string[]; offer: string; answer: string; deadline: number; lifts: (Lift & { by: string[] })[];
  winner: string; goal_a: number; goal_b: number; dispute: string; silent: string[];
};
const lift = (frame: number, kind: string, extra: Partial<Lift> = {}): Lift =>
  ({ frame, kind, checksum: `c${frame}`, inputs: "AAAA", winner: "", goal_a: -1, goal_b: -1, ...extra });
const finish = (extra: Partial<Lift> = {}) => lift(4100, "duel-finish", { winner: "a", goal_a: 3784, goal_b: -1, ...extra });

/** A duel with both seats filled, in `signalling`. */
async function started() {
  const { step, init } = await machine<Duel>("duel", ["a", "b"]);
  const waiting = await init({ stage: "alpine-peaks", seed: 77 }, 900);
  assertEquals([waiting.state.phase, waiting.state.seats, waiting.state.deadline], ["waiting", ["a", "b"], 30900]);
  const opened = await step(waiting.state, "start", { seats: ["a", "b"] }, 1000);
  assertEquals([opened.state.phase, opened.state.deadline], ["signalling", 31000]);
  return { step, waiting: waiting.state, opened };
}

/** A duel through its signalling: both descriptions in, racing. */
async function racing() {
  const { step, opened } = await started();
  const offered = await step(opened.state, "describe", { description: "offer-sdp" }, 1100, "a");
  const answered = await step(offered.state, "describe", { description: "answer-sdp" }, 1200, "b");
  return { step, answered };
}

Deno.test("a challenge link opens a duel in waiting until seat b joins, and only seat a can cancel it", async () => {
  const { step, waiting } = await started();
  assertEquals((await step(waiting, "start", { seats: ["a"] }, 1000)).reason, "waiting_for_players");
  assertEquals((await step(waiting, "cancel", {}, 1000, "b")).reason, "not_inviter");
  const cancelled = await step(waiting, "cancel", {}, 1000, "a");
  assertEquals([cancelled.state.phase, cancelled.state.deadline], ["abandoned", 0]);
  const timedOut = await step(waiting, "timeout", {}, 30900);
  assertEquals([timedOut.state.phase, timedOut.state.silent, timedOut.state.deadline], ["abandoned", [], 0]);
});

Deno.test("a duel carries each side's description to the other, the challenger's first, then races", async () => {
  const { step, opened: { state: opened } } = await started();
  assertEquals((await step(opened, "describe", { description: "answer-sdp" }, 1100, "b")).reason, "no_offer", "the target answers an offer");
  const offered = await step(opened, "describe", { description: "offer-sdp" }, 1100, "a");
  assertEquals(offered.views.find((v) => v.viewer === "b")!.value.peer, "offer-sdp");
  assertEquals(offered.views.find((v) => v.viewer === "a")!.value.described, true);
  assertEquals((await step(offered.state, "describe", { description: "again" }, 1150, "a")).reason, "described", "a description is sent once");
  const answered = await step(offered.state, "describe", { description: "answer-sdp" }, 1200, "b");
  assertEquals([answered.state.phase, answered.state.deadline], ["racing", 151200]);
  assertEquals(answered.views.find((v) => v.viewer === "a")!.value.peer, "answer-sdp");
});

Deno.test("both racers' rows of one milestone join under its frame and kind, and the finish both lifted is the result", async () => {
  const { step, answered } = await racing();
  let state = answered.state;
  for (const seat of ["a", "b"]) state = (await step(state, "lift", lift(1, "grid"), 2000, seat)).state;
  assertEquals(state.lifts.map((l) => [l.frame, l.kind, l.by]), [[1, "grid", ["a", "b"]]]);
  assertEquals((await step(state, "lift", lift(1, "grid"), 2000, "a")).reason, "lifted", "a seat lifts a milestone once");
  const half = await step(state, "lift", finish(), 60000, "b");
  assertEquals([half.state.phase, half.state.deadline], ["racing", 75000], "the other racer has fifteen seconds to lift theirs");
  const done = await step(half.state, "lift", finish(), 61000, "a");
  assertEquals([done.state.phase, done.state.winner, done.state.goal_a, done.state.goal_b, done.state.deadline], ["finished", "a", 3784, -1, 0]);
  assertEquals(done.views.map((v) => [v.viewer, v.value.winner]), [["a", "a"], ["b", "a"]]);
  assertEquals((await step(done.state, "lift", lift(5000, "grid"), 62000, "a")).reason, "illegal_event", "a finished duel takes nothing");
});

Deno.test("two rows of one milestone that disagree are the duel's dispute, whichever field differs", async () => {
  const { step, answered } = await racing();
  for (const differs of [{ checksum: "other" }, { inputs: "BBBB" }, { winner: "b" }, { goal_a: 3790 }]) {
    const held = (await step(answered.state, "lift", finish(), 60000, "a")).state;
    const desync = await step(held, "lift", finish(differs), 60100, "b");
    assertEquals([desync.state.phase, desync.state.dispute, desync.state.winner], ["disputed", "4100:duel-finish", ""], JSON.stringify(differs));
  }
});

Deno.test("the ticker times out a duel whose racer fell silent, naming them", async () => {
  const { step, opened: { state: opened } } = await started();
  const offered = (await step(opened, "describe", { description: "offer-sdp" }, 1100, "a")).state;
  assertEquals((await step(offered, "timeout", {}, 30999)).reason, "not_due");
  const unanswered = await step(offered, "timeout", {}, 31000);
  assertEquals([unanswered.state.phase, unanswered.state.silent], ["abandoned", ["b"]]);
  const { answered } = await racing();
  const half = (await step(answered.state, "lift", finish(), 60000, "a")).state;
  const left = await step(half, "timeout", {}, 75000);
  assertEquals([left.state.phase, left.state.silent, left.state.winner], ["abandoned", ["b"], ""], "one racer's finish is no result");
});
