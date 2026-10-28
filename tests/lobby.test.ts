// The lobby's fold (machines/lobby.js, as pronto composes it into
// shell/handlers/lobby.js) over a store of its own tables: the lease drawn
// once, the switch, a challenge on the picked stage keyed by its draws, and
// the answers, each a row the machines' surface takes.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { evaluateHandler } from "./platform.ts";
const read = (path: string) => Deno.readTextFile(new URL(path, import.meta.url));
const lobby = await evaluateHandler(await read("../shell/handlers/lobby.js"));
const html = await read("../shell/screens/arena.html");
const empty = JSON.parse(/class="stk-modal-card stk-lobby-card"[^>]*data-empty-row='([^']*)'/.exec(html)![1]);

type Row = Record<string, unknown>;
// deno-lint-ignore no-explicit-any
type Update = { op: string; entity: string; id: string; row?: any };

/** The lobby as the terminal runs it: the tables its fold reads, and the seat
 * that applies what it returns, with the draws it asks for. */
export function lobbyOf(tables: Record<string, Row[]> = {}) {
  const store: Record<string, Row[]> = {
    lobby_tab: [], apexrun_presence_lease: [], apexrun_presence_seat: [], apexrun_presence_command: [], apexrun_challenge_seat: [], apexrun_challenge_open: [],
    apexrun_challenge_command: [], apexrun_duel_seat: [], apexrun_duel_command: [], apexrun_duel_open: [], run: [], run_signal: [], run_milestone: [], ...tables,
  };
  let draws = 0;
  const apply = (updates: Update[] = []) => {
    for (const u of updates) {
      const rows = store[u.entity] ??= [];
      const at = rows.findIndex((r) => r.id === u.id);
      if (u.op === "delete") rows.splice(at, 1);
      else if (u.op === "put") at < 0 ? rows.push(u.row) : (rows[at] = u.row);
      else rows[at] = { ...rows[at], ...u.row };
    }
  };
  // deno-lint-ignore no-explicit-any
  const raise = (event: any) => {
    for (let depth = 0; event !== undefined; depth++) {
      assert(depth < 12, "the chain settles");
      const result = lobby({ items: [store.lobby_tab[0] ?? empty], rows: structuredClone(store) }, event);
      apply(result.updates);
      event = result.then && { type: result.then.type, ...(result.then.seed ? { seed: 0x1234567 + draws++ } : {}), ...(result.then.with ? { with: result.then.with } : {}) };
    }
  };
  return { store, raise, get tab() {
    return store.lobby_tab[0];
  } };
}

const seat = (phase = "hidden", revision = 3) => ({ id: "p/owner", instance_id: "me-0000", seat: "owner", revision, phase, name: "" });

Deno.test("lobby: a tab draws one lease, and is known by a callsign from it", () => {
  const l = lobbyOf({ apexrun_presence_seat: [seat()] });
  l.raise({ type: "mutation" });
  const lease = l.tab.lease as string;
  assertEquals(lease.length, 36);
  assertEquals(l.store.apexrun_presence_lease, [{ id: lease, beat: 0 }]);
  assertEquals(l.tab.name, `RACER ${lease.slice(0, 4).toUpperCase()}`);
  l.raise({ type: "mutation" });
  assertEquals(l.store.apexrun_presence_lease.length, 1, "a wake draws no second lease");
  assertEquals(l.tab.me, "me-0000", "the racer the list leaves out");
});

Deno.test("lobby: the switch shows the racer under its callsign, and a stale one is sent again at the seat's revision", () => {
  const l = lobbyOf({ apexrun_presence_seat: [seat()] });
  l.raise({ type: "mutation" });
  l.raise({ type: "click", from: "btn-toggle-online" });
  const [shown] = l.store.apexrun_presence_command;
  assertEquals(shown.id, "me-0000/3/owner/show");
  assertEquals(shown.request, { version: 1, expected_revision: "3", event: { kind: "show", payload: { name: l.tab.name } } });
  assertEquals(l.tab.shown, "show", "the switch moves on the click");
  // The lease's renewal moved the revision under the click.
  shown.outcome = "rejected";
  shown.reason = "stale_revision";
  l.store.apexrun_presence_seat[0] = seat("hidden", 4);
  l.raise({ type: "mutation" });
  assertEquals(l.store.apexrun_presence_command.map((c) => c.id), ["me-0000/3/owner/show", "me-0000/4/owner/show"]);
});

Deno.test("lobby: clicking online duel opens the lobby and goes online directly, with opt-out toggle", () => {
  const l = lobbyOf({ apexrun_presence_seat: [seat("hidden", 3)] });
  l.raise({ type: "mutation" });
  assertEquals(l.tab.open, "no");
  assertEquals(l.store.apexrun_presence_command.length, 0);

  // Clicking ONLINE DUEL opens the lobby and immediately sends show
  l.raise({ type: "click", from: "stk-btn-lobby" });
  assertEquals(l.tab.open, "yes");
  assertEquals(l.tab.shown, "show");
  const [shown] = l.store.apexrun_presence_command;
  assertEquals(shown.id, "me-0000/3/owner/show");
  assertEquals(((shown.request as Row).event as Row).kind, "show");

  // Opting out via the toggle switch sends hide
  l.store.apexrun_presence_seat[0] = seat("visible", 4);
  l.raise({ type: "click", from: "btn-toggle-online" });
  assertEquals(l.tab.shown, "hide");
  const [_, hidden] = l.store.apexrun_presence_command;
  assertEquals(hidden.id, "me-0000/4/owner/hide");
  assertEquals(((hidden.request as Row).event as Row).kind, "hide");
});

Deno.test("lobby: a challenge is opened on the picked stage under drawn keys, and its refusal is said", () => {
  const l = lobbyOf({ apexrun_presence_seat: [seat("visible")] });
  l.raise({ type: "mutation" });
  l.raise({ type: "click", from: "stage-metropolis-night" });
  l.raise({ type: "click", from: "challenge-x", id: "target-0000" });
  const [open] = l.store.apexrun_challenge_open;
  assertEquals(open.kind, "create");
  assertEquals(open.id, open.instance_id);
  assertEquals((open.input as Row).target, "target-0000");
  assertEquals((open.input as Row).stage, "metropolis-night");
  const seed = (open.input as Row).seed as number;
  assert(Number.isInteger(seed) && seed >= 0 && seed <= 0x7fffffff, "a seed the run row holds");
  assertEquals(l.tab.offer, open.id);
  open.outcome = "rejected";
  open.reason = "racer_unavailable";
  l.raise({ type: "mutation" });
  assertEquals([l.tab.offer, l.tab.note], ["", "racer_unavailable"]);
});

Deno.test("lobby: challenging while offline transitions the racer to online and opens the challenge", () => {
  const l = lobbyOf({ apexrun_presence_seat: [seat("hidden")] });
  l.raise({ type: "mutation" });
  l.raise({ type: "click", from: "challenge-x", id: "target-0000" });
  assertEquals(l.tab.shown, "show");
  const [shown] = l.store.apexrun_presence_command;
  assertEquals(((shown.request as Row).event as Row).kind, "show");
  const [open] = l.store.apexrun_challenge_open;
  assertEquals(open.kind, "create");
});

Deno.test("lobby: a challenge's answer is a command at the revision its seat holds", () => {
  const offer = { id: "c1/target", instance_id: "c1", seat: "target", revision: 1, phase: "offered" };
  const l = lobbyOf({ apexrun_presence_seat: [seat("visible")], apexrun_challenge_seat: [offer] });
  l.raise({ type: "mutation" });
  l.raise({ type: "click", from: "accept-c1/target", id: "c1/target" });
  assertEquals(l.store.apexrun_challenge_command.map((c) => [c.id, (c.request as Row).event]), [["c1/1/target/accept", { kind: "accept", payload: {} }]]);
});

Deno.test("lobby: a challenge link opens a waiting duel on the picked stage, can be cancelled, and can be joined from a pasted link", () => {
  const l = lobbyOf({ apexrun_presence_seat: [seat("hidden")] });
  l.raise({ type: "mutation" });
  l.raise({ type: "click", from: "stage-sunset-highway" });
  l.raise({ type: "click", from: "btn-challenge-link" });
  const [created] = l.store.apexrun_duel_open;
  assertEquals(created.kind, "create");
  assertEquals(created.id, created.instance_id);
  assertEquals((created.input as Row).stage, "sunset-highway");
  assertEquals(l.tab.link, created.id);
  const waiting = { id: `${created.id}/a`, instance_id: created.id, seat: "a", revision: 1, phase: "waiting", stage: "sunset-highway" };
  l.store.apexrun_duel_seat = [waiting];
  // Joining one's own waiting duel or another link while waiting is refused before hitting the cluster.
  l.store.lobby_tab[0].join = `?challenge=${created.id}`;
  l.raise({ type: "mutation" });
  assertEquals([l.tab.join, l.tab.note], ["", "already_in_duel"]);
  l.store.lobby_tab[0].join = "?challenge=00000000-0000-4000-8000-000000000099";
  l.raise({ type: "mutation" });
  assertEquals([l.tab.join, l.tab.note], ["", "racer_unavailable"]);
  // Cancelling a waiting link sends cancel to apexrun_duel.
  l.raise({ type: "click", from: `cancel-duel-${waiting.id}`, id: waiting.id });
  assertEquals(l.store.apexrun_duel_command.map((c) => [c.id, (c.request as Row).event]), [[`${created.id}/1/a/cancel`, { kind: "cancel", payload: {} }]]);
  // Another racer pasting the link writes a join row, and a cluster refusal is shown.
  const b = lobbyOf({ apexrun_presence_seat: [seat("hidden")] });
  b.raise({ type: "mutation" });
  b.store.lobby_tab[0].join = `https://apexrun.bonisoft3.com/?challenge=${created.id}`;
  b.raise({ type: "mutation" });
  const [joined] = b.store.apexrun_duel_open;
  assertEquals([joined.kind, joined.instance_id, b.tab.join, b.tab.link], ["join", created.id, "", joined.id]);
  joined.outcome = "rejected";
  joined.reason = "room_unavailable";
  b.raise({ type: "mutation" });
  assertEquals([b.tab.link, b.tab.note], ["", "room_unavailable"]);
});

/** The tab racing duel d1 from seat b, at the seat's `revision`. */
const duelling = (phase: string, revision: number, view: Row = {}) => ({
  id: "d1/b", instance_id: "d1", seat: "b", revision, phase,
  view: { stage: "alpine-peaks", seed: 4242, peer: "", described: false, lifted: [], winner: "", goal_a: -1, goal_b: -1, dispute: "", silent: [], deadline: 0, phase, ...view },
});
const milestone = (frame: number, kind: string, detail: Row = {}) =>
  ({ id: `4242:${frame}:${kind}`, race: 4242, frame, kind, checksum: `${frame}77`, from: 0, width: 2, inputs: "AAAA", detail: JSON.stringify(detail) });

Deno.test("lobby: the race's description goes to its duel once, at the seat's revision", () => {
  const l = lobbyOf({ apexrun_presence_seat: [seat("visible")], run: [{ id: "run", duel: "d1", race: 4242, mode: "online" }], apexrun_duel_seat: [duelling("signalling", 2)] });
  l.raise({ type: "mutation" });
  assertEquals(l.tab.open, "no", "entering signalling closes the lobby modal");
  assertEquals(l.store.apexrun_duel_command, [], "nothing to send before the race describes its side");
  l.store.run_signal = [{ id: "4242", description: '{"type":"answer"}' }];
  l.raise({ type: "mutation" });
  l.raise({ type: "mutation" });
  assertEquals(l.store.apexrun_duel_command.map((c) => [c.id, (c.request as Row).event]), [["d1/2/b/describe", { kind: "describe", payload: { description: '{"type":"answer"}' } }]]);
});

Deno.test("lobby: returning to the title cancels the previous duel without lifting title milestones", () => {
  const l = lobbyOf({
    apexrun_presence_seat: [seat("visible")],
    run: [{ id: "run", duel: "d1", race: 99, phase: "title" }],
    apexrun_duel_seat: [duelling("racing", 5, { described: true })],
    run_milestone: [{ ...milestone(1, "grid"), race: 99 }],
  });
  l.raise({ type: "mutation" });
  l.raise({ type: "mutation" });
  const commands = () => l.store.apexrun_duel_command.map((c) => [c.id, (c.request as Row).event]);
  assertEquals(commands(), [["d1/5/b/cancel", { kind: "cancel", payload: {} }]]);
  l.raise({ type: "mutation" });
  assertEquals(commands().length, 1, "a pending cancel is not duplicated");
  Object.assign(l.store.apexrun_duel_command[0], { outcome: "rejected", reason: "stale_revision" });
  Object.assign(l.store.run[0], { phase: "race", mode: "", race: 100 });
  l.store.apexrun_duel_seat[0] = duelling("racing", 6, { described: true });
  l.raise({ type: "mutation" });
  assertEquals(commands().at(-1), ["d1/6/b/cancel", { kind: "cancel", payload: {} }]);
  l.store.apexrun_duel_seat[0] = duelling("abandoned", 7);
  l.raise({ type: "click", from: "stk-btn-lobby" });
  l.raise({ type: "mutation" });
  assertEquals(l.tab.open, "yes", "the abandoned duel no longer closes the lobby");
});

Deno.test("lobby: the race's milestones go to its duel oldest first, one a revision, a stale one again at the next", () => {
  const l = lobbyOf({
    apexrun_presence_seat: [seat("visible")], run: [{ id: "run", duel: "d1", race: 4242, mode: "online" }], apexrun_duel_seat: [duelling("racing", 5, { described: true })],
    run_milestone: [milestone(4100, "duel-finish", { winner: 1, goal: [null, 3790] }), milestone(1, "grid"), { ...milestone(9, "start"), race: 99 }],
  });
  l.raise({ type: "mutation" });
  l.raise({ type: "mutation" });
  const sent = () => l.store.apexrun_duel_command.map((c) => [c.id, ((c.request as Row).event as Row).payload]);
  assertEquals(sent(), [["d1/5/b/lift", { frame: 1, kind: "grid", checksum: "177", inputs: "AAAA", winner: "", goal_a: -1, goal_b: -1 }]], "another race's milestone is not this duel's");
  // The peer's own lift moved the revision under it.
  Object.assign(l.store.apexrun_duel_command[0], { outcome: "rejected", reason: "stale_revision" });
  l.store.apexrun_duel_seat[0] = duelling("racing", 6, { described: true, lifted: [{ frame: 1, kind: "grid", by: ["a"] }] });
  l.raise({ type: "mutation" });
  assertEquals(sent().at(-1)![0], "d1/6/b/lift");
  l.store.apexrun_duel_seat[0] = duelling("racing", 7, { described: true, lifted: [{ frame: 1, kind: "grid", by: ["a", "b"] }] });
  l.raise({ type: "mutation" });
  assertEquals(sent().at(-1), ["d1/7/b/lift", { frame: 4100, kind: "duel-finish", checksum: "410077", inputs: "AAAA", winner: "b", goal_a: -1, goal_b: 3790 }]);
});
