# Help content: docs-only sections and links between documents

| | |
|---|---|
| Dates | 2026-09-22 → (open) |
| Model | Claude Opus 5 (claude-opus-5[1m]), 1M context, Claude Code agent |
| Tool | Claude Code as agent (no plan mode: two small changes agreed in the session) |
| Human | Mark van der Net: wrote the prompts, chose the conventions, wrote the tutorial content and the asides support, reviewed the code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

Two additions to the help markdown that `help/` and the editor share, both asked for
while Mark was writing the simple table tutorial by hand:

1. **`docs-only` sections** — lines between `<!-- docs-only -->` and `<!-- /docs-only -->`
   are dropped by the editor's help panel and kept by the docs site, which renders an HTML
   comment as nothing. For text that only makes sense on the website, such as a link back
   into the editor.
2. **Links between help documents** — a relative or site-path link in a help file opens
   that document in the help panel instead of navigating the editor away (which would lose
   the unsaved script). Unresolvable links keep their text and lose the anchor.

## Prompts (verbatim, local time)

(filled when the unit closes)

## Plan

No separate plan. Each change was proposed in the conversation with its file list and
rough size, and Mark approved it before implementation:

- `docs-only`: comment-pair convention in `parseHelpDoc()`, 5–10 lines plus a test, no new
  files. Alternatives offered and rejected: a frontmatter flag (whole files only), an
  `editor-only` counterpart (would need a remark plugin on the docs site).
- Links: `resolveLink` in `utils/markdown.ts` mirroring the existing `resolveImage`,
  `helpDocPath()` in `state/help.ts`, one click handler in the help tool. Both link forms
  the docs site accepts are supported; a site-root path is the form to write in content.

## Review and decisions by the human

- Chose the comment-pair `docs-only` convention over a frontmatter flag, so a section of a
  file can be hidden from the editor rather than a whole file.
- Kept `:::` asides (Starlight's syntax) rather than moving the content to GitHub alert
  syntax; wrote the aside support in `utils/markdown.ts` and `help-content.ts` himself. Those
  parts of these files are his work, not generated — this record covers the `docs-only`
  parser change and the link resolution only.
- Asked for the link style in the help panel to lose its underline (kept on hover).
- Decided the follow-up tutorial stub `simple-table-more.md` and the tutorials `index.md`
  stay out of these commits; the stub still fails the content test until it has a step with
  code.
- Noted during the work: the editor's automatic execute has a 20-character minimum, so a
  one-line script never runs by itself. Left as it is for now, no change made.

## Commits

| Commit | Subject | Prompt it answers |
