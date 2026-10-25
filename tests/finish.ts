// The end of a run, in the browser against the stack: a run that ranks asks
// the run machine for initials, typed on the kinetic child's keys, and the
// save reaches a second player's live board; what the table refuses is said
// on the panel rather than lost when it closes.

import { baseUrl } from "./platform.ts";
import { openArena, phase, replay, start } from "./arena.ts";

// deno-lint-ignore no-explicit-any
type Page = any;

const APP = Deno.args[0] ?? ".";

const assert = (ok: boolean, msg: string) => {
  if (!ok) throw new Error(msg);
};

/** A race from the title, ended as the recorded `run` ended it: a goal's
 * set piece plays out (eight seconds), and Enter skips its road trip. */
async function endRun(page: Page, run: string) {
  await start(page);
  await replay(page, run);
  await page.waitForFunction(() => document.querySelector(".arena-run")?.getAttribute("data-phase") === "replay", null, { timeout: 20_000 });
  await page.keyboard.press("Enter");
  await page.waitForFunction((): boolean => {
    const at = document.querySelector(".arena-run")?.getAttribute("data-phase");
    return at === "initials" || at === "result";
  }, null, { timeout: 15_000 }).catch(async (err: Error) => {
    throw new Error(`${err.message} Enter skipped no road trip: the run is in ${await phase(page)}`);
  });
}

/** The next race, from the results card. */
async function again(page: Page) {
  await page.click("#stk-res-restart");
  await page.waitForFunction(() => document.querySelector(".arena-run")?.getAttribute("data-phase") === "race");
}

async function main(): Promise<number> {
  const { chromium } = await import("npm:playwright@1.61.1");
  const base = await baseUrl(APP);
  // Both players' races draw: a page in the background would get no
  // animation frames, and its race would never reach the board.
  const browser = await chromium.launch({
    args: [
      "--ignore-certificate-errors",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--disable-background-timer-throttling",
    ],
  });
  let failed = 0;
  const check = async (id: string, run: () => Promise<void>) => {
    try {
      await run();
      console.log(`PASS  ${id}`);
    } catch (err) {
      failed++;
      console.log(`FAIL  ${id}\n      ${err instanceof Error ? err.message : err}`);
    }
  };

  try {
    const errors: string[] = [];
    const player = async () => {
      const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
      page.on("pageerror", (err: Error) => errors.push(err.message));
      await openArena(page, base);
      return page;
    };
    const one = await player();
    const two = await player();
    let score = "";
    let held = 0;
    // The rows player two's board holds with this score: a recorded run
    // scores alike every time it is replayed.
    const rows = (page: Page) => page.locator(".arena-board-row", { hasText: score }).count();

    await check("a ranking run asks for initials, typed on the race's keys, and saves them", async () => {
      await endRun(one, "castle-ending");
      assert(await phase(one) === "initials", "a top-ten run shows no initials");
      assert(await one.locator(".arena-finish-save").isVisible(), "the initials have no save");
      score = (await one.locator(".stk-res-value.stk-res-total").innerText()).replaceAll(",", "");
      held = await rows(two);
      await one.keyboard.type("ace");
      await one.keyboard.press("Enter");
      const mine = one.locator('.arena-board-row[data-mine-score="true"][data-mine-initials="true"]').first();
      await mine.waitFor({ state: "visible", timeout: 15_000 });
      assert(await mine.locator(".arena-board-initials").innerText() === "ACE", "the highlighted row is not the saved initials");
      assert(await mine.locator(".arena-board-outcome").innerText() === "GOAL C", "the ending is not named");
      assert(/^\d:\d\d\.\d$/.test(await mine.locator(".arena-board-time").innerText()), "the run's time is not on the board");
      assert(await mine.locator(".arena-board-score").innerText() === score, "the highlighted row is not the run's score");
      assert(await one.locator(".arena-finish-saved").isVisible(), "the panel does not say the run was saved");
    });

    // Player two is on the title, the board in the closed panel: the row
    // arriving in it is what makes it current when their run ends.
    await check("a second player's board gets the saved run live", async () => {
      for (const until = Date.now() + 15_000; await rows(two) <= held;) {
        assert(Date.now() < until, "player two's board never got the run");
        await two.waitForTimeout(250);
      }
    });

    // A run takes at least 75 s; the table admits one row per player per 75 s.
    await check("a save the table refuses says so and stays shown", async () => {
      await again(one);
      await replay(one, "right-fork-time-over");
      await one.waitForFunction(() => document.querySelector(".arena-run")?.getAttribute("data-phase") === "initials", null, { timeout: 15_000 });
      await one.keyboard.type("bob");
      await one.keyboard.press("Enter");
      await one.locator(".arena-finish .store-error").waitFor({ state: "visible", timeout: 15_000 });
      assert(!(await one.locator(".arena-finish-saved").isVisible()), "a refused run still reads as saved");
      assert(await one.locator(".arena-finish").isVisible(), "the refusal closed the panel");
    });

    await check("denied initials hold the panel open with a reason", async () => {
      await endRun(two, "castle-ending");
      await two.keyboard.type("kkk");
      await two.keyboard.press("Enter");
      await two.locator(".arena-finish .invalid").waitFor({ state: "visible" });
      assert(await two.locator(".arena-finish-save").isVisible(), "denied initials closed the panel");
    });

    await check("no page error on the way", () => {
      assert(errors.length === 0, errors.join(" | "));
      return Promise.resolve();
    });
  } finally {
    await browser.close();
  }
  return failed === 0 ? 0 : 1;
}

if (import.meta.main) Deno.exit(await main());
