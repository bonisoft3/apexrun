// The high-score table's access and admission (ir decision-leaderboard-writes),
// against the stack's own Postgres and through its door.

import { assert, assertEquals } from "jsr:@std/assert@1.0.19";
import { SignJWT } from "npm:jose@6.0.11";
import { query, refusal } from "./db.ts";

const base = Deno.env.get("APP_URL");
if (base === undefined) throw new Error("APP_URL is unset: the check runs beside the stack, which sets it");

const INSUFFICIENT_PRIVILEGE = "42501";
const CHECK_VIOLATION = "23514";

/** A guest, as the auth service mints one: an app_user row and nothing else. */
async function guest(): Promise<string> {
  const id = crypto.randomUUID();
  await query(`INSERT INTO app_user(id,handle) VALUES ('${id}','guest-${id}')`);
  return id;
}

/** The session PostgREST builds from a guest's token, inside the current transaction. */
const as = (id: string) =>
  `RESET ROLE; SET LOCAL app.scopes='public:,user:${id}'; SET LOCAL request.jwt.claims='{"sub":"${id}","role":"app_user","guest":true}'; SET LOCAL ROLE app_user;`;

const row = (fields: Record<string, string | number> = {}) => {
  const r = { initials: "ACE", score: 1000, outcome: "A", stage: 5, run_ms: 200000, ...fields };
  const cols = Object.keys(r);
  const vals = Object.values(r).map((v) => typeof v === "number" ? String(v) : `'${v}'`);
  return `INSERT INTO high_score(${cols.join(",")}) VALUES (${vals.join(",")})`;
};

async function token(sub: string): Promise<string> {
  const secret = Deno.env.get("PGRST_JWT_SECRET");
  if (secret === undefined) throw new Error("PGRST_JWT_SECRET is unset");
  return await new SignJWT({ role: "app_user", handle: `guest-${sub}`, guest: true })
    .setProtectedHeader({ alg: "HS256" }).setSubject(sub).setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));
}

Deno.test("a guest inserts a row of their own, on the server's clock", async () => {
  const me = await guest();
  const stamped = await query(`BEGIN; ${as(me)}
    ${row({ created_at: "2000-01-01T00:00:00Z" })} RETURNING player_id = '${me}', created_at = now();
    ROLLBACK;`);
  assertEquals(stamped, "t|t");
});

Deno.test("a row naming another player is refused", async () => {
  const [me, other] = [await guest(), await guest()];
  assertEquals(await refusal(`BEGIN; ${as(me)} ${row({ player_id: other })}; ROLLBACK;`), INSUFFICIENT_PRIVILEGE);
});

Deno.test("a score is never edited or removed, even by its player", async () => {
  const me = await guest();
  const id = crypto.randomUUID();
  await query(`BEGIN; ${as(me)} ${row({ id })}; COMMIT;`);
  assertEquals(await refusal(`BEGIN; ${as(me)} UPDATE high_score SET score = 999999 WHERE id = '${id}'; ROLLBACK;`), INSUFFICIENT_PRIVILEGE);
  assertEquals(await refusal(`BEGIN; ${as(me)} DELETE FROM high_score WHERE id = '${id}'; ROLLBACK;`), INSUFFICIENT_PRIVILEGE);
  assertEquals(await query(`SELECT score FROM high_score WHERE id = '${id}'`), "1000");
});

Deno.test("a reader with no session cannot insert", async () => {
  const me = await guest();
  assertEquals(await refusal(`BEGIN; RESET ROLE; SET LOCAL app.scopes='public:'; SET LOCAL ROLE anon; ${row({ player_id: me })}; ROLLBACK;`), INSUFFICIENT_PRIVILEGE);
});

Deno.test("rows no run produces are refused", async () => {
  const me = await guest();
  const impossible: Record<string, Record<string, string | number>> = {
    "lowercase initials": { initials: "ace" },
    "four initials": { initials: "ACES" },
    "denied initials": { initials: "ASS" },
    "a score past the ceiling": { score: 7422147 },
    "a negative score": { score: -1 },
    "an unknown outcome": { outcome: "F" },
    "a goal before the final stage": { outcome: "B", stage: 4 },
    "a goal on an empty clock": { outcome: "C", run_ms: 255000 },
    "a time over off its stage's budget": { outcome: "time_over", stage: 2, run_ms: 119000 },
    "a time over at a later stage's budget": { outcome: "time_over", stage: 1, run_ms: 120000 },
  };
  for (const [what, fields] of Object.entries(impossible)) {
    assertEquals(await refusal(`BEGIN; ${as(me)} ${row(fields)}; ROLLBACK;`), CHECK_VIOLATION, what);
  }
  const possible = await query(`BEGIN; ${as(me)} ${row({ outcome: "time_over", stage: 3, run_ms: 165000 })} RETURNING stage; ROLLBACK;`);
  assertEquals(possible, "3");
});

// No run ends inside 75 s, so a second row inside that window is not a second
// run; the window closes, or a player could keep only one score ever.
Deno.test("a second row inside 75 s is refused, and admitted after", async () => {
  const me = await guest();
  assertEquals(await refusal(`BEGIN; ${as(me)} ${row()}; ${row({ score: 2000 })}; ROLLBACK;`), CHECK_VIOLATION);
  const later = await query(`BEGIN; ${as(me)} ${row()};
    RESET ROLE; UPDATE high_score SET created_at = now() - interval '76 seconds' WHERE player_id = '${me}';
    ${as(me)} ${row({ score: 2000 })} RETURNING score; ROLLBACK;`);
  assertEquals(later, "2000");
});

Deno.test("another player reads the top ten score down, then time up, then id", async () => {
  const runs: [number, number][] = [
    [9000, 230000], [9000, 210000], [9000, 210000], [8000, 200000], [12000, 250000], [500, 75000],
    [8000, 200000], [7000, 165000], [12000, 240000], [100, 120000], [9000, 220000], [3000, 210000],
  ];
  const rows = await Promise.all(runs.map(async ([score, run_ms]) => ({ id: crypto.randomUUID(), player: await guest(), score, run_ms })));
  for (const r of rows) {
    const [outcome, stage] = clockOutcome(r.run_ms);
    await query(`BEGIN; ${as(r.player)} ${row({ id: r.id, score: r.score, outcome, stage, run_ms: r.run_ms })}; COMMIT;`);
  }
  const expected = [...rows]
    .sort((a, b) => b.score - a.score || a.run_ms - b.run_ms || (a.id < b.id ? -1 : 1))
    .slice(0, 10).map((r) => r.id);
  const players = rows.map((r) => r.player).join(",");
  const reader = await guest();
  const res = await fetch(`${base}/crud/high_score?select=id&player_id=in.(${players})&order=score.desc,run_ms.asc,id.asc&limit=10`, {
    headers: { "Authorization": `Bearer ${await token(reader)}` },
  });
  const text = await res.text();
  assert(res.ok, `${res.status} ${text}`);
  assertEquals(JSON.parse(text).map((r: { id: string }) => r.id), expected);
});

/** A run's outcome and stage the clock admits for its run_ms. */
function clockOutcome(run_ms: number): [string, number] {
  const budgets = [75000, 120000, 165000, 210000, 255000];
  const stage = budgets.indexOf(run_ms) + 1;
  return stage > 0 ? ["time_over", stage] : ["D", 5];
}

// The outbox redelivers a create until it sees it confirmed, so the same POST
// can arrive twice inside the cadence window; it must land once and not be
// mistaken for a second run, while a genuinely second row still is.
Deno.test("the same POST twice through /crud is one row", async () => {
  const me = await guest();
  const headers = { "Authorization": `Bearer ${await token(me)}`, "Content-Type": "application/json" };
  const id = crypto.randomUUID();
  const body = JSON.stringify({ id, initials: "DUP", score: 500, outcome: "time_over", stage: 1, run_ms: 75000 });
  for (let delivery = 1; delivery <= 2; delivery++) {
    const res = await fetch(`${base}/crud/high_score`, { method: "POST", headers, body });
    const text = await res.text();
    assert(res.ok, `delivery ${delivery}: ${res.status} ${text}`);
  }
  assertEquals(await query(`SELECT count(*), count(*) FILTER (WHERE id = '${id}') FROM high_score WHERE player_id = '${me}'`), "1|1");
  const second = await fetch(`${base}/crud/high_score`, {
    method: "POST", headers,
    body: JSON.stringify({ id: crypto.randomUUID(), initials: "DUP", score: 600, outcome: "time_over", stage: 1, run_ms: 75000 }),
  });
  const refused = await second.json();
  assertEquals([second.status, refused.code], [400, CHECK_VIOLATION]);
});
