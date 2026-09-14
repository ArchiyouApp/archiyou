/**
 *  sdkTypes.ts — GENERATED, do not edit.
 *
 *  A verbatim copy of packages/module-sdk/src/types.ts, which is where the module contract is
 *  authored. It is copied in because that package is internal to the Archiyou monorepo and is
 *  never published, while this one is: importing it by name would leave every published
 *  declaration pointing at a package no consumer can install.
 *
 *  Edit the original, then run:  pnpm --filter @archiyou/core sync:sdk-types
 */

/**
 * types.ts — the contract between Archiyou and a script module.
 *
 * A script module adds one global to the scope a user script runs in (see
 * packages/core/src/runner/Runner.ts). Modules are distributed separately from
 * this repository and may be separately licensed, so this file is the ONLY
 * coupling point between the two: a module compiles against these types and
 * nothing else.
 *
 * Deliberately dependency-free — importing anything from @archiyou/core here
 * would make every module repo depend on the whole engine to typecheck. Where a
 * real core type is wanted, it is modelled structurally (see AyArchiyou) so
 * core's own types stay assignable to it.
 *
 * This file is AUTHORED HERE and MIRRORED into the engine as
 * packages/core/src/modules/sdkTypes.ts, a generated verbatim copy. Core is
 * published to npm and this package is not, so core cannot import it by name
 * without shipping an unresolvable import. After editing this file run
 * `pnpm --filter @archiyou/core sync:sdk-types`; a unit test there fails while
 * the copy is stale.
 */

//// MANIFEST ////

/** Where a module's code actually runs.
 *
 *  'client' — a self-contained ESM bundle imported into the Web Worker that runs
 *  scripts. Fast, offline-capable, methods may be synchronous; but an entitled
 *  user can read the bundle.
 *
 *  'server' — the code never leaves the backend. The script-facing global is a
 *  stub that forwards each call over HTTP. Inside the script worker that call is
 *  SYNCHRONOUS (a worker may block on a request), so a script needs no `await`;
 *  anywhere else the stub returns a Promise. Use this for heavy computation or
 *  anything that should not be distributed.
 *
 *  A server module may additionally ship a small client wrapper — see
 *  AyModuleManifest.client — so the script sees objects with methods rather than
 *  a bag of remote procedures.
 */
export type AyModuleRuntime = 'client' | 'server';

/** One editor-autocomplete entry contributed by a module. Shaped to map directly
 *  onto a CodeMirror Completion (see packages/ui/src/editor/completions.ts) —
 *  modules get autocomplete without this package depending on the editor. */
export interface AyModuleCompletion {
    /** Member name, e.g. 'solve'. */
    label: string;
    /** Short signature shown beside the label, e.g. '(model, loads) => Result'. */
    detail?: string;
    /** Longer description shown in the completion's info panel. */
    info?: string;
    type?: 'method' | 'property' | 'function' | 'class';
}

/** A module's manifest.json. Read by the backend at boot and handed to the
 *  runner, which validates it before the module is allowed into a scope. */
export interface AyModuleManifest {
    /** Unique, stable id. Used in URLs and in a user's entitlement list, so
     *  renaming one revokes access for everybody who had it. */
    id: string;
    /** The name the script sees, e.g. `example.solve(...)`. Usually equal to
     *  `id`. Validated against every name the runner already occupies; a module
     *  that would shadow a core global is refused, never silently allowed. */
    global: string;
    /** Human-readable name for the module list in the editor. */
    name: string;
    /** Semver of the module itself. Appears in the bundle URL, so it doubles as
     *  the cache key — bump it to invalidate a deployed bundle. */
    version: string;
    /** Semver RANGE of @archiyou/core this module supports, e.g. '^0.9.0'.
     *  Checked at load time. This is what replaces a pinned submodule SHA:
     *  module and engine live in separate repos, so compatibility has to be
     *  declared rather than inferred from a checkout. */
    engine: string;
    runtime: AyModuleRuntime;
    /** Shown in the editor's module list, including to users who lack access —
     *  so keep it descriptive rather than secret. */
    description?: string;
    docsUrl?: string;
    /** Optional autocomplete entries, merged into the editor for entitled users. */
    completions?: Array<AyModuleCompletion>;
    /**
     * Available to everyone, with no entitlement.
     *
     * The module system exists to gate closed-source capabilities, so gating is the
     * default and this is the deliberate opt-out. An open-source module — one whose
     * source anybody can read and build — has nothing to protect, and requiring an
     * admin grant before it would run made it administratively indistinguishable
     * from a paid one.
     *
     * A public module still appears in the catalog, still declares its `engine`
     * range, and is still refused if its name collides with a core global. The only
     * thing that changes is that `entitled` is true for everybody, so the bundle
     * route and the server-call route stop checking `users.modules`.
     *
     * Set by the DEPLOYMENT, not by the user: manifests live in the installed module,
     * so whoever installs a module decides whether it is public.
     */
    public?: boolean;
    /**
     * A `runtime: 'server'` module that ALSO ships a client wrapper bundle.
     *
     * The wrapper is loaded like a client module, but its factory receives the
     * server stub (`{ server }`, see AyModuleFactoryContext) and returns the
     * object the script sees. That is how a server module offers an object API —
     * `wb = mod.open(url); wb.compute(...)` — instead of flat remote calls: the
     * wrapper holds the descriptors and forwards each method to `server.*`.
     *
     * The wrapper is readable by every entitled user, like any client bundle. Keep
     * secrets and heavy code on the server side; the wrapper is ergonomics only.
     * Ignored for `runtime: 'client'`.
     */
    client?: boolean;
}

/** A manifest as served by `GET /modules`, annotated for the current caller.
 *  Locked modules are listed rather than hidden, so the editor can show what
 *  exists and offer an upgrade path instead of failing mysteriously. */
export interface AyModuleCatalogEntry extends AyModuleManifest {
    entitled: boolean;
    /** True when the module ships a DOCS.md the backend can serve — `GET
     *  /modules/:id/docs`.
     *
     *  DOCS.md rather than README.md: a module's README is written for whoever
     *  builds and deploys it, and mixes the script-facing API with build steps,
     *  environment variables and the reasoning behind its security guards. This
     *  route is PUBLIC, so what it serves has to be the half written for the
     *  person using the module. Splitting the file is what makes that a decision
     *  the module author makes deliberately rather than one the editor makes by
     *  publishing whatever happened to be in the README.
     *
     *  A flag rather than the text itself: documentation is far larger than the
     *  rest of an entry, and the catalog is fetched on every run. The editor uses
     *  it to decide whether a module card offers a "read the docs" affordance at
     *  all, and fetches the markdown only once someone asks for it.
     *
     *  Unrelated to `docsUrl`, which points somewhere else entirely. */
    docs?: boolean;
    /** Content fingerprint of the built module, present only while the backend
     *  runs in module-dev mode.
     *
     *  During development a module is rebuilt many times at the SAME version, so
     *  version alone cannot answer "is this the build I already have". The runner
     *  folds this into its module cache key and into the bundle URL, which is
     *  what makes an edit show up on the next run instead of silently reusing the
     *  previous build. Absent in production, where a version bump is the key. */
    rev?: string;
}

//// CLIENT MODULES ////

/** The back-reference every module receives, giving access to the rest of the
 *  engine (modeler, calc, docs, the active kernel, …).
 *
 *  Structurally compatible with core's `ArchiyouModules`, but typed loosely so
 *  this package stays dependency-free. A module developed inside the workspace
 *  overlay can import core's real types directly if it wants them. */
export interface AyArchiyou {
    console: any;
    modeler: any;
    calc: any;
    docs: any;
    annotator: any;
    interactor: any;
    runner: any;
    materials: any;
    /** The registry itself, so one module can reach another. */
    modules?: any;
    oc?: any;
    meshup?: any;
    [key: string]: any;
}

/** What a module is told about the run when warm() is called.
 *
 *  Deliberately not the whole request: a warm-up needs to know how to fetch, not
 *  what the user is modelling. */
export interface AyModuleWarmContext {
    /** Base URL of the Archiyou asset proxy — `${assetProxyUrl}/proxy?url=…`.
     *  Undefined when the run has none, in which case a module that needs the
     *  network should skip its warm-up rather than attempt a direct fetch. */
    assetProxyUrl?: string;
}

/** A live client module instance.
 *
 *  Follows the same convention as every built-in Archiyou module: construct
 *  empty, then receive the back-reference via setArchiyou(). The runner builds a
 *  fresh scope per run and calls reset() rather than reconstructing, so a module
 *  holding an expensive resource (a WASM instance, a loaded dataset) keeps it
 *  across runs. */
export interface AyModule {
    /**
     * One-time async setup, awaited right after the factory runs and before the
     * module is ever handed to a script. Load WASM, fetch a dataset, warm a
     * cache here.
     *
     * This is what lets a module's script-facing methods stay SYNCHRONOUS: the
     * expensive async work happens once, up front, while the runner is still
     * preparing — the same trick $import() uses to avoid making user scripts
     * await. Called once per loaded instance, not once per run (that is reset()).
     *
     * Throwing here fails the module cleanly: the script gets a stub explaining
     * why, rather than a half-initialised module.
     */
    init?(): Promise<void>;
    /**
     * Optional async per-run warm-up, awaited BEFORE the script executes.
     *
     * The difference from init() is that this one knows about the run, so it can
     * use the asset proxy — init() fires before the module has any idea which
     * execution it belongs to, and a browser worker cannot fetch a third-party
     * host without going through the proxy.
     *
     * Use it to pull in whatever the script should be able to reach
     * synchronously. Keep it cheap on repeat: it runs on every execution, so
     * cache across runs rather than refetching.
     *
     * Throwing here does NOT fail the run — unlike init(), a warm-up is an
     * optimisation. The error is logged and the module is used as-is.
     */
    warm?(ctx: AyModuleWarmContext): Promise<void>;
    /** Called once per run, before the script executes. */
    setArchiyou(ay: AyArchiyou): void;
    /** Called once per run, after setArchiyou — drop per-run state here. */
    reset?(): void;
    /** The script-facing API. Anything else on the object is callable from a
     *  user script as `<global>.<name>(...)`. */
    [key: string]: any;
}

/** What a client bundle's factory is handed when constructed. */
export interface AyModuleFactoryContext {
    /** For the wrapper of a hybrid module (AyModuleManifest.client): the
     *  server-module stub. Every member access is a call to the server's
     *  `methods` — synchronous inside the script worker, a Promise elsewhere.
     *  Absent for an ordinary client module. */
    server?: any;
}

/** A client bundle's default export. A plain client module ignores the context. */
export type AyModuleFactory = (ctx?: AyModuleFactoryContext) => AyModule;

//// SERVER MODULES ////

/** One callable method of a server module. Arguments and the return value cross
 *  the network as JSON, so both must be JSON-serializable. */
export type AyServerModuleMethod = (args: any) => Promise<any> | any;

/** A server bundle's default export. Only the names in `methods` are reachable
 *  from a script — an explicit allowlist, so nothing else on the module is
 *  exposed by accident. */
export interface AyServerModule {
    methods: Record<string, AyServerModuleMethod>;
}

//// AUTHORING HELPERS ////

/** Identity function that pins the type of a client module's default export, so
 *  mistakes surface in the module's own build rather than at load time. */
export function defineModule(factory: AyModuleFactory): AyModuleFactory {
    return factory;
}

/** Identity function that pins the type of a server module's default export. */
export function defineServerModule(mod: AyServerModule): AyServerModule {
    return mod;
}
