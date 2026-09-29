# Script version history: browse, diff, restore

| | |
|---|---|
| Dates | 2026-09-28 → 2026-09-29 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code in plan mode, then as agent |
| Human | Mark van der Net: wrote the prompts, chose server-side merging of autosaves, restore of code + params + presets and a diff view in the first version, reviewed plan and code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-09-28 15:38 +0200  Can you check what it takes to have version tool that browser previous script versions, can revert, maybe check diffs?
2026-09-29 00:02 +0200  Go and implement versions
2026-09-29 00:13 +0200  Base directory for this skill: /tmp/claude-1000/bundled-skills/2.1.284/3e3aa8b4aebd9d8cac5a3647e933961b/run
2026-09-29 13:38 +0200  Some small UI tunes. Do you have local datetime format applied? Can you remove the buttons "vs current" and "vs previous": One would expect to always compare with the current right? (so vs. current is default). Can you also instead of "Params differ" - a readout of the difference between params?
2026-09-29 20:38 +0200  Delete the test rows and commit
2026-09-29 21:14 +0200  commit the last two things
```

## Plan (agent output, reviewed by the human before implementation)

## Script version history: browse, diff, restore

### Context

The history is already on the server. Every autosave appends a whole row to `script_versions`: `saveVersion()` in `apps/server/src/services/ScriptStore.ts:635` runs 900 ms after typing stops, and nothing is ever pruned. Two routes already exist: `GET /scripts/:user/:fileId/versions` for metadata and `…/versions/:versionId` for the full `ScriptData` (`apps/server/src/routes/scripts.ts:154-167`).

What's missing is everything else:
- The client never fetches an old version.
- There is no history UI.
- There is no diff and no restore.
- The history is far too fine-grained to browse: roughly one row per pause in typing.

Decisions you made:
1. Merge autosaves on the server, so there is about one row per 10 minutes of work.
2. Restore brings back code, params and presets.
3. The first version includes a diff view built on `@codemirror/merge`.

### 1. Server: merge autosaves into checkpoints (`ScriptStore.ts`)

- `saveVersion(author, fileId, payload, opts?: { checkpoint?: boolean })` overwrites the latest row in place, instead of appending, only when all of these hold:
  - the latest row is unversioned (`version === null`), so shared and published rows are never touched;
  - `now - latest.created < this.coalesceMs` (default 10 min). This is measured from `created`, so continuous typing still splits into rows;
  - `latest.name === data.name`. A rename must start a new row, because `resolveFileIdByName` relies on older rows to keep `$component('./oldname')` working;
  - `!opts.checkpoint`.
- When overwriting, keep `id`, `created`, `shared` and `thumbnail`, and set the content columns plus `updated = now`. Reuse `toRow()` and `db.update(...).where(eq(id))`.
- Make `coalesceMs` a public field on the class, so tests can set it to 0.
- Widen `VersionMeta` with `name` and `lines` (the code's line count, computed from the rows `fileRows` already loads). This lets the list show useful rows without fetching code.
- Route change: in `PUT /scripts/:user/:fileId`, read `?checkpoint=1` and pass it through (`routes/scripts.ts:139`).
- Estimate: about 40 lines. No migration.
- Existing dev databases keep their dense history. The UI simply lists it. A one-off thinning script is optional and not in this plan.

### 2. Client service (`apps/editor/src/services/scripts-sync.ts`)

- Add `listFileVersions(fileId): Promise<VersionMeta[]>`. Rewrite `fetchFileVersions` (:209) on top of it, keeping its current behaviour.
- Add `fetchFileVersion(fileId, versionId): Promise<ScriptData | null>`.
- Add a `{ checkpoint }` option to `syncSaveNow` (:174) so it appends `?checkpoint=1`.
- Export a `flushPendingSave()` so a restore first sends the pending debounced save. That way the state from just before the restore is kept as its own row.

### 3. State (`apps/editor/src/state/core.ts`)

- Add `restoreScriptVersion(data: ScriptData)`, next to `updateScriptCode` (:464). It will:
  - set `code`, `params` and `presets` on `editorScript`, plus `updated = now`;
  - call `saveActive()` and `saveCollection()`;
  - call `syncSaveNow({ checkpoint: true })`.
- The checkpoint flag means the restore always appears as its own entry. Undoing a restore is just restoring the previous row.
- It is not allowed for read-only or foreign scripts (`isReadOnly`).

### 4. UI: Versions tool (`packages/ui/src/editor/tools/versions-tool.ts`, new)

This is a new file, following the one-file-per-tool pattern in `tools/`. It is a `SignalWatcher(LitElement)` in the AGENTS.md order, with Allman braces and WebAwesome components.

- **Setup:**
  - Add a `TOOLS` entry in `apps/editor/src/pages/editor.ts:59`: `{ id: 'versions', icon: 'history', name: 'Versions', component: 'editor-versions-tool', width: 34, height: 60 }`, plus its import next to the other tools (:22-29).
  - On phones it opens in the bottom sheet automatically.
- **List:**
  - Newest first, grouped by day.
  - Each row shows the time, name, and line count, with a `<version-pill>` when a semver is set.
  - The newest row is marked "Current".
  - The list refetches when the tool opens, when `editorScript.fileId` changes, and after a restore. There is also a refresh button.
  - Past 100 rows, a "Show more" button appears.
- **Selecting a row:**
  - It fetches the full version, cached per id.
  - It shows a unified diff: that version against the current code, read-only. It uses `unifiedMergeView` from `@codemirror/merge`, imported with `import()` the first time the diff opens, so there is no startup cost. The theme follows the code box (one-dark or light).
  - A toggle switches between "vs current" and "vs previous version".
  - If params or presets differ, a short note says so.
- **Restore button:** fires a composed `version-restore` event with the `ScriptData`. `pages/editor.ts` handles it by calling `restoreScriptVersion`, then re-running.
  - The re-run reuses the tail of `_runHelpCode` (:462): cancel the echoed auto-run, `_whenIdle()`, then `_handleExecute()`. That tail becomes a shared private `_runNow()`.
- **Empty states:**
  - Anonymous user: "Sign in to keep version history".
  - Foreign or read-only script: "History is only available for your own scripts". The list is not shown.

### 5. Dependencies

- Add `@codemirror/merge` (^6.12) to the root `package.json` and `apps/editor/package.json`, where the other `@codemirror/*` deps are.
- It relies only on `@codemirror/state`/`view`, which are already installed.
- Bundle estimate: a lazy chunk of about 15–20 KB gzipped. The main bundle does not change.

### Size

Roughly:
- server: about 40 lines, plus about 60 lines of tests;
- sync: about 40;
- core: about 20;
- the tool: about 300;
- the page: about 30.

The new files are one tool component and one test.

### Housekeeping

- On approval:
  - open an AI disclosure record with the `ai-disclosure` skill;
  - this plan is saved as `plans/VERSIONS.md`.
- Commit with `pnpm commit:ai`.
- Leave the unused `'history'` `MenuItem` in `main-menu.ts:15` alone for now. It could be removed in a later cleanup.

### Verification

1. **Server unit tests** in `apps/server/tests/unit/scriptStore.test.ts`:
   - Set `store.coalesceMs = 0` for the existing tests.
   - Add tests showing that:
     - saves inside the window merge into one row (same `id` and `created`, newer `updated` and code);
     - a save after the window appends a row;
     - a rename appends a row, and `getFileByName(oldName)` still resolves;
     - `checkpoint` always appends;
     - shared and published rows are never overwritten;
     - `listVersions` returns `name` and `lines`.
   - Run with `pnpm --filter server test`.
2. Type-check with `tsc --noEmit` for the server, editor and ui packages.
3. **In the browser**, using the `run` skill:
   - Sign in, edit a script over a few minutes and open the Versions tool.
   - Check that the list shows checkpoints and the "Current" marker.
   - Select an older row and confirm the diff shows the changes.
   - Restore it. The code box, params and model should update, and a new top row should appear. Restore the row before that to undo.
   - Check the bottom-sheet layout at phone width.
   - Check the empty state when signed out.

### Changes to the plan during implementation (agent)

- The merge rule checks only `version`, not `published`: after publishing, the editor keeps
  `published` on its working copy, so every autosave row carries it, and a `published` guard
  would have stopped merging for every published script.
- A save whose content equals the latest row writes nothing. The editor re-saves unchanged
  content on load, which appended a row whenever the last one was older than the window.
- The tool calls `restoreScriptVersion` itself (so it knows when to refetch) and fires
  `version-restore` only for the page's re-run.
- Rows show the name only where it changes (a rename, or the first version), the last
  save time with the full span as a tooltip: the panel is ~215 px wide on desktop.
- `codebox.ts` exports `codeTheme()` so the diff uses the code box's light/dark theme.
- After review (human): the "vs current / vs previous" toggle is gone, a version is always
  compared with the current script; "Params differ" became a readout per param and preset
  (added, removed, or which fields changed, current → version). Times follow the browser
  locale, like the rest of the app.

## Review and decisions by the human
- Plan: chose server-side merging of autosaves (about one row per 10 minutes of work), restore of
  code, params and presets, and a diff view in the first version.
- Reviewed the tool in the browser, then asked for comparison with the current script only (the
  "vs current / vs previous" toggle removed), a readout per param and preset instead of "Params
  differ", and checked that times follow the local format.
- Had the test rows the agent's browser check left in the local dev database deleted, and the work
  committed with the message approved as shown.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| 2523d92 | Script version history: browse, diff and restore in a Versions tool | "Go and implement versions" / "Some small UI tunes. …" / "Delete the test rows and commit" |
| (this commit) | Close the disclosure record for script version history | "commit the last two things" |
