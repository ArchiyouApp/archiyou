# Configurator: `?embed=1` leaves out "View source" and "Embed" inside other sites

| | |
|---|---|
| Dates | 2026-10-24 → 2026-10-24 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent, in a session on the archiyou-sites repository (the websites that embed the configurators) |
| Human | Mark van der Net: asked for the configurators to be embedded and started directly on the sites, chose hiding the buttons through a URL parameter, asked for the commit |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-10-24 20:09 +0200  Ok, as in between step i want to focus on the configurators. They need to be directly visible (not on click as it is now) - i fixed the server at next.archiyou.com to enable iframes. So please put the configator https://next.archiyou.com/configurators/archiyou/ur_house_sketch:0.4 in the urbuild website. Have it embedded and start directly
2026-10-24 20:25 +0200  yes hiding that embed/source with parameters would be nice
2026-10-24 20:51 +0200  commit to archiyou repo, develop branch
```

The first prompt was work in the archiyou-sites repository (configurators embedded and started
on page load). Its report proposed this change: an embedded configurator showed its own "View
source" and "Embed" buttons inside the host site. The second prompt asked for it.

## Work (agent output; no separate plan)

- `?embed=1` (also `?embed=true` or a bare `?embed`; `?embed=0` and no key mean the standalone
  page) is read by `isEmbedded()` in `apps/editor/src/state/configurator-url.ts`, next to the
  other things the configurator reads from its address.
- `page-published-configurator` reads it once on connect and passes `embedded` to
  `<page-configurator>`, which passes it to `<configurator-viewer-actions>`. There it makes
  `_renderPublished()` find nothing to offer, so the existing "nothing to offer, stay hidden" path
  hides the bar. The editor's Configurator Preview (`preview`) is unchanged.
- The key is not a script parameter: `decodeParamValues()` skips keys that name no param, and
  `encodeParamValues()` keeps them, so `embed=1` stays in the address when the visitor changes a
  value. Covered by two new tests in `apps/editor/tests/configurator-url.test.ts`.
- Checked: the configurator URL tests pass (20); `typecheck:own` is clean for `apps/editor` and
  `packages/ui` (the 2 errors it reports in `apps/editor` from `packages/ui` are there without
  this change too). In the browser, the editor's dev server ran against the public API through a
  local read-only proxy (the local server stack was not running): the standalone page shows
  "View source" and "Embed", with `?embed=1` the bar is hidden and `embed=1` survives a parameter
  write-back.
- The archiyou-sites frames now add `embed=1`; their "Open full screen" link does not, so that
  page keeps both buttons. Until this is deployed, next.archiyou.com ignores the unknown key.

## Review and decisions by the human

- Chose a URL parameter for hiding the buttons, after the agent proposed it.
- Accepted the change as reported and asked for the commit on `develop`.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | Configurator: ?embed=1 hides View source and Embed in other sites | 20:25, 20:51 |
