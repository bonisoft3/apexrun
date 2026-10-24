// Fills the blob store with every file the art manifest names, fetched from
// the public origin and refused unless its bytes hash to the manifest's sha256.

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

export async function seed(manifest: unknown, origin: string, store: string, fetcher = fetch): Promise<number> {
  let fetched = 0;
  const pending = [...manifestFiles(manifest)];
  const worker = async () => {
    for (let next = pending.pop(); next; next = pending.pop()) {
      const [file, sha256] = next;
      const head = await fetcher(`${store}/${file}`, { method: "HEAD" });
      if (head.ok) continue;
      if (head.status !== 404) throw new Error(`assets: HEAD ${file} → ${head.status}`);
      const got = await fetcher(`${origin}/${file}`);
      if (!got.ok) throw new Error(`assets: GET ${origin}/${file} → ${got.status}`);
      const bytes = new Uint8Array(await got.arrayBuffer());
      const actual = await sha256Hex(bytes);
      if (actual !== sha256) throw new Error(`assets: ${file} hashes to ${actual}`);
      const type = CONTENT_TYPES[file.slice(file.indexOf("."))];
      if (!type) throw new Error(`assets: no content type for ${file}`);
      const put = await fetcher(`${store}/${file}`, { method: "PUT", body: bytes, headers: { "content-type": type } });
      if (!put.ok) throw new Error(`assets: PUT ${file} → ${put.status} ${await put.text()}`);
      fetched++;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return fetched;
}

if (import.meta.main) {
  const env = (name: string) => {
    const value = Deno.env.get(name);
    if (!value) throw new Error(`assets: ${name} is not set`);
    return value;
  };
  const manifest = JSON.parse(await Deno.readTextFile(env("ASSET_MANIFEST")));
  // No pooled connections: rclone drops idle ones, and a PUT sent down a
  // dropped one fails as "client error (SendRequest)".
  const client = Deno.createHttpClient({ poolMaxIdlePerHost: 0 });
  const fetcher = ((url: string, init?: RequestInit) => fetch(url, { ...init, client })) as typeof fetch;
  const fetched = await seed(manifest, env("ASSET_ORIGIN"), env("BLOB_STORE"), fetcher);
  client.close();
  console.log(`assets: ${manifestFiles(manifest).size} files in the store, ${fetched} fetched`);
}
