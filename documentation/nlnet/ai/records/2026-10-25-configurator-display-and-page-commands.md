# Configurator: display options in the link, isometric for visitors, commands from the page

| | |
|---|---|
| Dates | 2026-10-25 → 2026-10-27 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent, in a session on the archiyou-sites repository (the websites that embed the configurators) |
| Human | Mark van der Net: asked for the options, chose between the proposed alternatives |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-10-25 20:35 +0100  I want to work a bit more on the configurator and its tie-in with archiyou-sites. So first, i want more configuration url parameters (to show/hide title/description box, to show/hide metrics, and to position/config the view styles. why is isometric view disabled in urbuild btw? I also want to set language of the configurator (if that was not already an option). Please add a configurator block that can easily set all this options (i think there was already such a block?). I also want you to study up on a way for buttons on the same page to set presets/params of the configurator. Can this be done with url params too? Also is there a way for the configutor iframe to save its params/presets in the address url? That way users can link to a specific state of the configurator
```

The agent answered the questions first. `?lang=` already existed. The projection toggle was not
hidden for URBUILD alone: since the mobile-first work of 2026-09-26, every published configurator
had dropped it to keep the visitor's menu small. The configurator already kept its configuration
in its own address bar, which nobody sees inside a frame. The agent then proposed a plan and asked
three multiple-choice questions (see Review).

## Plan (agent output, reviewed by the human before implementation)

### In this repository

- New link keys under `ui.`, chosen because a param name can never contain a dot:
  - `ui.header=0` and `ui.metrics=0`; the Download button stays.
  - `ui.style` and `ui.styles`: the style the viewer opens in, and the styles it offers.
  - `ui.projection=ortho` and `ui.grid=0|1`.
  - `ui.menu=bottom|top|left|right|none`.
- `?preset=Name` opens a preset, with the link's params on top. A script that has a param called
  PRESET keeps the key for that param.
- The projection (isometric) toggle comes back in the visitor's menu.
- Commands from the page around an embedded configurator:
  `{ source: 'archiyou-host', version: 1, type: 'apply', query }`, applied like a link with that
  query. They are accepted only from the parent window. `ready` lists the commands the
  configurator takes, and the changes they cause are reported with `via: 'host'`. Every event
  carries `query`, the configuration as the configurator writes it in a link.

### In archiyou-sites (not in this repository)

- The Configurator block gets a start configuration (preset, values, language) and the display
  options. A setting keeps the configuration in the page address.
- Links on the page to `?preset=…` or `?PARAM=…` send commands instead of navigating. Older
  configurators are reloaded with the configuration instead.

## Work (agent output)

- `apps/editor/src/state/configurator-display.ts`: `displayFromQuery()`, `applyDisplayFromQuery()`,
  `resetDisplay()`, `presetFromQuery()`. The published page applies them and resets them when it
  closes, so the editor's preview shows everything.
- `state/configurator-url.ts`:
  - `applyConfiguratorQuery()` applies a preset (matched case-insensitively), then the params.
    The link a configurator opens with and the page's commands both go through it.
  - `configurationQuery()` writes the configuration as a query.
  - The address bar drops `preset` once the visitor changes something; the values then say it all.
- `services/host-events.ts`: `parseHostCommand()`, `listenToHost()` (parent window only),
  `HOST_COMMANDS`; `query` on every configuration, `commands` on `ready`, `via` on `change` and
  `preset`.
- `page-configurator`:
  - Takes commands and leaves out the header (on phones a "Parameters" title stays as the sheet's
    grab area).
  - Passes the display options to the viewer and the metric bar.
  - A change made while a run is under way now gets a run of its own afterwards; before, it was
    dropped.
- `model-viewer`:
  - `initialStyle`, `initialOrtho`, `initialGrid`, `styles`, and `menu-placement` (none hides the
    menu).
  - The grid follows the style's default only when the style changes. Before, every run
    re-applied it and undid the visitor's own grid toggle.
- `viewer-menu`: offers only the given styles (no style button for one), stands upright on the
  left or right with flyouts opening away from the edge, and shows the projection toggle to
  visitors. "Switch to perspective" and "Switch to isometric" are translated into the ten
  configurator languages.
- `configurator-metric-bar`: `without-metrics`; hidden altogether when there is no download either.
- Tests:
  - `apps/editor/tests/configurator-display.test.ts` (13), and command tests in
    `host-events.test.ts`.
  - Editor suite: 126 passed (1 expected fail). UI suite: 238 passed. `typecheck:own` is clean for
    `apps/editor` and `packages/ui`.
- Checked in a browser, with the editor's dev server against the public API through a local
  read-only proxy and `exec=client`:
  - `pubtest2` with every display option and `preset=BIG`, also at phone width.
  - `strawwall` with the menu at the top and no grid.
  - `pubtest2` embedded in a page on another origin: `ready` with `commands`, then `preset`
    (SMALL) and `change` (SIZE=77) with `via: 'host'` and the right `query`.

## Review and decisions by the human

- "Position/config the view styles": chose the start style plus the styles offered, the menu
  placement, and projection plus grid. Did not choose a fixed camera angle.
- Isometric: "Always show it", over showing it only through a link option.
- Buttons on the page: the live postMessage commands, over reloading the frame with a new URL and
  over only a write-up.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | Configurator: display options in the link, commands from the page | 20:35 |
