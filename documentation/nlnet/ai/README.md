# AI disclosure

Archiyou is funded by the [NLnet NGI0 Commons Fund](https://nlnet.nl/project/Archiyou/). NLnet's [policy on generative AI](https://nlnet.nl/foundation/policies/generativeAI/) asks that the provenance of generated code is clear per contribution: which model (with version), how it was used, the prompts and the output or a summary, kept where no login is needed and nothing disappears. This folder is that record.

How Archiyou uses AI, in short: the work is planned in the team, supported by agents. The agent writes a plan, we review it; the agent writes code and tests, we review the code, guide the standards and clarity, and test the applications. All parametric CAD scripts are hand-crafted. See also the "AI disclosure" section of the [main README](../../../README.md).

## The process

A **unit of work** is one approved plan. It gets one **record** in [`records/`](./records/) and a set of commits that point at it.

1. **Plan approval → record.** When a plan is approved, the agent copies it to `records/YYYY-MM-DD-<topic>.md` under the skeleton below and commits it with the first code commit. When the plan changes during the work, the record changes with it.
2. **Every commit that adds generated code** is made with `pnpm commit:ai` (see below). The human writes the summary; the model, prompt and record fields are filled in; the message is shown and committed only after approval. Commits without generated code (hand-written scripts, docs the human wrote, config) are ordinary commits.
3. **End of the unit → close the record.** The agent appends the verbatim prompts of the session, the review notes (what the human tested, changed, decided) and the commit table, and commits that as the last commit of the unit.
4. **Index.** The table at the bottom of this page lists every record.

For Claude Code the process is written as a project skill, [`.claude/skills/ai-disclosure/`](../../../.claude/skills/ai-disclosure/SKILL.md), which the agent applies without being told.

### Record skeleton

```markdown
# <Topic>

| | |
|---|---|
| Dates | 2026-09-14 → 2026-09-15 |
| Model | Claude Opus 5 (claude-opus-5), 1M context, Claude Code agent |
| Tool | Claude Code in plan mode, then as agent |
| Human | <name>: wrote the prompts, reviewed plan and code, tested ..., took the design decisions |
| Branch | recipe |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
## Plan (agent output, reviewed by the human before implementation)
## Review and decisions by the human
## Commits
```

The `Model` row is read by `pnpm commit:ai`: it becomes the `Model:` line of every commit, and its product name (the part before the first parenthesis) goes into the author line.

### Commit format

```
Author: Mark van der Net with Claude Opus 5 <mark@archiyou.com>

<subject: the human's summary>

<body: the human's description, optional>

Model: Claude Opus 5 (claude-opus-5), 1M context, Claude Code agent
Prompt: "<the prompt that led to this commit>"
Record: documentation/nlnet/ai/records/2026-09-14-freecad-export.md
Output: (this commit)
Review: <what the human checked or decided for this commit>
```

No co-author trailers and no links: the record in this repository is the reference, not a chat platform.

### `pnpm commit:ai`

`scripts/ai-commit.mjs`, no dependencies. After `git add`:

- **Interactive** (`pnpm commit:ai`): pick the record, type the summary and an optional description, the prompt and the review note; the full message is printed; `y` commits.
- **From an agent** (no terminal): the agent asks the human for the summary, runs `pnpm commit:ai -- --dry-run --record ... --summary ... --prompt ... --review ...`, shows the printed message, and on approval runs the same command with `--yes` instead of `--dry-run`.

The script refuses a message that contains a link or a co-author trailer, a summary over 72 characters, a missing record, and a commit with nothing staged.

## Coverage

| Work | Disclosure |
|---|---|
| From 2026-09-14 on (branch `recipe` and later) | per-unit records below, per-commit disclosure |
| Before 2026-09-14 | the general statement in the main README: code assistant until March 2026, agent after that, mainly Claude Sonnet then Opus; the public history of that period is squashed |

## Records

| Date | Topic | Model | Branch | Commits |
|---|---|---|---|---|
| 2026-09-14 | [FreeCAD export: Recipe layer and .FCStd exporter](./records/2026-09-14-freecad-export.md) | Claude Opus 5 | recipe | 5 |
| 2026-09-14 | [Configurator feedback: storage, admin overview](./records/2026-09-14-configurator-feedback.md) | Claude Opus 5 | recipe | part of 22a4393 |
| 2026-09-15 | [PNG thumbnails: background generation, viewer-rendered](./records/2026-09-15-png-thumbnails.md) | Claude Fable 5.1 | recipe | 1 |
| 2026-09-15 | [IFC4 export: automatic classification and .ifc exporter](./records/2026-09-15-ifc4-export.md) | Claude Opus 5 | recipe | part of 22a4393 |
| 2026-09-15 | [OpenSCAD export: non-parametric .scad from recipes](./records/2026-09-15-openscad-export.md) | Claude Opus 5 | recipe | part of 22a4393 |
| 2026-09-16 | [Kernel parity: cadscript bbox table, divergence inventory and brep API fixes](./records/2026-09-16-kernel-parity.md) | Claude Fable 5.1 | recipe (+ meshup develop) | 3 |
| 2026-09-16 | [Kernel parity, second unit: closing the remaining mesh ↔ brep gaps](./records/2026-09-16-kernel-gaps.md) | Claude Fable 5.1 | recipe (+ meshup develop) | 8 |
| 2026-09-17 | [Plugins cleanup: remove the editor plugin system, to be revisited with modules](./records/2026-09-17-plugins-cleanup.md) | Claude Fable 5.1 | recipe | 2 |
