/**
 * ModuleRegistry.ts — decides which script modules a run may use, loads them,
 * and hands the Runner a plain map of globals to drop into the scope.
 *
 * Shape of the problem: loading a module bundle is asynchronous, but the scope is
 * built synchronously (Runner.buildLocalExecScopeState). So this follows the same
 * two-phase pattern as $import():
 *
 *   1. prepare()  — async, called from Runner.execute() before the run. Loads the
 *                   modules the script DECLARES with $module('name').
 *   2. globals()  — sync, called while building the scope. Returns what prepare()
 *                   resolved, with an explaining stub wherever it could not.
 *
 * Declaration is required: using a module's global without $module('name') is an
 * error, not an implicit import. A script's dependencies are then readable from
 * its source without executing it — which is what lets the runner fetch exactly
 * the right bundles up front, and lets publishing report what a design needs.
 *
 * Modules live outside this repository (see modules/README.md), so nothing here
 * knows any module by name.
 */

import semver from 'semver';
import type { AyArchiyou, AyModule, AyModuleCatalogEntry, AyModuleFactoryContext, AyModuleWarmContext } from './sdkTypes';

import { MODELER_METHODS_INTO_GLOBAL, ARCHIYOU_CORE_VERSION } from '../constants';
import { loadClientModule, ModuleLoadError } from './loadClientModule';
import { serverModuleStub, type SyncTransport } from './serverModuleStub';
import { unavailableStub, ModuleUnavailableError } from './unavailableStub';

/** Names the script scope already occupies. A module claiming one of these is
 *  refused outright rather than allowed to shadow it — a module must never be
 *  able to break a script that does not use it.
 *
 *  Mirrors Runner._addModulesToScopeState / _addGlobalsToScopeState /
 *  _addModelingMethodsToScopeState. Modeling methods are also bound lowercased
 *  by the Runner, so both cases are reserved. */
export const RESERVED_SCOPE_NAMES: ReadonlySet<string> = new Set<string>([
    // Archiyou modules
    'console', 'modeler', 'docs', 'doc', 'calc', 'annotator', 'materials', 'make', 'interactor',
    // logging helpers
    'print', 'log',
    // debugging helper
    'exit',
    // JS basics the Runner injects
    'Math', 'JSON', 'Array', 'Object', 'Number', 'String', 'Boolean',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Error',
    'roundTo', 'toRad', 'toDeg',
    // modeling functions, in both the cased and lowercased form the Runner binds
    ...MODELER_METHODS_INTO_GLOBAL,
    ...MODELER_METHODS_INTO_GLOBAL.map(m => m.toLowerCase()),
]);

/** A module global must be a plain identifier starting with a letter.
 *
 *  Excluding `$` and `_` is deliberate and load-bearing: `$` is the meta/param
 *  namespace ($import, $PARAMS and every `$PARAMNAME` written by
 *  ParamManager.setParamGlobalsInScope), and `_` is the Runner's internal scope
 *  namespace (_scope, _archiyou, _paramManager). Keeping modules out of both
 *  means a module can never collide with a user's parameter name. */
const VALID_GLOBAL_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export interface ModuleRegistryOptions
{
    /** Base URL of the Archiyou backend. '' means root-relative. */
    moduleApiUrl?: string;
    /** Bearer token of the signed-in user, needed for gated bundles and calls. */
    authToken?: string;
    /** Core version the `engine` range is checked against. Overridable for tests. */
    coreVersion?: string;
    fetchImpl?: typeof fetch;
    /** Blocking transport for server-module calls. Inside the script worker the
     *  stub finds one itself (sync XHR); this is the injection point for tests
     *  and for hosts that provide their own bridge. */
    callSync?: SyncTransport;
    /** Full override of client-module loading, for tests. Also used for the
     *  client wrapper of a hybrid module — `opts.factoryContext.server` then
     *  carries the server stub the wrapper must be constructed with. */
    loadClient?: (manifest: AyModuleCatalogEntry, opts: ModuleRegistryOptions & { factoryContext?: AyModuleFactoryContext }) => Promise<AyModule>;
}

/** Why a module is not usable this run. */
interface RejectedModule
{
    global: string;
    id: string;
    reason: string;
}

export class ModuleRegistry
{
    private _opts: ModuleRegistryOptions = {};

    /** Client module instances, keyed `id@version`. Kept ACROSS runs: a module
     *  may hold something expensive (a wasm instance, a loaded dataset) and the
     *  Runner builds a fresh scope every run. Per-run state is cleared by the
     *  module's own reset(). */
    private _instances: Record<string, AyModule> = {};

    /** Resolved for the current run: global name -> value to put in the scope. */
    private _globals: Record<string, any> = {};

    /** Diagnostics for the current run, for logging and tests. */
    private _rejected: Array<RejectedModule> = [];

    /** id -> global, so $module() can be called with either. */
    private _idToGlobal: Record<string, string> = {};

    /** Why a module is unusable, keyed by BOTH its id and its global, so
     *  $module() can explain itself whichever name the script used. */
    private _reasons: Record<string, string> = {};

    setOptions(opts: ModuleRegistryOptions): this
    {
        this._opts = { ...this._opts, ...opts };
        return this;
    }

    get options(): ModuleRegistryOptions { return this._opts; }

    /** Modules refused this run, with the reason. */
    get rejected(): ReadonlyArray<RejectedModule> { return this._rejected; }

    /** Does this script mention the module's global at all?
     *
     *  Loading a bundle is expensive, so an ordinary script must not pay for a
     *  module it never touches. Same trade-off as $import()'s URL pre-scan: a
     *  dynamically-built name (`scope['exa'+'mple']`) is not detected, which is
     *  an accepted limitation rather than a bug. */
    static referencesGlobal(code: string, globalName: string): boolean
    {
        if(!code || !globalName) return false;
        const escaped = globalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`).test(code);
    }

    /** Problems that make the module's NAME unusable.
     *
     *  Kept separate from _validateUsable() because the two demand opposite
     *  handling. A module that claims a name it may not have must have NOTHING
     *  bound under it: binding even an explaining stub under, say, 'box' would
     *  shadow the real `box` for every script — exactly the breakage the reserved
     *  list exists to prevent. So these are reported and then dropped entirely. */
    private _validateName(entry: AyModuleCatalogEntry): string | null
    {
        if(!entry?.id) return 'manifest has no id';
        if(!entry?.global) return 'manifest has no global';

        if(!VALID_GLOBAL_RE.test(entry.global))
        {
            return `'${entry.global}' is not a valid global name (letters, digits and _ only, must start with a letter)`;
        }
        if(RESERVED_SCOPE_NAMES.has(entry.global))
        {
            return `'${entry.global}' is already used by Archiyou`;
        }
        return null;
    }

    /** Problems that leave the name legitimately module-owned, so binding a stub
     *  under it is safe and tells the user something useful. */
    private _validateUsable(entry: AyModuleCatalogEntry): string | null
    {
        if(entry.runtime !== 'client' && entry.runtime !== 'server')
        {
            return `unknown runtime '${entry.runtime}'`;
        }

        const coreVersion = this._opts.coreVersion ?? ARCHIYOU_CORE_VERSION;
        if(entry.engine)
        {
            // Modules and the engine live in separate repositories with no pinned
            // checkout between them, so this range is the only compatibility
            // signal there is. An invalid range is treated as a mismatch rather
            // than ignored — silently loading would be the worse failure.
            let ok = false;
            try { ok = semver.satisfies(coreVersion, entry.engine); }
            catch { ok = false; }

            if(!ok)
            {
                return `needs Archiyou core ${entry.engine}, but this is ${coreVersion}`;
            }
        }

        return null;
    }

    /** Check a manifest against the running core and the occupied scope names.
     *  Returns null when the manifest is fine, else the reason it is not. */
    validate(entry: AyModuleCatalogEntry): string | null
    {
        return this._validateName(entry) ?? this._validateUsable(entry);
    }

    /** Resolve every module this script references. Async: client bundles are
     *  fetched here so that globals() can stay synchronous.
     *
     *  Never throws — a module that cannot be resolved becomes a stub that
     *  explains itself when touched. One broken module must not take down a run
     *  that also uses working ones. */
    async prepare(code: string, catalog: Array<AyModuleCatalogEntry> | undefined): Promise<void>
    {
        this._globals = {};
        this._rejected = [];
        this._idToGlobal = {};
        this._reasons = {};

        if(!catalog?.length || !code) return;

        catalog.forEach(e => { if(e?.id && e?.global) this._idToGlobal[e.id] = e.global; });

        // Names are validated across the WHOLE catalog, not just the referenced
        // part: a malformed manifest is an operator problem, and it should be
        // reported the first time anyone runs — not stay silent until someone
        // happens to write a script that uses it.
        const usable: Array<AyModuleCatalogEntry> = [];
        for(const entry of catalog)
        {
            const badName = this._validateName(entry);
            if(badName)
            {
                // Recorded and logged, but nothing is BOUND — see _validateName.
                // The reason is still recorded by name so $module('box') can say
                // why rather than claiming no such module exists.
                this._rejected.push({ global: entry?.global ?? '?', id: entry?.id ?? '?', reason: badName });
                if(entry?.id) this._reasons[entry.id] = badName;
                continue;
            }
            usable.push(entry);
        }

        // Two modules claiming one global would otherwise resolve by array order,
        // which is arbitrary. Refuse both rather than silently pick one.
        const claims = new Map<string, number>();
        usable.forEach(e => claims.set(e.global, (claims.get(e.global) ?? 0) + 1));

        // A module is loaded ONLY when the script declares it with $module('name'),
        // by id or by global. Nothing else fetches anything.
        const declared = new Set(ModuleRegistry.extractDeclaredNames(code));
        const isDeclared = (e: AyModuleCatalogEntry) => declared.has(e.id) || declared.has(e.global);
        const referenced = usable.filter(isDeclared);

        // A script that uses a module's global WITHOUT declaring it gets a stub
        // that says so. This is the only remaining use of the word match, and it
        // costs nothing: no network, no module, just a better error than the
        // `undefined is not a function` the bare name would otherwise produce.
        //
        // It also makes the word match's roughness harmless — a module named in a
        // comment now binds an unused stub instead of downloading a solver.
        usable
            .filter(e => !isDeclared(e) && ModuleRegistry.referencesGlobal(code, e.global))
            .forEach((e) =>
            {
                this._globals[e.global] = unavailableStub(e.global, e.id,
                    `not declared in this script — add $module('${e.id}') before using it`);
            });

        await Promise.all(referenced.map(async (entry) =>
        {
            if((claims.get(entry.global) ?? 0) > 1)
            {
                return this._reject(entry, `more than one module claims the global '${entry.global}'`);
            }

            const invalid = this._validateUsable(entry);
            if(invalid) return this._reject(entry, invalid);

            if(!entry.entitled)
            {
                return this._reject(entry, 'not available on your account');
            }

            // A server module's stub. It is either the global itself, or — for a
            // hybrid module (manifest.client) — what the client wrapper is built
            // around, so it is created before the runtime split below.
            const stub = (entry.runtime === 'server')
                ? serverModuleStub(entry, {
                    moduleApiUrl: this._opts.moduleApiUrl ?? '',
                    authToken: this._opts.authToken,
                    fetchImpl: this._opts.fetchImpl,
                    callSync: this._opts.callSync,
                })
                : null;

            if(entry.runtime === 'server' && entry.client !== true)
            {
                this._globals[entry.global] = stub;
                return;
            }

            // client runtime, or the client wrapper of a hybrid module.
            // `rev` is only present in module-dev mode, and it is what makes a
            // rebuild at an unchanged version count as a different module — the
            // instance cache below would otherwise happily serve the previous
            // build for the rest of the session.
            //
            // A hybrid wrapper is cached the same way. Its stub carries the
            // CURRENT run's auth token, so it is refreshed on the instance each
            // run rather than baked in at load time (see _instanceStubs).
            const key = `${entry.id}@${entry.version}${entry.rev ? `#${entry.rev}` : ''}`;
            const cached = this._instances[key];
            if(cached)
            {
                if(stub) this._refreshStub(cached, stub);
                this._globals[entry.global] = cached;
                return;
            }

            try
            {
                const factoryContext: AyModuleFactoryContext | undefined = stub ? { server: stub } : undefined;
                const load = this._opts.loadClient
                    ?? ((m: AyModuleCatalogEntry) => loadClientModule(m, {
                        moduleApiUrl: this._opts.moduleApiUrl ?? '',
                        authToken: this._opts.authToken,
                        fetchImpl: this._opts.fetchImpl,
                        factoryContext,
                    }));

                const instance = await load(entry, { ...this._opts, factoryContext });

                // Drop earlier builds of this same module. Without this a dev
                // session that rebuilds fifty times keeps fifty instances alive,
                // each possibly holding a wasm instance or a loaded dataset.
                Object.keys(this._instances)
                    .filter(k => k === entry.id || k.startsWith(`${entry.id}@`))
                    .forEach(k => { delete this._instances[k]; });

                this._instances[key] = instance;
                this._globals[entry.global] = instance;
            }
            catch(e)
            {
                const reason = (e instanceof ModuleLoadError)
                    ? e.message
                    : `could not be loaded (${(e as Error)?.message})`;
                this._reject(entry, reason);
            }
        }));

        if(this._rejected.length)
        {
            this._rejected.forEach(r =>
                console.warn(`ModuleRegistry: module '${r.id}' unavailable — ${r.reason}`));
        }
    }

    private _reject(entry: AyModuleCatalogEntry, reason: string): void
    {
        this._rejected.push({ global: entry.global, id: entry.id, reason });
        this._reasons[entry.id] = reason;
        this._reasons[entry.global] = reason;
        this._globals[entry.global] = unavailableStub(entry.global, entry.id, reason);
    }

    /** Names declared with `$module('name')`. Extracting these is what lets a
     *  script alias a module (`cc = $module('cloudcalc')`) without ever writing
     *  the bare global — the word-match pre-scan alone would never load it. */
    static extractDeclaredNames(code: string): Array<string>
    {
        const names = new Set<string>();
        // The literal must be followed by `,` or `)` so that a CONCATENATED
        // argument — $module('a' + 'b') — is not mistaken for the name 'a', which
        // would fetch a module the script never asked for. Allowing `,` leaves
        // room for a second argument (a version range) without touching this.
        const re = /\$module\s*\(\s*(['"`])([^'"`]+)\1\s*[,)]/g;
        let m: RegExpExecArray | null;
        while((m = re.exec(code)) !== null)
        {
            const name = m[2].trim();
            if(name) names.add(name);
        }
        return Array.from(names);
    }

    /**
     * Back the in-scope `$module(name)`.
     *
     * Throws rather than returning a stub, so an unusable module fails AT THE
     * DECLARATION — before the script builds anything — instead of at whatever
     * line first touches it. That earlier, more precise failure is the main
     * reason to declare a module rather than just use its global.
     *
     * Accepts the module's id or its global; they are usually the same.
     */
    resolve(name: string): any
    {
        const globalName = this._idToGlobal[name] ?? name;

        const reason = this._reasons[name] ?? this._reasons[globalName];
        if(reason) throw new ModuleUnavailableError(name, `$module('${name}'): ${reason}`);

        const resolved = this._globals[globalName];
        if(resolved !== undefined) return resolved;

        // Not in the catalog at all: either the id is wrong or the module is not
        // installed here. Distinguishing those needs server state the script does
        // not have, so say both.
        throw new ModuleUnavailableError(name,
            `$module('${name}'): no such module — check the name, or it is not installed on this server`);
    }

    /** Hand each resolved client module the engine back-reference and let it drop
     *  per-run state. Mirrors how Runner.initLocalArchiyou wires the built-in
     *  modules via setArchiyou(). Stubs have no lifecycle, so they are skipped. */
    linkToArchiyou(archiyou: AyArchiyou): void
    {
        Object.values(this._globals).forEach((mod: any) =>
        {
            // Only real instances; the stubs' Proxy traps would throw on access.
            if(!this._isInstance(mod)) return;
            try
            {
                mod.setArchiyou(archiyou);
                if(typeof mod.reset === 'function') mod.reset();
            }
            catch(e)
            {
                console.error(`ModuleRegistry: module threw during setup: ${(e as Error)?.message}`);
            }
        });
    }

    /** Let each resolved client module do async per-run setup before the script
     *  runs. Called from Runner.execute(), where awaiting is still possible —
     *  the scope build below is synchronous by design.
     *
     *  A warm-up is an optimisation, so a module that throws (or hangs on a
     *  dead network) is logged and left as it was. Only init() failing is fatal,
     *  because that leaves a module half-constructed; this does not. */
    async warmModules(ctx: AyModuleWarmContext): Promise<void>
    {
        const pending = Object.entries(this._globals)
            .filter(([, mod]) => this._isInstance(mod) && typeof (mod as any).warm === 'function')
            .map(async ([name, mod]) =>
            {
                try
                {
                    await (mod as any).warm(ctx);
                }
                catch(e)
                {
                    console.warn(`ModuleRegistry: module '${name}' failed to warm up: ${(e as Error)?.message}`);
                }
            });

        if(pending.length === 0) return;
        await Promise.all(pending);
    }

    private _isInstance(value: any): boolean
    {
        return Object.values(this._instances).includes(value);
    }

    /** Hand a cached hybrid wrapper this run's server stub.
     *
     *  The wrapper was constructed with the stub of the run that first loaded
     *  it, and that stub holds the bearer token of THAT run. Tokens rotate and
     *  users sign out, so on every later run the wrapper is told about the new
     *  stub through the conventional `setServer(stub)` hook, if it has one. A
     *  wrapper without the hook keeps its original stub — fine for a
     *  single-session editor, wrong after a re-login, hence the convention. */
    private _refreshStub(instance: AyModule, stub: any): void
    {
        if(typeof (instance as any).setServer === 'function')
        {
            try { (instance as any).setServer(stub); }
            catch(e) { console.warn(`ModuleRegistry: module rejected its server stub: ${(e as Error)?.message}`); }
        }
    }

    /** The scope globals for this run: `{ example: <module|stub> }`. Synchronous
     *  by design — see the two-phase note at the top. */
    globals(): Record<string, any>
    {
        return { ...this._globals };
    }
}
