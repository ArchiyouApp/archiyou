# `modules/` — separately-licensed script modules

This directory is the **overlay** where Archiyou script modules are developed. It is empty in a
public checkout, and everything in it except this file is gitignored.

A **script module** adds one global to the scope an Archiyou script runs in — `fem`, say, or an
advanced calculation engine. Modules exist so capabilities that cannot live in this repository
can still be offered, whether because they are commercially licensed, or because their licence
is incompatible with this one.

Two kinds, and the difference is one manifest field:

| | |
|---|---|
| **Gated** (the default) | Available only to accounts entitled to it. What the system was built for. |
| **Public** (`"public": true`) | Available to everybody, no grant needed. For open-source modules, whose source anyone can read and build anyway. |

> **A copyleft module must never enter this repository's dependency graph.** archiyou-web is
> Apache-2.0. A module under the GPL or AGPL lives in its own repository, is built to its own
> `dist/bundle.js`, and reaches the engine only through the module system — which fetches that
> artifact over HTTP and imports it from a blob URL. Nothing here imports it, and nothing here
> depends on it. Cloning such a module into this overlay for development is fine; adding it to
> a `package.json` in `packages/` or `apps/` is not.

**This file is the reference for the module system** — both the hands-on guide (set up, write,
run, deploy, troubleshoot) and the system detail: the manifest contract, the client and server
runtimes, entitlement, and why the pieces are shaped the way they are.

---

## Using a module in a CADscript

Start here, because it is what everything below exists to produce.

Declare the modules a script uses at the top, with `$module()`:

```js
$module('strength')

WIDTH  = 200
beam   = box(WIDTH, 40, 40)
report = strength.analyse(beam, { grade: 'C24' })

print(report.utilisation)
```

`$module()` also *returns* the module, so you can alias it — useful for a shorter name, or just to
make the dependency read as a binding:

```js
fem = $module('cloudcalc')

// a server module — the call crosses the network, so await it
beam   = box(200, 40, 40)
result = await fem.solve({ shape: beam, load: 500 })

beam.color(result.overloaded ? 'red' : 'green')
```

Either the module's **id** or its **global** name works as the argument; they are usually the same.

**The declaration is required.** Using a module's global without declaring it is an error — modules
are not implicitly imported the way `box` and `calc` are always present. Three reasons:

- **It fails at the top.** Without a module you are not entitled to, the script stops on the
  `$module()` line, before any geometry is built, and the message names the declaration.
- **It is exact.** Nothing is downloaded because your source happened to contain a word. Only what
  you declared is fetched — a mention in a comment costs nothing.
- **It states the dependency** where a reader — or a colleague opening your published configurator —
  will look for it.

Forget it and the message says so, naming the line to add:

```
Module 'fem': not declared in this script — add $module('fem') before using it
```

> `$module()` is deliberately separate from `$import()`, which fetches a remote **asset** by URL
> (`$import('https://…/logo.svg')`). One name for both would make failures ambiguous: a bad URL and
> a missing module would report the same way.

`await` at the top level is fine — scripts already run as async functions. Whether a module needs
it is decided by its `runtime`, which the Modules panel shows.

Modules compose with everything else normally: parameters, `$component`, `calc`, `docs`.

```js
$PARAMS.define('LOAD', 'number', { label: 'Load', units: 'N', default: 500, minimum: 0, maximum: 5000 });

beam   = box(200, 40, 40).material('steel')
result = await fem.solve({ shape: beam, load: $LOAD })

calc.metric('utilisation', Math.round(result.utilisation * 100), { unit: '%' })
```

### How the runner decides to load it

A module is fetched **before** the script runs, so its name has to be readable from the source
without executing it. That is why the argument must be a **plain string literal**, never built up:

| In your script | Loaded? |
|---|---|
| `$module('fem')` | yes |
| `cc = $module('fem')` | yes |
| `$module('f' + 'em')` | **no** — a computed argument cannot be read ahead of time |
| `fem.solve(...)` with no declaration | no — and the call fails, telling you to declare it |
| `// TODO: use fem here` | no — a mention costs nothing |

If you need the name in a variable, declare it first and alias the result:

```js
cc = $module('cloudcalc')   // literal here…
run = (x) => cc.solve(x)    // …then use it however you like
```

### When something is wrong

Each case reports differently, so you never have to guess which one you hit:

| Message | Meaning |
|---|---|
| `$module('fem'): not available on your account` | The module exists here; your account is not entitled. |
| `$module('exmaple'): no such module — check the name, or it is not installed on this server` | Nothing by that name — usually a typo. |
| `Module 'fem': not declared in this script — add $module('fem') before using it` | You used the global without declaring it. |
| `$module('fem'): needs Archiyou core ^0.9.0, but this is 1.0.0` | The module was built for a different engine version. |

All of them stop the run and name the module. That is deliberate: the name is always bound to
*something* that explains itself, rather than left undefined and failing later with `undefined is
not a function`, which points nowhere.

To write a script that works either way, catch it:

```js
fem = null
try { fem = $module('fem') } catch (e) { print('FEM not available — skipping stress analysis') }

beam = box(200, 40, 40)
if (fem) { stress = await fem.solve({ shape: beam, load: 500 }) }
```

### Finding out what you have

The **Modules** panel (puzzle icon in the left menu) lists everything installed, unlocked first,
with each module's global name, what it does, and a docs link. Locked modules are listed too, so
you can see what exists. Entitled modules also appear in editor autocomplete — both the global
and its methods.

The panel is hidden entirely when no modules are installed.

---

## Setup

Clone each module repository into a **subdirectory** of this one:

```bash
# from the repo root
git clone git@github.com:YourOrg/archiyou-module-fem.git modules/fem
pnpm install
```

`pnpm-workspace.yaml` includes `modules/*` and `modules/*/*`, so both layouts work:

| Layout | Clone as | Becomes |
|---|---|---|
| One repo per module | `modules/fem` | one package |
| One repo holding several modules | `modules/private` | `modules/private/fem`, `modules/private/calc`, … |

From there everything behaves as if the modules were in-tree: `workspace:*` dependencies
resolve, `turbo build` picks them up with no filter changes, and `tsc`, vitest and HMR all work
normally.

> **Clone into a subdirectory, not into `modules/` itself.** Git refuses to clone into a
> non-empty directory, and this README makes `modules/` non-empty. Cloning as `modules/<name>`
> also lets several private repos coexist.

Nothing you add here can be committed to this repository — `.gitignore` covers `/modules/*`, and
the `private-modules-boundary` CI job fails the build if anything under it is ever tracked.

### The lockfile leaks too

`pnpm-lock.yaml` is tracked, and pnpm records **one importer per workspace project** — so any
plain `pnpm install` with the overlay cloned in writes your private module names, and their full
dependency lists, into it. The deps alone are usually enough to say what a module does. Expect to
see this the first time you install after cloning a module in:

```
$ git status --short
 M pnpm-lock.yaml      # +300-odd lines, all of them modules/…
```

Do not commit it. Regenerate the lockfile as a public checkout would have it:

```bash
pnpm lockfile:public
```

That parks each overlay directory behind a dot-prefix (which the `modules/*` globs do not match),
reruns `pnpm install --lockfile-only`, and puts everything back. pnpm tolerates importers with no
directory on disk, so the result still installs cleanly here, with the overlay present.

If you forget, the `no private module may appear in the lockfile` step of the
`private-modules-boundary` CI job fails the build and names the leaked importers.

One consequence to expect: while the overlay is cloned in, `pnpm install --frozen-lockfile` fails
locally, because those importers are deliberately absent from the committed lockfile. Plain
`pnpm install` is the local command; frozen is for CI and the server image, which never see
`modules/`.

---

## Anatomy of a module

```
modules/<repo>/fem/
  package.json          name it @archiyou/module-<id>, private: true, type: module
  manifest.json         the contract the backend and runner read
  README.md             for whoever builds and deploys this module — NOT published
  DOCS.md               for whoever writes scripts with it — shown in the editor, see below
  ts/                   your code (src/ is equally fine)
  tests/                the module's own tests — see below
  dist/bundle.js        build output — runtime: 'client'
  dist/server.js        build output — runtime: 'server'
```

**Every module carries its own `tests/`**, and the one that matters exercises it end to end in a
real CAD script — through the genuine Runner and the genuine `loadClientModule()` path, so the
factory, `init()`, `setArchiyou()` and the scope binding all behave as they do in production. Only
the network is faked. `optimize/tests/` is the worked example: it runs the same script against both
the TypeScript entry *and* the built `dist/bundle.js`, so a build that splits into chunks or drops
an asset fails there and nowhere else.

Depend only on `@archiyou/module-sdk`:

```json
{
  "name": "@archiyou/module-fem",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": { "@archiyou/module-sdk": "workspace:*" }
}
```

`workspace:*` is the only way to depend on it: the SDK is internal to this monorepo and is **not
published to npm**. That is why a module repository is developed from inside the overlay rather
than as a standalone checkout — cloned into `modules/`, it is a workspace package and resolves the
SDK (and the same TypeScript) exactly as the engine does. Nothing is lost by it being unpublished:
`@archiyou/core` carries a verbatim mirror of the contract (`src/modules/sdkTypes.ts`) and
re-exports it, so an outside consumer of core still sees the module types — but edit the contract
in `packages/module-sdk/src/types.ts` and re-run `pnpm --filter @archiyou/core sync:sdk-types`,
never the other way round.

### `manifest.json`

```jsonc
{
  "id": "fem",             // unique; used in URLs and in entitlement lists
  "global": "fem",         // the name scripts use
  "name": "FEM Solver",
  "version": "0.1.0",      // bump to invalidate a deployed bundle
  "engine": "^0.9.0",      // semver range of @archiyou/core you support
  "runtime": "server",     // 'client' | 'server'
  "description": "Linear-static finite element analysis.",
  "docsUrl": "https://…",
  "completions": [         // optional editor autocomplete
    { "label": "solve", "detail": "(model, loads) => Result", "type": "method" }
  ]
}
```

Two rules the runner enforces, both of which cause the module to be **refused** rather than
misbehave:

- `global` must match `/^[A-Za-z][A-Za-z0-9_]*$/`. `$` is the parameter namespace (`$PARAMS`,
  `$WIDTH`) and `_` is the runner's internal namespace, so neither is available.
- `global` must not be a name Archiyou already uses (`box`, `calc`, `docs`, …). A module can
  never shadow a core global.

`id` must equal the directory name at deploy time, or the backend skips the module with a warning.

### `DOCS.md` — the documentation the editor shows

A module's `DOCS.md` is served by `GET /modules/<id>/docs` and rendered inside the editor's module
list: clicking a card slides the list aside and shows the page in place. Nothing declares it — the
backend picks up `DOCS.md` (any capitalisation) from the module's own directory at scan time, sets
`docs: true` on the catalog entry, and the editor shows the affordance only for the modules that
have one. Editing it takes effect on the next open in dev, no restart.

**It is a different file from `README.md`, and that is the point.** A README is written for whoever
builds and deploys the module: build commands, `MODULE_*` environment variables, how the security
guards work and why. This route is **public** — it serves the page for a module the caller is not
entitled to, and to anonymous callers, on the same reasoning that lists locked modules at all —
so publishing a README wholesale would put deployment detail and threat-model notes in front of
every visitor. `README.md` is never read by the backend; only `DOCS.md` is.

So the split is: **`DOCS.md` is everything a script author needs** — what the module does, the
script API, conventions, worked examples, and the limits and caveats that change what someone
writes. **`README.md` keeps the rest** — build, tests, configuration, deployment, licence, and how
it works inside.

It is written as markdown and rendered as markdown: headings, code fences, tables, lists,
blockquotes and links all work. Three things do not, and are worth knowing before writing:

- **Raw HTML is escaped, not rendered.** A `DOCS.md` is authored outside this repository, so
  nothing in it is allowed to become live markup.
- **Relative links and images do not resolve.** `./docs/diagram.png` and `[types](ts/types.ts)`
  are paths in the module's own repository, which the editor cannot follow. Use an absolute URL
  for an image that must appear; a relative image degrades to its alt text.
- **Only the first 256 KiB is served.** Past that the response is truncated.

The page opens in a fairly narrow pane with the first heading at the top, so lead with what the
module does and a short example. `cloudcalc/DOCS.md` is the worked shape.

### `public` — opting out of entitlement

Everything else in this system assumes a module is gated: the catalog marks it `entitled: false`
for accounts that lack it, and both the bundle route and the server-call route return 403.
`"public": true` turns that off for one module, and nothing else.

Use it for a module whose source is public anyway. Requiring an admin grant before an
open-source module will run makes it administratively indistinguishable from a paid one, for no
benefit — anyone can read and build it regardless.

What does **not** change: a public module still appears in the catalog, still has its `engine`
range checked against the running core, and is still refused outright if its `global` collides
with a name Archiyou already uses. `public` affects entitlement, and only entitlement.

It is set by the **deployment**, not by a user — manifests live in the installed module's own
directory, so whoever installs a module decides whether it is public. The schema accepts only a literal
`true`; `"yes"` or `1` is a malformed manifest and the module is skipped.

---

## Choosing a runtime

| | `client` | `server` |
|---|---|---|
| Runs in | the script Web Worker | a backend worker thread |
| Methods | may be synchronous | always `async` — scripts must `await` |
| Latency | none | one HTTP round trip per call |
| Source visibility | an entitled user can extract the bundle | never leaves the server |
| Native / Node deps | no | yes |

**Put anything commercially sensitive or CPU-heavy on `server`.** The client bundle is gated —
an unentitled user cannot download it — but someone who *is* entitled can read it.

---

## Writing a client module

```ts
// src/index.ts
import { defineModule } from '@archiyou/module-sdk';

export default defineModule(() => ({
  _ay: null as any,

  // Optional. One-time async setup — load WASM, fetch a dataset — awaited once
  // per loaded instance, before any script can reach the module. This is what
  // lets the methods below be synchronous.
  async init() { await loadMyWasm(); },

  // Optional. Async per-run warm-up, awaited before the script executes. Unlike
  // init() it knows the run, so it can fetch through the asset proxy.
  async warm({ assetProxyUrl }) { await this._preload(assetProxyUrl); },

  // Called once per run, before the script executes.
  setArchiyou(ay) { this._ay = ay; },

  // Called once per run, after setArchiyou — drop per-run state here.
  reset() { this._cache = null; },

  // Anything else is callable from a script as `fem.<name>(...)`.
  analyse(shape, opts) {
    const modeler = this._ay.modeler;   // the rest of the engine
    return /* … */;
  },
}));
```

`init()` runs while the runner is still preparing — the same trick `$import()` uses — so a script
never awaits your module's setup. A module whose `init()` throws is treated as unavailable, and the
script gets a stub explaining why rather than a half-initialised module.

`warm()` is for the setup `init()` cannot do. `init()` fires before the module knows which run it
belongs to, and in the browser a worker cannot fetch a third-party host at all without going through
the asset proxy — so anything network-shaped belongs here, where the run's `assetProxyUrl` is handed
to you. It is awaited on **every** execution, right after the modules are loaded and before the
scope is built, so keep it cheap on repeat: cache across runs rather than refetching. Unlike
`init()`, throwing costs nothing but a log line — a warm-up is an optimisation, and the run
continues without it. (The `pv` module uses it to have a default weather site ready, so a script can
read `pv.site` with no `await` anywhere.)

Script parameters are not on `ay`; they live on the scope. Reach them with
`ay.runner.getActiveScope().$PARAMS` (that is how `optimize` builds its search space).

```js
// in a user script — no await needed
result = fem.analyse(myBeam, { load: 500 })
```

The instance is **created once and reused across runs**, so an expensive resource (a WASM
instance, a loaded dataset) survives; `reset()` is where per-run state goes.

Build to a **self-contained** `dist/bundle.js` (ESM, everything inlined). The bundle is fetched
with an auth header and imported from a blob URL, and a blob URL has no base — so relative
imports back to the server cannot work.

## Writing a server module

```ts
// src/index.ts
import { defineServerModule } from '@archiyou/module-sdk';

export default defineServerModule({
  methods: {
    async solve(args) {
      return { displacements: [/* … */] };
    },
  },
});
```

```js
// in a user script — no await needed
result = fem.solve({ nodes, elements, loads })
```

`methods` is an explicit allowlist: only names on it are reachable, and only own properties
count, so `constructor` and friends cannot be called. Arguments and return values cross the
network as JSON, so both must be JSON-serializable.

The call is **synchronous from the script's point of view**. Scripts run in a dedicated Web
Worker, and a worker may block on a request (a synchronous `XMLHttpRequest`), so the stub waits
for the server and returns the plain result. Outside the worker — Node, tests — the same stub
returns a Promise, and `await` on a plain value is a no-op, so a script written either way works
in both places.

Each call runs in a **fresh worker thread** with an empty environment — module code cannot read
the JWT signing key or mail credentials — and is killed after
`SERVER_MODULES_CALL_TIMEOUT_MS` (default 60 s). Nothing survives between calls, so a server
module is stateless by construction: whatever a later call needs, the script has to pass back.

### Hybrid: a server module with a client wrapper

Flat remote calls (`mod.compute({ sheet, input })`) get awkward once there is a thing to hold
on to. A server module can therefore also ship a **client wrapper**: set `"client": true` in
the manifest and build a `bundle.js` next to `server.js`. The wrapper is loaded like a client
module, but its factory receives the server stub and returns the object the script sees:

```ts
// src/client/index.ts  →  dist/bundle.js
import { defineModule } from '@archiyou/module-sdk';

export default defineModule(({ server }) => ({
  setArchiyou(ay) { /* keep it if you need calc/docs */ },
  // Called on every later run with that run's stub (fresh bearer token).
  setServer(s) { server = s; },
  open(url) {
    const descriptor = server.open({ ref: url });          // one sync call
    return {
      ...descriptor,
      compute: (input) => server.compute({ ref: descriptor.ref, input }),
    };
  },
}));
```

```js
wb = cloudcalc.open('https://docs.google.com/spreadsheets/d/…')
out = wb.compute({ width: 300 })
```

The wrapper is readable by every entitled user, like any client bundle: keep it to ergonomics
(objects, defaults, argument checks) and leave secrets and heavy code in `server.js`. Both
artifacts are gated by the same entitlement; the bundle route serves the wrapper and never
`server.js`.

---

## The development loop

Clone the module repository into `modules/` and you are done — **there is nothing to configure
and no deploy step**. The backend reads the checkout in place, and finds it on its own:

```bash
git clone git@…:archiyou-private-modules.git modules/archiyou-private-modules
```

Both shapes a clone produces are recognised, one level deep each:

```
modules/<repo>/<id>/manifest.json   a repository holding several modules
modules/<id>/manifest.json          a single module cloned straight in
```

**Several repositories at once** is the normal case — a private one and an open-source one, say,
since they cannot share a repository — and needs no more than cloning both. Each becomes a
*root*: a directory whose children are modules.

Roots are scanned in order and the **first definition of an id wins**, so a module cloned
straight into `modules/` shadows the same id inside a repository — which is how you test a local
build against the deployed copy. A duplicate is reported at boot, naming both directories. A
root that does not exist is warned about and skipped; it does not take the others down with it.

At boot the backend says which roots it used and how it got them, so an unexpected set of
modules is readable rather than something to deduce:

```
🧩 Loaded 1 script module(s): struct@0.1.0
   found under modules/: /…/modules/archiyou-private-modules
```

**Overriding the search.** `SERVER_MODULES_DIR` still names the roots outright — a comma- or
colon-separated list — for a deployment that keeps them somewhere other than the checkout. It
replaces the search rather than adding to it, including when the path is wrong (that is reported,
not quietly corrected):

```bash
# apps/server/.env — only when modules live outside the checkout
SERVER_MODULES_DIR=/srv/archiyou-modules,/srv/struct
```

Set it to `off` (or `none`/`false`/`0`) to load nothing even though modules are installed, which
is how you reproduce an open-source-only instance without moving the checkout.

```bash
# one command: rebuilds modules on change, runs editor + backend
pnpm dev:modules

# grant yourself access (once)
pnpm --filter @archiyou/server admin:modules --user <your-handle> --grant fem

# …or take everything, now and in future, which is usually what you want in dev
pnpm --filter @archiyou/server admin:modules --user <your-handle> --grant '*'
```

> **With nothing installed the catalog is empty**, and every `$module('x')` fails with
> *"no such module — check the name, or it is not installed on this server"*. That message covers
> both "you typed it wrong" and "this instance has no modules at all", so start with
> `admin:modules --list`: it prints what the backend can actually see, and when that is nothing it
> says which of the reasons it is — nothing cloned into `modules/`, a `SERVER_MODULES_DIR` that
> found nothing, or the feature switched off.

Then: **edit your module → save → hit Run in the editor.** That is the whole loop. No copying,
no server restart, no browser reload.

It works because each of the places a stale build could hide is handled:

| | What happens |
|---|---|
| Build | `turbo watch build --filter=./modules/**` rebuilds on save (`**`, not `*` — a one-repo-holding-several layout puts packages two levels down, and a filter that matches nothing exits 0) |
| Deploy | none — the backend reads `<id>/dist/bundle.js` in place |
| Backend | watches for changes and re-scans, so new modules and edited manifests need no restart |
| HTTP cache | bundles are served `no-store` in dev, so a fetch really refetches |
| Runner cache | the backend publishes a per-build `rev`; the runner keys its module cache on it |
| Editor catalog | refreshed before a run (500 ms TTL), so the new `rev` is seen |

**Server modules are even simpler**: each call runs in a fresh worker thread with its own module
registry, so a rebuilt `server.js` takes effect on the very next call — no rescan, no restart,
nothing to invalidate.

All of this is on when `config.modules.dev` is true, which it is whenever `NODE_ENV` is not
`production`. Force it either way with `SERVER_MODULES_DEV=1` / `=0`.

> **Why the cache handling matters.** In production, bundles are immutable and cached for a year
> — the version in the URL is the cache key. During development you rebuild many times at the
> *same* version, so without `rev` and `no-store` a reload would keep serving the first build you
> ever loaded, indefinitely, with nothing to suggest why your edit had no effect.

### Deploying for real

Production expects a *flatter* layout — manifest and the one artifact side by side, in a
directory named for the id:

```
<root>/fem/manifest.json
<root>/fem/server.js      # or bundle.js for a client module
```

…where `<root>` is a directory under `modules/` (found automatically) or one named by
`SERVER_MODULES_DIR`. The docker-compose deployment mounts the whole checkout, so a production
install is the same `git clone` into `modules/` that development uses.

Both layouts are accepted (`<id>/bundle.js` is checked before `<id>/dist/bundle.js`), so the same
backend code serves a real deployment and your working tree.

### What the backend tells you

At boot, and again on every re-scan:

```
🧩 Loaded 1 script module(s): fem@0.1.0
👀 Watching script modules in /…/modules
🧩 modules changed — re-scanned
```

Anything malformed is skipped with a warning on those lines — check them first.

Grants and revokes take effect on the **next request**: entitlements are read from the database
per request, so there is no restart, no re-login, and no token to expire.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `not declared in this script` | The script used the global without `$module('fem')`. Declaration is required. |
| `Module 'fem': not available on your account` | Not entitled. `admin:modules --user <handle> --grant fem`. |
| `Module 'fem': needs Archiyou core ^0.9.0, but this is 1.0.0` | Manifest `engine` range excludes the running core. |
| Module missing from `GET /modules` | Not loaded — check the boot log. Usually `id` ≠ directory name, a malformed `manifest.json`, or a missing `bundle.js`/`server.js`. |
| `'fem' is already used by Archiyou` in the console | `global` collides with a core name. Nothing is bound, so scripts still work; pick another name. |
| `$module('x')` says no such module, but it is installed | The argument must be a plain string literal — a computed one cannot be read before the run. |
| Bundle 404s but the module exists | The URL's version must match the manifest exactly. Bump `version` when you redeploy. |
| Editor autocomplete missing | Only entitled modules are registered, from `manifest.completions`. |
| No docs arrow on the module's card | No `DOCS.md` in the module's own directory — check `"docs": true` in `GET /modules`. A `README.md` is deliberately not used, and a `DOCS.md` nested in `src/` or `dist/` is not picked up. |
| Edits have no effect, old code keeps running | Dev mode is off. Check for `👀 Watching script modules` at boot and `"rev"` in `GET /modules`; force with `SERVER_MODULES_DEV=1`. |
| Edits have no effect, and `rev` *is* changing | The build did not run. Check the `build` pane of `pnpm dev:modules`. |
| `pnpm-lock.yaml` shows hundreds of changed lines after `pnpm install` | Expected — pnpm wrote an importer per overlay module. Run `pnpm lockfile:public`; never commit it. |
| `pnpm install --frozen-lockfile` fails locally | Also expected while the overlay is cloned in. Use plain `pnpm install`; frozen is for CI and the server image. |

---

## Publishing a module repo

Its CI can clone **this** repository freely — archiyou-web is public, so no credentials are
needed in that direction:

```yaml
# The engine FIRST: actions/checkout cleans its target path, so checking out to
# `.` afterwards would wipe a module placed there first.
- uses: actions/checkout@v5              # the public engine
  with: { repository: ArchiyouApp/archiyou-web, path: . }
- uses: actions/checkout@v5              # your private module repo, into the overlay
  with: { path: modules/fem }
- run: pnpm install && pnpm --filter @archiyou/module-fem build
```

Since there is no pinned submodule between the two repositories, the manifest's `engine` range
is the only compatibility signal — keep it honest, and run against `main` on a schedule to catch
drift early.
