# Data tool: a table as its HTML page, and the offer page's header

| | |
|---|---|
| Dates | 2026-11-17 → (open) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent |
| Human | Mark van der Net: asked for the prototype and the offer page changes, wrote the prompts, tried the offer page in the editor, reviewed the code |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
(filled when the unit closes)

## Plan (agent output, reviewed by the human before implementation)

To test the HTML page of an offer (`products.offerPage()`) in the editor without publishing
fulfillments: run the pipeline that fills the offer table, and open the table as its HTML page
from the Data tool.

- The Data tool shows the tables of the model and of the pipeline picked next to Run (the
  editor asks for `<pipeline>/tables/*/json` too), labelled with their pipeline.
- An HTML button per table opens a tab and fills it with `<pipeline>/tables/<name>/html`, made
  by a run of its own. The tool asks the editor for that run through `runOutputs()` in
  `state/core` (registered by the editor page), so it does not need to know how a run is put
  together. The run goes after the one going on (`_runAside()`, which the Animation tool's
  parameter frames now use too); its result is not shown.

The offer page itself (`packages/core/src/products/offer-html.ts`), after the human looked at it:

- `afbeelding`: an SVG document (an iso of the house) in the header, as an image.
- The costs per category (Materiaal, Voorbewerking, ...) in the element rows only with
  `kosten: true`.
- Bouwlagen shows the number of storeys (the input counts the floors above the ground floor).

Another session has uncommitted changes in `editor.ts` and `state/core.ts` (stopping a run,
one document at a time); this work commits only its own hunks.

## Review and decisions by the human
- Asked for it as a prototype (2026-11-17), tried the offer page with it: "Ok dat ziet er best
  OK uit", then asked for the iso in the header and the phase costs out of the rows.
- Decided to commit the offer page changes together with the Data tool (2026-11-18).
- Agent checked: the offer-html unit tests (13), the editor typecheck, the HTML button in a
  headless browser against the dev editor.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
