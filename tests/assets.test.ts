import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { manifestFiles, seed, sha256Hex } from "../services/assets/seed.ts";

const bytes = (s: string) => new TextEncoder().encode(s);

async function entry(body: string, ext: string) {
  const sha256 = await sha256Hex(bytes(body));
  return { file: `${sha256}${ext}`, sha256 };
}

/** A store and an origin in memory. */
function fakeNet(origin: Record<string, string>, files: Map<string, Uint8Array>) {
  const puts: string[] = [];
  const store = {
    has: (file: string) => Promise.resolve(files.has(file)),
    put: (file: string, bytes: Uint8Array) => {
      files.set(file, bytes);
      puts.push(file);
      return Promise.resolve();
    },
  };
  const fetcher = ((url: string) => {
    const body = origin[url.slice("origin/".length)];
    return Promise.resolve(body === undefined ? new Response(null, { status: 404 }) : new Response(body));
  }) as typeof fetch;
  return { store, fetcher, puts };
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
  const { store: files, fetcher, puts } = fakeNet({ [a.file]: "rock", [b.file]: "sky" }, store);
  assertEquals(await seed({ a, b }, "origin", files, fetcher), 1);
  assertEquals(puts, [b.file]);
});

Deno.test("assets: bytes that do not hash to the manifest are never stored", async () => {
  const a = await entry("rock", ".glb");
  const store = new Map<string, Uint8Array>();
  const { store: files, fetcher } = fakeNet({ [a.file]: "tampered" }, store);
  await assertRejects(() => seed({ a }, "origin", files, fetcher), Error, "hashes to");
  assertEquals(store.size, 0);
});
