/// <reference lib="dom" />

import { openArena, start } from "./arena.ts";

export const journeys = [{
  screen: "arena",
  // deno-lint-ignore no-explicit-any
  async run(page: any, ctx: { baseUrl: string }) {
    await openArena(page, ctx.baseUrl);
    await start(page, "Enter");
  },
}];
