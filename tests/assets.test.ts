import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { manifestFiles, seed, sha256Hex } from "../services/assets/seed.ts";

const bytes = (s: string) => new TextEncoder().encode(s);

async function entry(body: string, ext: string) {
  const sha256 = await sha256Hex(bytes(body));
  return { file: `${sha256}${ext}`, sha256 };
}

/** A blob store and an origin in memory, behind one fetch. */
function fakeNet(origin: Record<string, string>, store: Map<string, Uint8Array>) {
  const puts: string[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    if (url.startsWith("store/")) {
      const file = url.slice("store/".length);
      if (init?.method === "HEAD") return new Response(null, { status: store.has(file) ? 200 : 404 });
      store.set(file, init!.body as Uint8Array);
      puts.push(file);
      return new Response(null, { status: 200 });
    }
    const body = origin[url.slice("origin/".length)];
    return body === undefined ? new Response(null, { status: 404 }) : new Response(body);
  }) as typeof fetch;
  return { fetcher, puts };
}

Deno.test("assets: the manifest's files are found at any depth, once each", async () => {
  const a = await entry("palm", ".glb");
  const b = await entry("palm lod1", ".glb");
  const files = manifestFiles({ "model/palm": { ...a, lods: [a, b] }, "model/palm-b": a });
  assertEquals([...files.keys()].sort(), [a.file, b.file].sort());
});

// A file not named by its own hash could be overwritten under the same name.
Deno.test("assets: a file not named by its sha256 is refused", () => {
  assertThrows(() => manifestFiles({ x: { file: "palm.glb", sha256: "ab" } }), Error, "not named by its sha256");
});

Deno.test("assets: the seed fetches what the store lacks and skips what it has", async () => {
  const a = await entry("rock", ".glb");
  const b = await entry("sky", ".env");
  const store = new Map([[a.file, bytes("rock")]]);
  const { fetcher, puts } = fakeNet({ [a.file]: "rock", [b.file]: "sky" }, store);
  assertEquals(await seed({ a, b }, "origin", "store", fetcher), 1);
  assertEquals(puts, [b.file]);
});

Deno.test("assets: bytes that do not hash to the manifest are never stored", async () => {
  const a = await entry("rock", ".glb");
  const store = new Map<string, Uint8Array>();
  const { fetcher } = fakeNet({ [a.file]: "tampered" }, store);
  await assertRejects(() => seed({ a }, "origin", "store", fetcher), Error, "hashes to");
  assertEquals(store.size, 0);
});
