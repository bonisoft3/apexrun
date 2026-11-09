// The cluster's database image, run by docker for a test that applies the
// app's migrations to a fresh PostgreSQL: the pin pronto emitted, a runner,
// and the fixtures' stable ids.

const facts = JSON.parse(await Deno.readTextFile(new URL("../.pronto/cluster.json", import.meta.url)));
if (typeof facts.database !== "string") throw new Error(".pronto/cluster.json names no database image; regenerate the application");

/** The mecha-database image the cluster runs, as pronto pins it. */
export const DATABASE: string = facts.database;

export const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

export async function run(command: string, args: string[], input?: string) {
  const process = new Deno.Command(command, {
    args, stdin: input === undefined ? "null" : "piped", stdout: "piped", stderr: "piped",
  }).spawn();
  if (input !== undefined) {
    const writer = process.stdin.getWriter();
    await writer.write(new TextEncoder().encode(input));
    await writer.close();
  }
  const result = await process.output();
  return { ok: result.success, out: new TextDecoder().decode(result.stdout).trim(), err: new TextDecoder().decode(result.stderr).trim() };
}
