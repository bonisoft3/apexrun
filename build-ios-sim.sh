#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DESKTOP_DIR="${SCRIPT_DIR}/desktop"
APP_BUNDLE="${SCRIPT_DIR}/ApexRun-iOS.app"
SIM_SDK="/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/SDKs/iPhoneSimulator.sdk"

echo "==> Ensuring 314 art-pack assets are seeded into apps/apexrun/.seed-assets..."
cd "${REPO_ROOT}"
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

echo "==> Building ApexRun for iOS Simulator (aarch64-apple-ios-sim)..."
cd "${DESKTOP_DIR}"
RUSTUP_BIN="$(dirname "$(rustup which cargo)")"
PATH="${RUSTUP_BIN}:${PATH}" \
DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer" \
SDKROOT="${SIM_SDK}" \
cargo build --release --target aarch64-apple-ios-sim --bin apexrun-mac

echo "==> Packaging ${APP_BUNDLE}..."
rm -rf "${APP_BUNDLE}"
mkdir -p "${APP_BUNDLE}"

cp "${DESKTOP_DIR}/target/aarch64-apple-ios-sim/release/apexrun-mac" "${APP_BUNDLE}/ApexRun"
chmod +x "${APP_BUNDLE}/ApexRun"

if [[ ! -f "${SCRIPT_DIR}/.seed-assets/manifest.json" ]]; then
    echo "ERROR: ${SCRIPT_DIR}/.seed-assets/manifest.json is missing" >&2
    exit 1
fi
cp -R "${SCRIPT_DIR}/.seed-assets" "${APP_BUNDLE}/seed-assets"

cat > "${APP_BUNDLE}/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleDisplayName</key>
    <string>Apex OutRun</string>
    <key>CFBundleExecutable</key>
    <string>ApexRun</string>
    <key>CFBundleIdentifier</key>
    <string>com.worldsense.apexrun.ios</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>ApexRun</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSRequiresIPhoneOS</key>
    <true/>
    <key>MinimumOSVersion</key>
    <string>17.0</string>
    <key>UIDeviceFamily</key>
    <array>
        <integer>1</integer>
        <integer>2</integer>
    </array>
    <key>UILaunchScreen</key>
    <dict/>
    <key>UIRequiredDeviceCapabilities</key>
    <array>
        <string>arm64</string>
        <string>metal</string>
    </array>
    <key>UIRequiresFullScreen</key>
    <true/>
    <key>UIStatusBarHidden</key>
    <true/>
    <key>UISupportedInterfaceOrientations</key>
    <array>
        <string>UIInterfaceOrientationLandscapeLeft</string>
        <string>UIInterfaceOrientationLandscapeRight</string>
    </array>
    <key>UISupportedInterfaceOrientations~ipad</key>
    <array>
        <string>UIInterfaceOrientationLandscapeLeft</string>
        <string>UIInterfaceOrientationLandscapeRight</string>
    </array>
</dict>
</plist>
EOF

codesign --force --sign - "${APP_BUNDLE}"
echo "==> Packaged ${APP_BUNDLE}"
