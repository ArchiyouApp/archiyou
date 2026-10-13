# Merged component documents: every page shown, also on re-runs

| | |
|---|---|
| Dates | 2026-10-13 → 2026-10-13 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: reproduced in the editor, then a fix in three source files) |
| Human | Mark van der Net: reported the missing pages in the editor's Docs tool, asked for the fix to be committed |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

```
2026-10-13 19:04 +0200  Im testing this script: http://localhost:5173/editor/ur_house_detailed - Im checking out the merged document that has all the component spec sheets. But not all pages show up when I watch them in the editor Docs tool. Can you replicated and look for a fix?
2026-10-13 19:17 +0200  yes please commit this fix
```

## Scope (no plan: reproduce, find the cause, fix)

`ur_house_detailed` merges the docs of a floor component and four `timberwall` components
into one `project` document. The Docs tool showed fewer pages than merged, and the number
changed from run to run. Reproduced in the editor (the page labels read `---plan`, `---main`,
`--main`, `-main`, every page with layer id `layer1`) and in a unit test on one Runner.

Three causes together:

- **Name clashes dropped pages.** `Document.merge` names a merged page
  `{prefix}[{component}]-{page}`, but `Document._component` was never set, so four walls all
  gave `-main` and all but the first were skipped with a warning.
- **Merging mutated the component's document.** `$component().get('…/docs/…')` hands out the
  Documents memoised in the Runner's component result cache. `merge` renamed their pages and
  moved them into the host, so every run added a `-`, and which pages clashed shifted per run.
- **Merged pages kept their own Document**, so each took its layer id from its index there:
  all `layer1`.

Fix:

- `Page._copyTo()`: `merge` adds a copy of each page, owned by the host document; the memoised
  original is left alone. The containers are shared, so views keep resolving their pipeline
  shapes against the document they were made in.
- `Document.merge`: pages with the same name are numbered (`main`, `main2`, ...) instead of
  dropped; something that is not a Document is now really skipped (the `return` was missing).
- `RunnerComponentImporter`: a component's docs get `_component` set to the script name, so
  pages read `[timberwall]-main`, `[ur_floor_foundation]-plan`.

Test: `runner.component.test.ts` merges one component three times with different params, runs
three times on one Runner and checks the page labels, layer ids and page contents. It failed
before the fix exactly as the editor did. Core runner and docs suites pass; in the editor the
document shows all six pages, each with its own titleblock title, over repeated runs.

Noted, not changed: two identical `$component()` calls share one memoised Document, so
different `set()` values on them end up as the last one; params a component declares with
`$PARAMS.define` do not take values passed by the parent (only `script.params` do).

## Review and decisions by the human

- Reported the bug from the editor; reviewed the diagnosis and the fix, and asked for it to be
  committed.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| the commit that adds this record | Docs: fix missing pages when merging component documents | 19:04 prompt, committed on the 19:17 prompt |
