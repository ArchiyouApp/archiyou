# Configurator: events for the page it is embedded in

| | |
|---|---|
| Dates | 2026-10-24 → 2026-10-25 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent, in a session on the archiyou-sites repository (the websites that embed the configurators) |
| Human | Mark van der Net: asked for analytics on the configurators, approved the plan |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-10-24 20:53 +0200  ok whats more on the plan for archiyou-sites?
2026-10-24 20:56 +0200  ok do commit first. then do analytics on configurators, thats important
```

The first prompt asked for the open items of the archiyou-sites plan; its answer listed the
configurator reporting to the page as an optional step. The plan below was then proposed and
approved with a multiple-choice question ("Yes, as planned").

## Work (agent output)

- `apps/editor/src/services/host-events.ts`: `hostMessage()` (the envelope), `metricValues()`
  (single metric values of a run: numbers, and text as the script shows it, such as a price
  "129k"; series are left out), `currentParams()` / `currentConfiguration()`, and
  `postToHost()`, a no-op outside a frame that never throws.
- `page-configurator` collects what changed between runs (a param control's name, a preset's
  name, handle drags in the viewer) and reports after each run, with the values that run was
  made with: `ready` once (with server or browser execution and the time since the frame's
  navigation started), then `preset` and `change`; `error` when a run fails. Not in the editor's
  preview. `configurator-download-menu` reports `download` after a finished download, with the
  fulfillment's authored name and formats.
- Tests: `apps/editor/tests/host-events.test.ts` (6). Editor suite 110 passed (1 expected
  fail), UI suite 238 passed; `typecheck:own` clean for `apps/editor` and `packages/ui`.
- Checked in a browser: the editor's dev server against the public API through a local
  read-only proxy, the configurator embedded in a test page on another origin, and embedded in
  the URBUILD site (archiyou-sites dev server): `ready`, every `change` with the new value,
  `download` with option, formats, all values and metrics arrived; the site counted them in
  Umami and showed them in the design's report.

## Plan (agent output, reviewed by the human before implementation)

Goal: the sites that embed configurators (archiyou-sites: library.archiyou.com, urbuild.org) can
see, per design and per site and inside campaign funnels, how many visitors saw a configurator,
changed the design and downloaded something; which parameters and presets people use; and what
they download (option, formats) with the configuration at that moment (sizes, area, price).

### In this repository: the configurator reports to the page around it

- When it runs inside a frame, the published configurator sends `postMessage` events to its
  parent: `ready` (model shown, server or browser run, load time), `change` (which parameter,
  all values and metrics), `preset`, `download` (option, formats, values, metrics) and `error`
  (the model could not be made). Tagged `source: 'archiyou-configurator', version: 1`; any
  embedding site can use them; nothing personal in them.
- Unit tests for the messages; committed with `pnpm commit:ai`.

### In archiyou-sites (not in this repository)

- The embed accepts messages only from its own frame (sender and origin checked) and turns them
  into Umami events tagged with the design: funnel steps "Saw a configurator", "Changed a design",
  "Downloaded from a configurator", "Chose a model in the wizard"; detail events for the first
  change of each parameter per visit, presets and full-screen opens.
- Campaign defaults for designs (saw → changed → downloaded), a configurator report per design in
  the admin (visitors per step, downloads per option, most-changed parameters, typical downloaded
  size, area and price), tests.

### Order and limits

- next.archiyou.com is deployed first; until then the sites receive no messages.
- The full-screen page on next.archiyou.com and embeds on other sites are not counted by the
  sites; Archiyou-wide counting would be a separate step.

## Review and decisions by the human

- Approved the plan as proposed, with the per-design report ("Yes, as planned"), over "events
  only" and over adding Archiyou-wide counting now.
- Asked first for the commit of the archiyou-sites work, then for this analytics work, as
  "important".

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | Configurator: events for the page it is embedded in | 20:56 |
