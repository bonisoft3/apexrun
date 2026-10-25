// Apex Run by touch alone, in the browser against the stack (DESIGN.md
// "Touch"): a phone held flat, the same phone upright and a tablet, each an
// emulated touch device, start a run from the title, drive it on the pad and
// pedals, pause and resume it, and end it; the initials are edited on the
// keypad and saved, and the board shows them. A duel on one screen, each seat
// on its own cluster, is raced on a tablet and a phone either way up. A
// desktop shows none of it.
//
// The fingers are Chromium's own touch points (CDP Input.dispatchTouchEvent),
// so the race reads them through the pointer events a phone raises. SHOTS
// names a directory for a screenshot of each phase.

import { baseUrl } from "./platform.ts";
import { openArena, phase, replay } from "./arena.ts";

// deno-lint-ignore no-explicit-any
type Page = any;
type Cmd = { up: boolean; down: boolean; left: boolean; right: boolean; nitro: boolean };

const APP = Deno.args[0] ?? ".";
const SHOTS = Deno.env.get("SHOTS");

const assert = (ok: boolean, msg: string) => {
  if (!ok) throw new Error(msg);
};

const until = (page: Page, want: string[], timeout = 15_000) =>
  page.waitForFunction((want: string[]) => want.includes(document.querySelector(".arena-run")?.getAttribute("data-phase") ?? ""), want, { timeout })
    .catch(async (err: Error) => {
      throw new Error(`${err.message}: waited for ${want.join(" or ")}, the run is in ${await phase(page)}`);
    });

/** Fingers on the screen: each `down` adds a touch point, `move` slides one,
 * `up` lifts one. A start or a move carries every point down; an end, the one
 * point lifted, which is how Chromium tells which finger left. */
async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  // Each touch a fresh point id, as each new finger on a phone is.
  let touches = 0;
  const down = new Map<number, { x: number; y: number; point: number }>();
  const points = () => [...down].map(([id, p]) => ({ id: p.point, finger: id, x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1 }));
  const send = (type: string, touched = points()) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: touched.map(({ finger: _, ...p }) => p) });
  const center = async (selector: string) => {
    const box = await page.locator(selector).first().boundingBox();
    assert(box !== null, `${selector} is not on screen`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  return {
    async down(id: number, selector: string) {
      down.set(id, { ...(await center(selector)), point: ++touches });
      await send("touchStart");
    },
    async move(id: number, selector: string) {
      await this.moveTo(id, await center(selector));
    },
    async moveTo(id: number, at: { x: number; y: number }) {
      down.set(id, { ...at, point: down.get(id)!.point });
      await send("touchMove");
    },
    async up(id: number) {
      const lifted = points().filter((p) => p.finger === id);
      down.delete(id);
      await send("touchEnd", lifted);
    },
    async tap(selector: string) {
      const id = 90;
      await this.down(id, selector);
      await page.waitForTimeout(80);
      await this.up(id);
    },
  };
}

/** The commands the race took over the last `frames` frames, a seat's. */
const commands = (page: Page, frames: number, seat?: number): Promise<Cmd[]> =>
  page.evaluate(({ frames, seat }: { frames: number; seat?: number }) => {
    // deno-lint-ignore no-explicit-any
    const host = (document.querySelector("[data-kinetic]") as any)._prontoKinetic.host;
    const now = host.getCurrentTick();
    const out = [];
    for (let t = Math.max(1, now - frames + 1); t <= now; t++) {
      const cmd = host.getInputLog(t);
      out.push(seat === undefined ? cmd : cmd[seat]);
    }
    return out;
  }, { frames, seat });

/** Waits for the race to step `n` frames: an emulated phone may draw slower
 * than the race's clock, so wall time is no measure of frames taken. */
const frames = async (page: Page, n: number) => {
  // deno-lint-ignore no-explicit-any
  const tick = () => page.evaluate(() => (document.querySelector("[data-kinetic]") as any)._prontoKinetic.host.getCurrentTick());
  const from = await tick();
  // deno-lint-ignore no-explicit-any
  await page.waitForFunction((to: number) => (document.querySelector("[data-kinetic]") as any)._prontoKinetic.host.getCurrentTick() >= to, from + n, { timeout: 15_000 });
};

const visible = (page: Page, selector: string) => page.locator(selector).first().isVisible();
/** That `selector` shows (or not) on the phase the run is in. */
async function shows(page: Page, selector: string, want: boolean, msg: string) {
  const seen = await visible(page, selector);
  if (seen !== want) console.log(await page.evaluate((sel: string) => [...document.querySelectorAll(sel)].map((e) => `${e.className} ${getComputedStyle(e).display} ${(e as HTMLElement).offsetHeight} ${JSON.stringify(e.getBoundingClientRect())}`), selector));
  assert(seen === want, `${msg} (in ${await phase(page)})`);
}

async function shot(page: Page, device: string, moment: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${device}-${moment}.png` });
}

/** From the title, a run driven by touch: steer, slide across, nitro, brake. */
async function drive(page: Page, device: string) {
  const f = await fingers(page);
  await shows(page, ".stk-title-touch", true, "the title says nothing of the touch controls");
  await shows(page, ".stk-title-keys.keys-only", false, "the title still teaches the keyboard");
  await shot(page, device, "title");
  await f.tap("#stk-btn-start");
  await until(page, ["race"]);
  assert(await visible(page, ".touch-pad"), "no pad in the race");
  assert(!(await visible(page, "#stk-pause-btn")), "the keyboard's pause button shows on a touch screen");
  // The swoop and the count, then the thumb on the pad's left half.
  await page.waitForFunction(() => document.querySelector(".arena-run")?.getAttribute("data-racing") === "yes", null, { timeout: 20_000 });
  await f.down(1, '[data-touch-zone="drive left"]');
  await frames(page, 12);
  let taken = await commands(page, 5);
  assert(taken.every((c) => c.up && c.left && !c.right), `the pad's left half is not throttle and left: ${JSON.stringify(taken.at(-1))}`);
  // Regression: the pad's rounded end was no zone, and a thumb that drifted
  // off the pad was forgotten until lifted.
  const pad = (await page.locator(".touch-seat[data-seat='1'] .touch-pad").boundingBox())!;
  await f.moveTo(1, { x: pad.x + 3, y: pad.y + 4 });
  await frames(page, 12);
  taken = await commands(page, 5);
  assert(taken.every((c) => c.up && c.left), `the pad's rounded end does not drive: ${JSON.stringify(taken.at(-1))}`);
  await f.moveTo(1, { x: pad.x + pad.width / 2, y: pad.y - 60 });
  await frames(page, 12);
  assert((await commands(page, 5)).every((c) => !c.up && !c.left), "a thumb off the pad still drives");
  await f.move(1, ".touch-pause");
  await frames(page, 12);
  assert(await phase(page) === "race", "a thumb sliding onto the pause button paused the race");
  await f.move(1, '[data-touch-zone="drive left"]');
  await frames(page, 12);
  taken = await commands(page, 5);
  assert(taken.every((c) => c.up && c.left), `a thumb back on the pad does not drive again: ${JSON.stringify(taken.at(-1))}`);
  await f.move(1, '[data-touch-zone="drive right"]');
  await f.down(2, '[data-touch-zone="nitro"]');
  await frames(page, 12);
  await shot(page, device, "race");
  taken = await commands(page, 5);
  assert(taken.every((c) => c.up && c.right && !c.left && c.nitro), `a slide right with nitro under the other thumb: ${JSON.stringify(taken.at(-1))}`);
  await f.up(2);
  await f.move(1, '[data-touch-zone="drive"]');
  await f.down(2, '[data-touch-zone="brake"]');
  await frames(page, 12);
  taken = await commands(page, 5);
  assert(taken.every((c) => c.down && !c.left && !c.right && !c.nitro), `the notch goes straight and the brake brakes: ${JSON.stringify(taken.at(-1))}`);
  await f.up(2);
  await frames(page, 12);
  assert((await commands(page, 5)).every((c) => c.up && !c.down), "a lifted brake still brakes");
  return f;
}

/** The glass pause holds the race; the card's RESUME plays it again. The
 * pause is the steering thumb's, which leaves the pad to reach it, so no
 * finger is down when RESUME is tapped: a browser makes no click of a tap
 * while another finger is held. */
async function pauseAndResume(page: Page, device: string, f: Awaited<ReturnType<typeof fingers>>) {
  await f.up(1);
  await f.tap(".touch-pause");
  await until(page, ["paused"]);
  await shot(page, device, "paused");
  await f.tap("#stk-pause-resume");
  await until(page, ["race"]);
}

/** On the keypad: ▲ ▲ makes C, ▶ moves, ▲ makes B, ▶, ▼ makes Z: CBZ. */
async function initials(page: Page, device: string, f: Awaited<ReturnType<typeof fingers>>) {
  await until(page, ["initials"], 20_000);
  assert(await visible(page, ".arena-key-up"), "the initials have no keypad");
  for (const key of ["up", "up", "right", "up", "right", "down"]) {
    await f.tap(`.arena-key-${key}`);
    await page.waitForTimeout(120);
  }
  const letters = await page.locator(".arena-initial").allInnerTexts();
  assert(letters.join("") === "CBZ", `the keypad spelled ${letters.join("")}`);
  await shot(page, device, "initials");
  await f.tap("#arena-finish-save");
  const mine = page.locator('.arena-board-row[data-mine-score="true"][data-mine-initials="true"]').first();
  await mine.waitFor({ state: "visible", timeout: 15_000 });
  assert(await mine.locator(".arena-board-initials").innerText() === "CBZ", "the board's highlighted row is not the saved initials");
  await shot(page, device, "saved");
}

async function main(): Promise<number> {
  const { chromium, devices } = await import("npm:playwright@1.61.1");
  const base = await baseUrl(APP);
  const browser = await chromium.launch({
    args: ["--ignore-certificate-errors", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-background-timer-throttling"],
  });
  let failed = 0;
  const errors: string[] = [];
  const check = async (id: string, run: () => Promise<void>) => {
    try {
      await run();
      console.log(`PASS  ${id}`);
    } catch (err) {
      failed++;
      console.log(`FAIL  ${id}\n      ${err instanceof Error ? err.message : err}`);
    }
  };
  // Each device its own context, closed whatever its check came to.
  const on = (device: Record<string, unknown>, play: (page: Page) => Promise<void>) => async () => {
    const context = await browser.newContext({ ...device, ignoreHTTPSErrors: true });
    try {
      const page = await context.newPage();
      page.on("pageerror", (err: Error) => errors.push(err.message));
      await openArena(page, base);
      await play(page);
    } finally {
      await context.close();
    }
  };

  try {
    await check("a desktop shows no touch controls and keeps its keys", on({ viewport: { width: 1440, height: 900 } }, async (page) => {
      assert(await page.locator(".screen[data-kinetic-touch]").count() === 0, "a fine pointer's screen reads as touch");
      await shows(page, ".stk-title-touch", false, "the title teaches touch on a desktop");
      await shows(page, ".stk-title-keys.keys-only", true, "the title lost its keys");
      await page.keyboard.press("Enter");
      await until(page, ["race"]);
      assert(!(await visible(page, ".touch-pad")), "a pad on a desktop");
      assert(await visible(page, "#stk-pause-btn"), "the keyboard's pause button is gone");
    }));

    // Played to its time over on the pad: the clock runs out at 75 s on the
    // first stage, and that run ranks.
    await check("a phone held flat plays a run on the pad and pedals to its time over, and saves initials on the keypad", on(devices["iPhone 15 Pro landscape"], async (page) => {
      const f = await drive(page, "phone");
      await pauseAndResume(page, "phone", f);
      await f.down(1, '[data-touch-zone="drive"]');
      await until(page, ["ended", "initials", "result"], 120_000);
      await shot(page, "phone", "time-over");
      await f.up(1);
      await initials(page, "phone", f);
    }));

    await check("a phone held upright drives, pauses, and ends a run by touch", on(devices["iPhone 15 Pro"], async (page) => {
      const f = await drive(page, "portrait");
      await pauseAndResume(page, "portrait", f);
      await replay(page, "right-fork-time-over");
      await initials(page, "portrait", f);
    }));

    await check("a tablet drives on its wider clusters, the lobby opens by touch, and a run ends by touch", on(devices["iPad Pro 11 landscape"], async (page) => {
      const f = await fingers(page);
      await f.tap("#stk-btn-lobby");
      await page.locator(".stk-lobby-card").waitFor({ state: "visible" });
      await shot(page, "tablet", "lobby");
      await f.tap("#btn-lobby-close");
      await page.locator(".stk-lobby-card").waitFor({ state: "hidden" });
      const g = await drive(page, "tablet");
      await pauseAndResume(page, "tablet", g);
      await replay(page, "right-fork-time-over");
      await initials(page, "tablet", g);
    }));

    // Regression: the duel's clusters were laid out for a landscape tablet;
    // on an upright tablet the two NITROs overlapped, and on an upright phone
    // the seats' pedals sat on each other, so the first seat could never
    // brake or fire nitro.
    for (const [name, device] of [["tablet", "iPad Pro 11 landscape"], ["tablet-upright", "iPad Pro 11"], ["phone-flat", "iPhone 15 Pro landscape"], ["phone-upright", "iPhone 15 Pro"]]) {
      await check(`a duel on one ${name.replace("-", " ")} screen: each seat's cluster stands clear of the other's, and each seat drives on its own`, on(devices[device], async (page) => {
        const f = await fingers(page);
        await f.tap("#stk-btn-duel");
        await until(page, ["race"]);
        await page.waitForFunction(() => document.querySelector(".arena-run")?.getAttribute("data-racing") === "yes", null, { timeout: 20_000 });
        const clear = await page.evaluate(() => {
          const view = { w: innerWidth, h: innerHeight };
          const seats = [1, 2].map((n) =>
            [...document.querySelectorAll(`.touch-seat[data-seat="${n}"] [data-touch-zone]`), document.querySelector(`.touch-seat[data-seat="${n}"] .touch-pad`)!]
              .map((el) => ({ el, r: el.getBoundingClientRect(), zone: el.getAttribute("data-touch-zone") }))
          );
          const meet = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          const faults: string[] = [];
          for (const a of seats[0]) for (const b of seats[1]) if (meet(a.r, b.r)) faults.push(`${a.zone ?? "pad"} meets ${b.zone ?? "pad"}`);
          for (const seat of seats) {
            const [nitro, brake, pad] = [seat.find((c) => c.zone?.startsWith("nitro"))!, seat.find((c) => c.zone?.startsWith("brake"))!, seat.at(-1)!];
            if (meet(nitro.r, brake.r) || meet(nitro.r, pad.r) || meet(brake.r, pad.r)) faults.push(`${pad.el.parentElement!.getAttribute("data-seat")}'s own controls meet`);
            for (const c of seat) {
              if (c.r.left < 0 || c.r.top < 0 || c.r.right > view.w || c.r.bottom > view.h) faults.push(`${c.zone ?? "pad"} leaves the screen`);
              if (c.zone === null) continue;
              const hit = document.elementFromPoint(c.r.left + c.r.width / 2, c.r.top + c.r.height / 2)?.closest("[data-touch-zone]");
              if (hit !== c.el) faults.push(`${c.zone} is covered`);
            }
          }
          return faults;
        });
        assert(clear.length === 0, clear.join("; "));
        await f.down(1, '[data-touch-zone="drive left"]');
        await f.down(2, '[data-touch-zone="nitro"]');
        await f.down(3, '[data-touch-zone="drive-2 right-2"]');
        await f.down(4, '[data-touch-zone="brake-2"]');
        await frames(page, 12);
        await shot(page, name, "duel");
        const one = await commands(page, 5, 0);
        const two = await commands(page, 5, 1);
        assert(one.every((c) => c.up && c.left && !c.right && c.nitro && !c.down), `the first seat: ${JSON.stringify(one.at(-1))}`);
        assert(two.every((c) => c.up && c.right && !c.left && !c.nitro && c.down), `the second seat: ${JSON.stringify(two.at(-1))}`);
        for (const id of [1, 2, 3, 4]) await f.up(id);
      }));
    }

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
