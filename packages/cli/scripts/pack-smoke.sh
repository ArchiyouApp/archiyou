#!/usr/bin/env bash
# The npx path end to end: build and pack core, meshup, the two wasm packages and the CLI the way
# publishing would, install the tarballs with npm in an empty directory, and use the CLI there.
# Hand-run, needs network for the third-party dependencies:  packages/cli/scripts/pack-smoke.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/archiyou-pack-smoke-XXXX")"
echo "work dir: $WORK"

cd "$REPO"
pnpm build:meshup > "$WORK/build.log" 2>&1
pnpm --filter @archiyou/core build >> "$WORK/build.log" 2>&1
pnpm --filter @archiyou/cli build >> "$WORK/build.log" 2>&1
for p in meshup core collada-wasm gdrr2bp-wasm cli; do
  (cd "packages/$p" && pnpm pack --pack-destination "$WORK/packs" > /dev/null)
done
ls -l "$WORK/packs" | awk 'NR > 1 { printf "  %6.1f MB  %s\n", $5 / 1e6, $9 }'

mkdir -p "$WORK/project" && cd "$WORK/project"
echo '{ "name": "smoke", "private": true }' > package.json
npm install --no-audit --no-fund --silent "$WORK"/packs/*.tgz
echo "  installed: $(du -sh node_modules | cut -f1)"

cat > plate.js <<'JS'
units('mm');
$PARAMS.define('WIDTH', 'number', { min: 100, max: 400, default: 200 });
plate = box($WIDTH, 100, 10).name('plate');
leg = box(20, 20, 200, [0, 0, -105]).name('leg');
JS

npx archiyou init
npx archiyou run plate.js -p WIDTH=300 --clash --out out | tee run.txt
grep -q 'size 300 x 100 x 210' run.txt
test -s out/views.png && test -s out/model.glb
npx archiyou run plate.js --kernel brep --views none | head -1 | grep -q '^OK'
npx archiyou api box | head -1 | grep -q '^box('
npx archiyou docs csg | head -1 | grep -q 'Constructive Solid Geometry'
grep -q 'npx @archiyou/cli' AGENTS.md
test -f .agents/skills/archiyou/SKILL.md && test -f .claude/skills/archiyou/SKILL.md
echo "pack smoke OK"
