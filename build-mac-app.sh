#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"

echo "==> Ensuring 314 art-pack assets are seeded into apps/apexrun/.seed-assets..."
cd "${ROOT_DIR}"
deno eval '
import { seed } from "./apps/apexrun/services/assets/seed.ts";
const dir = "./apps/apexrun/.seed-assets";
await Deno.mkdir(dir, { recursive: true });
const manifest = JSON.parse(await Deno.readTextFile("./apps/apexrun/assets/manifest.json"));
await seed(manifest, "https://storage.googleapis.com/trash-362115-supertuxkart-assets", {
  has: (f) => Deno.stat(`${dir}/${f}`).then(() => true, () => false),
  put: (f, b) => Deno.writeFile(`${dir}/${f}`, b),
});
await Deno.copyFile("./apps/apexrun/assets/manifest.json", `${dir}/manifest.json`);
'

echo "==> Bundling 60 Hz simulation.js + pose_buffer.js + stage_gltf.js for JavaScriptCore..."
deno bundle --format iife -c apps/apexrun/tests/deno.json \
  apps/apexrun/shell/engine/native_runtime_entry.js \
  -o apps/apexrun/desktop/fixtures/apexrun_sim_bundle.js

echo "==> Refreshing deterministic coconut_beach.glb stage fixture..."
deno eval -c apps/apexrun/tests/deno.json '
import { buildStageGltf } from "./apps/apexrun/shell/engine/stage_gltf.js";
const { glb } = buildStageGltf("coconut-beach", { textureSize: 8 });
await Deno.writeFile("./apps/apexrun/desktop/fixtures/coconut_beach.glb", glb);
'

echo "==> Building release native macOS binary (AppKit + Metal + CoreAudio + JavaScriptCore)..."
cd "${ROOT_DIR}/apps/apexrun/desktop"
cargo build --release --bin apexrun-mac

APP_DIR="${ROOT_DIR}/apps/apexrun/ApexRun.app"
mkdir -p "${APP_DIR}/Contents/MacOS" "${APP_DIR}/Contents/Resources/seed-assets"
cp "${ROOT_DIR}/apps/apexrun/desktop/target/release/apexrun-mac" "${APP_DIR}/Contents/MacOS/ApexRun"
chmod +x "${APP_DIR}/Contents/MacOS/ApexRun"
if [[ ! -f "${ROOT_DIR}/apps/apexrun/.seed-assets/manifest.json" ]]; then
  echo "ERROR: ${ROOT_DIR}/apps/apexrun/.seed-assets/manifest.json is missing" >&2
  exit 1
fi
cp -R "${ROOT_DIR}/apps/apexrun/.seed-assets/." "${APP_DIR}/Contents/Resources/seed-assets/"
codesign --force --deep --sign - "${APP_DIR}"

echo "==> Built ${APP_DIR}"
echo "    Run with: open \"${APP_DIR}\""
