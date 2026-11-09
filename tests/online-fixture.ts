// Apex Run's Mecha machines as pronto emitted them, stepped in the executor
// PLV8 runs, as Truco's online tests step its own.
import { executeMecha, type Machine } from "./platform.ts";

const APP = new URL("../", import.meta.url);
const emitted = async <T>(path: string) => JSON.parse(await Deno.readTextFile(new URL(path, APP))) as T;
// Each machine's chart as the compilers read it, and its step compiled as
// PostgreSQL runs it.
const reducers = emitted<Record<string, Machine>>(".pronto/check-inputs.json").then((inputs) => (inputs as unknown as { reducers: Record<string, Machine> }).reducers);
const compiled = emitted<Record<string, { source: string; engine: { sha256: string } }>>(".pronto/mecha-reducers.json");

export const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

export type Answer<T> = { kind: string; reason?: string; state: T; views: { viewer: string; value: Record<string, unknown> }[]; public?: unknown };

/** `apexrun_<name>`'s step: `state` taking `kind` from `actor` at `now`, or its first state from `input`. */
export async function machine<T>(name: string, viewers: string[]) {
  const spec = (await reducers)[`apexrun_${name}`];
  const source = (await compiled)[`apexrun_${name}`]?.source;
  if (!spec || !source) throw new Error(`unknown mecha machine apexrun_${name}`);
  const tier = (kind: string) => spec.events[kind].tier;
  return {
    spec,
    source,
    step: async (state: T, kind: string, payload: unknown = {}, now = 1000, actor = viewers[0]) =>
      await executeMecha(source, spec.fuel, {
        state, event: { kind, payload }, viewers, context: { actor: tier(kind) === "mecha" ? "" : actor, tier: tier(kind), now },
      }) as Answer<T>,
    init: async (input: unknown, now = 1000) =>
      await executeMecha(source, spec.fuel, {
        initialize: true, payload: input, viewers, context: { tier: "mecha", now },
      }) as Answer<T>,
  };
}

/** The sha256 of `apexrun_<name>`'s engine statement as pronto compiles it today. */
export async function engine(name: string): Promise<string> {
  const found = (await compiled)[`apexrun_${name}`]?.engine.sha256;
  if (!found) throw new Error(`no compiled engine for apexrun_${name}`);
  return found;
}

/** The sha256 of `text` as lowercase hex, as .pronto/mecha-reducers.json spells an engine's. */
export async function sha256(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

