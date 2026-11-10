# Fulfillment access and the configurator's events

| | |
|---|---|
| Dates | 2026-11-10 → 2026-11-10 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code in plan mode, then as agent |
| Human | Mark van der Net: wrote the prompts, chose the access kinds (email, signed-in, users, clients, access code, gating orders too), chose files in the email over a verified link, asked for one general events table and an author-only events view on the configurator, reviewed the plan |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)

```
2026-11-10 14:11 +0100  /plan When publishing a configurator and defining a fulfillment I want to add some options who can use that fulfillment. Things that I can name now: email (people should leave email and the fulfillment is email to them), loggedin (should be loged in user of archiyou), users:<specific logged user can use it> - Anything missing? Can you check what logic in server and frontend that is available already do to that. Come up with a plan.  /model fable
2026-11-10 15:35 +0100  (answers to the agent's questions) Email flow: "Files in the email". Leads: "Can you just make a general "events" table for these things and log it as email delivery of fulfillment x - later we can have authors access to events?" Extras: "My clients, Access code, Also gate product orders"
2026-11-10 19:00 +0100  (on the plan) While you are at it. Design a view on the events surrounding a configurator (requests, fulfillments) - have it accessaible in a events menu on the configurator itself. Acces through an icon to the top right (in the line of the embed, source etc) - This icon only shows when the configurator is of the author.
2026-11-10 21:37 +0100  Batch all work into commits
2026-11-10 22:41 +0100  (summary lines) Commit 1: "Server: fulfillment access, emailed files and configurator events". Commit 2: "Configurator: email, sign-in and code fulfillments; who can get it when publishing". Commit 3: "Configurator: an events view for its author"
```

## Plan (agent output, reviewed by the human before implementation)

## Fulfillment access: who can get a configurator's fulfillment

### Context

A published configurator offers fulfillments: downloads, made in the visitor's browser, and
product orders, which become a request in the author's Projects. Right now anyone can use any
fulfillment. The author wants to choose who can get one:

- **email**: the visitor leaves an address and gets the files by email;
- **signed-in**: only signed-in Archiyou users;
- **users**: only specific users;
- **clients**: only addresses in the author's Clients list;
- **code**: only visitors who type an access code.

The same rule also gates "Order product". Every gated hand-over is logged in a general
`events` table, so authors can be given access to it later.

#### What exists today

- **Schema.** `ScriptPublishedFulfillmentSchema` (`packages/core/src/ScriptSchema.ts:96`) has
  `delivery: 'anonymous download' | 'email' | 'pay'`. Only anonymous download works:
  `isFreeDownload()` (`apps/editor/src/services/fulfillment.ts:207`) blocks the other two, and
  the download menu marks them "Not available yet"
  (`packages/ui/src/configurator/configurator-download-menu.ts:106`).
- **Publish dialog.** The fulfillment editor has a Delivery select
  (`packages/ui/src/editor/publish-script-menu.ts:444`).
- **Orders.** `POST /orders` (`apps/server/src/routes/client.ts:149`) is public. It has a
  rate limit, a honeypot, the same 404 for every refusal, and a per-day cap per configurator.
  It has no access rule. This is the pattern to copy.
- **A user list already exists for shares.** `shared.onlyUsers` with
  `ScriptStore.canAccessShared()` (`apps/server/src/services/ScriptStore.ts:669`), the
  `/users/search` endpoint, and the user picker in `share-script-menu.ts:209`.
- **Server runs.** `routes/execute.ts` can run a published version server-side, but only for
  authors in `SERVER_EXECUTION_AUTHORS` or for admin-validated versions when
  `SERVER_EXECUTION_VALIDATED` is on. The worker has no sandbox, so both gates are off by
  default. The Runner can export docs as `pdf` in Node (`Runner.ts:3177`).
- **Email.** `EmailService.send()` (Mailgun) sends HTML only, with no attachments. Without a
  key it logs the message instead of sending it.
- **Events.** An `events` table exists (`apps/server/src/db/schema.ts:317`), but it is tied to
  projects: `projectId` is NOT NULL. It has `type`, `actor`, `meta`, a `visitor` hash, and a
  retention of 365 days.
- **Who is signed in.** `userState` (`apps/editor/src/state/core.ts:186`). Inside an embed
  iframe the browser partitions storage, so a signed-in user looks anonymous there.
- **The limit that shapes the design.** `GET /scripts/published/...` returns the whole script,
  including its code. A gate on a download the browser makes is therefore a convenience gate,
  not protection. Only server-made hand-overs (email and clients) and orders are actually
  enforced.

### Design

#### 1. Schema (core)

Add to `ScriptPublishedFulfillmentSchema`:

```ts
export const FULFILLMENT_ACCESS = ['anyone', 'email', 'clients', 'signed-in', 'users', 'code'] as const
access:   Type.Optional(...)                     // absent: 'anyone'; an old delivery 'email' means 'email'
users:    Type.Optional(Type.Array(Type.String())), // handles, for 'users'
code:     Type.Optional(Type.String()),          // write-only: sent on publish, never stored
codeHash: Type.Optional(Type.String()),          // server-owned
```

- `accessOf(f)` normalizes old data at read time: `delivery: 'email'` becomes access
  `'email'`. No data migration.
- `delivery` stays only for `'pay'`, which is still not built. The publish UI stops offering
  `'email'` as a delivery.

#### 2. How each access kind hands over

| access | download | product order |
|---|---|---|
| anyone | browser, as today | as today |
| email | server makes the files and emails them | as today (the form already asks for an email) |
| clients | as email, if the address is in the author's Clients | the order's email must be in the author's Clients |
| signed-in | server checks the token, then the browser downloads | token required; contact details taken from the account |
| users | as signed-in, plus the handle must be in `users` | as signed-in, plus `users` |
| code | server checks the code, then the browser downloads | code required |

#### 3. Server

**New route file `apps/server/src/routes/fulfillments.ts`, `POST /fulfillments`.**

- Body: `{ versionId, fulfillment, values?, unitSystem?, lang?, email?, code?, website? }`.
- Protections copied from `/orders`: a rate limit per IP, a per-configurator daily cap, the
  honeypot, and the same 404 for an unknown version, fulfillment or author.
- The access check is shared with `/orders` through a helper, `checkFulfillmentAccess(script,
  f, { caller, email, code })`:
  - users are compared by lowercased handle, as in `canAccessShared`;
  - clients by email, through ProjectStore;
  - the code with `timingSafeEqual` on a scrypt hash.
- **email and clients:** reply `202 { queued: true }` straight away, then in the background:
  1. make sure the version may run on the server, using a helper factored out of
     `execute.ts` (`serverRunAllowed(scriptData)`);
  2. build the run request with a second helper factored out of `execute.ts`
     (`buildExecutionRequest(...)`), checking the param values the same way;
  3. run the fulfillment's export paths through `fastify.executionManager`;
  4. turn the outputs into files, zip them when there are several, and email them.
- If the zip is over `config.fulfillmentEmail.maxBytes` (default 20 MB; Mailgun's limit is
  25 MB), or the run fails: the visitor gets an email saying it could not be made, and a
  `fulfillment.failed` event is logged.
- Duplicates: the same email, version and values within an hour are dropped.
- **signed-in, users and code:** reply `200 { granted: true }` or the same 404. The browser
  then downloads.
- **Publish-time warning:** if the version cannot run on the server, the publish dialog tells
  the author that email delivery needs admin validation. A visitor's request then fails
  politely.

**Other server changes:**

- `routes/client.ts`, `/orders`: run `checkFulfillmentAccess` before `receiveOrder`. For
  signed-in and users, the contact details come from the account.
- `EmailService`:
  - `send()` takes `attachments?: { name, data, mime }[]` and appends each to the form as a
    Blob;
  - new `sendFulfillment(to, { configurator, fulfillment, author, files })`, which says who
    the files come from;
  - the dev fallback logs attachment names and sizes.
- `ScriptStore`:
  - on publish and on in-place edit, hash `code` into `codeHash` and drop `code`. An edit
    without a new code keeps the old hash;
  - public published reads (`libraryGet`/`libraryList` for kind `'published'`, and the
    configurator page) leave out `codeHash` and `users`. The author's own routes keep
    `users`, so the author can edit the list.
- **Events, migration `0005_events_general.sql`.** Make `project_id` nullable, add
  `script_version_id` (nullable), and add an index on `(professional, created)`.
  - Types: `fulfillment.emailed`, `fulfillment.unlocked`, `fulfillment.failed`. The
    `professional` column holds the script's author.
  - Actor: `'visitor'`.
  - `meta`: `{ fulfillment, access, email?, user?, formats }`.
  - Existing project timeline queries filter by `projectId`, so they are not affected. The
    retention purge stays.
  - `@archiyou/types` gets the `ProjectEventActor` / `'visitor'` addition.

**Shared code.** Move the pure fulfillment helpers out of `apps/editor/src/services/fulfillment.ts`
into `packages/core/src/execution/fulfillment.ts`: `fulfillmentExports`, `FORMAT_META`,
`formatExtension`, `normalizeOutput`, `uniqueName`, `zipFiles` and `accessOf`. The editor
re-exports them, and the server uses them for naming and zipping.

#### 4. Publish dialog (`packages/ui/src/editor/publish-script-menu.ts`)

- **New "Who can get it" select.** It shows for both downloads and products, and offers
  Anyone, Anyone who leaves an email (files by email), My clients (by email), Signed-in
  Archiyou users, Specific users, and Anyone with an access code. The email option is hidden
  for products.
- **Specific users:** extract the share menu's picker into a `<user-picker>` component in
  `packages/ui/src/editor/` and use it in both dialogs.
- **Access code:** a text input. Once a code is saved it shows "Code set · Change".
- **Summary line:** `_renderFulfillmentRow` shows the access kind.

#### 5. Configurator (`configurator-download-menu.ts`, `configurator-order-form.ts`)

**Download menu.** A row works when its access kind can be met; `isFreeDownload` becomes
`isAvailable`.

- **email and clients:** an inline email field and a consent line naming the author. After
  sending, the row says "On its way to x@y".
- **signed-in and users:**
  - when anonymous, the row says "Sign in to download". In an embed, the sign-in link opens
    the configurator page in a new tab;
  - when signed in, the row calls `POST /fulfillments`, then `downloadFulfillment()`;
  - users who are not on the list see nothing different until they click, which then answers
    "not available for your account".
- **code:** an inline code field, then the same unlock and download.
- **Logging:** `postToHost` download events stay as they are.

**Order form.** It checks the same access kind before sending: it asks for a code, requires
sign-in, or prefills the account's email and name.

#### 6. Events view on the configurator (author only)

The author opens it from a new icon button in the configurator's top-right bar,
`configurator-viewer-actions.ts`. It sits next to "View source" and "Embed".

- **The button:**
  - `<configurator-action-button icon="activity" label="Events" toggle>`, which opens a panel
    the same way "Embed" does;
  - shown only on the published page when `!embedded` and `userState.get().id` equals the
    script's `author`, compared lowercased;
  - opening one panel closes the other.
- **Panel, new `packages/ui/src/configurator/configurator-events.ts` (`<configurator-events>`),**
  same look as the embed panel but wider, `min(520px, 100cqw - 16px)`:
  - **Summary row**, last 30 days: orders, emailed, unlocked, downloads, failed.
  - **Filter chips**: All · Orders · Fulfillments · Failed. Version: this version, or all
    versions of the file.
  - **List, newest first.** Each row has an icon, a sentence, the version tag and a relative
    time:
    - "Order *Order this table* from Jan (jan@…)", linking to the project;
    - "Changes requested on P-012";
    - "Emailed *Documents* to x@y";
    - "Unlocked *Model* for @user";
    - "Downloaded *Model*", for anonymous downloads (counted per visitor per day, like
      delivery opens);
    - "Failed: *Documents* to x@y (too large)".
  - "Load more" pages through older rows with a `before` cursor. Empty state: "Nothing yet".
- **Service:** `apps/editor/src/services/configurator-events.ts` calls
  `api.get('/scripts/configurators/:versionId/events?scope=version|file&type=&before=&limit=')`.
- **Server, in `routes/scripts.ts`:**
  - the caller must be authenticated and be the version's author, otherwise 404;
  - it queries `events` by `professional` and `script_version_id` (one version, or every
    version id of its `fileId`);
  - it returns rows and the 30-day counts;
  - `meta` is mapped to a typed `ConfiguratorEvent` in `@archiyou/types`, and the project
    label is joined for order rows.
- **What makes the events appear:**
  - The events migration also backfills `script_version_id` on existing `order.received` and
    `adjust.requested` events, from `configurations.source_version_id` through
    `configuration_id`.
  - `receiveOrder` and `receiveAdjustment` stamp it from now on.
  - Anonymous "anyone" downloads report themselves through a fire-and-forget
    `POST /fulfillments/downloaded` with `{ versionId, fulfillment, formats }`. It is rate
    limited and stores no PII, only the daily `visitorOf` hash. Previews never report.

#### 7. Tests and checks

- **Server, new `apps/server/tests/unit/fulfillments.test.ts`**, modeled on `orders.test.ts`:
  - each access kind is granted and refused;
  - refusals are the same 404;
  - honeypot, rate limit and daily cap;
  - email: the run is mocked, attachments end up in the dev log, an `events` row is written,
    and the too-large and failed paths send the failure email;
  - `codeHash` and `users` are missing from public GETs but present for the author;
  - the events endpoint returns 404 for anyone but the author, honors version/file scope and
    type filters, and the backfill links old orders;
  - the download ping is counted once per visitor per day.
- **`orders.test.ts`:** gated orders.
- **Migration:** the existing project events tests still pass.
- **Core and editor:** `apps/editor/tests/fulfillment.test.ts` follows the moved helpers, and
  `accessOf` gets tests for old data.
- **Server PDF:** check that a docs `pdf` export from the worker renders text properly in
  Node. If it doesn't, email the per-page SVGs and say so in the publish hint.
- **End to end:**
  - local dev with `SERVER_EXECUTION_VALIDATED=1`, a version validated through admin, and an
    empty Mailgun key;
  - on the configurator page, try each kind anonymously, signed in, and inside an embed;
  - for email, watch the dev log for the message and its attachments;
  - run `pnpm -s tsc --noEmit` in ui, editor and server, plus the server vitest.
- Nothing goes to the production database. Commits go through `pnpm commit:ai`, with a new
  record `documentation/nlnet/ai/records/2026-11-10-fulfillment-access.md`.

### Order of work

1. Schema, shared helpers, `accessOf`, and the events migration.
2. `POST /fulfillments`, the access helper, email attachments, `codeHash` stripping, and the
   server tests.
3. Publish dialog with `<user-picker>`.
4. Configurator download menu and order form.
5. Events endpoint, download ping, and the `<configurator-events>` panel with its icon.
6. End-to-end check. In the browser: sign in as the author to see the icon and the panel;
   signed out, or as another user, the icon is absent.

### Left open

- `pay` is still not built.
- An events view across all of an author's configurators (this plan adds one per
  configurator only).
- Configurator opens are not logged.
- Real protection for browser-made downloads: their script code is public.

## Review and decisions by the human

- Email delivery: the server makes the files and emails them (not a verified link back to the configurator), so it needs server runs for that version.
- Leads: one general `events` table, logged as "email delivery of fulfillment x"; authors get a view later.
- Extra access kinds: my clients, access code, and the same rule on product orders.
- Added before approval: an events view on the configurator itself, behind an icon in the top-right bar, shown only to the author.
- Approved the plan with that view in it; asked for the work to be committed in batches and chose the summary lines.
- Checked by the agent, not yet by the human: server tests (385), a real server run on a local in-memory database emailing a zip with a PDF (mail logged, not sent), and the configurator in the browser as a visitor (email row, wrong code, sign-in to order) and as the author (Events panel, all versions). Migration 0005 is not applied to production.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| 4afcb04 | Server: fulfillment access, emailed files and configurator events | /plan When publishing a configurator … (14:11), plan steps 1-2 |
| 9180347 | Configurator: email, sign-in and code fulfillments, set when publishing | /plan When publishing a configurator … (14:11), plan steps 3-4 |
| 278e8b7 | Configurator: an events view for its author | While you are at it. Design a view on the events … (19:00) |
