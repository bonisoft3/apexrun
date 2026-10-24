// The cluster's Postgres over the compose network, read as `psql -At` prints
// it: a row's values joined by `|`, rows by newlines, NULL as nothing. The
// checks run beside the stack, which hands them DATABASE_URL.

import postgres from "npm:postgres@3.4.9";

const url = Deno.env.get("DATABASE_URL");
if (url === undefined) throw new Error("DATABASE_URL is unset: the check runs beside the stack, which sets it");

type Rows = (Uint8Array | null)[][];

/** Runs a script of one statement or many, and answers every row any of them returned. */
export async function query(script: string): Promise<string> {
  const sql = postgres(url!, { max: 1, onnotice: () => {}, fetch_types: false });
  try {
    const r = await sql.unsafe(script).simple().raw() as unknown as Rows & { command?: string };
    const results: Rows[] = r.command === undefined ? r as unknown as Rows[] : [r];
    const text = new TextDecoder();
    return results.flatMap((rows) => rows.map((row) => row.map((v) => v === null ? "" : text.decode(v)).join("|"))).join("\n");
  } finally {
    await sql.end();
  }
}

/** The SQLSTATE a script is refused with. A script the database accepts is the run failing. */
export async function refusal(script: string): Promise<string> {
  try {
    await query(script);
  } catch (e) {
    if (e instanceof postgres.PostgresError) return e.code;
    throw e;
  }
  throw new Error(`accepted, and should have been refused:\n${script}`);
}
