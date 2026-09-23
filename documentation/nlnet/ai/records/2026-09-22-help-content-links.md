# Help content: docs-only sections and links between documents

| | |
|---|---|
| Dates | 2026-09-22 → 2026-09-23 |
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

The session also began with a question about the editor's automatic execute and one about
`:::tip` blocks; both were answered without changing code (see the decisions below).

```
2026-09-22 13:43 +0200  Can you check - looks like the automatic execute is not working?
2026-09-22 14:32 +0200  Dont change anything yet. But is there a way to show md content in the docs, but not in the help section in the editor?
2026-09-22 14:34 +0200  Implement the docs-only comment
2026-09-22 14:36 +0200  On the astro website there is a way to place tip blocks in the md with (:::tip[...]) - what is needed to use those too here? Or are there better alternatives?
2026-09-22 20:31 +0200  Can you commit the manual work on simple table tutorial. Because it is not AI make it a normal commit. Not NLnet AI disclosure.
2026-09-22 20:33 +0200  Is there a way for links to other tutorials to work inside the help tool? In simple-table.md i made a reference to simple-table-more.md
2026-09-22 20:37 +0200  ok build it
2026-09-22 20:47 +0200  Small tweak. Remove the underline from the styling of the in-help-menu links
2026-09-22 20:49 +0200  commit the docs-only and link work with the AI disclosure
2026-09-23 15:23 +0200  I git added some of the content md files. Can you commit this. Manual mode, so no AI NLNet disclosure needed
2026-09-23 15:24 +0200  yes go ahead
```

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
  stay out of these commits and committed them himself (793db78, a plain commit) together
  with the rewritten tour; the stub still fails the content test until it has a step with
  code.
- Wrote the tutorial and tour content himself; those commits (56d0175, 793db78) are plain
  commits with no disclosure block, as he asked.
- Noted during the work: the editor's automatic execute has a 20-character minimum, so a
  one-line script never runs by itself. Left as it is for now, no change made.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| c52fa75 | Help: docs-only sections in help markdown | "Implement the docs-only comment" |
| e9208a7 | Help: links between help documents | "Is there a way for links to other tutorials to work inside the help tool? … ok build it" |

Both commits also carry Mark's own aside support (`:::tip` … `:::`) in the same files,
which is not generated code. The content commits 56d0175 and 793db78 are his, plain.
