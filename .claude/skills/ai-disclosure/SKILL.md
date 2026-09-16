---
name: ai-disclosure
description: Disclose AI involvement the way NLnet's GenAI policy asks. Use whenever a plan is approved (create the record), whenever committing code the agent wrote (pnpm commit:ai with the disclosure block), and when a unit of work ends (close the record with the session's prompts). Never use Co-Authored-By trailers or claude.ai links.
---

# AI disclosure for commits and records

Archiyou is NLnet-funded. Every unit of AI-assisted work gets a **record** in
`documentation/nlnet/ai/records/` and every commit with generated code carries a
**disclosure block**. The human-readable version of this process is
`documentation/nlnet/ai/README.md`; this file is what you do.

## 1. When a plan is approved: create the record

Copy the approved plan into `documentation/nlnet/ai/records/YYYY-MM-DD-<topic>.md`
(date = when the work started, topic = short kebab-case). Skeleton:

```markdown
# <Topic>

| | |
|---|---|
| Dates | YYYY-MM-DD → (open) |
| Model | <product> (<api id>), <context>, Claude Code agent |
| Tool | Claude Code in plan mode, then as agent |
| Human | <git user.name>: wrote the prompts, reviewed plan and code, ... |
| Branch | <branch> |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes, see 3)

## Plan (agent output, reviewed by the human before implementation)
<the plan, headings demoted one level: sed 's/^#/##/'>

## Review and decisions by the human
(filled as you go)

## Commits
| Commit | Subject | Prompt it answers |
```

The `Model` row must read `<product> (<api id>), ...`, for example
`Claude Fable 5.1 (claude-fable-5-1), 1M context, Claude Code agent`. `pnpm commit:ai`
reads it. Stage the record with the first code commit. When the plan changes during the
work, change the record too.

## 2. Every commit with generated code: `pnpm commit:ai`

Never run plain `git commit` for code you wrote. Never add `Co-Authored-By` or any URL.

1. Stage exactly the files of this commit.
2. Ask the user for the one-line summary (AskUserQuestion). Offer a proposed line as the
   first option so they can accept it, but the words are theirs. Ask for an optional
   description in the same question if the change needs one.
3. Dry run, and show the printed message to the user verbatim:
   ```
   pnpm commit:ai -- --dry-run \
     --record documentation/nlnet/ai/records/<record>.md \
     --summary "<summary>" --body "<description or empty>" \
     --prompt "<the user's prompt that led to this commit>" \
     --review "<what the user checked or decided>"
   ```
   Use `--body-file <path>` for a long description.
4. On the user's approval, run the same command with `--yes` instead of `--dry-run`.

`--prompt` is the last user message that asked for this change, verbatim (shorten a long
one with `...`). For a commit you initiated inside an approved plan, use the prompt that
approved the plan and add `(plan step N)`. `--review` is one line: what the user tested,
changed or decided for this commit; `reviewed by the author` if nothing more specific.

Commits without generated code (files the user wrote, config, generated test outputs
refreshed by a test run) are ordinary `git commit`s with the plain author.

## 3. When the unit ends: close the record

1. Extract the user's prompts of the session. The session id is the folder name of your
   scratchpad directory (`/tmp/claude-<uid>/<project>/<session-id>/scratchpad`):
   ```
   python3 .claude/skills/ai-disclosure/scripts/prompts.py <session-id> [--since ISO]
   ```
   If the unit spanned several sessions, run it for each (older transcripts mention the
   plan file name: `grep -l <plan-slug> ~/.claude/projects/<project>/*.jsonl`). Paste the
   output into the `Prompts` section inside a code fence.
2. Fill `Review and decisions by the human` from the conversation: what they tested,
   corrected, rejected, decided.
3. Fill the `Commits` table (`git log --format='%h | %s' <range>`), set the end date.
4. Add a row to the `Records` table in `documentation/nlnet/ai/README.md`.
5. Commit the record update through `pnpm commit:ai` as the last commit of the unit.

## Rewriting existing commits (rare)

Only for unpushed or solo branches, with the user's explicit decision. Produce each
message with `pnpm commit:ai -- --dry-run --summary "<old subject>" --body-file <old body> ...`,
then `git commit-tree` with the original dates and the author from the dry run output,
`git update-ref` the branch, and push with `--force-with-lease`.
