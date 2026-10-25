// The game boots in the browser against the stack: the arena's kinetic child
// loads its engine and sound into the cage and its presenter into its worker,
// the scene builds and frames are drawn, with no page error on the way. Unit
// tests import the renderer under mocks, and the stack's other checks never
// draw the race, so a syntax error in shell/engine/renderer.js once passed
// integrate.
//
// While it loads, nothing of the scene shows before its title card: the
// owner saw "a ghost version of the car before the controls appear". Every
// animation frame of the boot is sampled.

import { baseUrl } from "./platform.ts";
import { openArena, start } from "./arena.ts";

const APP = Deno.args[0] ?? ".";

async function main(): Promise<number> {
  const engines = await import("npm:playwright@1.61.1");
  // PW_BROWSER picks the engine (chromium by default); headless Firefox has no
  // GPU adapter on macOS, so PW_HEADED=1 opens a window.
  const name = Deno.env.get("PW_BROWSER") ?? "chromium";
  const engine = ({ chromium: engines.chromium, firefox: engines.firefox, webkit: engines.webkit })[name];
  if (!engine) throw new Error(`PW_BROWSER=${name}: not chromium, firefox or webkit`);
  const base = await baseUrl(APP);
  const headed = Deno.env.get("PW_HEADED") === "1";
  // An online duel's two tabs both play: a tab in the background would get
  // no animation frames, and its peer would wait on it.
  const browser = await engine.launch({
    headless: !headed,
    ...(name === "chromium"
      ? {
        args: [
          "--ignore-certificate-errors",
          "--disable-renderer-backgrounding",
          "--disable-backgrounding-occluded-windows",
          "--disable-background-timer-throttling",
        ],
      }
      : {}),
  });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    // A frame where the scene shows and its title card does not is a ghost.
    await context.addInitScript(() => {
      // deno-lint-ignore no-explicit-any
      const w = globalThis as any;
      w.__ghosts = 0;
      const sample = () => {
        const scene = document.querySelector(".arena-race");
        const card = document.querySelector(".stk-title-card");
        if (scene && card && Number(getComputedStyle(scene).opacity) > 0 && getComputedStyle(card).display === "none") w.__ghosts++;
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (err: Error) => errors.push(err.message));
    // A presenter that cannot start fails loudly, as a page error: the gate
    // reports it then rather than at the frame wait's timeout.
    const failed = new Promise<never>((_, reject) => page.on("pageerror", (err: Error) => reject(new Error(`page error while booting: ${err.message}`))));
    const early = page.goto(`${base}/`, { waitUntil: "domcontentloaded" }).then(() =>
      page.evaluate(() => ({
        scene: getComputedStyle(document.querySelector(".arena-race")!).opacity,
        loading: getComputedStyle(document.querySelector(".arena-loading")!).display,
      }))
    );
    const shown = await Promise.race([failed, early]);
    if (shown.scene !== "0" || shown.loading === "none") throw new Error(`the arena showed its scene before the race was ready: ${JSON.stringify(shown)}`);
    await Promise.race([failed, openArena(page, base)]);
    if (errors.length) throw new Error(`page errors while booting: ${errors.join(" | ")}`);
    // deno-lint-ignore no-explicit-any
    const ghosts = await page.evaluate(() => (globalThis as any).__ghosts);
    if (ghosts) throw new Error(`the scene showed without its title card on ${ghosts} frames`);
    const ready = await page.evaluate(() => getComputedStyle(document.querySelector(".arena-loading")!).display);
    if (ready !== "none") throw new Error("the loading line stayed up over a drawing race");
    console.log("PASS  boot: the presenter loads, the scene builds and draws behind its loading line, and no ghost");

    // The renderer is a view of the host's frames, which run backwards on a
    // seek: its worker keeps drawing across the jump. It sends nothing back,
    // so its draws are read from inside it, off Babylon's own frame counter —
    // read rather than hooked, since Firefox evaluates in a realm of its own,
    // where a hook on the worker's setTimeout counts nothing.
    const worker = page.workers().find((w) => w.url().includes("presenter.js"));
    if (!worker) throw new Error("the game runs no presenter worker");
    // deno-lint-ignore no-explicit-any
    const drawn = () => worker.evaluate(() => (globalThis as any).BABYLON.EngineStore.LastCreatedEngine.frameId as number);
    await start(page);
    await page.evaluate(() => {
      // deno-lint-ignore no-explicit-any
      const host = (document.querySelector("[data-kinetic]") as any)._prontoKinetic.host;
      for (let i = 0; i < 400; i++) host.stepTick({ up: true, enter: i === 0 });
    });
    await page.waitForTimeout(300);
    // Firefox drew the car black on a race's first frames, when the race
    // started before the car probe's light was read back (renderer.test.ts
    // "the car probe always carries a polynomial"); the frame stood while the
    // host held. The body under the riders is lit. A headless Chromium's
    // screenshot holds none of the worker's canvas, so only a window is read.
    if (headed) {
      const body = await meanColour(context, page, { x: 580, y: 525, width: 120, height: 30 });
      if (Math.max(...body) < 70) throw new Error(`the car's body drew dark at the race's start: mean ${body.map(Math.round).join(",")}`);
      console.log(`PASS  boot: the car's body is lit at the race's start (${body.map(Math.round).join(",")})`);
    }
    const before = await drawn();
    await page.evaluate(async () => {
      // deno-lint-ignore no-explicit-any
      const host = (document.querySelector("[data-kinetic]") as any)._prontoKinetic.host;
      host.seek(120);
      await new Promise((r) => setTimeout(r, 200));
      host.stepForward(30);
      await new Promise((r) => setTimeout(r, 500));
    });
    const draws = await drawn() - before;
    if (!(draws > 0)) throw new Error("the presenter drew nothing after a seek backwards");
    if (errors.length) throw new Error(`page errors across a seek backwards: ${errors.join(" | ")}`);
    console.log(`PASS  boot: the presenter keeps drawing across a seek backwards (${draws} draws)`);

    // A hot-seat duel (pronto's kinetic-machine record), chosen on the title
    // card: the first seat's car is the player's, and the card at its end
    // says who won.
    const duel = await context.newPage();
    duel.on("pageerror", (err: Error) => errors.push(err.message));
    await openArena(duel, base);
    await start(duel, "Digit2");
    const winner = await duel.evaluate(() => {
      // deno-lint-ignore no-explicit-any
      const host = (document.querySelector("[data-kinetic]") as any)._prontoKinetic.host;
      let state = host.getState();
      while (state.stageState !== "finished") state = host.stepTick([{ up: true }, { up: true, nitro: state.tick % 240 === 0 }]);
      return state.duel.winner;
    });
    await duel.locator(".stk-results-card").waitFor({ state: "visible", timeout: 15_000 });
    const title = await duel.locator(".stk-res-title").innerText();
    const expected = winner === null ? "DRAW" : winner === 0 ? "YOU WIN!" : "YOU LOSE";
    if (title !== expected) throw new Error(`the duel's card reads ${title}, not ${expected}`);
    await duel.close();
    if (errors.length) throw new Error(`page errors in a duel: ${errors.join(" | ")}`);
    console.log("PASS  boot: a hot-seat duel runs to its end and its card names the winner");
    return 0;
  } catch (err) {
    console.log(`FAIL  boot\n      ${err instanceof Error ? err.message : err}`);
    return 1;
  } finally {
    await browser.close();
  }
}

/** Each channel's mean over a clip of the page, decoded on a blank page of its own. */
// deno-lint-ignore no-explicit-any
async function meanColour(context: any, page: any, clip: { x: number; y: number; width: number; height: number }): Promise<number[]> {
  const png = (await page.screenshot({ clip })).toString("base64");
  const blank = await context.newPage();
  try {
    return await blank.evaluate(async (b64: string) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = new OffscreenCanvas(image.width, image.height);
      const g = canvas.getContext("2d")!;
      g.drawImage(image, 0, 0);
      const px = g.getImageData(0, 0, image.width, image.height).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += px[i + c];
      return sum.map((v) => v / (px.length / 4));
    }, png);
  } finally {
    await blank.close();
  }
}

Deno.exit(await main());
