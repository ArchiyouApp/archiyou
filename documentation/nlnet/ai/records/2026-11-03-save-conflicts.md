# Script saves without overwriting newer versions

| | |
|---|---|
| Dates | 2026-11-03 → 2026-11-16 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode) |
| Human | Mark van der Net: reported that the editor overwrote the database copy of a script with what looked like a local version, asked for the debugging, approved the fix |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-11-03 11:48 +0100  There is still a bug that overwrites the script on the database of what looks like the local version. Can you debug this?
2026-11-03 11:51 +0100  yes go ahead
2026-11-15 23:36 +0100  After i get a popup about a new version, when i chose load version the popup does not go away
```

## Diagnosis (agent output, reviewed by the human)

The history of `ur_house_sketch` in the production database shows it: on 2026-10-30 18:00 an editor save
put the code of 2026-10-24 back over five newer rows (the offer section of 2026-10-29/30). Three things
combine:

1. The editor saves without an edit. Opening a script from the local collection (`openScript()`) saves it
   to the server 0.9 s later, and so does every run in which the script sets its own param values
   (`applyManagedValues()`); the sketch writes random openings into `OPENINGS` on each run, so the server's
   "nothing changed" check never applies.
2. The local collection is refreshed from the server only on load and sign-in, and a deep link opens the
   local copy without waiting for that pull. A tab that stays open never refreshes.
3. A save does not say which version it was made from, so the server cannot see a conflict; and a save
   within 10 minutes of the latest row's creation overwrites that row in place.

## Plan (agent output, approved by the human: "yes go ahead")

1. Server: `PUT /scripts/:user/:fileId?base=<row id>`. `saveVersion()` refuses with 409 (`conflict`) when
   the latest row is not the base and its content differs from the save. Without `base` it behaves as
   before (scripts, older clients). Tests in `tests/unit/scriptStore.test.ts`.
2. Editor sync: a save sends `base` = the row id the local copy came from (`Script.id`) and takes the id
   the server returns; saves of one file go out one after the other. A 409 is a conflict: nothing is
   overwritten, the editor asks.
3. Editor: opening a script, and a run that only changes the values the script sets itself, save to the
   browser only, not to the server.
4. Editor: opening one of your own scripts first fetches its latest server version and takes it when the
   local copy has no unsaved edits.
5. Editor: a dialog for a conflict: load the saved version, or keep mine as a new version on top (the other
   one stays in the history).

## Review and decisions by the human
- Reported the overwrite on ur_house_sketch and approved the plan ("yes go ahead").
- The change of a28ee93 was undone by accident by 211ba23 (a commit of another unit that swept in an older copy of the files) and committed again as d3238c2 on 2026-11-09.
- 2026-11-15: found that the conflict dialog stayed open after "Load the saved version". Fixed in another session: the dialog was kept open by stopping every `wa-hide`, also the one its own closing sends; it now only stops a hide while there is still a conflict, and says so when the server's version could not be fetched.
- 2026-11-16: had the fix committed with the other uncommitted work of the tree.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| a28ee93 | Scripts: no save over a newer version | 11:48, 11:51 |
| d3238c2 | Scripts: no save over a newer version, again (undone by 211ba23) | 11:48, 11:51 (re-applied) |
| 895c48c | Editor: the conflict dialog closes once resolved | 2026-11-15 23:36 |
