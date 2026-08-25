#!/usr/bin/env bash
#
# Build the WebAssembly package + TS bindings for gdrr2bp-wasm.
#
# Output goes to ./pkg (bundler target, matching the csgrs setup in this repo):
#   gdrr2bp_wasm.js / _bg.js / _bg.wasm / .d.ts
#
# The base64 payload in ts/gdrr2bp-wasm-binary.ts is generated from pkg/gdrr2bp_wasm_bg.wasm;
# regenerate it when the wasm changes.
#
# Requirements: rustup with the wasm32-unknown-unknown target, and wasm-pack.
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-pack
#
# The getrandom wasm backend is selected via .cargo/config.toml.

set -euo pipefail
cd "$(dirname "$0")"

wasm-pack build --target bundler --release --out-dir pkg "$@"

# Keep the generated artifacts tracked (this repo commits its wasm blobs).
rm -f pkg/.gitignore

# wasm-pack also writes a package.json and README into --out-dir. A nested manifest inside a
# published package confuses npm about where the package boundary is, and neither file is used
# — pkg/ is consumed through ts/BinPacker.ts, never as a package.
rm -f pkg/package.json pkg/README.md

echo "✅ Built pkg/. Import the wrapper from ./ts/index.ts"
