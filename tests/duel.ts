// An online duel in the browser against the stack: two racers, each a guest
// in a browser of their own; a fresh guest follows the challenge URL.
// The duel machine's rows carry their descriptions, and
// the race runs over a real data channel to its end card, whose result is the
// machine's. Both races lift the same milestones with the same checksums.
//
// PW_BROWSER picks the engine. WebKit offers mDNS names as its host
// candidates, which a second context does not resolve without STUN (pronto's
// kinetic-machine record), so it is skipped and says so.

import { baseUrl } from "./platform.ts";
import { openArena } from "./arena.ts";

// deno-lint-ignore no-explicit-any
type Page = any;
type Lift = { race: string; frame: number; kind: string; checksum: number };

const APP = Deno.args[0] ?? ".";
const SHOTS = Deno.env.get("DUEL_SHOTS");

const assert = (ok: boolean, msg: string) => {
  if (!ok) throw new Error(msg);
};
const attr = (page: Page, name: string) => page.evaluate((n: string) => document.querySelector(".arena-run")!.getAttribute(n), name);

async function main(): Promise<number> {
  const engines = await import("npm:playwright@1.61.1");
  const name = Deno.env.get("PW_BROWSER") ?? "chromium";
  if (name === "webkit") {
    console.log("SKIP  duel: WebKit's host candidates are mDNS names another context resolves only through STUN");
    return 0;
  }
  const engine = ({ chromium: engines.chromium, firefox: engines.firefox })[name];
  if (!engine) throw new Error(`PW_BROWSER=${name}: not chromium, firefox or webkit`);
  const base = await baseUrl(APP);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname);
  const headed = Deno.env.get("PW_HEADED") === "1";
  // Both racers' tabs play: one in the background would get no animation
  // frames, and its peer would wait on it.
  const launch = () => engine.launch({
    headless: !headed,
    ...(name === "chromium"
      ? { args: ["--ignore-certificate-errors", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-background-timer-throttling",
        // Isolated local browsers cannot rely on multicast name resolution.
        ...(local ? ["--disable-features=WebRtcHideLocalIpsWithMdns"] : []),
        ...(Deno.env.get("PW_ARGS") ?? "").split(" ").filter(Boolean)] }
      : {}),
  });
  const browsers: Awaited<ReturnType<typeof launch>>[] = [];
  const errors: string[] = [];
  const diagnostics: string[] = [];
  const pages: Page[] = [];
  const shot = async (page: Page, label: string) => {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label}.png` });
  };
  try {
    browsers.push(await launch());
    browsers.push(await launch());
    const racer = async (browser: typeof browsers[number], challenge?: string) => {
      const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
      // The race's lifted milestones, as the mount raises them.
      await context.addInitScript(() => {
        // deno-lint-ignore no-explicit-any
        const w = globalThis as any;
        w.__lifted = [];
        document.addEventListener("milestone", (e) => w.__lifted.push((e as CustomEvent).detail), true);
      });
      const page = await context.newPage();
      pages.push(page);
      page.on("pageerror", (err: Error) => errors.push(err.message));
      page.on("console", (message: { type(): string; text(): string }) => {
        if (message.type() === "error") diagnostics.push(message.text());
      });
      page.on("requestfailed", (request: { url(): string; failure(): { errorText: string } | null }) => {
        diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`);
      });
      if (challenge) {
        await page.goto(new URL(challenge, `${base}/`).href, { waitUntil: "domcontentloaded" });
      } else {
        await openArena(page, base);
        await page.click("#stk-btn-lobby");
        await page.waitForSelector('.stk-lobby-card[data-shown="show"]');
      }
      return page;
    };
    const ana = await racer(browsers[0]);
    let bia = await racer(browsers[1]);
    const callsign = (page: Page) => page.locator(".stk-lobby-you b").innerText();
    const biaName = await callsign(bia);
    await ana.click("#stage-alpine-peaks");
    // A challenge link can be opened and cancelled before challenging from the list.
    await ana.click("#btn-challenge-link");
    const linkCode = ana.locator(".stk-lobby-code");
    await linkCode.waitFor({ timeout: 30_000 });
    const linkText = await linkCode.innerText();
    assert(/^\?challenge=[0-9a-f-]{36}$/i.test(linkText), `expected ?challenge=<uuid>, got ${linkText}`);
    await ana.locator('[id^="cancel-duel-"]').click();
    await linkCode.waitFor({ state: "hidden", timeout: 30_000 });
    console.log("PASS  duel: a racer opens and cancels a challenge link in the lobby");

    const listed = ana.locator(".stk-lobby-racer", { hasText: biaName });
    await listed.waitFor({ timeout: 30_000 });
    await shot(ana, "1-lobby");
    await listed.locator("button").click();
    await bia.locator('[id^="decline-"]').waitFor({ timeout: 30_000 });
    await shot(bia, "2-challenged");
    await bia.locator('[id^="decline-"]').click();
    await ana.click("#btn-challenge-link");
    await linkCode.waitFor({ timeout: 30_000 });
    const sharedLink = await linkCode.innerText();
    await bia.context().close();
    bia = await racer(browsers[1], sharedLink);
    console.log("PASS  duel: a fresh guest opens the shared challenge URL");

    // The duel's rows carry both descriptions; the start lifts once GGRS has
    // both racers' inputs for its frame.
    for (const page of [ana, bia]) {
      await page.waitForFunction(() => document.querySelector(".arena-run")?.getAttribute("data-mode") === "online", null, { timeout: 30_000 });
      await page.waitForFunction(() => {
        const run = document.querySelector(".arena-run");
        const verdict = run?.getAttribute("data-verdict");
        if (run?.getAttribute("data-mode") !== "online") throw new Error("duel returned to an offline screen before racing");
        if (verdict === "disputed" || verdict === "abandoned") throw new Error(`duel ended before racing: ${verdict}`);
        return run?.getAttribute("data-racing") === "yes";
      }, null, { timeout: 90_000 });
    }
    assert(await attr(ana, "data-stage") === "alpine-peaks", "the duel races the challenger's stage");
    console.log("PASS  duel: both races start over the data channel the duel machine signalled");
    for (const page of [ana, bia]) await page.keyboard.down("ArrowUp");
    await ana.waitForTimeout(8000);
    await shot(ana, "3-racing-ana");
    await shot(bia, "3-racing-bia");
    for (const page of [ana, bia]) await page.waitForFunction(() => document.querySelector(".arena-run")?.getAttribute("data-phase") === "result", null, { timeout: 150_000 });
    for (const page of [ana, bia]) await page.keyboard.up("ArrowUp");
    for (const page of [ana, bia]) {
      await page.waitForFunction(() => !["", "pending"].includes(document.querySelector(".arena-run")!.getAttribute("data-verdict") ?? ""), null, { timeout: 30_000 });
    }
    await shot(ana, "4-result-ana");
    await shot(bia, "4-result-bia");
    const verdicts = [await attr(ana, "data-verdict"), await attr(bia, "data-verdict")];
    const titles = [await ana.locator(".stk-res-title").innerText(), await bia.locator(".stk-res-title").innerText()];
    const agreed = (verdicts[0] === "draw" && verdicts[1] === "draw") || (verdicts.includes("won") && verdicts.includes("lost"));
    assert(agreed, `the racers' verdicts disagree: ${verdicts.join(" / ")}`);
    assert(titles.every((t, i) => t === { won: "YOU WIN!", lost: "YOU LOSE", draw: "DRAW" }[verdicts[i]!]), `the cards read ${titles.join(" / ")} against ${verdicts.join(" / ")}`);
    console.log(`PASS  duel: both end cards show the machine's result (${verdicts.join(" / ")})`);

    const race = await ana.evaluate(() => document.querySelector("[data-kinetic]")!.getAttribute("data-prop-seed"));
    // deno-lint-ignore no-explicit-any
    const lifted = async (page: Page): Promise<Lift[]> => (await page.evaluate(() => (globalThis as any).__lifted)).filter((l: Lift) => l.race === race);
    const [a, b] = [await lifted(ana), await lifted(bia)];
    const rows = (ls: Lift[]) => ls.map((l) => `${l.frame}:${l.kind}:${l.checksum}`).join(" ");
    assert(a.some((l) => l.kind === "duel-finish"), `the race lifted no finish: ${rows(a)}`);
    assert(rows(a) === rows(b), `the races lifted different rows:\n  ${rows(a)}\n  ${rows(b)}`);
    console.log(`PASS  duel: both races lifted the same milestones and checksums (${rows(a)})`);
    assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
    console.log("PASS  duel: no page error on the way");
    return 0;
  } catch (err) {
    console.log(`FAIL  duel\n      ${err instanceof Error ? err.message : err}`);
    for (const error of errors) console.log(`      page error: ${error}`);
    for (const message of diagnostics) console.log(`      diagnostic: ${message}`);
    const snapshots = await Promise.allSettled(pages.filter((page) => !page.isClosed()).map(async (page, i) => {
      console.log(`      browser ${i}: ${await page.locator("body").innerText({ timeout: 5000 })}`);
      await shot(page, `failure-${i}`);
    }));
    for (const result of snapshots) if (result.status === "rejected") console.log(`      diagnostics failed: ${result.reason}`);
    return 1;
  } finally {
    await Promise.all(browsers.map((browser) => browser.close()));
  }
}

Deno.exit(await main());
