#!/usr/bin/env bash
# Thin wrapper around the real build script so `./build.sh` keeps working
# the way it does in packages/gdrr2bp-wasm.
set -euo pipefail
cd "$(dirname "$0")"
exec pnpm exec tsx buildscripts/build-wasm.ts "$@"
