# @archiyou/cli

Run and check [Archiyou](https://archiyou.com) CAD scripts from the command line. Built for coding
agents (Claude Code, Codex, Cursor): they write the script, the CLI tells them what they made.

## Start

```sh
npx @archiyou/cli init
```

This puts the Archiyou skill in `.agents/skills/` and `.claude/skills/` and points `AGENTS.md` at it.
Then ask your agent, for example: "Make a parametric model of the chair in these photos."

## What a run looks like

```
$ archiyou run plate.js -p WIDTH=300 --expect 300x100x60 --clash
OK  plate.js  mesh  0.08s  units mm
size 300 x 100 x 60   min 0, 0, 0   parts 3
params WIDTH=300 TOP=true
part    type  size            volume
blockL  Mesh  40 x 100 x 50   200000
blockR  Mesh  40 x 100 x 50   200000
plate   Mesh  300 x 100 x 10  300000
print: width 300
expect ok (300 x 100 x 60)
clashes 0
files /tmp/archiyou/plate/model.glb  /tmp/archiyou/plate/views.png
```

`views.png` is a sheet of line drawings (iso, front, right, top by default), with any photos and
photo overlays first. A failing script prints `ERROR line N: message` with the lines around it and
exits 1.

## Commands

| | |
| --- | --- |
| `run <file.js>` | run a script: summary, `model.glb`, `views.png` |
| `sweep <file.js>` | the defaults and every parameter at its min and max (`--corners`: every combination); exit 1 unless all clean |
| `api <name>` | API reference: `api box`, `api Mesh.rotateX`, `api Mesh` |
| `docs [topic]` | the guide and tutorials |
| `examples [name]` | example scripts |
| `mark <photo> <marks.json>` | a photo with numbered markers, to confirm what was counted |
| `init` | add the skill to a project |
| `eval <dir>` | score solutions against an eval set |

## Options for `run` and `sweep`

| | |
| --- | --- |
| `-p NAME=value` | parameter value (repeatable) |
| `--expect WxDxH` | the size asked for; says which axis is off |
| `--clash` | parts that share volume |
| `--check <inventory.json>` | parts against an inventory: counts, axes, floor contact, relations |
| `--views ...` | `iso,front,left,top,cam:x,y,z`, `around` (eight directions), `none` |
| `--ref <photo>` | a photo on the sheet (PNG, JPEG) |
| `--overlay <photo>@<view>@x0,y0,x1,y1` | the model drawn over a photo, fitted into the object's rectangle |
| `--kernel mesh\|brep` | default `mesh` |
| `--out <dir>` | default `<tmp>/archiyou/<name>/` |
| `--json` | everything as one JSON object |

A view is a camera direction from the model, z up: `front` = `cam:0,-1,0`, `left` = `cam:-1,0,0`,
`top` = `cam:0,0,1`, `iso` = `cam:-1,-1,1`.

## Good to know

- Node 22 or later.
- `run` executes the script with your user's rights, like any code your agent runs.
- Results go to stdout, problems with the command to stderr.

## Development

In the Archiyou repo: `pnpm build:meshup` once, then `pnpm -s archiyou <command>`. Tests:
`pnpm --filter @archiyou/cli test`; the npx path end to end: `packages/cli/scripts/pack-smoke.sh`.

Apache-2.0. Includes the font Plus Jakarta Sans (SIL Open Font License).
