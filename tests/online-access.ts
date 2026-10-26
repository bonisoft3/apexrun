// The lobby's machines through their surface rows, against the stack's own
// Postgres as the browser reaches them: every request a row a guest inserts
// under the generated policies, every answer a row the machine writes. The
// ticker is played by inserting the tick it would.

import { assert, assertEquals } from "jsr:@std/assert@1.0.19";
import postgres from "npm:postgres@3.4.9";
import { query as once, refusal } from "./db.ts";

const INSUFFICIENT_PRIVILEGE = "42501";

/** A guest, as the auth service mints one. */
async function guest(): Promise<string> {
  const id = crypto.randomUUID();
  await query(`INSERT INTO app_user(id,handle) VALUES ('${id}','guest-${id}')`);
  return id;
}

// A machine's step runs serializable, as the gateway and the ticker run it,
// and like their writers this one runs again a transaction a conflict aborted,
// so racing callers see some serial order of their steps.
async function query(script: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await once(script);
    } catch (e) {
      if (!(e instanceof postgres.PostgresError) || e.code !== "40001" || attempt >= 20) throw e;
    }
  }
}

const lit = (value: unknown) => `'${(typeof value === "string" ? value : JSON.stringify(value)).replaceAll("'", "''")}'`;
/** `script` in the session PostgREST builds from a guest's token. */
const as = (id: string, script: string) =>
  `BEGIN ISOLATION LEVEL SERIALIZABLE; SET LOCAL app.scopes='public:,user:${id}'; SET LOCAL request.jwt.claims='{"sub":"${id}","role":"app_user","guest":true}'; SET LOCAL ROLE app_user; ${script}; COMMIT;`;
type Receipt = { kind: string; reason: string };
/** A row of the surface, absorbed if it is already there, then its stamp. */
async function insert(actor: string, table: string, row: Record<string, unknown>): Promise<Receipt> {
  const out = await query(as(actor, `INSERT INTO ${table} (${Object.keys(row).join(", ")}) VALUES (${Object.values(row).map(lit).join(", ")}) ON CONFLICT DO NOTHING;
    SELECT jsonb_build_object('kind', outcome, 'reason', coalesce(reason, '')) FROM ${table} WHERE id = ${lit(String(row.id))}`));
  return JSON.parse(out);
}
const seatOf = async (actor: string, machine: string, instance: string) => {
  const out = await query(as(actor, `SELECT jsonb_build_object('revision', revision::text, 'phase', phase, 'seat', seat, 'view', view::jsonb) FROM ${machine}_seat WHERE instance_id = ${lit(instance)}`));
  return out ? JSON.parse(out) as { revision: string; phase: string; seat: string; view: Record<string, unknown> } : null;
};
const command = async (actor: string, machine: string, instance: string, kind: string, payload: unknown = {}, key?: string) => {
  const at = (await seatOf(actor, machine, instance))!;
  return await insert(actor, `${machine}_command`, {
    id: key ?? `${instance}/${at.revision}/${at.seat}/${kind}`, instance_id: instance, request: { version: 1, expected_revision: at.revision, event: { kind, payload } },
  });
};
/** A racer with a tab open, shown in the lobby under `name`. */
async function online(name: string): Promise<string> {
  const me = await guest();
  await query(as(me, `INSERT INTO apexrun_presence_lease (id, beat) VALUES ('${crypto.randomUUID()}', 0)`));
  assertEquals((await command(me, "apexrun_presence", me, "show", { name })).kind, "accepted");
  return me;
}
const listed = async (reader: string, racer: string) => (await query(as(reader, `SELECT count(*) FROM apexrun_presence_public WHERE id = '${racer}'`))) === "1";
const challenge = (inviter: string, target: string, id = crypto.randomUUID(), stage = "alpine-peaks") =>
  insert(inviter, "apexrun_challenge_open", { id, instance_id: id, kind: "create", input: { target, stage, seed: "424242" } }).then((r) => ({ id, ...r }));
/** What the ticker does when an instance's schedule falls due, with its deadline already past. */
async function lapse(schema: string, instance: string, field: string, machine: string, state = `jsonb_set(state, '{${field}}', '1')`) {
  await query(`BEGIN ISOLATION LEVEL SERIALIZABLE;
    UPDATE ${schema}.instance SET state = ${state} WHERE id = '${instance}';
    SELECT ${schema}.arm(i) FROM ${schema}.instance i WHERE i.id = '${instance}';
    COMMIT`);
  await tick(machine, instance);
}
/** The tick the ticker inserts when `instance`'s schedule falls due. */
const tick = (machine: string, instance: string) =>
  query(`BEGIN ISOLATION LEVEL SERIALIZABLE; INSERT INTO machine_timer_tick (id, schedule, tick_at, late, machine, "row", state, delay)
    SELECT gen_random_uuid(), s.name, s.due_at, false, s.emits_values->>'machine', s.emits_values->'row', s.emits_values->>'state', s.emits_values->>'delay'
    FROM schedule s WHERE s.emits_values @> jsonb_build_object('machine', '${machine}', 'row', jsonb_build_object('id', '${instance}')); COMMIT`);

Deno.test("a racer is listed while visible with a tab open, and the ticker drops a lapsed one", async () => {
  const [ana, bia] = [await online("RACER ANA"), await online("RACER BIA")];
  assert(await listed(bia, ana));
  assertEquals(await query(as(bia, `SELECT name FROM apexrun_presence_public WHERE id = '${ana}'`)), "RACER ANA");
  assertEquals((await command(ana, "apexrun_presence", ana, "hide")).kind, "accepted");
  assertEquals(await listed(bia, ana), false);
  await command(ana, "apexrun_presence", ana, "show", { name: "RACER ANA" });
  // Every lease of hers lapsed at once.
  await lapse("hybrid_apexrun_presence", ana, "until", "apexrun_presence",
    `jsonb_set(jsonb_set(state, '{leases}', (SELECT jsonb_agg(l || '{"until": 1}') FROM jsonb_array_elements(state->'leases') l)), '{until}', '1')`);
  assertEquals(await listed(bia, ana), false, "a racer whose tabs went away is unlisted without them");
  assertEquals(await refusal(as(bia, `INSERT INTO apexrun_presence_command (id, instance_id, request) VALUES ('forged', '${ana}', ${lit({ version: 1, expected_revision: "1", event: { kind: "hide", payload: {} } })})`)), INSUFFICIENT_PRIVILEGE);
});

Deno.test("a challenge names its stage and seed; an accept and a cancel race, and one wins", async () => {
  const [ana, bia] = [await online("RACER ANA"), await online("RACER BIA")];
  const offer = await challenge(ana, bia);
  assertEquals(offer.kind, "accepted");
  assertEquals(await challenge(ana, bia, offer.id).then(({ kind }) => kind), "accepted", "the same challenge twice is one row");
  const seen = (await seatOf(bia, "apexrun_challenge", offer.id))!;
  assertEquals([seen.seat, seen.view.stage, seen.view.seed, seen.view.inviter_name], ["target", "alpine-peaks", 424242, "RACER ANA"]);
  assertEquals((await challenge(ana, await online("RACER CAU"))).reason, "outgoing_challenge_pending");
  const race = await Promise.all([command(bia, "apexrun_challenge", offer.id, "accept"), command(ana, "apexrun_challenge", offer.id, "cancel")]);
  assertEquals(race.map((r) => r.kind).sort(), ["accepted", "rejected"]);
  const phase = (await seatOf(ana, "apexrun_challenge", offer.id))!.phase;
  assert(phase === "accepted" || phase === "cancelled", phase);
});

Deno.test("a challenge to a racer not in the lobby is refused, and an unanswered one expires on the ticker", async () => {
  const [ana, bia] = [await online("RACER ANA"), await online("RACER BIA")];
  assertEquals((await challenge(ana, await guest())).reason, "racer_unavailable");
  const offer = await challenge(ana, bia);
  await lapse("hybrid_apexrun_challenge", offer.id, "deadline", "apexrun_challenge");
  assertEquals((await seatOf(bia, "apexrun_challenge", offer.id))!.phase, "expired");
  assertEquals((await command(bia, "apexrun_challenge", offer.id, "accept")).reason, "illegal_event");
});

/** Ana's challenge accepted by Bia: the duel it opens, Ana in seat a. */
async function accepted() {
  const [ana, bia] = [await online("RACER ANA"), await online("RACER BIA")];
  const offer = await challenge(ana, bia);
  assertEquals((await command(bia, "apexrun_challenge", offer.id, "accept")).kind, "accepted");
  const duel = (await seatOf(ana, "apexrun_challenge", offer.id))!.view.duel as string;
  return { ana, bia, duel };
}
const lifted = (frame: number, kind: string, extra: Record<string, unknown> = {}) =>
  ({ frame, kind, checksum: `c${frame}`, inputs: "AAAA", winner: "", goal_a: -1, goal_b: -1, ...extra });
/** A milestone row the racer's race lifted, sent again at the seat's revision while another's step makes it stale. */
async function lift(actor: string, duel: string, row: Record<string, unknown>): Promise<Receipt> {
  for (let attempt = 0; ; attempt++) {
    const receipt = await command(actor, "apexrun_duel", duel, "lift", row);
    if (receipt.reason !== "stale_revision" || attempt >= 10) return receipt;
  }
}
async function raced() {
  const seats = await accepted();
  assertEquals((await command(seats.ana, "apexrun_duel", seats.duel, "describe", { description: "offer-sdp" })).kind, "accepted");
  assertEquals((await command(seats.bia, "apexrun_duel", seats.duel, "describe", { description: "answer-sdp" })).kind, "accepted");
  return seats;
}

Deno.test("an accepted challenge opens the duel on its stage and seed, and its racers are busy until it ends", async () => {
  const { ana, bia, duel } = await accepted();
  const [a, b] = [(await seatOf(ana, "apexrun_duel", duel))!, (await seatOf(bia, "apexrun_duel", duel))!];
  assertEquals([a.seat, a.phase, a.view.stage, a.view.seed, b.seat], ["a", "signalling", "alpine-peaks", 424242, "b"]);
  assertEquals((await challenge(ana, await online("RACER CAU"))).reason, "racer_unavailable", "a racer in a duel takes no challenge");
  assertEquals(await seatOf(await guest(), "apexrun_duel", duel), null, "a duel is its racers' alone");
});

Deno.test("the duel's rows carry each description to the other racer, and both racers' finish is its result", async () => {
  const { ana, bia, duel } = await raced();
  assertEquals((await seatOf(ana, "apexrun_duel", duel))!.view.peer, "answer-sdp");
  assertEquals((await seatOf(bia, "apexrun_duel", duel))!.view.peer, "offer-sdp");
  // Both racers lift at once: the one whose step lands second is stale, and sends it again.
  const both = await Promise.all([lift(ana, duel, lifted(1, "grid")), lift(bia, duel, lifted(1, "grid"))]);
  assertEquals(both.map((r) => r.kind), ["accepted", "accepted"]);
  const finish = lifted(4100, "duel-finish", { winner: "b", goal_a: -1, goal_b: 3790 });
  await Promise.all([lift(ana, duel, finish), lift(bia, duel, finish)]);
  for (const racer of [ana, bia]) {
    const seat = (await seatOf(racer, "apexrun_duel", duel))!;
    assertEquals([seat.phase, seat.view.winner, seat.view.goal_b], ["finished", "b", 3790]);
  }
  assertEquals(await query(`SELECT winner FROM apexrun_duel_seat WHERE instance_id = '${duel}' ORDER BY seat`), "b\nb", "the result is a row of each racer's");
  assertEquals((await challenge(ana, bia)).kind, "accepted", "a finished duel frees its racers");
});

Deno.test("two racers' rows that disagree are the duel's recorded dispute", async () => {
  const { ana, bia, duel } = await raced();
  await lift(ana, duel, lifted(4100, "duel-finish", { winner: "a", goal_a: 3784 }));
  await lift(bia, duel, lifted(4100, "duel-finish", { winner: "a", goal_a: 3784, checksum: "forged" }));
  const seat = (await seatOf(ana, "apexrun_duel", duel))!;
  assertEquals([seat.phase, seat.view.dispute, seat.view.winner], ["disputed", "4100:duel-finish", ""]);
});

Deno.test("the ticker abandons a duel whose racer fell silent", async () => {
  const { ana, bia, duel } = await raced();
  await lift(ana, duel, lifted(4100, "duel-finish", { winner: "a", goal_a: 3784 }));
  await lapse("hybrid_apexrun_duel", duel, "deadline", "apexrun_duel");
  const seat = (await seatOf(bia, "apexrun_duel", duel))!;
  assertEquals([seat.phase, seat.view.silent, seat.view.winner], ["abandoned", ["b"], ""]);
});

Deno.test("a challenge link opens a waiting duel without listing in the lobby, and a second guest joining it starts signalling", async () => {
  const [ana, bia, cau] = [await guest(), await guest(), await guest()];
  const duel = crypto.randomUUID();
  assertEquals((await insert(ana, "apexrun_duel_open", { id: duel, instance_id: duel, kind: "create", input: { stage: "sunset-highway", seed: "777777" } })).kind, "accepted");
  const waiting = (await seatOf(ana, "apexrun_duel", duel))!;
  assertEquals([waiting.seat, waiting.phase, waiting.view.stage, waiting.view.seed], ["a", "waiting", "sunset-highway", 777777]);
  assertEquals((await insert(ana, "apexrun_duel_open", { id: crypto.randomUUID(), instance_id: crypto.randomUUID(), kind: "create", input: { stage: "sunset-highway", seed: "1" } })).reason, "racer_unavailable");
  // A racer already holding a waiting link cannot join another racer's waiting link.
  const other = crypto.randomUUID();
  assertEquals((await insert(cau, "apexrun_duel_open", { id: other, instance_id: other, kind: "create", input: { stage: "alpine-peaks", seed: "2" } })).kind, "accepted");
  assertEquals(await refusal(as(ana, `INSERT INTO apexrun_duel_open (id, instance_id, kind, input) VALUES ('join/${other}/ana', '${other}', 'join', '{}')`)), "23514");
  assertEquals(await seatOf(ana, "apexrun_duel", other), null);
  assertEquals((await command(cau, "apexrun_duel", other, "cancel")).kind, "accepted");
  assertEquals((await insert(bia, "apexrun_duel_open", { id: `join/${duel}/1`, instance_id: duel, kind: "join", input: {} })).kind, "accepted");
  const [a, b] = [(await seatOf(ana, "apexrun_duel", duel))!, (await seatOf(bia, "apexrun_duel", duel))!];
  assertEquals([a.seat, a.phase, b.seat, b.phase], ["a", "signalling", "b", "signalling"]);
  assertEquals((await insert(cau, "apexrun_duel_open", { id: `join/${duel}/2`, instance_id: duel, kind: "join", input: {} })).reason, "room_unavailable");
  // A waiting link its opener cancels or the ticker times out is no longer open to join.
  const cancelled = crypto.randomUUID();
  assertEquals((await insert(cau, "apexrun_duel_open", { id: cancelled, instance_id: cancelled, kind: "create", input: { stage: "alpine-peaks", seed: "123" } })).kind, "accepted");
  assertEquals((await command(cau, "apexrun_duel", cancelled, "cancel")).kind, "accepted");
  assertEquals((await seatOf(cau, "apexrun_duel", cancelled))!.phase, "abandoned");
  assertEquals((await insert(ana, "apexrun_duel_open", { id: `join/${cancelled}/1`, instance_id: cancelled, kind: "join", input: {} })).reason, "room_unavailable");
});
