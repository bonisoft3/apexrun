// The arena in a browser, for the stack's browser checks: opened, its race
// started from the title as a player starts it, and a recorded run replayed
// on the kinetic child's own host, whose milestones reach the run machine as
// a played race's do.

// deno-lint-ignore no-explicit-any
type Page = any;

/** The arena, its race drawing frames. */
export async function openArena(page: Page, base: string) {
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    // deno-lint-ignore no-explicit-any
    return (document.querySelector("[data-kinetic]") as any)?._prontoKinetic?.frames > 30;
  }, null, { timeout: 120_000 });
}

/** The run row's phase, as the arena wears it. */
export const phase = (page: Page) => page.evaluate(() => document.querySelector(".arena-run")!.getAttribute("data-phase"));

/** From the title, a race: `key` is Enter for a run, 2 for a hot-seat duel. */
export async function start(page: Page, key = "Enter") {
  await page.keyboard.press(key);
  await page.waitForFunction(() => document.querySelector(".arena-run")?.getAttribute("data-phase") === "race");
}

/**
 * Replays `tests/runs/<name>.json` on the running race: its seed and options,
 * then its commands a frame at a time, as fast as the host steps. The race
 * keeps the seed the run row handed it, so what it lifts is this run's.
 */
export async function replay(page: Page, name: string) {
  const run = JSON.parse(await Deno.readTextFile(new URL(`runs/${name}.json`, import.meta.url)));
  await page.evaluate((run: { seed: number; initOptions: Record<string, unknown>; inputs: [number, Record<string, unknown>][] }) => {
    // deno-lint-ignore no-explicit-any
    const host = (document.querySelector("[data-kinetic]") as any)._prontoKinetic.host;
    host.reset(run.seed, run.initOptions);
    for (const [count, input] of run.inputs) for (let i = 0; i < count; i++) host.stepTick(input);
  }, run);
}
