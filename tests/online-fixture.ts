// Apex Run's Mecha machines compiled from what the app declares and stepped
// in the executor PLV8 runs, as Truco's online tests step its own.
import { fileURLToPath } from "node:url";
import { compileHybrid, type HybridMachine, executeHybrid, readCheckInputs, instrument, ses } from "./platform.ts";

const terminal = { instrument, ses };
const APP_DIR = fileURLToPath(new URL("../", import.meta.url)).replace(/[/\\]$/, "");
const hybrids = readCheckInputs<unknown, unknown, unknown, HybridMachine>(APP_DIR).then((inputs) => inputs.hybrids);

export const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

export type Answer<T> = { kind: string; reason?: string; state: T; views: { viewer: string; value: Record<string, unknown> }[]; public?: unknown };

/** `apexrun_<name>`'s step: `state` taking `kind` from `actor` at `now`, or its first state from `input`. */
export async function machine<T>(name: string, viewers: string[]) {
  const spec = (await hybrids)[`apexrun_${name}`];
  if (!spec) throw new Error(`unknown hybrid machine apexrun_${name}`);
  const compiled = await compileHybrid(spec, await Deno.readTextFile(`${APP_DIR}/machines/${name}.js`), terminal);
  const tier = (kind: string) => spec.events[kind].tier;
  return {
    spec,
    compiled,
    step: async (state: T, kind: string, payload: unknown = {}, now = 1000, actor = viewers[0]) =>
      await executeHybrid(compiled.source, spec.fuel, {
        state, event: { kind, payload }, viewers, context: { actor: tier(kind) === "mecha" ? "" : actor, tier: tier(kind), now },
      }) as Answer<T>,
    init: async (input: unknown, now = 1000) =>
      await executeHybrid(compiled.source, spec.fuel, {
        initialize: true, payload: input, viewers, context: { tier: "mecha", now },
      }) as Answer<T>,
  };
}
