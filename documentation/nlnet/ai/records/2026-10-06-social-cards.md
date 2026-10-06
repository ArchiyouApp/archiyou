# Social cards for published configurators

| | |
|---|---|
| Dates | 2026-10-06 → 2026-10-06 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (options proposed in chat, stage 1 approved, then implemented) |
| Human | Mark van der Net: asked for a social card for configurator links, chose stage 1 (a card for every configurator from the stored thumbnail) before the param-specific render, reviewed the work, had it committed |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-10-06 14:50 +0200  I was looking at a configurator of mine. 
                        
                        <pasted_content id="f37c">
                        https://next.archiyou.com/configurators/archiyou/ur_house_sketch:0.2?WIDTH=5000&OPENINGS=%5B%7B%22wall%22%3A%22front%22%2C%22name%22%3A%22Frontdoor%22%2C%22width%22%3A1000%2C%22height%22%3A2150%2C%22left%22%3A2845%2C%22sill%22%3A0%7D%2C%7B%22wall%22%3A%22back%22%2C%22name%22%3A%22SlidingdoorBack%22%2C%22width%22%3A2000%2C%22height%22%3A2150%2C%22left%22%3A2345%2C%22sill%22%3A0%7D%2C%7B%22wall%22%3A%22left%22%2C%22left%22%3A691%2C%22sill%22%3A0%2C%22width%22%3A800%2C%22height%22%3A2000%7D%2C%7B%22wall%22%3A%22left%22%2C%22left%22%3A3528%2C%22sill%22%3A0%2C%22width%22%3A600%2C%22height%22%3A2000%7D%2C%7B%22wall%22%3A%22right%22%2C%22left%22%3A600%2C%22sill%22%3A0%2C%22width%22%3A600%2C%22height%22%3A2000%7D%2C%7B%22wall%22%3A%22right%22%2C%22left%22%3A2700%2C%22sill%22%3A0%2C%22width%22%3A800%2C%22height%22%3A2000%7D%5D
                        </pasted_content id="f37c">
                        
                         - Is there a way we can generate a social card or something? The real model would be great (so with param values as urlencoded), but any nice image would do.
2026-10-06 15:20 +0200  Do 1 first.
2026-10-06 21:44 +0200  Can you commit all the configurator work (translations, param switches etc)
```

## Plan (agent output, reviewed by the human before implementation)

### Context

A configurator link pasted into Slack, LinkedIn, WhatsApp or X shows nothing but "Archiyou". `/configurators/*` is the static SPA shell (`Caddyfile`: `try_files {path} /index.html`), and link crawlers do not run JavaScript. Fetched as Twitterbot, `https://next.archiyou.com/configurators/archiyou/ur_house_sketch:0.2` returns `<title>Archiyou</title>` and no `og:*` tags.

What is already there:
- Every published version has a thumbnail: a 512×512 PNG of the model at its defaults, rendered in the browser and stored by `services/ThumbnailStore.ts` (URL on the row, file under `config.thumbnails.path`).
- The configurator keeps its param values in the query string (`apps/editor/src/state/configurator-url.ts`), only values that differ from the defaults.
- Published metadata has `title`, `description` and machine translations per locale (`packages/core/src/i18n/resolve.ts`, `?lang=`).

### Stage 1 (this plan): a card for every configurator

#### 1. Shared URL codec (`packages/core/src/execution/ScriptParam.ts`)
- Move the pure half of `configurator-url.ts` into core, next to the param class: `decodeParamValues`, `encodeParamValues` and their helpers (`coerce`, `serialize`, `sameValue`, opening value, reserved keys).
- `configurator-url.ts` keeps the signals and the address bar, and re-exports the two functions, so its importers and tests are unchanged.
- Reason: the server must read a link exactly as the page does (case-insensitive names, schema checks, unreadable values ignored). Stage 2 needs the same decoding to run the script.
- About 110 lines moved, net zero.

#### 2. Server: page and card (`apps/server/src/services/SocialCard.ts`, new; routes in `routes/library.ts`)
- `GET /configurators/*`: the SPA shell (`config.social.spaIndex`, default `../editor/dist/index.html`) with meta tags injected before `</head>`:
  - `<title>`, `description`, `og:type/site_name/title/description/url/image/image:width/image:height/image:alt`, `twitter:card=summary_large_image`.
  - Title and description follow `?lang=` through `makeTranslator`. The description falls back to the script description, then to "by {author}".
  - Unknown script or bad path: the shell unchanged, 200, as Caddy serves it now. Missing shell: 503, so Caddy falls back to the static file.
  - `helmet: false` on this route, so the response carries the same headers as the static shell (Caddy adds its own).
  - `Cache-Control: no-cache`, so a rebuilt shell with new asset hashes is picked up.
- `GET /cards/:user/:scriptAndVersion.png?<params>`: a 1200×630 PNG.
  - Left: the stored thumbnail on the viewer background. Right: the Archiyou logo, the title, the description and up to six chips for the params the link sets ("Width 5000 mm", "Openings 6"), with "+N more" when there are more.
  - A chip for every param the link sets. The link only holds values a visitor changed, so they were visible to them: a behaviour can show a param that is hidden by default (the house's per-side overhangs). Labels and option names are translated; lists show their length, booleans on/off.
  - SVG composed in code, rasterised with `@resvg/resvg-js` (server only, no change to the client bundle). Text is wrapped and truncated by an estimated width, since resvg has no text measuring.
  - No thumbnail (or its file is gone): the text takes the whole width.
  - The logo is the editor's own `public/img/archiyou_logo_header.png`; a card without it is still a card.
  - In-memory LRU cache (64 cards). Crawlers cache images themselves, so nothing is written to disk and the number of param combinations cannot fill it.
  - Rate limited per IP like the other public routes that cost CPU.
- Absolute URLs: `og:url` = `FRONTEND_URL` + path + query; `og:image` = the API base (`SERVER_API_BASE_URL`, default `/api`) resolved against `FRONTEND_URL`.
- Fonts: Outfit SemiBold and Plus Jakarta Sans Regular/SemiBold as static TTFs (about 175 KB, OFL-1.1) in `apps/server/assets/fonts/`, with their licences. Recorded in `ATTRIBUTION.md`. resvg reads no WOFF/WOFF2, and the container has no system fonts.
- As built: `SocialCard.ts` 474 lines (about a third comments), routes 76, `ThumbnailStore.read()` 20, config 19; tests 264.

#### 3. Caddy (`Caddyfile`)
- `handle /configurators/*` → `reverse_proxy api:4100`, before the SPA `handle`.
- `handle_errors` for `/configurators/*` with status ≥ 502 serves `/srv/app/index.html` with `file_server { status 200 }` (without it the shell goes out as a 502), so the page keeps working when the API is down or still building.
- Checked with the caddy:2 image (v2.11.4) against the dev API: tags and security headers through the proxy, the card under `/api/cards/…`, and the 200 fallback with a dead upstream.
- A path that is not valid UTF-8 now gets Fastify's 400 instead of the shell. Caddy rejects malformed escapes itself, and no real link has one.

#### 4. Tests (`apps/server/tests/unit/socialCard.test.ts`, new)
- The page route injects escaped tags for a published script, honours `?lang=`, and leaves the shell alone for unknown scripts.
- The card route returns a 1200×630 PNG, with and without a stored thumbnail.
- The param summary (types, units, hidden params, overflow).
- The editor's `configurator-url` tests run unchanged against the moved codec.

### Stage 2 (later): the model with the link's params
For an admin-validated version whose link sets params, the card route runs the script server-side (`ExecutionManager`, output `default/model/svg` with `thumbnail`) and rasterises that drawing instead of the default thumbnail. A time budget falls back to the stage 1 card, and the configurator's copy-link action requests the card in the background so it is ready before the link is pasted.

### Not doing
- Visitors uploading a picture from their browser: the server cannot check that a PNG shows the model, so anyone could attach any image to an archiyou.com link.
- A headless Chrome on the server: about 400 MB more image, seconds and the full CAD kernel per card.

## Verification (agent)
- Unit tests: `apps/server/tests/unit/socialCard.test.ts` (17), full server suite green; the editor's `configurator-url` tests run unchanged against the codec moved to core.
- Cards rendered from the real published `ur_house_sketch:0.2` and looked at: with the link's chips, with a long description and "+4 more", and without a thumbnail.
- The Caddyfile run in the `caddy:2` image (v2.11.4) against the dev API: tags and the site's security headers through the proxy, the card under `/api/cards/…`, and the plain shell (status 200, after a fix) with the API down.
- Not deployed to next.archiyou.com in this unit.

## Review and decisions by the human
- Chose stage 1 first ("Do 1 first."); stage 2 (server render with the link's params) stays open.
- Accepted the result ("ok nice") and moved on to the configurator's translations; had it committed with the rest of the day's configurator work.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | see the git log | 14:50, approved 15:20 ("Do 1 first.") |
