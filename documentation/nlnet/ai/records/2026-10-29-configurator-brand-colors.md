# Configurator: the colours and theme of the site around it, from its link

| | |
|---|---|
| Dates | 2026-10-27 → 2026-10-29 |
| Model | Claude Fable 5.1 (claude-fable-5-1), Claude Code agent |
| Tool | Claude Code as agent, in a session on the archiyou-sites repository (the websites that embed the configurators) |
| Human | Mark van der Net: asked for the study, confirmed the input through the link, asked for the build |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below (times not recorded) |

## Prompts (verbatim)
```
2026-10-27  Can you study up on how to add brand colors to the configurator? probably primary, secondary, accent and alert will do
2026-10-29  Cant we make these colors direct url param input of the iframe?
2026-10-29  ok build it
```

## Study (agent output, before the build)

- The configurator chrome is painted with the design tokens of `apps/editor/src/styles/design-tokens.ts`
  alone; nothing hard-codes a brand colour, so overriding the tokens restyles it fully.
- `--color-primary` paints the Download button, the primary viewer action, the hovered preset, the
  parameter tab indicator, the metric icons, the author mark and focus outlines. `--color-alert` paints
  only the feedback form. `--color-secondary` and `--color-accent` painted nothing in the
  configurator: they needed roles.
- Text on a primary fill was hard-coded white in seven rules, so a light brand colour would give
  unreadable buttons. `--color-on-primary` existed for this (the dark theme sets it) but the
  configurator did not use it.
- An embedded configurator followed the visitor's stored or OS theme (`app-shell` applies it on
  every route), and switching back re-applies the root tokens, which would wipe an override on
  `:root`.
- Proposed: four `ui.*` keys with hex values, read like the display options; a `ui.theme` key; the
  overrides on the page element; secondary for the author mark and metric icons, accent for the
  slider thumb, tab indicator and preset buttons, alert for errors.

The human asked whether the colours could be direct URL parameters of the iframe; the agent
confirmed that this was the proposal (the `ui.` prefix keeps them apart from a script's params, which
can never contain a dot) and the human asked for the build.

## Work (agent output)

- `state/configurator-display.ts`: `ui.primary`, `ui.secondary`, `ui.accent`, `ui.alert` (6-digit
  hex, `#` optional, also the short 3-digit form; anything else is no colour, `hexColor()`), and
  `ui.theme=light|dark`. `BrandColors`, `ChromeTheme`, `colors` and `theme` on the display.
- `styles/brand-colors.ts` (new): `brandColorProperties()` derives the tokens for the given colours:
  the text colour on each (white or ink by WCAG luminance, `onColor()`), lighter and darker steps and
  the Web Awesome brand scale and focus ring for primary; `--configurator-secondary`,
  `--configurator-accent`, `--configurator-on-*` exist only when a site gives that colour.
  `applyBrandColors(host)` sets them on the page element, where they reach every shadow root below and
  outlive a theme switch; `removeBrandColors()` takes them off.
- `styles/dark-theme.ts`: `overrideTheme(theme | null)`: the theme the page asks for over the
  visitor's preference, which stays stored for the editor.
- `pages/published-configurator.ts` applies the colours and theme on connect and removes them on
  disconnect, so the editor's Configurator Preview stays as it was.
- `packages/ui`: text on primary and alert fills uses `--color-on-primary` /
  `--configurator-on-alert` (header avatar, metric bar Download button, viewer action buttons, the
  feedback Send button); the author mark and metric icons take `--configurator-secondary`, the tab
  indicator, preset buttons and the native range slider `--configurator-accent`, each falling back to
  `--color-primary`, so nothing changes without a site's colours. In the dark theme, buttons now carry
  ink on the lightened primary, as `dark-theme.ts` intended.
- Tests: `apps/editor/tests/configurator-display.test.ts` (3 new), `tests/brand-colors.test.ts`
  (new, 4). Both files: 20 passed. `typecheck:own` is clean for `apps/editor` and `packages/ui`.

### In archiyou-sites (not in this repository)

- `configuratorDisplayQuery` writes the five keys; every embed (product page, Configurator block,
  Wizard) gets the site's Theme colours through `configuratorTheme()`: primary, secondary and alert as
  the theme colour where it reads as text on the page background, else the nearest readable step of
  its scale; the accent as entered; `ui.theme` dark when the page background is dark. The Theme gets
  an alert colour (also the site's `--destructive`). The full-screen link keeps the five keys and
  drops the other `ui.*` keys.

## Review and decisions by the human

- Input through the link, confirmed by the human ("direct url param input of the iframe").
- The roles of secondary and accent, the alert colour from a new Theme colour, and the full-screen
  link keeping the colours were the agent's defaults, offered for review and not objected to.
