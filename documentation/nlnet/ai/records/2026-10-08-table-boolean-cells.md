# calc.Table: boolean cell values, and an error instead of a table without rows

| | |
|---|---|
| Dates | 2026-10-08 → 2026-10-08 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a bug found while trying out a module feature) |
| Human | Mark van der Net: asked for the feature, ran his script in the editor, reported the error, had the fix made and committed |
| Branch | `agent` |
| Session transcript | kept locally; the prompts are reproduced below (the pasted script abridged) |

The session's main work was `toTables()` in the cloudcalc script module (`modules/`, the private
`archiyou-modules` repo), which is out of NLnet scope and committed there as ordinary work. This
record covers only the engine fix that work exposed.

## Prompts (verbatim, local time)
```
2026-10-08 20:28 +0200  I think the cloudcalc module needs a easier way to get the a workbook or a sheet specifically into archiyou tables. For one it could be very simple: offerWorkbook = cloudcalc.open('https://docs.google.com/spreadsheets/d/1tjYfGffEl46hx-0vt6LWizDjPIjUaVoOm23ZYgdiKWI'); offerWorkbook.import(); ==> all sheets are imported as table inside archiyou editor. What do you think?
2026-10-08 20:35 +0200  1. Well just import non-lists anyway. skip is fine. But its not a big deal when it is imported anyways. 2. Imported/toTables should imply compute with input values. So a workbook that already had a compute(inputs) method called, keep those inputs and results cached. Please warn is the user did not supply inputs, so he gets the non-computed = default ones. 3. switch to .toTables(). Yes add some row and column maxs and warn the user accordingly.
2026-10-08 20:53 +0200  I tried it with this script: "

                        <pasted_content>
                        // urhousesketch
                        // Sketch design for URHOUSE
                        [... ~640 lines of the URHOUSE model script, abridged ...]
                          offerWorkbook = cloudcalc.open('https://docs.google.com/spreadsheets/d/1tjYfGffEl46hx-0vt6LWizDjPIjUaVoOm23ZYgdiKWI');
                          offerWorkbook.toTables();
                        [... rest of the script, abridged ...]
                        </pasted_content>

                        " But error: ERROR at line 665: "Cannot read properties of undefined (reading 'map')"
2026-10-08 21:00 +0200  Yes before I go further, please commit the cloudcalc work (non NLnet), the core needs to follow it
```

## What was wrong (agent analysis)

Two tabs of the offer workbook have a checkbox column, so `calc.table()` got rows with `true` in
them. `isDataRowColumnValue()` / `isDataRowValues()` only allowed strings, numbers and falsy values;
the `Table` constructor then fell through to its "unknown data format" branch, which only logged, and
left `_dataRows` undefined. The next method (`setColumns()`) crashed with an unrelated message.

## Change

- `packages/core/src/calc/typeguards.ts`: booleans are valid cell values.
- `packages/core/src/calc/Table.ts`: data the table cannot hold throws a clear error in the
  constructor instead of producing a table without rows.
- `packages/core/tests/unit/calc/Table.test.ts`: both cases.

## Review and decisions by the human

- Reproduced the error in the editor with his URHOUSE script against the real offer workbook; the
  agent reproduced it through the core Runner and confirmed the fix there (all four tabs become tables).
- Decided the module work is committed first as non-NLnet work and the core fix follows it.
- Core unit suite: 1718 passed; `brep/Shelling.test.ts` failed once in the full parallel run and passed
  three times in isolation, with and without the change (unrelated, flaky).

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | see git log | 20:53, 21:00 |
