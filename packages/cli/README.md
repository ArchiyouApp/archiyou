# @archiyou/cli

Run, check and look up [Archiyou](https://archiyou.com) CAD scripts from the command line. It is the
harness a coding agent (Claude Code, Codex, Cursor, ...) needs to model with Archiyou: run a script
headless, read a compact summary, look at line drawings and photo overlays, check for clashes and
against an inventory of parts, sweep the parameters, and look up the API and guide.

```sh
npx @archiyou/cli init          # puts the Archiyou skill in this project for your agent
```

Then ask your agent, in this folder, for what you want to model: "I have some sketches and photos here,
make me a parametric model." The skill tells it how to write the script and check it with this CLI.

## Commands

| Command | |
| --- | --- |
| `init` | write the skill to `.agents/skills/archiyou/` and `.claude/skills/archiyou/`, and a block in `AGENTS.md` |
| `run <file.js>` | run a script: summary on stdout, `model.glb` and `views.png` in `--out` |
| `sweep <file.js>` | run the defaults and every parameter at its extremes (`--corners`: every combination); exit 1 unless every run is clean |
| `api <name>` | the API reference: `api box`, `api Mesh.rotateAround`, `api Mesh` (all members) |
| `docs [topic]` | the guide and tutorials as Markdown |
| `examples [name]` | example scripts |
| `mark <photo> <marks.json>` | a photo with numbered markers and a legend (`--out dir`) |
| `eval <dir>` | score solutions against an eval set (`--evals file`) |

Options of `run` (most also work for `sweep`):

| Option | |
| --- | --- |
| `-p NAME=value` | a parameter value, repeatable |
| `--views iso,front,right,top,cam:x,y,z` | the views on the sheet (`none` for none, `around` for eight directions to match a photo); front, side and top share one scale. A view is a camera direction from the model, z up: `front` = `cam:0,-1,0`, `left` = `cam:-1,0,0`, `top` = `cam:0,0,1`, `iso` = `cam:-1,-1,1` |
| `--ref <photo>` | a photo on the sheet (PNG, JPEG), repeatable |
| `--overlay <photo>@<view>@x0,y0,x1,y1` | the model drawn over a photo, fitted into the object's rectangle in it (fractions or pixels); also written full size |
| `--expect WxDxH` | the size asked for: a line naming the axis that is off |
| `--clash` | parts that share volume (touching does not count) |
| `--check <inventory.json>` | the parts against an inventory: counts, axes, floor contact, relations |
| `--kernel mesh\|brep` | default `mesh` |
| `--out <dir>` | default `<tmp>/archiyou/<name>/` |
| `--json`, `--parts`, `--verbose` | one JSON object; every part of a large model; core's logging on stderr |

Results go to stdout, problems with the command to stderr; a script that fails exits with 1.

`run` executes the script in-process with the rights of your user, like any code your agent runs.

Requires Node 22 or later.

## Development (in the Archiyou repo)

```sh
pnpm build:meshup                         # once: the mesh kernel from its built dist/
pnpm -s archiyou run packages/core/tests/cadscripts/scripts/programmaticparams.js
pnpm --filter @archiyou/cli test          # the CLI as a subprocess, from source
packages/cli/scripts/pack-smoke.sh        # pack, install in an empty folder, run (needs network)
```

From source the CLI runs through tsx with `tsconfig.runtime.json`; the published build imports the Node
build of `@archiyou/core`. The eval set is in `evals/` (not published); see its `evals.json`.

License: Apache-2.0. The bundled font Plus Jakarta Sans is under the SIL Open Font License.
