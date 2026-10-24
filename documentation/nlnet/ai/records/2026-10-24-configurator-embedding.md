# Caddy: published configurators may be framed by other sites

| | |
|---|---|
| Dates | 2026-10-24 → 2026-10-24 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent |
| Human | Mark van der Net: reported that configurators could not be embedded, asked for the commit |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-10-24 10:35 +0200  apparently the server app doesnt allow iframes, so users cant embed their configurators ontheir own website. see next.archiyou.com
2026-10-24 11:11 +0200  yes, commit it
```

## Work (agent output; no separate plan)

- Cause: the `Caddyfile` sent `Content-Security-Policy: ... frame-ancestors 'self'` and
  `X-Frame-Options: SAMEORIGIN` on every response of next.archiyou.com, the configurator pages
  included, so the iframe from the "Embed" snippet was refused on any other site. The API
  (`apps/server/src/routes/library.ts`) already serves `/configurators/*` with helmet off, so
  nothing there needed to change.
- `/configurators/*` now gets `frame-ancestors *` and no `X-Frame-Options` (it has no value for
  "any site"). Everything else, the editor above all, keeps `frame-ancestors 'self'` and
  `X-Frame-Options: SAMEORIGIN`: a logged-in editor in a foreign frame is a clickjacking target.
- The CSP is a `(csp)` snippet with frame-ancestors as its argument, so the policy is written
  once. The two `header` blocks have disjoint matchers, so their order does not matter.
- Checked with the `caddy:2` image: `caddy validate` passes; served locally, `/` and `/editor`
  answer with `frame-ancestors 'self'` and `X-Frame-Options`, `/configurators/<user>/<script>:<version>`
  with `frame-ancestors *` and no `X-Frame-Options` (through the static fallback, as no API ran).
- Noted to the human: a framed configurator runs with partitioned storage, so an Archiyou login
  does not carry into an embed. Takes effect after a Caddy reload on the server.

## Review and decisions by the human

- Accepted the change as reported (configurator pages only, editor stays non-frameable) and
  asked for the commit.

## Commits

| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | Caddy: allow embedding published configurators | both of the above |
