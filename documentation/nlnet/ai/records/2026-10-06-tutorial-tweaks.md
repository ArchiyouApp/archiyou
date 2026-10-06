# Tutorial-related tweaks: make and docs suggestions, prepend, document placement and export

| | |
|---|---|
| Dates | 2026-10-06 → 2026-10-06 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a series of small requests while writing a tutorial) |
| Human | Mark van der Net: wrote the prompts while writing the simple-table-more tutorial, chose the behaviour of each tweak (prepend before the previous block, the 6 pt table text, the export formats, the panel widths), reviewed the work, had it committed |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-10-06 10:43 +0200  In make.partList() when no arg is given can you make it make.partList(all()) ?
2026-10-06 10:58 +0200  Can you make the codemirror suggestions work for the make module? (so when i type in make. ==> suggestions)
2026-10-06 11:12 +0200  Can you make the suggestions for make module a bit more useful by extending the tsdoc section with what are the options, and example etc.
2026-10-06 11:27 +0200  Can you implement ```js prepend <<code>>````  that prepends the code before the previous code block ?
2026-10-06 11:37 +0200  Can you implement .position('topright'), just with .pivot('topright') ?
2026-10-06 11:41 +0200  Can you make the default font size for tables smaller? Like 6pnts ?
2026-10-06 11:51 +0200  Can you make the Doc tool => Save as PDF button a drop down with the options PDF and SVG pages, SVG please? SVG pages is the format for Inkscape
2026-10-06 12:00 +0200  The drop down menu text should be xs, make the background color white
2026-10-06 12:04 +0200  A small thing, but can you make sure the help tool as a minimum width (for example 1/3 screen width?) - when openend for the first its too small
2026-10-06 12:09 +0200  Maybe a minimum width for the tool content is nice? Maybe 25% vw
2026-10-06 12:15 +0200  Can you see if the docs. codemirror suggestions work too. Bring to same quality as the make module you just did
2026-10-06 13:39 +0200  Can you do a spellingscheck on simple-table-mode.md?
2026-10-06 13:42 +0200  Now commit all work except for the simple-table-more tutorial under the title "Tutorial-related tweaks" under NLnet AI policy. Then commit the tutorial content itself as non-AI one
```

## Work (agent output; no separate plan)

- **make.partList()** without shapes lists everything in the scene, as `make.partList(all())`.
- **Editor suggestions for make.**: the completion generator reads the Make class, and `make.`
  offers its methods. The generator also carries @param, @returns and the first @example of
  every documented method, and the editor shows them in an info box (parameters, return
  value, example as code); wrapped comment lines are joined so the box reads as prose. The
  eight Make methods got their options and runnable examples written out; boarding()'s
  example uses sheets because narrow boards make its stats nesting fail (reported, not fixed).
- **Editor suggestions for docs.**: `docs.` (the name scripts use) resolved to the shape
  methods, only the older `doc.` worked; now both do, down chains and through variables.
  About 30 Document/Docs methods got their parameters, options, defaults and 13 runnable
  examples; resolveUnitSystem() is no longer offered.
- **```js prepend** in help markdown: the block goes before the code of the last run or
  append block; a run of prepends keeps its order.
- **position('topright')** reads alignment words as pivot() does, through one helper that
  also fixes 'centerbottom'/'centerleft' and capitals.
- **Tables in documents** default to 6 pt text (was 10).
- **Doc tool save menu**: PDF, SVG pages (one SVG with Inkscape pages) and SVG (a file per
  page, zipped when more, with the editor's existing zip helper); xs text on a white menu.
- **Editor layout**: the help panel opens at a third of the width (the tutorial-link layout,
  now whenever help is open); an open tool keeps at least 25vw.

The spelling check of the tutorial (13:39) changed only the tutorial, which the human
committed as their own work (see below).

## Review and decisions by the human

- Asked for each tweak while writing the tutorial, and chose the defaults: 6 pt, a third of
  the screen for help, 25vw for tools, the menu's text size and colour.
- Named the export formats and their purpose (SVG pages for Inkscape).
- Asked for the docs suggestions to match the make ones after seeing those.
- Had the work committed as one commit titled "Tutorial-related tweaks", and the tutorial
  content (text and images, with the agent's spelling fixes) as their own plain commit.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | Tutorial-related tweaks | the prompts above, 10:43 to 12:15 |
