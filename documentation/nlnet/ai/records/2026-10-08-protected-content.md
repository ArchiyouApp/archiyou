# Protected content: a Keys menu in the editor, and cloudcalc in the browser

| | |
|---|---|
| Dates | 2026-10-08 → (open: grants, phase 3) |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code in plan mode, then as agent |
| Human | Mark van der Net: wrote the prompts, took the plan's five decisions, reviewed the Keys menu in the browser and asked for its tweaks, redesigned `copy()` into `cloudcopy()`, had it committed |
| Branch | `keys` |
| Session transcript | kept locally; the prompts are reproduced in full below |

The cloudcalc module itself lives in `modules/` (the private `archiyou-modules` repo). It is out of
NLnet scope and committed there as ordinary work. This record covers the engine, module SDK, server
and editor side. The cloudcopy wait that followed on 2026-10-09 has its own record,
[2026-10-09-cloudcopy-wait](./2026-10-09-cloudcopy-wait.md); its code is in the same commit, because
both sessions changed the same files.

## Prompts (verbatim, local time)

The session started with spreadsheet work outside this repository (2026-10-08 10:48–15:24: reading
and restructuring Google Sheets, the cloudcalc rate limit); the prompts below are the ones that led
to this plan and its implementation.

```
2026-10-08 18:16 +0200  yeah I already though the cache was client-side too?
2026-10-08 18:25 +0200  Can you make clear the design, client versus server side on these modules? For now I think it should always be clientside for now
2026-10-08 20:20 +0200  For 1. I feel that we should be able to enable confidential content for a specific user. This would need a secrets manager for a client in the editor. This could be local storage right? Optional the user can chose to save the key inside the archiyou database (of course end2end encrypted) Then if the user want to publish a configurator without giving access to the source content to the users, the only way is to enable server-side execution and granting archiyou the rights to use the secret to get specific content. Maybe using an equivant of a configurator-specific key to unlock the secret? I think we should focus on simple access, getting the protect content. Now more complicated use like using protected API's etc. For good admin I think we should flag a secret in a script to make users and ourselves aware. A central secretManager could centralize logging, maintain rights and requist access to protected content using the keys/tokens. Please research /plan
2026-10-08 20:47 +0200  I think its more scalable to just manage API keys, so a menu where to say: Google Service account => JSON, but also other (AI) API keys. Not the Google Oauth thing.
2026-10-08 21:32 +0200  ok for the decisions: 1. yes the same rule for bundles on the authors entitlement. 2. retire server compute directly. 3. ok 4. Remove the operator service account entirely. 5. ok
2026-10-08 21:38 +0200  Ok start the implementation of the plan. Please work in branch "keys"
2026-10-08 22:55 +0200  Just a couple of tweaks first: For adding different keys use a dropdown with a <Add> button next to it. Not the list. The description should be more clear: "With keys you can access content that is not public. A script only refers to a key, never reads it. They also remain on your browser and are not uploaded to Archiyou unless you grant rights to a public configurator to use them". In the key details menu. "Use when a script names no key" => "Use as default key for Google". Please remove the small text underneath ("Stored in the browser..."). After typing in a key (or JSON) there appears a blue info (/hint/config) box. Its ugly and almost unreadable. Please make it xs text, primary color border, with a icon more like hint or settings icon. Please open the menu in the browser to check for consistency. For example the cancel button should be more like other buttons in the editor.  When added a key, the replace/remove buttons are too big. Make small text.
2026-10-08 23:05 +0200  There is a bubbling click event that closes the keys window too soon. Try again to open
2026-10-08 23:16 +0200  please continue the work on copy(), private sheet badge (maybe just key active).
2026-10-09 10:13 +0200  Lets redesign copy() a bit. First I think copy() is too generic. Call it cloudcopy() please. And it should take the input from earlier compute() or fill(), keep the options but remove the folder, for easy management. so it should be cloudcopy({ options }) - please make a good TSdoc entry to explain options and make sure autosuggestions work. To avoid saves on every run please dont do the button etc. In the editor just check earlier saves, if input is the same block immediately without any warning, if inputs are different and block everything with a clear warning. Make a options flag "force" to force a save anyway.
```

## Plan (agent output, reviewed by the human before implementation)

## Protected content — a key manager in the editor, configurator grants, and cloudcalc in the browser

*Scripts need content that is not public: a private Google Sheet with prices and margins. This plan
moves cloudcalc's computation into the browser, gives the editor one menu where a user keeps their
keys — a Google service account, AI provider keys, other API keys — and lets an author publish a
configurator on protected content without handing that content, or the key, to its visitors.*

Companion to [`SECRETS.md`](SECRETS.md) (credentials, server side) and [`CO_AI.md`](CO_AI.md) (AI
keys in the browser). It keeps SECRETS.md's Model B, its `secretHandler`, its audit design and its one
rule (§4 there). It changes one thing: a user's *own* key may live in their own editor's main thread,
as CO_AI.md §6 already allows for AI keys. §3 states exactly what moves.

**Decisions, 2026-10-08:**

- Credentials are **keys the user brings and manages** — a service-account JSON for Google, an API key
  for everything else — in one menu. Not per-source OAuth flows: one mechanism that scales to every
  source and provider, and no Archiyou app to register, verify and keep alive with Google. §2.2 records
  what that trades away.
- **Server compute is retired at once**, and **the operator's service account is removed entirely**.
  Together they leave cloudcalc nothing to do on the server: it becomes a **client module**
  (`runtime: 'client'`), and the server's part in protected content moves to `secretHandler` (§8).
  §12 lists everything that goes with it, including `copy()`.
- A published script's module bundles are served on the **author's** entitlement, the rule server-side
  runs already follow (§12.1).

### Context

1. **cloudcalc computes on the server, and that does not scale with the editor.** The editor re-runs a
   script on every edit and every parameter tick (`apps/editor/src/pages/editor.ts:505-513`, 50 ms
   debounce). Each run cost `open()` + `compute()` — two calls to `POST /modules/:id/call`, which is
   rate-limited at 60 per minute per IP (`apps/server/src/config.ts:214`). Dragging a slider that feeds
   a sheet hit the limit within seconds. A client-side result cache now absorbs repeated inputs
   (`modules/archiyou-modules/cloudcalc/src/client/index.ts:93`), but every new input is still a round
   trip. formualizer runs in browsers; nothing *requires* the computation to be on the server.
2. **The only reason it has to stay there is access** — and access needs a key only to *fetch*, never
   to *compute*.
3. **Confidential content per user.** An author wants to use their own private sheet, and to publish a
   configurator built on it without its visitors being able to read the sheet.

Intended outcome:

- Public sheets: computed entirely in the browser — no server call, no rate limit, works for a
  configurator's anonymous visitor (bundles served on the author's entitlement, §12.1).
- A user's own private sheets: fetched by the editor with the user's own service-account key,
  computed in the browser. The key never enters a script.
- A published configurator on private content: runs server-side with a copy of the key the author
  released to *that configurator only*; visitors see outputs, never the sheet or the key.
- AI provider keys live in the same menu, used by the AI assist (CO_AI.md) exactly as that plan says.
- Every script that uses protected content says so — to its author, to an admin validating it, and
  to the operator.

Scope: **getting protected content**, plus storing AI keys. Calling protected APIs from scripts
(`$api`, the credentialed proxy) stays as designed in SECRETS.md §7.2 and is not part of this plan,
though the menu is built so that it can serve it later.

---

### 1. Vocabulary

| Term | Meaning |
| --- | --- |
| **Content** | What a script needs: the bytes of a workbook. Identified by a **ref** — a Google Sheets URL or id. |
| **Protected content** | Content that cannot be fetched anonymously. |
| **Key** | A credential the user brought: a Google service-account JSON, an AI provider key, an API key. Has a **name** (what a script may say), a **kind**, and pinned **hosts**. Its value is never seen by a script. |
| **Grant** | An author's release of one key to *one published configurator* for *specific refs*, usable in server-side runs only. Revocable. |
| **Flag** | The visible record that a script uses protected content: which refs, through which key or grant. |

---

### 2. What this design rests on

Verified in the code or tested on 2026-10-08. Each line is load-bearing; if one stops being true, the
section that depends on it has to be revisited.

#### 2.1 The browser

- **The script worker cannot read `localStorage`, but can read IndexedDB and Cache Storage.** Web
  Storage exists on `Window` only; IndexedDB, Cache and `fetch` are available in dedicated workers
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Functions_and_classes_available_to_workers)).
  So the origin's IndexedDB is readable by **any** script the worker runs, including a foreign
  configurator's. `SECURITY.md` relies on the first half ("That worker cannot reach `document` or
  `localStorage`, which is the boundary the editor relies on").
- **A non-extractable `CryptoKey` in IndexedDB does not stop same-origin code.** It cannot be exported,
  but it can be loaded and *used* ([W3C WebCrypto](https://w3c.github.io/webcrypto/)). Nothing secret
  may be parked in IndexedDB on the assumption that non-extractability protects it.
- **There is no worker → main-thread channel, and scripts are synchronous.** `RunnerWorker` exposes
  none (CO_AI.md §7), and module calls block on a synchronous XHR so scripts need no `await`
  (`packages/core/src/modules/serverModuleStub.ts`). A script cannot ask the editor for anything
  mid-run. §5 is built around this.
- **One worker serves own and foreign scripts.** `apps/editor/src/services/execution-service.ts:82`
  keeps a single `workerPromise` for the whole SPA; the published configurator is a route of the same
  app. Module instances live on across runs (`ModuleRegistry.linkToArchiyou`, `:423`; `_refreshStub`,
  `:481`) — which the new cloudcalc result cache relies on, and which is why it can leak (§2.3).
- **The CSP blocks Google today.** `Caddyfile:85` pins `connect-src 'self' blob: data:
  https://cdn.jsdelivr.net https://www.gstatic.com`. §6.6 lists the additions.

#### 2.2 Google, with a service-account key

**Tested from this machine on 2026-10-08**, using only `crypto.subtle` and `fetch` — the APIs a browser
has — with the cloudcalc service account against URBUILD_OFFER_TEMPLATE_V2 (read-only):

| Step | Result |
| --- | --- |
| Import the JSON's `private_key` (PKCS#8 PEM) as `RSASSA-PKCS1-v1_5`/SHA-256, sign a JWT | works |
| `POST https://oauth2.googleapis.com/token`, `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`, scope `drive.readonly` | 200, access token, `expires_in` 3599 |
| `GET https://www.googleapis.com/drive/v3/files/{id}/export?mimeType=…spreadsheetml.sheet&supportsAllDrives=true` | 200, the xlsx |
| The same export with a self-signed JWT as bearer (no token exchange), `scope` or `aud` claim | 403 / 401 — **the exchange is required** |
| CORS preflight, origin `https://archiyou.com`: token endpoint (POST, `content-type`) and Drive export (GET, `authorization`) | both allowed |

And for public sheets, no key at all: `https://docs.google.com/spreadsheets/d/{id}/export?format=xlsx`
answers a cross-origin request with `Access-Control-Allow-Origin: <origin>` and a 307 to
`doc-*-sheets.googleusercontent.com`, which serves the xlsx with `Access-Control-Allow-Origin: *`
(tested against the public URBUILD price sheet). The endpoint is undocumented; private content goes
through the Drive API above, which is documented (`files.export`, 10 MB limit).

What a service-account key means, honestly:

- **No Archiyou app, no verification.** Google requires no OAuth verification for service-account-only
  access ([when verification is not needed](https://support.google.com/cloud/answer/13464323)). There
  is no consent screen, no "Testing" mode with 7-day tokens, no Picker, no client id to configure per
  instance. Each user brings their own Google Cloud project and account.
- **Google advises against it in client-side apps.** "For client-side applications … don't use service
  accounts"; key creation is blocked by default for Google Cloud organizations created after
  2024-05-03 (constraint `iam.disableServiceAccountKeyCreation`)
  ([key best practices](https://docs.cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys)).
  Google's concern is an app *shipping* a key to all its users. Here each user stores *their own* key
  in *their own* editor — the same position as an AI key in CO_AI.md. The residual risk is real and
  stated in §11: a leaked key reads every sheet shared with that account until it is rotated.
- **Scope is Google's sharing, not a per-file grant.** The account reads exactly what was shared with
  it. So the UI steers users to a dedicated account per purpose, shared as *Viewer*, only with the
  sheets it needs (§6.2).
- **One shared account for many users is a confused deputy** — user A names user B's sheet. Which is
  why every user brings their own, and why the operator's account is narrowed (§2.3 #1).

Set aside, and why (2026-10-08): **per-user OAuth** (`drive.file` + Google Picker). Its strengths —
Google-enforced per-file access and no long-lived secret in the browser — are real; its costs are an
Archiyou Google app per instance, brand verification, a Picker and consent flow per source, 7-day
refresh tokens until verified, and nothing reusable for the next provider. It can come back later as
one more key *kind* without changing anything else here.

#### 2.3 This codebase — three problems that exist today

1. **cloudcalc reads any sheet with the operator's service account.** `googleAuth()`
   (`cloudcalc/src/config.ts:60`) returns it whenever `CLOUDCALC_GOOGLE_CREDENTIALS` is set, and
   `resolveSheetRef()` accepts any Google URL. On a multi-user instance any entitled user can open any
   sheet that *anyone* shared with that account. **Resolved by removing the account (§12.4).**
2. **`copy()` publishes what it copies.** `defaultCopyShare()` (`config.ts:77`) is `anyone-reader`. A
   copy of a sheet read through the service account becomes a public link. **Resolved with the account:
   `copy()` leaves the server (§12.4).**
3. **The new client result cache can hand one script's answers to another script.** `ResultCache`
   (`cloudcalc/src/client/index.ts:93`) lives in the module instance, which lives in the shared worker.
   Edit your own script against a private sheet, then open a foreign configurator in the same tab: the
   foreign script can read `cloudcalc._cache` (a private TypeScript field is a public JavaScript
   property). Same in a server-side run: `ExecutionWorker` reuses one Runner at concurrency 1
   (SECRETS.md §1.4), so author B's job can read what author A's job cached.

And one gap: **server-side runs cannot call server modules.** `routes/execute.ts:209-213` hands the run
a module catalog and `moduleApiUrl` but no `authToken`, and `POST /modules/:id/call` has
`preHandler: fastify.authenticate` (`routes/modules.ts:176-178`). By reading the code — not tested — a
cloudcalc call from a server-side run is rejected. SECRETS.md's phase 0, still open.

#### 2.4 The industry, on "kept from the server, but sometimes the server must use it"

- **Infisical** shipped end-to-end encryption, made it opt-out (July 2023), off by default (February
  2024, "to increase consistency with existing and future integrations"), and removed it (≈ early
  2025). Server-side use needs the plaintext; E2EE blocked exactly that.
- **Phase** keeps E2EE but has a per-app "Enable SSE" switch that seals an environment's root key to a
  server key, required for integrations. **GitHub Actions** has the client seal each secret to a
  public key for a repo or environment, and releases environment secrets to a job only after
  protection rules pass. **Sealed Secrets** binds a ciphertext to namespace and name so it opens
  nowhere else.
- The common shape: **kept from the server by default, plus an explicit, scoped, revocable release for
  one named job.** That is a grant (§8).

---

### 3. The rules

> **R1 — Keys never enter the script worker.** Not a value, not a masked value, not a minted access
> token. Unchanged from SECRETS.md and CO_AI.md.

> **R2 — Protected content enters a run only when the content's owner drives the code.** The owner's
> own script in the owner's editor, or the owner's granted configurator on the server. SECRETS.md §4,
> applied to content.

> **R3 — Protected content never reaches a browser its owner does not control.** A configurator on
> confidential content runs server-side; only outputs leave the server.

> **R4 — One rulebook, two managers.** `ClientSecretManager` (editor main thread) and `secretHandler`
> (API) are the only places a key is used. They share the vocabulary, the outcome enum and the audit
> format, so the owner sees one history.

What this changes in SECRETS.md: its invariant (§1.5) "plaintext must never reach the browser" becomes
**"never reaches the script worker, and never reaches a browser other than its owner's"**. Nothing
about server-side handling changes.

| Run | Content | Where it computes | Who fetches | With what |
| --- | --- | --- | --- | --- |
| Any script, any browser | public | worker | the worker, directly from Google | nothing |
| My script, my editor | mine, protected | worker | `ClientSecretManager`, before the run | my key (main thread) |
| My published configurator, a visitor's browser | mine, protected | **server** | `secretHandler`, before the run | the copy I released to that configurator |
| A foreign script, my browser | mine, protected | — | **nobody** | named error. No fallback to my keys. |

The last row is SECRETS.md §4.2 unchanged: a stranger's code driving my key is the confused deputy, and
it is refused, not contained.

---

### 4. Where cloudcalc runs after this

| Piece | Today | After | Why |
| --- | --- | --- | --- |
| Download a public sheet | server | **worker** (`docs.google.com` export, §2.2) | no key needed; CORS allows it |
| Download a protected sheet (own script) | server, operator's account | **editor main thread**, user's key (§5, §6) | R1, R2 |
| Download a protected sheet (configurator) | — | **API**, `secretHandler` with a grant (§8) | R3 |
| Flatten named functions, `IMPORTRANGE`, `ROUND(x)` | server | **worker** | `src/xlsx/flatten.ts` imports only `fflate` and `patch.ts`, and takes its import loader as a parameter (`loadImport`, `:35`), so the worker supplies one |
| `compute()`, `table()`, `fill()` | server | **worker** (formualizer wasm, lazy-loaded) | the point of the plan |
| `copy()` into Google Drive | server, operator's account | **post-run action** in the editor, user's key (§12.4) | no operator account any more |
| Named sheets (`CLOUDCALC_SHEETS`) | server | **removed** (§12.4) | existed to hide private URLs behind the operator's account |
| Server-side run | (broken, §2.3) | the *same client code* in Node; content pre-resolved by `secretHandler` | one engine path everywhere |

So cloudcalc has **no server half**: `dist/server.js`, `src/module.ts`'s methods, `src/sources/`
(downloads, disk cache, reference policy) and `src/google/` (Drive copy) are removed, and the manifest
becomes `runtime: 'client'`, `client` and `keepAlive` dropped. Its calls stop counting against the
module rate limit, which is what started this plan.

Costs: formualizer's wasm is 8.3 MB — fetched on the first `compute()` only, then HTTP-cached. A
12k-formula workbook loads in about 1 s and computes in about 75 ms (measured in Node on the Jasper
model, 2026-10-08).

---

### 5. Getting content into a synchronous run

A script cannot wait for the editor (§2.1). So protected content is resolved **before** the run and
travels with the request:

```ts
interface RunnerScriptExecutionRequest
{
  // …existing fields…
  /** Pre-resolved content by ref. Bytes only — never a key. Absent for foreign scripts. */
  content?: Record<string, ResolvedContent>;
}

interface ResolvedContent
{
  bytes: ArrayBuffer;          // transferred, not copied, into the worker
  source: 'google-drive' | 'google-public';
  keyName?: string;            // which key fetched it — a name, for the flag (§9)
  version: string;             // Drive modifiedTime — the cache key
  fetchedAt: string;
}
```

Which key: a script may name one — `cloudcalc.open(url, { key: 'urbuild' })`, a **name**, never a
value — or say nothing, and the user's default Google key is used (§6.1).

**How the editor learns which refs a script needs:**

1. `cloudcalc.open(ref)` in the worker looks in `request.content` first.
2. Not there: it tries the public download (§2.2). That works for every public sheet, in any browser,
   for anyone.
3. Public download refused (401/403/404): it throws a typed `ContentNeeded(ref, keyName?)`. The run
   ends with `result.needs.content = [{ ref, keyName }]`.
4. The editor hands that to `ClientSecretManager.resolve()` (§6). If R2 allows it and a matching key
   exists, the content is fetched and the script re-runs **once**, with `request.content` filled. If
   not, the run shows a named error with the fix: "Add a Google service account under Keys, and share
   this sheet with it", "The key 'urbuild' cannot read this sheet — share it with
   urbuild@….iam.gserviceaccount.com", or "this sheet belongs to someone else's script".
5. The refs a script turned out to need are remembered with the script (`requires.content`, §9), so
   later runs are pre-resolved and the extra run happens once per script, not once per run.

A literal-string scan of the source (`cloudcalc.open('…')`, the rule `$module('…')` already follows)
fills `requires.content` up front where it can. It is a hint, not the mechanism: scripts alias modules
(`cc = $module('cloudcalc')`), and only the run knows for sure.

**Rejected alternatives**, so they are not re-proposed:

| Alternative | Why not |
| --- | --- |
| Give the worker the key or a minted token | R1. A foreign configurator in the same worker reads it. |
| `SharedArrayBuffer` + `Atomics.wait` for a synchronous worker → main call | Needs cross-origin isolation (COOP/COEP): breaks embedding configurators and the CDN loads in the CSP. |
| A service worker that injects the key into the worker's requests | It cannot tell *which script* is asking, so it cannot enforce R2. |
| Send the key to the server for every own-script fetch | Puts every fetch through the server again — the cost this plan removes. Kept for configurators only (§8). |

**Caching protected content:** in the editor main thread's memory only, keyed by `(ref, keyName,
version)`, revalidated against Drive's `modifiedTime` (a metadata call, much cheaper than the export).
**Never in IndexedDB or the Cache API** — the worker can read both (§2.1). Minted access tokens are
cached the same way, per key, for their hour.

**Trust-context switch:** when the editor is about to run a script whose ownership differs from the
last run's (own ↔ foreign), it terminates the worker and starts a fresh one. This fixes §2.3 #3 in the
browser, and it is cheaper than auditing every module for cross-run state. In server-side runs, module
instances and their caches are reset between jobs (§8.4).

---

### 6. The key manager — the editor's half

#### 6.1 The menu

`packages/ui/src/editor/keys-menu.ts`, modelled on `modules-menu.ts` (a `wa-dialog`, two-pane list ↔
detail, Lit + Webawesome, Allman braces, the render → state → lifecycle → behaviour → styles order).
Main file menu → **Keys**. One list for every kind:

```
  urbuild                                     Google service account · default
  urbuild-sheets@urbuild-prod.iam.gserviceaccount.com
  used by 3 scripts · 1 configurator          [ Replace ]  [ ⋯ ]

  anthropic                                   AI · Anthropic · ····a91f
  used by AI assist                           [ Replace ]  [ ⋯ ]

  supplier-stock                              API key · api.dexwood.example · ····7c02
  not used yet                                [ Replace ]  [ ⋯ ]
```

| Kind | Value | Checked on save | Pinned hosts | Used by |
| --- | --- | --- | --- | --- |
| `google-service-account` | the JSON key file | parses; has `client_email`, `private_key`, `token_uri`; a test token exchange | `oauth2.googleapis.com`, `www.googleapis.com`, `sheets.googleapis.com` | cloudcalc (protected sheets) |
| `ai` (provider: Anthropic, OpenAI, OpenRouter, Google AI, …) | the API key | prefix shape per provider; optional test call | the provider's API host (CO_AI.md `AI_ALLOWED_HOSTS`) | AI assist |
| `api-key` | a token | — | entered by the user | later: `$api` (SECRETS.md §7.2) |

Each key has a **name** (slug — what a script may say), a label, a kind, pinned hosts, a `hint` (last
four characters; for a service account, its `client_email`, which is not secret), and per Google key a
**default** flag. There is no *edit*, only **Replace** — paste a new value, same name, every script
keeps working (SECRETS.md §9.4's rotation story). No reveal: the menu cannot show a value back.

#### 6.2 Adding a Google service account — one field

```
┌─ Add a Google service account ──────────────────────────────┐
│  Name     urbuild                                           │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Paste the JSON key file here, or drop it              │  │
│  └───────────────────────────────────────────────────────┘  │
│  ✓ urbuild-sheets@urbuild-prod.iam.gserviceaccount.com [copy]│
│                                                             │
│  Share each sheet you want to use with this address, as     │
│  Viewer. It can read everything shared with it — so use a   │
│  service account just for Archiyou, and share only what it  │
│  needs.                                                     │
│                                                             │
│  Only ever sent to oauth2.googleapis.com, www.googleapis.com│
│  [x] Remember on this device   [ ] Forget when I close tab  │
│                                        [ Cancel ]  [ Save ] │
└─────────────────────────────────────────────────────────────┘
```

The `client_email` line is what saves the support ticket: a valid key is not enough, the sheet has to be
shared with that address, and Archiyou cannot do that step for the user. The help link covers creating
a key, including the organization policy that blocks key creation by default (§2.2).

#### 6.3 Storage

- **Default: `localStorage`**, main thread, under `archiyou:keys:<name>`; an index of non-secret
  metadata under `archiyou:keys`. CO_AI.md §6 makes the case for plain `localStorage` over
  "encrypted" browser storage, and its four controls apply unchanged: never in a signal (`keysPresent`
  is a `signal<string[]>` of names; the value is read on demand), the `archiyou:` namespace, a
  **session-only** option (`sessionStorage`), and an egress check against the key's pinned hosts
  before every request.
- **Optional, later: synced** — end-to-end encrypted in the Archiyou database, so keys follow the user
  across devices (§7).
- Nothing in IndexedDB or the Cache API (§2.1).

#### 6.4 The class

`apps/editor/src/services/secret-manager.ts`, main thread only, never imported by anything the worker
loads. Singleton export in the house style.

```ts
class ClientSecretManager
{
  //// KEYS — what the menu calls ////
  list(): KeyInfo[];                                    // metadata + hint. Never a value.
  put(input: PutKeyInput): Promise<KeyInfo>;            // validates per kind (§6.1)
  remove(name: string): void;
  usage(name: string): KeyUsage;                        // scripts / configurators that name it

  //// USE — the only ways a value leaves this class ////
  resolve(needs: ContentNeed[], run: RunContext): Promise<ResolveResult>;   // protected content
  aiKey(provider: AiProviderId): string | null;         // for CO_AI.md's adapter, on demand

  //// AUDIT ////
  activity(): KeyUse[];

  private _mayResolve(run: RunContext): boolean;        // R2, in one place
  private _accessToken(key: StoredKey): Promise<string>; // §2.2 exchange, cached ≤ 1 h in memory
}
export const secretManager = new ClientSecretManager();
```

CO_AI.md's `getApiKey()` becomes `secretManager.aiKey(provider)`; its key-settings UI becomes the `ai`
kind in this menu. One store, one list, one place to rotate.

#### 6.5 Rights — `_mayResolve()`

The editor launched the run, so it knows whose script it is; the worker's word is never asked.
Resolve only when the active script is the signed-in user's own: `author === currentUser.id`, or an
unsaved local draft that was not opened from a shared or published link. `_scriptIsForeign()`
(`apps/editor/src/state/core.ts:258`) is the starting point but is too lenient for this — it treats a
signed-out user's authored, unshared script as not foreign. Write the stricter predicate once, here.

#### 6.6 Fetching, logging, CSP

- **Fetch:** `files.get?fields=modifiedTime` (cache check), then `files.export` (xlsx), with
  `supportsAllDrives=true` for shared drives. Imports to other protected sheets are resolved in the same
  `resolve()` call, before the run; imports to public sheets are left to the worker.
- **Log** every use locally: `{ key, ref, outcome, at, script }` — never a value, never a token. The
  outcomes are SECRETS.md §5.5.2's enum plus `no_key`, `not_shared_with_key` and
  `foreign_script_refused`. Metadata is posted to the server's `secret_uses` (§10), `side: 'client'`.
- **CSP** additions: `connect-src https://docs.google.com https://*.googleusercontent.com
  https://oauth2.googleapis.com https://www.googleapis.com`, plus the AI provider hosts from CO_AI.md
  §5. No `script-src` or `frame-src` changes — no Google script is loaded. Mirror them in the dev server
  (CO_AI.md §5, "making dev fail like prod").

---

### 7. Optional: synced keys, end-to-end encrypted (later)

For keys that should follow the user across devices without the server being able to read them.

- **Protects against:** a server or database compromise, a stolen backup. **Does not:** XSS in the
  editor, which can call the unlock path. Say both in the UI — CO_AI.md §1.6 forbids "password-encrypted
  key storage sold as security".
- **Shape (Bitwarden's):** a random vault key encrypts each key (AES-GCM, AAD = `userId:keyId:name`).
  The vault key is wrapped by a passphrase-derived key (Argon2id via wasm, or PBKDF2-SHA256 at ≥ 600k
  iterations) and, where supported, by a passkey's WebAuthn PRF output (Chrome/Edge 116+, Firefox 139+;
  sources disagree on Safari — optional). The server stores ciphertext and wrapped keys only.
- **Unlocked state lives in main-thread memory only** — never IndexedDB (§2.1).
- **Not phase 1**, because `localStorage` already works and Infisical's history (§2.4) shows E2EE must
  not stand in the way of the server-side case. That case does not go through the vault at all: it is a
  grant (§8), released explicitly.

---

### 8. Publishing a configurator on protected content — grants

#### 8.1 The flow

1. The author publishes. The publish dialog sees `requires.content` (§9) and says:
   *"This configurator reads 1 private Google Sheet with the key 'urbuild'. Visitors can't read it, so
   the configurator has to run on the server, with a copy of that key that only this configurator may
   use. Release 'urbuild' to this configurator?"*
2. **Release** sends the key's value once, over TLS, to `POST /grants` (authenticated; the server checks
   the caller owns the script). `secretHandler` seals it at once (SECRETS.md §5.3) with the grant in
   the AAD — `${ownerId}:${grantId}:${scriptFileId}:${version}` — so the ciphertext opens for that grant
   and nothing else. The plaintext exists in the API process for the length of that call, as SECRETS.md
   §1.5 allows.
3. The **grant** row pins what it may be used for:

   | column | notes |
   | --- | --- |
   | `id` | uuid |
   | `owner_id` | the author |
   | `script_file_id` | the configurator |
   | `version` | the published version it was released for — a new version needs a new release |
   | `refs` | JSON array of spreadsheet ids — **only these** |
   | `key_kind`, `key_name`, `key_hint` | for the UI; the value is in the sealed columns |
   | `ciphertext`, `iv`, `auth_tag`, `key_id` | SECRETS.md §5.2 |
   | `created_at`, `last_used_at`, `last_error` | |

   Revoking **deletes** the sealed copy; it does not merely flag it.
4. The configurator runs server-side: admin-validated (anonymous visitors) or allowlisted author
   (`routes/execute.ts:15-16`, `:124`). Before the run, `secretHandler.resolveForRun()` checks: a grant
   for this `(scriptFileId, version)` exists, and every ref the script declares is in `refs`. It opens
   the sealed key, exchanges it for an access token (§2.2, in Node), fetches only those refs, and puts
   the bytes in `request.content` — in-process, no module call, no key or token in the request. This
   also closes §2.3's server-side gap for content.

#### 8.2 "A configurator-specific key"

Three layers, each enforced by a different party:

| Layer | Enforced by | Scope |
| --- | --- | --- |
| Google sharing | Google | only sheets shared with that service account |
| Sealed copy, AAD bound to the grant | `secretHandler` | opens only for this grant |
| Grant row | `secretHandler._principal()` + `resolveForRun()` | only this configurator version, only these refs |

The released copy *is* the configurator-specific key: the author's other configurators and other
versions cannot use it, and the user's local key is untouched. For the strongest version of the first
layer, the menu suggests a dedicated service account per published configurator, shared only with its
sheets; then even a leak of the sealed copy reads nothing else.

Sealing to the server's public key in the browser (X25519 / RFC 9180 HPKE via `@hpke/core`, the GitHub
Actions shape) is possible and would keep the plaintext out of request logs and proxies in transit. It
does not change what the API process sees when it uses the key, so it is optional, not phase 3.

#### 8.3 What the server must still get right

- **Outputs are the author's choice.** A script that writes the whole price list to `calc.table()`
  publishes it. The grant protects the sheet, not what the author's code does with it — say so in the
  publish dialog.
- **No fallback to the browser.** `runScript()` drops to the local kernel when the server path fails
  (`execution-service.ts:246-265`). For a configurator that needs a grant, that fallback can only
  produce a confusing failure; turn it off for those and show the server's named error.
- **No cross-job residue.** Reset module instances (and their caches) between jobs in
  `ExecutionWorker`, and never keep `request.content` past its job. §2.3 #3.
- **Keys get rotated.** When the author replaces a key locally, the released copies are stale: the menu
  shows "released to 1 configurator — release the new key too?", and a failing grant sets `last_error`
  and shows visitors *"this configurator is temporarily unavailable"*, never a stack trace and never a
  retry loop.

---

### 9. Flags — making protected content visible

`requires.content` is stored with the script: `[{ ref, protected, keyName?, via: 'key' | 'grant' |
'public' }]`, kept up to date by §5. It is computed again at publish time and stored on
`ScriptData.published`, so a configurator never re-derives it in a visitor's browser (SECRETS.md
§10.3's point).

| Where | What it shows |
| --- | --- |
| Editor, script header | badge "uses 1 private sheet (key: urbuild)" → which, last fetched |
| Publish dialog | the §8.1 question; refuses to publish for browser execution when protected refs have no grant |
| Library / configurator card | "runs on the server — uses protected content" |
| `/admin` validation screen | the refs and grants next to the source — an admin validating a script is validating code that will read someone's private content |
| Keys menu | per key: "used by 3 scripts, 1 configurator" (Zapier's "Zap workflows: N"), and its released copies |
| Operator | every grant: owner, configurator, refs, key hint, last used, last error |

Precedent: GitHub Actions makes every secret an explicit reference (`${{ secrets.X }}`); n8n has an
open request (since June 2024) for exactly the "which workflows use this credential" view. Ours comes
from `requires.content`.

---

### 10. The central secret manager

Two implementations, one contract. The browser cannot run the server's manager and the server must
not run the browser's; what is central is the rulebook and the record:

- **Shared types** in `packages/types`: `KeyKind`, `ContentRef`, `ContentNeed`, `ResolvedContent`,
  `KeyUseOutcome`, `KeyUse`.
- **One rights table** (§3), implemented twice: `ClientSecretManager._mayResolve()` and
  `secretHandler._principal()`, each tested against the same table.
- **One audit record:** `secret_uses` (SECRETS.md §5.5.1) gains `side: 'client' | 'server'`, `ref`
  and `key_name`. The client posts metadata, never values; the server writes its own uses. The owner's
  **Activity** pane reads one table.
- **One place to ask for access:** a script never asks. It names a ref (and maybe a key name); a manager
  decides, fetches, or explains what is missing.

---

### 11. Threat model

| Path | Reaches a key? | Reaches protected content? |
| --- | --- | --- |
| Own script in own editor | **No** | **Yes** — its own, by design (R2) |
| Foreign script in my browser (configurator) | **No** | **No** — never resolved for it; worker replaced on context switch (§5) |
| Foreign script reading IndexedDB / Cache | **No** — nothing stored there | **No** — nothing stored there |
| XSS in the editor main thread | **Yes** — the stored keys | **Yes** — the in-memory cache |
| Browser extension with page access | **Yes** | **Yes** — as for every web app |
| Configurator visitor, server-side run | **No** | **Only what the author's code outputs** (§8.3) |
| Another author's server-side job | **No** | **No** — per-job reset (§8.3) |
| Database backup without `SERVER_SECRETS_KEY` | **No** | n/a |
| Database backup with the key | **Yes** — released copies only | — |

**Be candid about the XSS row.** `SECURITY.md` already concedes that an XSS reads the session JWT,
valid 7 days. A stored service-account key is **longer-lived**: valid until the user rotates it in
Google, and it reads everything shared with that account. The controls are the ones that actually bound
the damage, all user-visible: a dedicated account shared as Viewer with only what it needs (§6.2),
session-only storage for shared machines, one-click Replace, and a help link to deleting the key in
Google Cloud. Do not present localStorage storage as more than that.

---

### 12. Decisions (2026-10-08) and what follows from them

#### 12.1 Bundles of a published script are served on the author's entitlement

`GET /modules/:id/:version/bundle.js` requires sign-in, even for public modules
(`routes/modules.ts:123-124`), so a signed-out visitor cannot load any module bundle. Server-side runs
already take module entitlement from the *script's author* (`routes/execute.ts:189-213`); bundles of a
published script now follow the same rule.

- The bundle request names the published script it is for: `GET /modules/:id/:version/bundle.js
  ?script=<user>/<scriptAndVersion>`. Without sign-in, the server serves it only when that published
  version exists, its code declares the module (`$module('<id>')` — the literal the runner already
  reads, `modules/README.md` *How the runner decides to load it*), and its author is entitled.
- Server-side runs need client bundles too, now that cloudcalc is a client module. Today they would
  fetch them over HTTP with no token (`routes/execute.ts:209-213`; `loadClientModule.ts:83-100`) and be
  refused — by reading, not tested. Rather than reuse the HTTP route, inject `loadClient`
  (`ModuleRegistry` already accepts one, `ModuleRegistry.ts:328`) so the execution worker reads the
  bundle from `moduleHost.bundlePath()` in-process, with the author's entitlement already checked by
  the route. Whether the blob-URL import in `loadClientModule.ts` works in Node is untested; the
  in-process loader avoids the question.
- **Consequence to accept knowingly:** a gated module used by any published script of an entitled
  author is downloadable by anyone who can open that configurator. `modules/README.md` already says an
  entitled user can read a client bundle; this widens it to the configurator's visitors. Fine for
  cloudcalc (nothing in it is secret). For a commercial module whose code is the product, a manifest
  opt-out (`"publishable": false`: a published script using it must run server-side) is the escape
  hatch — add it when such a module exists, not before.

#### 12.2 Server compute is retired at once

No migration period: phase 1 (§14) removes `open`/`compute`/`table`/`fill` from the server in the same
change that adds them to the worker. One engine path, one set of tests. The equivalence bar before
removal is §15's: the worker gives 0 differences against today's server results on the URBUILD and
Jasper workbooks.

#### 12.3 One default Google key; `{ key: 'name' }` to choose another

As proposed. No trying every key on a 403 — slower, and the flag would not know which key was used.

#### 12.4 The operator's service account is removed entirely

`CLOUDCALC_GOOGLE_CREDENTIALS`, `CLOUDCALC_DRIVE_FOLDER_ID` and `CLOUDCALC_COPY_SHARE` go, with what
only existed because of them:

- **Named sheets** (`CLOUDCALC_SHEETS`, `cloudcalc.list()`, `open('pricing')`): they existed to let an
  operator publish a *private* sheet without showing its URL. With user keys and grants that is what a
  configurator grant does. Removed.
- **`copy()`**: it wrote with the operator's account into the operator's shared drive. Without it there
  are two honest options, and the plan takes the first:
  1. **A post-run action carried out by the editor with the user's key.** In the worker, `wb.copy(input,
     { title })` records `{ ref, input, title, keyName }` in `result.actions` and returns a pending
     handle; the editor performs `files.copy` + `values:batchUpdate` with the key on the main thread,
     after the run, and shows the link. The script cannot read the result in the same run (the worker
     is synchronous, §2.1) — which is fine for "make an offer document", the only use so far.
     *Changed 2026-10-09:* the script does read it. `cloudcopy()` ends the run with a content need
     (`google-sheet-copy`) instead; the editor makes the copy and runs again, and `cloudcopy()`
     returns `{ status, url, title, messages }`. Later runs are handed the answers so far, so only a
     new set of inputs costs the extra run. (§5's mechanism, so no worker change.) One
     catch for the help text: a service account has no Drive storage of its own, so the copy must land
     in a **shared drive** the user added that account to (Google answers `storageQuotaExceeded`
     otherwise — the same constraint `CLOUDCALC_DRIVE_FOLDER_ID` documented). The key's settings get a
     "copies go to" folder field.
  2. Drop `copy()` and rely on `fill()` (an `.xlsx`, computed in the worker, no Google write at all).
     Simpler, but loses the "live Google Sheet the customer can open" outcome.
- **The reference policy** (`resolveSheetRef()`, `CLOUDCALC_ALLOW_ANY_URL`,
  `CLOUDCALC_ALLOW_LOCAL_FILES`) protected the *server* from SSRF and file reads. The worker's fetches
  are bounded by the browser and the CSP instead, so it goes with the server half.
- `CLOUDCALC_CACHE_TTL_MS` goes with the server's download cache.
- Release note: anyone opening a private sheet through the operator's account today must, after the
  upgrade, add their own key (phase 2) or share the sheet as "anyone with the link can view".

#### 12.5 Synced keys after grants

As proposed (§7, phase 4).

---

### 13. Files

| Concern | Path |
| --- | --- |
| Key manager | `apps/editor/src/services/secret-manager.ts` (new) |
| Keys menu | `packages/ui/src/editor/keys-menu.ts` (new), main file menu entry |
| Run plumbing | `apps/editor/src/services/execution-service.ts` (content, worker reset, no-fallback), `apps/editor/src/pages/editor.ts` (one re-run on `needs.content`) |
| Request/result types | `packages/core/src/execution/types.ts` (`content`, `needs`) |
| cloudcalc, now a client module | `modules/archiyou-modules/cloudcalc/src/client/` (fetch, flatten, formualizer, `ContentNeeded`, `copy()` as an action), `vite.client.config.ts` (wasm as a lazy asset), `manifest.json` (`runtime: 'client'`) |
| cloudcalc server half — **removed** | `src/module.ts` methods, `src/config.ts`, `src/sources/`, `src/google/`, `dist/server.js`, their tests; `.env.example` lines 80-86 |
| Bundles on the author's entitlement | `apps/server/src/routes/modules.ts` (bundle route, `?script=`), `apps/server/src/execution/ExecutionWorker.ts` (in-process `loadClient`), `packages/core/src/modules/loadClientModule.ts` |
| `copy()` as a post-run action | `packages/core/src/execution/types.ts` (`actions`), `apps/editor/src/services/secret-manager.ts` (perform it) |
| Server grants | `apps/server/src/services/SecretHandler.ts` (SECRETS.md, + `resolveForRun`), `routes/grants.ts` (new), `routes/execute.ts`, `execution/ExecutionWorker.ts` (per-job reset) |
| Schema | `content_grants`; `secret_uses.side`, `.ref`, `.key_name` |
| UI | `publish-script-menu.ts`, script header badge, `/admin` validation view |
| AI assist | CO_AI.md's adapter reads `secretManager.aiKey()` |
| CSP | `Caddyfile`, dev server headers |
| Docs | `SECURITY.md`, `cloudcalc/{DOCS,README}.md`, `modules/README.md` (runtime table) |

---

### 14. Build order

Phases 0–2 ship **as one release**. Removing the operator's account and the server compute (§12.2,
§12.4) without the keys menu would leave no way to open a private sheet in between — and that is not
hypothetical: `URBUILD_OFFER_TEMPLATE_V2` answers an anonymous export with **401** (checked
2026-10-08), so the URHOUSE test script reads it only through the operator's account today. (The
original template and the price sheet answer 200.)

0. **Fix what exists** (§2.3 #3): worker reset on trust-context switch; module instances reset between
   server-side jobs. Remove the operator's service account and everything in §12.4.
1. **cloudcalc becomes a client module.** Worker download from `docs.google.com`, flatten and
   formualizer in the worker, lazy wasm, CSP; the server half removed (§12.2); bundles of published
   scripts on the author's entitlement, in-process `loadClient` for server-side runs (§12.1).
   *Delivers:* no module rate limit and no round trip; public-sheet configurators for signed-out
   visitors.
2. **The keys menu and `ClientSecretManager`**: Google service account and AI kinds, `localStorage` /
   session storage, token exchange, pre-resolution with one re-run, `requires.content` badge, `copy()`
   as a post-run action. *Delivers:* private sheets in your own scripts, computed in your browser; AI
   keys in one place.
3. **Grants**: release a key to a configurator, `content_grants`, `resolveForRun()`, per-job reset,
   admin view, Activity. Needs SECRETS.md phase 1's cipher. *Delivers:* confidential configurators.
4. **Synced keys** (§7), when users ask for multi-device.

Protected APIs (`$api`) remain SECRETS.md phase 5; the `api-key` kind is ready for them.

---

#### Status (branch `keys`, 2026-10-08)

Built, with tests: cloudcalc as a client module (local engine, inlined wasm, `Books`, server half
removed, operator service account and named sheets gone); `content`/`needs` in core and the module
SDK; the editor's `secret-manager.ts` (keys, service-account token exchange, content resolution,
own-scripts-only), the run loop with one re-run and the trust-switch worker reset
(`execution-service.ts`, `content-needs.ts`); the Keys menu; bundles of published scripts on the
author's entitlement (`?script=`, server and client); CSP; docs (cloudcalc DOCS/README,
modules/README, SECURITY.md, .env.example).

Then: modules report after a run (`AyModule.report()` → `result.used`); the code
editor's header shows a key badge when a run read content with one of the user's keys
(`<editor-key-badge>`). cloudcalc's `wb.cloudcopy({ title, share, force })` copies with the inputs
of the last `compute()`: the run stops with a `google-sheet-copy` need, the editor makes the copy
next to the sheet with the user's key (`secretManager.copySheet()`: write scope only then, own
scripts only, values RAW, shared only when asked) and runs again; `cloudcopy()` returns
`{ status, url, title, messages }`. Once per script — same inputs: the earlier copy ('existing');
other inputs: none ('blocked', with a message), unless `force`. Earlier copies are found in Drive by
private app properties, answers are handed to the script's later runs (`cloud-copies.ts`). cloudcalc's
`fill()` became `wb.xlsx()`. Module manifests can declare `types` for autocomplete of returned
objects; cloudcalc generates its completions from TSDoc.

Not yet: the publish-dialog check for a configurator that reads private content (the needs are
remembered per script already); client modules in server-side runs (blob-URL import does not work
in Node — a prerequisite for grants, phase 3); a copy made against a real shared drive.

### 15. Verification

**Unit**
- `_mayResolve()` and `_principal()` against the same table (§3): own script, unsaved draft, signed-out
  user with an authored script, foreign shared script, published configurator. Only the first two
  resolve in the browser.
- Key validation per kind: a malformed JSON, a JSON without `private_key`, a key whose token exchange
  fails — each a named error at save time, not at run time.
- Egress: a key used against a host outside its pinned list is refused before the request.
- `cloudcalc.open()`: content in the request → no fetch; public ref → worker download; 403 →
  `ContentNeeded`. Results identical to today's server compute on the URBUILD and Jasper workbooks
  (`ai-excel-logic-test/tools/verify.mjs` — 0 diffs is the bar).
- A grep test (CO_AI.md §11 style): nothing under `packages/core` or a module's client bundle reads
  `archiyou:keys:`; `RunnerScriptExecutionRequest` has no credential-shaped field.
- Grants: other version → refused; a ref not in `refs` → refused; a revoked grant has no ciphertext
  left; every refusal writes one `secret_uses` row.

**End to end**
1. Public sheet, signed out, browser, published configurator: the bundle loads on the author's
   entitlement, and the sheet computes with no request to `/modules/*/call`.
2. Own private sheet: `ContentNeeded` → "add a key" → paste JSON → share the sheet → one re-run →
   computes; the next run makes no export call (cache), and a sheet edit is picked up via `modifiedTime`.
3. From that script: `Object.constructor('return globalThis')()`, `indexedDB.databases()`,
   `caches.keys()`, `cloudcalc._cache` — nothing yields a key or a token.
4. Open a foreign configurator in the same tab: a new worker; `cloudcalc._cache` is empty; the foreign
   script naming my sheet gets `foreign_script_refused`.
5. Publish on the private sheet without a grant: the dialog stops it. Release the key, validate as
   admin, open it signed out: it runs server-side, the network tab shows no sheet bytes, Activity shows
   the use.
6. Revoke the grant: the sealed copy is gone, the next visitor run fails with the named error, and it
   does not fall back to the browser.

---

### 16. What not to do

- **No key or minted token in the run request**, not even for the user's own script "because it is
  theirs" — the worker is shared with foreign code (§2.1).
- **No keys or protected bytes in IndexedDB or the Cache API.** The worker reads both; a non-extractable
  key is still usable (§2.1).
- **No operator service account**, and no shared service account for user content of any kind
  (§2.3 #1, §12.4). Every Google read is the user's own key, or a grant of it.
- **No silent fallback** from a missing grant to the visitor's keys, or from a failed server-side run to
  the browser (§8.3).
- **No reveal** in the keys menu, not even "show for 5 seconds" — once a path returns a value, R1 is a
  comment rather than a property (SECRETS.md §14).
- **No security claim that covers XSS** for browser-stored keys (§11), and no E2EE that blocks the
  server-side case — that case is a grant, released on purpose (§2.4).

---

### Sources

Retrieved 2026-10-08.

[When OAuth verification is not needed](https://support.google.com/cloud/answer/13464323) ·
[Service account key best practices](https://docs.cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys) ·
[Confused deputy with shared service accounts](https://www.agwa.name/blog/post/accessing_your_customers_google_cloud_accounts) ·
[Drive files.export](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export) ·
[Authorization dropped on cross-origin redirect](https://caniuse.com/mdn-api_fetch_authorization_removed_cross_origin) ·
[Worker APIs (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Functions_and_classes_available_to_workers) ·
[WebCrypto](https://w3c.github.io/webcrypto/) ·
[WebAuthn PRF support](https://caniuse.com/mdn-api_credentialscontainer_get_publickey_option_extensions_prf) ·
[Bitwarden PRF](https://contributing.bitwarden.com/architecture/deep-dives/passkeys/implementations/relying-party/prf) ·
[Bitwarden security white paper](https://bitwarden.com/help/bitwarden-security-white-paper/) ·
[Infisical June 2023 update](https://infisical.com/blog/infisical-update-june-2023) ·
[GitHub: encrypting secrets](https://docs.github.com/en/rest/guides/encrypting-secrets-for-the-rest-api) ·
[GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) ·
[Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) ·
[Phase apps (SSE)](https://docs.phase.dev/console/apps) ·
[hpke-js](https://github.com/dajiaji/hpke-js) ·
[Zapier connections](https://help.zapier.com/hc/en-us/articles/8496290788109) ·
[n8n credential-usage request](https://community.n8n.io/t/see-what-workflows-individual-credentials-are-used-in/48353) ·
Set aside (§2.2): [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) ·
[Web Picker](https://developers.google.com/workspace/drive/picker/guides/web-picker) ·
[GIS authorization models](https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model)

## Review and decisions by the human

- Asked for confidential content per user, a secret manager in the editor, and grants for a
  configurator; then narrowed it to keys the user manages (a Google service-account JSON, AI and other
  API keys) instead of Google OAuth.
- Took the plan's five decisions (2026-10-08 21:32): bundles of a published script on the author's
  entitlement; server compute retired at once; the operator's service account removed entirely.
- Reviewed the Keys menu in the browser and asked for changes: an *Add* dropdown instead of a list,
  the description text (the author's wording), "Use as default key for Google", a smaller hint box, editor
  button styles; reported a bubbling click event that closed the menu.
- Redesigned `copy()`: renamed to `cloudcopy({ title, share, force })`, inputs from the last
  `compute()`, no folder option, no button, once per script and inputs unless `force`, TSDoc and
  autocomplete.
- Not yet tried against a real shared drive by the agent; the author made a copy with their own key on
  2026-10-09 (see the cloudcopy-wait record).
- Before committing (2026-10-09), the agent ran the editor (33), server module (32), core module (71),
  UI completion (5) and CLI (24) tests and cloudcalc's suite (118), and type-checked against HEAD: no
  new errors.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | see git log | 21:38 (plan), 22:55, 23:05, 23:16, 2026-10-09 10:13 |
