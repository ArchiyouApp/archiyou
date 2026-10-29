#!/usr/bin/env bash
#
# Build the WebAssembly package + TS bindings for gdrr2bp-wasm.
#
# Output goes to ./pkg (bundler target, matching the csgrs setup in this repo):
#   gdrr2bp_wasm.js / _bg.js / _bg.wasm / .d.ts
#
# The base64 payload in ts/gdrr2bp-wasm-binary.ts is generated from pkg/gdrr2bp_wasm_bg.wasm;
# this script regenerates it, so the two never drift apart.
#
# Requirements: rustup with the wasm32-unknown-unknown target, and wasm-pack.
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-pack
#
# Nothing in the build needs OS entropy (every run is seeded), so there is no getrandom backend
# to select.

set -euo pipefail
cd "$(dirname "$0")"

wasm-pack build --target bundler --release --out-dir pkg "$@"

# Keep the generated artifacts tracked (this repo commits its wasm blobs).
rm -f pkg/.gitignore

# wasm-pack also writes a package.json, a README and a copy of the LICENSE into --out-dir. A
# nested manifest inside a published package confuses npm about where the package boundary is,
# and none of the three is used — pkg/ is consumed through ts/BinPacker.ts, never as a package
# (the package's own LICENSE is the one that ships).
rm -f pkg/package.json pkg/README.md pkg/LICENSE

# ts/BinPacker.ts loads the module from this inlined base64, never from the .wasm file (which is
# not tracked). Same format as before: one exported template string.
node -e '
const fs = require("node:fs");
const wasm = fs.readFileSync("pkg/gdrr2bp_wasm_bg.wasm");
fs.writeFileSync("ts/gdrr2bp-wasm-binary.ts", "export const GDRR2BP_WASM_BASE64 = `" + wasm.toString("base64") + "`;");
console.log("inlined " + (wasm.length / 1024).toFixed(1) + " KB into ts/gdrr2bp-wasm-binary.ts");
'

echo "✅ Built pkg/ and ts/gdrr2bp-wasm-binary.ts. Import the wrapper from ./ts/index.ts"
