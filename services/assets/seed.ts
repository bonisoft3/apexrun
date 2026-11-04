// Serves every file the art manifest names, fetched from the public origin as
// it starts and refused unless its bytes hash to the manifest's sha256.

/** Every { file, sha256 } the manifest names, however deeply nested, once each. */
export function manifestFiles(manifest: unknown): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    const { file, sha256 } = node as { file?: unknown; sha256?: unknown };
    if (typeof file === "string" && typeof sha256 === "string") {
      if (file !== `${sha256}${file.slice(file.indexOf("."))}`) throw new Error(`assets: ${file} is not named by its sha256`);
      files.set(file, sha256);
    }
    Object.values(node).forEach(walk);
  };
  walk(manifest);
  return files;
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const CONTENT_TYPES: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".env": "application/octet-stream",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
};

/** Where the files are kept: a directory, or a map in a test. */
export interface Store {
  has(file: string): Promise<boolean>;
  put(file: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
}

export async function seed(manifest: unknown, origin: string, store: Store, fetcher = fetch): Promise<number> {
  let fetched = 0;
  const pending = [...manifestFiles(manifest)];
  const worker = async () => {
    for (let next = pending.pop(); next; next = pending.pop()) {
      const [file, sha256] = next;
      if (await store.has(file)) continue;
      const got = await fetcher(`${origin}/${file}`);
      if (!got.ok) throw new Error(`assets: GET ${origin}/${file} → ${got.status}`);
      const bytes = new Uint8Array(await got.arrayBuffer());
      const actual = await sha256Hex(bytes);
      if (actual !== sha256) throw new Error(`assets: ${file} hashes to ${actual}`);
      if (!CONTENT_TYPES[file.slice(file.indexOf("."))]) throw new Error(`assets: no content type for ${file}`);
      await store.put(file, bytes);
      fetched++;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return fetched;
}

/** A file by its name, which is its content: it never changes. */
export async function answer(req: Request, dir: string): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (pathname === "/health") return new Response("ok");
  const file = pathname.startsWith("/seed-assets/") ? pathname.slice("/seed-assets/".length) : "";
  if (!/^[0-9a-f]{64}\.[a-z0-9.]+$/.test(file)) return new Response(null, { status: 404 });
  const type = CONTENT_TYPES[file.slice(file.indexOf("."))];
  if (!type) return new Response(null, { status: 404 });
  try {
    return new Response(await Deno.readFile(`${dir}/${file}`), { headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable" } });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return new Response(null, { status: 404 });
    throw e;
  }
}

if (import.meta.main) {
  const env = (name: string) => {
    const value = Deno.env.get(name);
    if (!value) throw new Error(`assets: ${name} is not set`);
    return value;
  };
  const manifest = JSON.parse(await Deno.readTextFile(env("ASSET_MANIFEST")));
  const dir = env("ASSET_DIR");
  await Deno.mkdir(dir, { recursive: true });
  const store: Store = {
    has: (file) => Deno.stat(`${dir}/${file}`).then(() => true, (e) => {
      if (e instanceof Deno.errors.NotFound) return false;
      throw e;
    }),
    // A name is its content, so a file is whole or absent, even across a crash.
    put: async (file, bytes) => {
      await Deno.writeFile(`${dir}/.${file}`, bytes);
      await Deno.rename(`${dir}/.${file}`, `${dir}/${file}`);
    },
  };
  const fetched = await seed(manifest, env("ASSET_ORIGIN"), store);
  console.log(`assets: ${manifestFiles(manifest).size} files, ${fetched} fetched`);
  Deno.serve({ port: 8787, hostname: "0.0.0.0" }, (req) => answer(req, dir));
}
