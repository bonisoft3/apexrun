import { assertEquals } from "jsr:@std/assert@1.0.11";
import { DATABASE, run, uuid } from "./mecha-database.ts";

Deno.test({ name: "retained native actors and engine behavior survive the runtime upgrade", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const container = `apexrun-upgrade-${crypto.randomUUID().slice(0, 8)}`;
  const started = await run("docker", ["run", "-d", "--rm", "--name", container, "-e", "POSTGRES_PASSWORD=proof", DATABASE]);
  if (!started.ok) throw new Error(started.err);
  const sql = async (source: string) => {
    const result = await run("docker", ["exec", "-i", container, "psql", "-qtAX", "-v", "ON_ERROR_STOP=1", "-U", "postgres"], source);
    if (!result.ok) throw new Error(result.err);
    return result.out;
  };
  try {
    for (let i = 0; ; i++) {
      if ((await run("docker", ["exec", container, "pg_isready", "-h", "127.0.0.1", "-qU", "postgres"])).ok) break;
      if (i >= 60) throw new Error("PostgreSQL did not start");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const dir = new URL("../services/database/migrations/", import.meta.url);
    const names: string[] = [];
    for await (const file of Deno.readDir(dir)) if (file.isFile && file.name.endsWith(".sql")) names.push(file.name);
    for (const name of names.sort()) await sql(await Deno.readTextFile(new URL(name, dir)));
    const id = uuid(96);
    const state = {phase: "visible", name: "RACER", leases: [{id, until: 40000}], until: 40000};
    await sql(`INSERT INTO hybrid_apexrun_presence.instance (id, version, revision, state) VALUES ('${id}', 1, 4, '${JSON.stringify(state)}');
      INSERT INTO hybrid_apexrun_presence.member (instance_id, actor, seat) VALUES ('${id}', '${id}', 'owner');
      INSERT INTO hybrid_apexrun_presence.receipt (instance_id, actor, command_id, request, result, now) VALUES ('${id}', '${id}', 'kept', '{}', '{}', 12);
      SELECT hybrid_apexrun_presence.arm(i) FROM hybrid_apexrun_presence.instance i WHERE id = '${id}';`);
    const snapshot = () => sql(`SELECT jsonb_build_object(
      'instance', (SELECT to_jsonb(i) FROM hybrid_apexrun_presence.instance i WHERE id = '${id}'),
      'members', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.actor) FROM hybrid_apexrun_presence.member m WHERE instance_id = '${id}'),
      'receipts', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.command_id) FROM hybrid_apexrun_presence.receipt r WHERE instance_id = '${id}'),
      'schedules', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.name) FROM schedule s WHERE s.emits_entity = 'machine_timer_tick' AND s.emits_values @> jsonb_build_object('machine', 'apexrun_presence', 'row', jsonb_build_object('id', '${id}')))
    )::text`);
    const input = {state, event: {kind: "hide", payload: {}}, viewers: ["owner"], context: {actor: "owner", tier: "omnishell", now: 1000}};
    const step = () => sql(`SELECT hybrid_apexrun_presence.engine('${JSON.stringify(input)}'::jsonb)::text`);
    const before = await snapshot(), oldAnswer = await step();
    await sql(await Deno.readTextFile(new URL("../services/database/sql/017_xstate_engines.sql", import.meta.url)));
    assertEquals(await snapshot(), before);
    assertEquals(await step(), oldAnswer);
    await sql(await Deno.readTextFile(new URL("../services/database/sql/018_mecha_engines.sql", import.meta.url)));
    assertEquals(await snapshot(), before);
    assertEquals(await step(), oldAnswer);
  } finally {
    const stopped = await run("docker", ["stop", container]);
    if (!stopped.ok) throw new Error(stopped.err);
  }
}});
