/**
 * loadClientModule.ts — fetch and instantiate a `runtime: 'client'` module bundle.
 *
 * WHY FETCH-THEN-BLOB RATHER THAN A PLAIN import(url):
 * the bundle route is entitlement-gated and this app authenticates with a Bearer
 * token, but dynamic import() offers no way to set request headers. So the bundle
 * is fetched with the token, turned into a blob URL, and imported from there.
 *
 * A consequence worth knowing when authoring modules: a blob URL has no useful
 * base, so a bundle CANNOT contain relative imports back to the server. Module
 * bundles must be self-contained.
 */

import type { AyModule, AyModuleFactory, AyModuleFactoryContext, AyModuleManifest } from './sdkTypes';

export interface LoadClientModuleOptions
{
    /** Base URL of the Archiyou backend. '' means root-relative. */
    moduleApiUrl: string;
    authToken?: string;
    /** Injectable for tests — Node has no reliable blob-URL import. */
    fetchImpl?: typeof fetch;
    /** Injectable for tests: turn bundle source into its module namespace. */
    importImpl?: (source: string, manifest: AyModuleManifest) => Promise<any>;
    /** Handed to the factory. For the wrapper of a hybrid module this carries
     *  the server stub (see AyModuleFactoryContext); plain client modules get
     *  nothing and ignore it. */
    factoryContext?: AyModuleFactoryContext;
}

/** Raised when a module bundle cannot be fetched or instantiated. `notEntitled`
 *  separates "you may not have this" from "this is broken", so the message shown
 *  to the user can be accurate about which. */
export class ModuleLoadError extends Error
{
    readonly moduleId: string;
    readonly notEntitled: boolean;

    constructor(moduleId: string, message: string, notEntitled = false)
    {
        super(message);
        this.name = 'ModuleLoadError';
        this.moduleId = moduleId;
        this.notEntitled = notEntitled;
    }
}

/** Default import strategy: blob URL + dynamic import. Browser/Worker only. */
async function importFromSource(source: string, manifest: AyModuleManifest): Promise<any>
{
    if(typeof URL?.createObjectURL !== 'function')
    {
        throw new ModuleLoadError(manifest.id,
            `client module '${manifest.id}' needs a browser-like environment (URL.createObjectURL is unavailable)`);
    }

    const blob = new Blob([source], { type: 'text/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try
    {
        // @vite-ignore: the URL is only known at runtime; Vite must not try to
        // resolve or pre-bundle it.
        return await import(/* @vite-ignore */ blobUrl);
    }
    finally
    {
        URL.revokeObjectURL(blobUrl);
    }
}

/** Build the gated bundle URL. The version is in the path so a deployed bundle
 *  can be cached immutably and invalidated by bumping the manifest version.
 *
 *  In module-dev mode the catalog also carries a per-build `rev`, appended here
 *  as a query parameter: the server sends `no-store` then, but a distinct URL
 *  means even an over-eager intermediate cache cannot hand back the last build. */
export function clientBundleUrl(
    manifest: AyModuleManifest & { rev?: string },
    moduleApiUrl: string,
): string
{
    const base = (moduleApiUrl ?? '').replace(/\/+$/, '');
    const path = `${base}/modules/${encodeURIComponent(manifest.id)}/${encodeURIComponent(manifest.version)}/bundle.js`;
    return manifest.rev ? `${path}?rev=${encodeURIComponent(manifest.rev)}` : path;
}

export async function loadClientModule(
    manifest: AyModuleManifest,
    opts: LoadClientModuleOptions,
): Promise<AyModule>
{
    const doFetch = opts.fetchImpl ?? globalThis.fetch;
    const doImport = opts.importImpl ?? importFromSource;
    const url = clientBundleUrl(manifest, opts.moduleApiUrl);

    let res: Response;
    try
    {
        res = await doFetch(url, {
            headers: opts.authToken ? { Authorization: `Bearer ${opts.authToken}` } : {},
        });
    }
    catch(e)
    {
        throw new ModuleLoadError(manifest.id,
            `could not reach the server (${(e as Error)?.message})`);
    }

    if(!res.ok)
    {
        // 401/403 is the entitlement gate doing its job — a different situation
        // for the user than a missing or broken bundle, so say so.
        const notEntitled = (res.status === 401 || res.status === 403);
        throw new ModuleLoadError(manifest.id,
            notEntitled
                ? 'not available on your account'
                : `could not be loaded (HTTP ${res.status})`,
            notEntitled);
    }

    const source = await res.text();

    let namespace: any;
    try
    {
        namespace = await doImport(source, manifest);
    }
    catch(e)
    {
        throw new ModuleLoadError(manifest.id,
            `bundle failed to load: ${(e as Error)?.message}`);
    }

    const factory = (namespace?.default ?? namespace) as AyModuleFactory;
    if(typeof factory !== 'function')
    {
        throw new ModuleLoadError(manifest.id,
            `bundle does not default-export a factory function (see defineModule in the module contract, src/modules/sdkTypes.ts)`);
    }

    let instance: AyModule;
    try
    {
        instance = factory(opts.factoryContext);
    }
    catch(e)
    {
        throw new ModuleLoadError(manifest.id,
            `factory threw while constructing: ${(e as Error)?.message}`);
    }

    if(!instance || typeof instance !== 'object')
    {
        throw new ModuleLoadError(manifest.id, `factory did not return a module object`);
    }
    if(typeof instance.setArchiyou !== 'function')
    {
        throw new ModuleLoadError(manifest.id, `module does not implement setArchiyou(ay)`);
    }

    // One-time async setup (WASM, datasets). Awaited HERE, while the runner is
    // still preparing, so the module's own methods can be synchronous when the
    // script finally calls them.
    if(typeof instance.init === 'function')
    {
        try
        {
            await instance.init();
        }
        catch(e)
        {
            // A module that failed to initialise must not reach a script looking
            // usable — the registry turns this into an explaining stub.
            throw new ModuleLoadError(manifest.id,
                `failed to initialise: ${(e as Error)?.message}`);
        }
    }

    return instance;
}
