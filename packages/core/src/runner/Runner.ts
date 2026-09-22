/**
 *  Archiyou Runner.ts
 * 
 *  Easily execute Archiyou scripts in different contexts. 
 *  Currently support execution in main thread, and workers (use RunnerWorker) 
 * 
 *  WARNING: a Runner maintains seperate states (for example seperate for component) but execution is not sandboxed. 
 *   
 *  For requesting results we use output paths in RunnerExecutionRequest.outputs:
 *  
 *  For example: 
*/
 //      - default/models/glb: get the default model in GLB format with default options
 //      - default/models/dxf?2d: get the default model in DXF format with 2D options
 //      - default/docs/*/pdf // get all documents in PDF format
 //      - sketch/tables/*/*  // execute sketch pipeline and get all tables in all formats
 //      - [WIP] */*/*/* // execute all pipelines, all entities and all formats (for example for cache purposes)
 //


import type { ArchiyouModules, ArchiyouStateData } from '../types'; // general types

import { ScriptOutputData,
    ExecutionRequestOutputFormatGLTFOptions } from '../execution/types'; // types for execution outputs and formats

// Runner
import type { RunnerActiveScope,
    RunnerScriptExecutionRequest,
    RunnerScriptExecutionResult,
    RunnerScriptScope } from './types'; // Runner types


import { RunnerComponentImporter } from './RunnerComponentImporter'; // helper for importing components in scope
import { ScriptExitSignal, isScriptExitSignal, SCRIPT_EXIT_WARNING } from './ScriptExit';
import { extractTopLevelComponentCalls, extractFirstArg, parseAuthoredComponentRef, parseVersionedLocalComponentRef, DEV_COMPONENT_VERSION, MAX_COMPONENT_DEPTH, type ComponentCall } from './componentRefs'; // $component() reference parsing (shared with the editor)
import { Importer as AssetImporter } from '../importer/Importer'; // $import: fetch+parse remote assets
import type { AssetPayload } from '../importer/Importer';


// Execution
import { Script } from '../Script'; // Script class for handling script data and params
import { ScriptParam } from '../execution/ScriptParam'; 
import { ScriptOutputManager } from '../execution/ScriptOutputManager'; 
import type { ScriptOutputFormat, ScriptOutputFormatModel, ScriptStatement, ScriptStatementResult, ScriptParamData, ScriptData, ScriptMeta } from '../execution/types'; // Script output format types
import { CodeParser } from '../execution/CodeParser'; // helper for parsing code into ScriptStatements and pipelines
import { Pipeline } from '../execution/Pipeline'; // Pipeline class
import { ScriptOutputPath } from '../execution/ScriptOutputPath';

import { roundTo, hash, toRad, toDeg } from '../utils';
import type { ConsoleMessageType } from '../console/types';
import type { DocData } from '../docs/types';
import { Db } from '../calc/Db';

// Archiyou modules
import { Console, NATIVE_CONSOLE } from '../console/Console';
import { Modeler, loadIFCModule, loadFabModule } from '../modeler/Modeler';
import type { ModelMode } from '../modeler/types';
import { isAnyShape } from '../modeler/types';
import { Annotator } from '../annotator/Annotator';
import { Interactor } from '../interaction/Interactor';
import { Calc } from '../calc/Calc';
import { Docs } from '../docs/Docs';
import { MaterialManager } from '../materials/MaterialManager';
import { ModuleRegistry } from '../modules/ModuleRegistry'; // optional, entitlement-gated script modules

// Settings
import { MODELER_METHODS_INTO_GLOBAL, SCRIPT_OUTPUT_GLTF_OPTIONS_DEFAULT, outputsNeedRecipes } from '../constants'; 
import { ParamManager } from '../execution/ParamManager';
import type { Make } from '../modeler/Make';
import type { FabFacade } from '../modeler/Fab';
import type { Handle } from '../interaction/Handle';
import type { ShapeCollection } from '@archiyou/meshup';

/**
 * What a script can use besides the modeling functions (`box()`, `sketch()`, …, see
 * MODELER_METHODS_INTO_GLOBAL): the modules, the `$` functions and the helpers.
 *
 * Documentation only. The Runner builds the real scope in _addModulesToScopeState(),
 * _addLoggingToScopeState() and _addMetaMethodsToScopeState(); this interface is what
 * the editor's API reference (scripts/generate-api.ts) reads to describe them. Keep
 * the two in step when adding a global.
 */
export interface ScriptGlobals
{
    //// MODULES ////

    /** Drawings and documents: pages with views of the model, text, tables and images.
     *
     *  @example
     *  b = box(100, 60, 40)
     *  doc.create('drawing')
     *     .page('front')
     *     .view('front')
     *     .text('A box')
     */
    doc: Docs;
    /** Same as `doc` */
    docs: Docs;
    /** Tables and metrics: numbers and lists that come out of the model, shown in the
     *  Data and Metrics tools and available to configurators.
     *
     *  @example
     *  b = box(100, 60, 40)
     *  calc.metric('Volume', Math.round(b.volume()), { unit: 'mm3' })
     */
    calc: Calc;
    /** Ready-made building parts: walls, floors, frames and part lists. */
    make: Make;
    /** Fabrication: how the parts of the model are cut, joined and priced. */
    fab: FabFacade;
    /** Materials to assign to shapes, with their colour, weight and carbon. */
    materials: MaterialManager;
    /** The parameters of the script. `$PARAMS.define()` adds one; every parameter is
     *  also available as its own global, like `$WIDTH`.
     *
     *  @example
     *  $PARAMS.define('WIDTH', 'number', { default: 100, minimum: 50, maximum: 200 })
     *  box($WIDTH, 50, 20)
     */
    $PARAMS: ParamManager;

    //// $ FUNCTIONS ////

    /** Use another script as a component. Returns an importer: set its parameters with
     *  `.params()` and get the shapes with `.get()`. Without a name it lists the scripts
     *  you can use.
     *
     *  @param name The script: `'./name'` for one of your own, `'@author/name:version'` for a published one
     *  @param params Parameter values for the component, same as `.params()`
     */
    $component(name?: string, params?: Record<string, any>): RunnerComponentImporter;
    /** Register a pipeline: a named step that runs after the model, for instance to
     *  prepare shapes for a drawing.
     *
     *  @param name Name of the pipeline, referred to by docs and outputs
     *  @param fn The function to run
     */
    $pipeline(name: string, fn: () => any): void;
    /** Declare a script module (an optional extension installed on the server) and get it.
     *
     *  @param name Name of the module, e.g. `'cloudcalc'`
     */
    $module(name: string): any;
    /** Make a handle: a point in the viewer that users drag to change a parameter.
     *  Place it with `.start(target)` or `.at(target)`. */
    $handle(): Handle;
    /** Import a file from the web (SVG, GeoJSON, DXF, STL, OBJ, glTF, AMF, 3MF) as shapes.
     *  The address must be written out as text, not computed.
     *
     *  @param url Web address of the file
     *  @param opts Import options, such as scaling and centring
     */
    $import(url: string, opts?: Record<string, any>): ShapeCollection;

    //// HELPERS ////

    /** Print values to the console, like `console.log()`. Objects are printed as data.
     *
     *  @example
     *  b = box(100, 60, 40)
     *  print('volume', b.volume())
     */
    print(...values: any[]): void;
    /** Log a message to the console at info level */
    log(...values: any[]): void;
    /** Stop the script here, for instance to look at the model built so far.
     *  The shapes made before it are still shown.
     *
     *  @param message Shown with the warning in the console
     */
    exit(message?: string): never;
}

/** How many component execution results the Runner memoises before evicting the
 *  least-recently-used one. Every entry pins that run's Shapes in memory, so this is a
 *  ceiling on growth over a long editor session rather than a performance knob. */
const MAX_COMPONENT_RESULT_CACHE = 64;

/** JSON with object keys sorted at every level, so two param objects that differ only in
 *  key order hash the same. Plain JSON.stringify would make { w:1, h:2 } and { h:2, w:1 }
 *  two separate cache entries - and a script that builds params dynamically hits that. */
function stableStringify(v:any):string
{
    if(v === null || typeof v !== 'object'){ return JSON.stringify(v) ?? 'null'; }
    if(Array.isArray(v)){ return `[${v.map(stableStringify).join(',')}]`; }
    const keys = Object.keys(v).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

export class Runner
{
    private _modeler:Modeler;
    private _config: Record<string,any> = {} // environment variables for worker
    private _localScopes: Record<string, any> = {}; // TODO: more specific typing for Proxy
    private _activeScope: RunnerActiveScope; // scope in given context (local or worker) and name
    private _activeExecRequest: RunnerScriptExecutionRequest;
    /** src/modeler/Recipe.ts, loaded the first time a run requests a format that reads recipes */
    private _recipe: typeof import('../modeler/Recipe') | null = null;

    /** Persistent Interactor instance — survives across runs so the internal HandleRegistry
     *  can track which handles have been emitted to the viewer. Re-linked each run. */
    private _interactor: Interactor = new Interactor();

    private _linkedComponentScripts: Array<Script> = [];
    private _componentScripts: Record<string, Script> = {}; // prefetched component scripts by name=url=path
    /** Where to look up a component that nothing linked in — the shared library. Set per
     *  run from the request (componentLibraryUrl, and the script's author for bare names).
     *  Without an author only `@author/name` references can use it. */
    private _componentLibrary: { url: string; author?: string; authToken?: string; fileId?: string } | null = null;
    /** In-flight/settled shared-library lookups by local component name. A script that
     *  uses the same component four times (and the double prefetch on execute) must not
     *  cause four fetches — and a miss must be remembered as a miss. */
    private _sharedComponentFetches: Record<string, Promise<Script|null>> = {};
    /** Same memo for the rename fallback (_getRenamedComponentScript), keyed by old name.
     *  Holds the server's ScriptData rather than a Script: linked scripts are re-linked
     *  every run, so the matching working copy is looked up again each time. Cleared per run:
     *  it resolves own scripts to their latest stored version, which changes between runs. */
    private _renamedComponentFetches: Record<string, Promise<ScriptData|null>> = {};
    /** Other authors' components readable from the shared library (`@author/name`), for
     *  $component().list(). Fetched before a run that lists them, see _prefetchComponentScripts. */
    private _sharedComponentNames: Array<string> = [];
    /** The chain of components currently being executed, innermost last, by reference.
     *  A component already on it would recurse forever, so it is refused with the chain
     *  in the message. Also caps how deep nesting may go. Unwound in the finally of
     *  _executeComponentScript, so a throwing component cannot leave it dirty. */
    private _componentExecStack: Array<string> = [];
    /** Makes every component activation's scope name unique. Two activations of the SAME
     *  reference can be live at once (a cycle, before the guard above trips), and they
     *  would otherwise share -- and then delete -- one entry in _localScopes. */
    private _componentScopeSeq = 0;
    /** Memoised component EXECUTION results, keyed by _componentResultCacheKey(): a component
     *  used twenty times in a facade would otherwise run its script twenty times. Insertion
     *  ordered and capped, so it doubles as an LRU (see addComponentResultToCache).
     *
     *  Deliberately NOT cleared per run - the key includes the component's own code, so an
     *  edit in the editor invalidates by itself, and a configurator changing one param keeps
     *  the hits for every component that param does not reach. Bypass per call with
     *  $component(..).noCache(), or wipe it with clearComponentResultCache(). */
    private _componentResults: Map<string, RunnerScriptExecutionResult> = new Map();
    private _importAssets: Record<string, AssetPayload> = {}; // prefetched $import() assets by url (raw bytes)
    /** Optional script modules (see src/modules/). Persistent like _interactor:
     *  it caches loaded module instances so editor re-runs don't re-fetch a
     *  bundle. Empty and inert unless the request carries a module catalog. */
    private _moduleRegistry: ModuleRegistry = new ModuleRegistry();
    private _pipelines:Array<Pipeline> = []; // keep track of defined pipelines


    //// SETTINGS ////
    LOGGING_DEBUG: boolean = false; // directly log into local console, not that of Archiyo

    //// DEFAULTS ////
    
    DEFAULT_OUTPUTS = ['default/model/glb'];

    /** Create a new Runner instance on main thread */
    constructor() 
    {
       console.info(`Created new Runner instance. Use .load() to load the Runner and its dependencies before executing any scripts.`);
    }

    /** Loading Archiyou library with WASM module */
    async load():Promise<this>  
    {
        this._modeler = new Modeler('mesh'); // mesh is default
        await this._modeler.load(); // load WASM module in Modeler (and all dependencies)
        return this;
    }

    /** If Modeler primary kernel is loaded */
    loaded():boolean
    {
        return this?._modeler?.loaded() || false;
    }

    //// EXECUTION SCOPES ////

   /** Set Execution Scope 
     *  Depending on the execution context we set up a scope in which the script will run 
     *  
     *  NOTES: big errors like 'var Module=typeof Module!='undefined'?Module:{}....' are ofter thrown when any problem arrises
     * 
     * */
    createScope(name:string='default'):this
    {
        // Capture the scope we are nesting inside before buildLocalExecScopeState() swaps
        // globalThis.console for the new scope's Console.
        const parentScope = (name !== 'default') ? this._localScopes[this._activeScope?.name] : undefined;

        const state = this.buildLocalExecScopeState();
        state._scope = name; // set name of the scope inside scope
        state._main = (name === 'default'); // is this the main scope

        // Fallback only: _addModulesToScopeState() already points this at the scope's own
        // Console. Kept so a scope built without that step still has a usable console.
        state.console ??= console;

        state._archiyou.console.setParent(parentScope?._archiyou?.console);

        /*
                Proxy is used to isolate scope changes
                and allow settings variables without var/let/const

                Some important notes about the Proxy handler:
                 - Inline functions can behave counter intuitive 
                     when using (parent) variables earlier in the script
                    The values of these variables are 'locked in' at the time of function creation.
                    This is called lexical closure. This results in pipelines that have 
                    'previous' parameters/results
                    
                    ==> WARN THE USER to avoid inline functions 
                    that use variables from outside the function scope! So for pipelines and re-usable functions, 
                    always use explicit arguments instead.

                    pipelineFunc = (mainScope) => { mainScope.someShapeVar.move() ... }
                    otherFunc = (arg1, arg2) => { arg1.doSomething() ... }

                    Arrow functions are preferred to normal functions, because they keep the 'this' reference
                        to the Proxy scope object

        */

        /*  The Proxy MUST wrap `state` itself, never a copy of it.

            This used to be `new Proxy({ ...BASIC_SCOPE, ...state }, ...)`, which made the
            scope a shallow *snapshot* of the state taken at build time. Everything assigned
            to the scope afterwards — most importantly `scope.$PARAMS` and `scope._paramManager`
            in _executionStartRunInScope(), plus every variable the user's script declares —
            landed only on that copy. Meanwhile the in-scope helpers built by
            buildLocalExecScopeState() ($import, $module, print, …) close over `state`, so
            they could never see any of it: `state.$PARAMS` was permanently undefined.

            That was silent rather than loud: anything reading $PARAMS through a closure — the
            optimizer module does, via getActiveScope() — saw an empty param set and reported
            "nothing to optimize" on a script that plainly had params. Sharing one object means
            a closure over `state` and a read through the scope always agree.
        */
        // Indexed as a loose bag inside the traps: a scope holds whatever the user's script
        // declares, and Proxy keys are `string | symbol`. `scope` stays RunnerScriptScope-typed
        // below — this cast only widens the target for the trap bodies.
        const scope = new Proxy(state as Record<string|symbol, any>,
        {
            has: () => true, // Allows access to any variable (avoids ReferenceError) - this enabled users to omit var/let/const
            get: (target, key) => target[key], // Retrieves values from scope
            set: (target, key, value) =>
            {
                // Auto-name shapes/collections after the variable they are assigned to.
                // e.g. `myTopBox = box(10,10,10)` behaves like `.name('myTopBox')`.
                // Only names when still unnamed, so explicit .name(...) and earlier
                // names always win. Skip internal scope fields (_scope, _archiyou, …).
                if (typeof key === 'string' && !key.startsWith('_'))
                {
                    try {
                        if (isAnyShape(value) && (!(value as any).name() || (value as any)._nameInherited === true))
                        {
                            // Unnamed shapes are named after their variable; so are
                            // fresh copies, which inherit the source's name — e.g.
                            // `rafterRight = rafterLeft.copy()` becomes 'rafterRight'.
                            // (name() clears _nameInherited, so explicit names and
                            // plain re-assignment `second = first` keep the first name.)
                            (value as any).name(key);
                        }
                        else if ((value as any)?.isShapeCollection?.() === true && (value as any)._name === 'collection')
                        {
                            (value as any).name(key);
                        }
                    } catch { /* never let naming break assignment */ }
                }

                // Give warning about using functions (see above)
                if(typeof value === 'function')
                {
                    console.warn(`Runner: Detected a function definition in scope '${name}' with name '${String(key)}'. \nPlease make sure you don't use variables from outside the function scope, \nbecause they will be locked in at the time of function creation (lexical closure). \nUse explicit arguments instead!`);
                }

                // Plain rebinding. NEVER Object.assign onto the value already under `key`:
                // re-assigning a variable to a shape of a DIFFERENT class (the common
                // `beam = beam.extrude(10)`, Polygon → Mesh) would then smear the new
                // shape's own fields onto the old instance and keep the old prototype —
                // leaving an object that reports type 'Mesh' but still runs Polygon's
                // methods, which fails much later with a confusing error.
                target[key] = value;
                return true;
            }
        });
        //scope._archiyou.scope = scope; // Set a property directly within the Proxy
        // TODO: can't we use the scope._archiyou.getScope() method for this instead of setting it directly in the Proxy? This would be cleaner, but we need to make sure the reference is correct and available in all modules (for example in pipelines)
        this._localScopes[name] = scope; 
        this._activeScope = { name: name };
        

        return this;
    }
    
    /** Build start Archiyou state for a execution scope
     *  Each scope uses its own instances of Archiyou modules 
     */
    buildLocalExecScopeState():RunnerScriptScope
    {
        const scopeState = {} as RunnerScriptScope; 

        // Archiyou base modules like brep, doc, calc, make etc
        Object.assign(scopeState, { _archiyou: this.initLocalArchiyou()});

        // Add basic globals (like Math)
        this._addGlobalsToScopeState(scopeState);

        // Add Archiyou modules as globals in execution scope state object
        this._addModulesToScopeState(scopeState);
        // Modeling basics into state
        this._addModelingMethodsToScopeState(scopeState)
        // Special scope methods, for example importing components
        this._addMetaMethodsToScopeState(scopeState);


        return scopeState;
    }

    /** Initiate all Archiyou modules and return a state object
     *  that is plugged into a local execution scope
     */
    initLocalArchiyou():ArchiyouModules
    {
        // create all Archiyou modules
        const scopeModeler = new Modeler();
        if (this._modeler?.loaded()) scopeModeler.inheritKernels(this._modeler);

        const archiyou = {
            console: new Console((this.LOGGING_DEBUG) ? console : this), // put Archiyou console in debug mode if needed
            modeler: scopeModeler,
            annotator: new Annotator(),
            interactor: this._interactor, // reuse persistent instance so HandleRegistry survives runs
            calc: new Calc(),
            // No explicit settings: Docs.getAssetProxyUrl() reads the asset proxy off the
            // request being executed (set below via setArchiyou → runner back-reference).
            docs: new Docs(),
            materials: new MaterialManager(),
            runner: this,
            // Shared across scopes, not rebuilt per run: it caches loaded module
            // instances, which may hold expensive resources. Per-run cleanup is
            // the module's own reset(), called from linkToArchiyou().
            modules: this._moduleRegistry,
        } as ArchiyouModules

        archiyou.modeler.setArchiyou(archiyou);
        archiyou.docs.setArchiyou(archiyou);
        archiyou.calc.setArchiyou(archiyou);
        archiyou.materials.setArchiyou(archiyou);
        archiyou?.annotator?.setArchiyou(archiyou); // doesnt have it yet
        archiyou?.interactor?.setArchiyou(archiyou); // re-link fresh modules to persistent interactor

        return archiyou;
    }

    /** Our scopes are very limited. We need to make sure basic globals are availble */
    _addGlobalsToScopeState(state:Record<string,any>):Record<string,any>
    {
        // Add basic globals to the state
        Object.assign(state,
            {
                Math: Math,
                JSON: JSON, // for debugging
                Array: Array,
                Object: Object,
                Set: Set,
                Map: Map,
                // Primitive constructors/parsers: scripts need these to convert values,
                // most commonly an options param (always a string) used as a number
                Number: Number,
                String: String,
                Boolean: Boolean,
                parseInt: parseInt,
                parseFloat: parseFloat,
                isNaN: isNaN,
                isFinite: isFinite,
                // Errors, so a script can throw something meaningful
                Error: Error,
                roundTo: roundTo,
                toRad: toRad,
                toDeg: toDeg,
            }
        );

        return state;
    }

    /** Add Archiyou modules as globals in execution scope state object */
    _addModulesToScopeState(state:Record<string,any>):Record<string,any>
    {
        if(!state._archiyou)
        { 
            throw new Error(`Runner:: _addModulesToScopeState(): Archiyou modules not found in state object`); 
        }

        console.info(`Runner::_addModulesToScopeState(): Adding Archiyou modules to scope state`);
        Object.assign(state,
        {
            console: state._archiyou.console,
            modeler: state._archiyou.modeler,
            docs: state._archiyou.docs,
            doc: state._archiyou.docs, // alias - backwards compatibility
            calc: state._archiyou.calc,
            annotator: state._archiyou.annotator, // dimension/label settings live here (DIMENSION_TEXT_SIZE_MM, ...)
            materials: state._archiyou.materials,
            make: state._archiyou.modeler.make, // Make lives on Modeler, not directly on ArchiyouModules
            fab: state._archiyou.modeler.fab, // fabrication facade; its module loads on demand (_loadFabWhenUsed)
            interactor: state._archiyou.interactor,
        });

        // Optional, separately-distributed script modules (see src/modules/).
        // Resolved earlier by _prepareModules() during execute(), because loading
        // a bundle is async and this is not. Nothing is added when the run has no
        // entitled modules, which is the case for every default build.
        this._addScriptModulesToScopeState(state);

        // setup logging
        this._addLoggingToScopeState(state);

        return state; // update remains the same
    }

    /** Bind resolved script modules into the scope and hand each the engine
     *  back-reference, the same way initLocalArchiyou() wires the built-ins. */
    _addScriptModulesToScopeState(state:Record<string,any>):Record<string,any>
    {
        const globals = this._moduleRegistry.globals();
        const names = Object.keys(globals);
        if(names.length === 0) return state;

        console.info(`Runner::_addScriptModulesToScopeState(): Adding script module(s): ${names.join(', ')}`);
        Object.assign(state, globals);
        this._moduleRegistry.linkToArchiyou(state._archiyou);

        return state;
    }

    _addLoggingToScopeState(state:Record<string,any>):Record<string,any>
    {
        // Overwrite global console methods with Archiyou console
        // That console still has a reference for global console for debugging
        console.info(`Runner::_addLoggingToScopeState(): Overwriting global console methods with Archiyou console`);

        globalThis.console = state.console;

        // like console.log(): any value, any number of arguments - Objects are printed
        // as data ({ width: 10, height: 100 }), not as '[object Object]'
        state.print = (...messages:Array<any>) => state.console.user(...messages);
        state.log = (...messages:Array<any>) => state.console.info(...messages);

        // exit(): stop the run here on purpose (debugging). Thrown as a signal the
        // Runner recognises: the model built so far is still collected, only a
        // warning is logged - see ScriptExit.ts
        state.exit = (message?:string) =>
        {
            state.console.warn(message ? `${SCRIPT_EXIT_WARNING}: ${message}` : SCRIPT_EXIT_WARNING);
            throw new ScriptExitSignal(message);
        }
        
        return state;
    }

    /** Make general modeling methods from Modeler available in scope state object  */
    _addModelingMethodsToScopeState(state:Record<string,any>):Record<string,any>
    {
        // TODO: can we do TS typing of state that knows what we add here?
        console.info(`Runner::_addModelingMethodsToScopeState(): Adding modeling methods to scope state`);        
        

        // Some shortcuts to important methods on Modeler
        // TODO: could we do this inside Modeler, registering them for inclusion here?
        MODELER_METHODS_INTO_GLOBAL.forEach(methodName => 
        {
            const method = state.modeler[methodName];
            if (!method){ console.warn(`Runner::_addModelingMethodsToScopeState: Could not find "${methodName}" in Modeler class. Check config: MODELER_METHODS_INTO_GLOBAL`);}
            else {
                // avoid overwriting
                if (!state[methodName])
                {
                    state[methodName] = method.bind(state.modeler);
                }
                state[methodName.toLowerCase()] = method.bind(state.modeler);
            }
        })

        return state;
    }

    /** Add specific meta methods */
    _addMetaMethodsToScopeState(state:Record<string,any>)
    {
        // Import component
        state.$component = (name?:string, params?: Record<string, any>) =>
        {
            const componentImporter = new RunnerComponentImporter(this, this.getActiveScope(), name);
            // No name: show what can be used, so $component() alone is a lookup
            if (!name) componentImporter.list();
            if (params && typeof params === 'object') componentImporter.params(params);
            // Don't execute yet, wait for componentImporter.get()
            return componentImporter;
        }

        state.$pipeline = (name:string, func: () => Promise<any>|any) =>
        {
            console.info(`$pipeline: Registering pipeline: '${name}'`);

            // Detect if given function has no arguments

            // Pipelines are registered on the Runner instance
            this.pipeline(name, func);
        }

        // Declare a script module (see modules/README.md). Returns the module, so
        // both forms work:
        //
        //     $module('cloudcalc')                  // declare; use the global
        //     cc = $module('cloudcalc')             // declare and alias
        //
        // Synchronous, like $import: the module was resolved by _prepareModules()
        // before the run. Throws HERE if it is unavailable, which is the point —
        // the script stops at its declaration rather than partway through
        // building a model it cannot finish.
        //
        // NOTE: deliberately not folded into $import(), which means "fetch a
        // remote asset by URL". One name for two unrelated jobs would make every
        // failure ambiguous: a bad URL and a missing module would report alike.
        state.$module = (name:string) =>
        {
            if(typeof name !== 'string' || !name.trim())
            {
                throw new Error(`$module(): needs a module name, e.g. $module('cloudcalc')`);
            }
            return this._moduleRegistry.resolve(name.trim());
        };

        // Shortcut to create a new interaction Handle.
        // Use .start(target) for initial placement, .at(target) for every-run push.
        state.$handle = () => state._archiyou.interactor.addHandle();

        // Import a remote asset (SVG/GeoJSON/DXF/STL/OBJ/glTF/AMF/3MF) as a ShapeCollection.
        // The bytes were pre-fetched by _prefetchImportAssets(), so this is synchronous
        // (no await needed). Auto-centers, auto-scales and adds to the scene by default.
        state.$import = (url:string, opts:Record<string,any> = {}) =>
        {
            const payload = this._importAssets[url];
            if(!payload)
            {
                const msg = `$import('${url}'): asset not pre-loaded. $import needs a plain ` +
                            `string-literal URL (dynamic/computed URLs are not supported).`;
                state._archiyou.console.error(msg);
                throw new Error(msg);
            }
            return AssetImporter.build(payload, opts, {
                modeler: state._archiyou.modeler,
                console: state._archiyou.console,
            });
        };

    }

    //// PIPELINES ////

    /** Make a new pipeline. Use .do(fn) to set function later */
    pipeline(name?:string, fn?:() => any):Pipeline
    {
        const p = new Pipeline(name);
        if (fn){ p.do(fn); } // attach function if given
        if(!this._pipelines.includes(p)) this._pipelines.push(p);
        console.info(`Brep::pipeline: Created new pipeline '${p.name}'`);
        return p;
    }

    getPipelineNames():Array<string>
    {
        return Array.from( new Set(this._pipelines.map( p => p.name)))
    }

    getPipelineByName(name:string):Pipeline
    {
        return this._pipelines.find(p => p.name === name);
    }

    //// MANAGING EXECUTION SCOPES 
    
    /** Select a scope */
    scope(name:string):this
    {
        if(!this._localScopes[name]){ throw new Error(`Runner:: scope(): Scope '${name}' does not exist`)}
        this._activeScope = { name: name };

        return this;
    }

    getActiveScope():RunnerScriptScope
    {
        if(!this._activeScope) { throw new Error(`Runner:: scope(): No active scope found`)}
        return this._localScopes[this._activeScope.name];
    }

    /** The request currently being executed (params, script, outputs), or undefined
     *  outside a run. Read by modules that report on the run itself — the document
     *  titleblock summarises the script's params and version from it. */
    getActiveExecRequest():RunnerScriptExecutionRequest|undefined
    {
        return this._activeExecRequest;
    }

    getScope(name:string):RunnerScriptScope
    {
        if(!this._localScopes[name]){ throw new Error(`Runner:: scope(): Scope '${name}' does not exist`)}
        return this._localScopes[name];
    }

    /** Delete a scope and return to `restoreTo`.
     *
     *  `restoreTo` matters for NESTED components. Without it this always returned to
     *  'default', so once an inner component's scope was deleted, the OUTER component was
     *  still running while the Runner reported the main scope as active. Everything that
     *  resolves the active scope lazily then looked in the wrong place: `$component()`
     *  (Runner._addMetaMethodsToScopeState) grafted the outer component's next sub-component
     *  onto the main scene, and Docs.executePipelines()/View.resolveShapeNameToSVG() ran the
     *  outer component's doc pipelines against the main scope.
     *
     *  It stays a parameter rather than a scope STACK on purpose: scopes are not always
     *  deleted in the order they were created (see runner.scope-identity.test.ts, which
     *  creates iso-a + iso-b and deletes them in that same order), so a stack would restore
     *  the wrong scope. Callers that nest say so; everyone else keeps the old behaviour. */
    deleteLocalScope(name:string, restoreTo:string='default'):this
    {
        if(!this._localScopes[name]){ throw new Error(`Runner:: scope(): Scope '${name}' does not exist`)}
        delete this._localScopes[name];
        // The scope we return to must still exist - fall back to default if it was itself deleted.
        const target = this._localScopes[restoreTo] ? restoreTo : 'default';
        this._activeScope = { name: target, context: 'local' };

        // Hand the global console back to the scope we return to. Without this the deleted
        // scope's Console stays installed globally and every later run stacks another one on top.
        globalThis.console = this._localScopes[target]?._archiyou?.console ?? NATIVE_CONSOLE;

        console.info(`Runner::deleteLocalScope(): Deleted scope: '${name}'. Returned to '${target}'.`);

        return this;
    }


    //// REQUESTS AND EXECUTION ////

    /** Start execution of entire code or script with params in fresh, active scope 
     *  @request - string with code or object with script and params
     *  @result - return the result of the execution
    */
    /** Load the kernel a run asks for, on the Runner's own Modeler.
     *
     *  Scope Modelers pick the loaded kernel objects up through inheritKernels(), so this is
     *  the single place the (async, potentially 10MB) load happens — once per Runner, not once
     *  per run. Selecting brep keeps mesh loaded too: it owns the scene, the styles and the
     *  exporters both kernels share. */
    private async _ensureKernel(kernel?: ModelMode): Promise<void>
    {
        const wanted: ModelMode = kernel ?? 'mesh';
        if (!this._modeler) { return }
        if (this._modeler.mode() === wanted && this._modeler.loaded()) { return }

        this._modeler.mode(wanted);
        await this._modeler.load();

        // Scopes built BEFORE this load inherited only what was loaded then, so hand the
        // newly loaded kernel to the Modelers that already exist. inheritKernels() only fills
        // gaps, so this is safe to repeat.
        Object.values(this._localScopes).forEach((scope: any) =>
            scope?._archiyou?.modeler?.inheritKernels(this._modeler));
    }

    public async execute(request: string|RunnerScriptExecutionRequest):Promise<RunnerScriptExecutionResult>
    {
        const { missing } = await this._prefetchComponentScripts(request);

        // Pre-fetch remote assets referenced by $import('url') so the in-scope
        // $import() can resolve them synchronously (no await in user scripts).
        await this._prefetchImportAssets(request);

        // Same reasoning for script modules: a gated bundle is fetched here so
        // that building the scope stays synchronous.
        await this._prepareModules(request);

        // Names only: logging every component's full source on each run was tens of KB of
        // console text per execution, which is not free in a Web Worker.
        console.info(`Runner::execute(): ${Object.keys(this._componentScripts).length} prefetched component(s): ${Object.values(this._componentScripts).map(s => s._component).join(', ')}`);

        if (missing.length > 0)
        {
            const names = missing.map(n => `'${n}'`).join(', ');
            const errorMessage = `Component not found: ${names}. Make sure the script exists in your workspace, or use $component().list() to see the available components.`;
            return {
                created: new Date(),
                status: 'error',
                duration: 0,
                request: request as RunnerScriptExecutionRequest,
                errors: [{ status: 'error', message: errorMessage } as any],
                state: { sceneGraph: null, annotations: [], managedParams: null, managedPresets: null },
            } as RunnerScriptExecutionResult;
        }

        // Normalize a bare code string into a request so we can inspect flags below.
        if(typeof request === 'string')
        {
            request = { script: { code: request } } as RunnerScriptExecutionRequest;
        }

        // Make sure the kernel this run asks for is actually loaded. Has to happen here:
        // loading is async and the per-scope setup (_executionStartRunInScope) is not.
        await this._ensureKernel(request.kernel);

        // Record how shapes are made only when something reads it: FreeCAD and friends, or `fab`
        await this._syncRecipeRecording(request);

        // The IFC classifier loads on demand; explainIFC() is synchronous, so load it up front when used
        await this._loadIFCWhenUsed(request);
        // Same for the fabrication module behind `fab`
        await this._loadFabWhenUsed(request);

        // Per-statement mode: split the script and execute statement-by-statement so a
        // single failure halts with a partial model instead of losing the whole run, and
        // each statement is timed. Opt-in via request.perStatement (editor on, server off).
        if(request.perStatement)
        {
            return await this.executeInScriptStatements(request);
        }

        return await this._execute(request, true, true);
    }

    /** Switch shape recipe recording on for runs that request a recipe format or use `fab` (which reads
     *  saw cuts and drillings from recipes), off for all others. Recording stays on through the export at
     *  the end of the run, which is what reads it. */
    private async _syncRecipeRecording(request: RunnerScriptExecutionRequest): Promise<void>
    {
        const wanted = outputsNeedRecipes(request.outputs) || this._usesFab(request);
        if (!wanted && !this._recipe) return;
        this._recipe ??= await import('../modeler/Recipe');
        if (wanted)
        {
            this._recipe.installRecipeRecorder();   // meshup
            if (this._modeler?.mode() === 'brep') this._recipe.installRecipeRecorder({ brep: this._modeler.kernel() });
        }
        this._recipe.setRecipeRecording(wanted);
    }

    /** Load the IFC module before a run whose script, or any of its components, calls explainIFC():
     *  that script-facing call is synchronous and cannot wait for a dynamic import. Components are
     *  already prefetched at this point. */
    private async _loadIFCWhenUsed(request: RunnerScriptExecutionRequest): Promise<void>
    {
        const codes = [request.script?.code, ...Object.values(this._componentScripts).map(s => (s as any)?.code)];
        if (codes.some(code => typeof code === 'string' && /\bexplainIFC\s*\(/.test(code))) await loadIFCModule();
    }

    /** Load the fabrication module before a run whose script, or any of its components, uses `fab`:
     *  every fab.*() call is synchronous for scripts. Components are already prefetched at this point. */
    private async _loadFabWhenUsed(request: RunnerScriptExecutionRequest): Promise<void>
    {
        if (this._usesFab(request)) await loadFabModule();
    }

    /** Whether the script, or any of its components, calls fab.something() */
    private _usesFab(request: RunnerScriptExecutionRequest): boolean
    {
        const codes = [request.script?.code, ...Object.values(this._componentScripts).map(s => (s as any)?.code)];
        return codes.some(code => typeof code === 'string' && /\bfab\s*\.\s*\w+\s*\(/.test(code));
    }

    private _finalizeExecutionDuration(result: RunnerScriptExecutionResult | null | undefined, executeStartTime: number): void
    {
        if(!result || typeof result !== 'object' || typeof result.status !== 'string')
        {
            return;
        }

        result.duration = Math.round(performance.now() - executeStartTime);
    }

    /** Execute (entire or partial) request on local execution scope or on managed worker */
    private async _execute(request: string|RunnerScriptExecutionRequest, startRun:boolean=true, result:boolean=true):Promise<RunnerScriptExecutionResult>
    {
        // Convert code to request if needed
        if(typeof request === 'string')
        {
            request = { script: { code: request } } as RunnerScriptExecutionRequest;    
        }

        // If no params are defined, use default params
        if(!request.params)
        {
            console.warn(`Runner::_execute(): No params defined in request, using default param values from script`);
            const script = Script.fromData(request.script);
            request.params = script?.getDefaultParamValues() ?? {};
        }

        // If no outputs are defined, use default outputs
        if(!request.outputs || request.outputs.length === 0)
        {
            request.outputs = this.DEFAULT_OUTPUTS;
        }

        // Check request structure (including params defs and values)
        this._activeExecRequest = this._checkRequestAndAddDefaults(request);

        console.info(`**** Runner::_execute(): Executing script '${JSON.stringify((request as any)?.script?.name || request)}', return result ${result} ****`);
        console.info(` params: ${JSON.stringify((request as any)?.params || {})} --- outputs: ${JSON.stringify((request as any)?.outputs)}
                       kernel: ${request.kernel }`);
        console.info(`***************************************`);

        return await this._executeLocal(this._activeExecRequest, startRun, result);
    }

    /** Main entrypoint for per-statement execution.
     *  Splits the script into top-level statements and executes them one-by-one in a single
     *  shared scope. On failure it halts at the offending statement but still collects the
     *  outputs built up to that point (a partial model), and it records per-statement timings
     *  in result.statements. Reached from execute() when request.perStatement is set, and
     *  directly by executeUrl().
    */
    async executeInScriptStatements(request: RunnerScriptExecutionRequest):Promise<RunnerScriptExecutionResult>
    {
        // Normalize like _execute(): fill param + output defaults so this works standalone.
        if(!request.params)
        {
            const script = Script.fromData(request.script);
            request.params = script?.getDefaultParamValues() ?? {};
        }
        if(!request.outputs || request.outputs.length === 0)
        {
            request.outputs = this.DEFAULT_OUTPUTS;
        }

        this._activeExecRequest = this._checkRequestAndAddDefaults(request);

        return await this._executeLocalInScriptStatements(this._activeExecRequest);
    }

    /** Check execution request */
    _checkRequestAndAddDefaults(request:RunnerScriptExecutionRequest):RunnerScriptExecutionRequest
    {
        console.info(`Runner::_checkRequestAndAddDefaults(): Checking Execution Request with code '${request.script.code.slice(0, 150)}...'`);
        // check params defs and inputs
        // DONT VALIDATE
        // this._checkRequestParams(request);

        return {
            ...request
        }
    }

    /** Check params in RunnerScriptExecutionRequest
     *  We need to make sure that param values are there and consistent with param definitions 
     *  - if param values (request.params) are not set, we use default values from script.params definitions
     *  - param values (request.params) are put in defs (request.script.params) 
     *  
     *  TODO: Use ScriptParam.validateValue() to validate incoming values
     * 
     * */
    _checkRequestParams(request:RunnerScriptExecutionRequest):RunnerScriptExecutionRequest
    {
        // No param definitions in script
        if(!request.script.params)
        {
            request.params = {}; // no param values in request
            return request;
        }
        
        // Do some sanity checks on script param definition
        if(typeof request.script.params !== 'object')
        {
            console.error(`Runner::_checkRequestParams(): Script params should be an object, but got: ${JSON.stringify(request.script.params)}`);
            request.script.params = {}; // reset to empty object
        }

        // Params from script definition and values from request
        const params = (request.script.params && typeof request.script.params === 'object' && Object.keys(request.script.params).length > 0) 
            ? Object.values(request.script.params) : [];

        // Make sure we got name in param obj definition too
        params.forEach((pd,i) => 
        {
            const name = Object.keys(request.script.params)[i];
            pd.name = name;
            if(!name){ console.error(`Runner::_checkRequestParams(): Param definition without name found: ${JSON.stringify(pd)}`); }	
        });

        const paramValues = (request.params && typeof request.params === 'object' && Object.keys(request.params)) ? request.params : {};
        params.forEach(pd =>
        {
            const hasExplicitValue = Object.prototype.hasOwnProperty.call(paramValues, pd.name);
            pd._value = hasExplicitValue ? paramValues[pd.name] : pd.default;
        });
        // NOTE: in paramManager incoming values are validated and set to default if not valid
        
        // Make sure we have param values too (default if not set)
        request.params = params.reduce( (agg,p) => { agg[p.name] = p._value ?? p.default; return agg }, {}); 

        return request;
    }

    /** Execute a piece of code or script (and params) in local execution context 
     *  @param {RunnerScriptExecutionRequest} [request] - string with code or object with script and params
     *  @param {boolean} [startRun] - if true a reset is made of the state to prepare for fresh run
     *  @param {boolean} [output] - if true, the Archiyou state is returned as RunnerScriptExecutionResult
     * 
     *  @returns - RunnerScriptExecutionResult or error string or null if no output 
     * 
     *  NOTE: this = execution context (not Runner)
    */
    async _executeLocal(request: RunnerScriptExecutionRequest, startRun:boolean=true, output:boolean=true):Promise<RunnerScriptExecutionResult|null>
    {
        // First Check if OpenCascade is loaded
        if(!this.loaded())
        { 
            console.warn(`Runner::_executeLocal(): OpenCascade WASM module not loaded yet. The request is executed once it is!`);

            return new Promise((resolve, reject) => {
                const checkLoaded = () => {
                    if (this.loaded())
                    {
                        resolve(this._executeLocal(request, startRun, output)); // Resolve the promise when loaded() is true
                    } 
                    else 
                    {
                        setTimeout(checkLoaded, 100); // Check again after the interval
                    }
                };
                checkLoaded();
            });
        }

        // Create a fresh scope if this is a new execute run
        if(startRun)
        {
            console.info('**** CREATING FRESH SCOPE STATE FOR NEW RUN ****');
            this.createScope('default'); // resets all scope variables
        }

        // Ensure the BinPacker WASM is ready so synchronous make.pack() calls in user
        // scripts don't race the async WASM load. packReady() resolves a module-level
        // shared promise, so any Make instance works and this only blocks once (cached).
        try { await this._modeler?.make?.packReady?.(); }
        catch(e){ console.warn(`Runner::_executeLocal(): BinPacker WASM failed to load: ${e}`); }

        console.info(`Runner: Executing script in active local context: '${this._activeScope.name}'`);
        console.info(`* With param values: ${JSON.stringify(request.params)} *`);
        console.info(`====== code ======`)
        console.info(`${request.script.code}`)
        console.info(`===================`)

        this._activeExecRequest = request;
        const executeStartTime = performance.now()

        // In older apps AyncFunction is not available because await/async are replaced on buildtime
        // This is pretty OK, instead that in the dynamic function underneath the awaits are not replaced
        // Resulting in error: 'await is only valid in async function'
        // We use a fix that detects type of inner execution function
        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

        const scope = this.getActiveScope();
        let code = request.script.code;

        const startRunFunc = (startRun) ? this._executionStartRunInScope : () => {};
        const outputFunc = (output) 
                            ? this.getScopeResults.bind(this)
                            : async () => null;

        const exec = async () =>
        {
            try 
            {
                const asyncFunc = new AsyncFunction(  
                'request',
                'scope', 
                'startRunFunc',
                'outputFunc',
                    `
                    startRunFunc.call(scope, scope, request);
                    
                    with (scope)
                    {
                        'use strict'; 
                        ${code}; 
                    }
                    
                    asyncOutput = outputFunc.constructor.name === 'AsyncFunction'; 
                    return (asyncOutput) 
                                ? Promise.resolve(outputFunc(scope, request))
                                : outputFunc(scope, request);
                    `
                );
                return await asyncFunc.call(scope, this._activeExecRequest, scope, startRunFunc, outputFunc);
            }
            catch(e)
            {
                // exit() is not a failure: collect whatever was modeled before it
                // and return that as a normal (successful) result.
                if(isScriptExitSignal(e))
                {
                    console.warn(`Runner::_executeLocal(): ${SCRIPT_EXIT_WARNING}`);
                    return await outputFunc(scope, this._activeExecRequest);
                }
                return this._handleExecutionError(scope, this._activeExecRequest, code, e);
            }
        }

        const result = await exec();
        
        this._finalizeExecutionDuration(result, executeStartTime);

        return result;
    }

    /** Describe whatever was thrown.
     *
     *  Not everything that reaches here is an Error: the OpenCascade WASM throws a raw
     *  exception POINTER (a number), and kernel bindings sometimes throw plain strings. Those
     *  have no `.message`, which is how a real geometry failure used to surface to the user as
     *  the famously unhelpful "ERROR: undefined". */
    _describeThrown(e:any):string
    {
        if (e instanceof Error && e.message){ return e.message }
        if (typeof e === 'string' && e){ return e }

        if (typeof e === 'number')
        {
            // An OpenCascade exception pointer. Ask OC for the real failure text when the
            // kernel is loaded; the raw number is meaningless on its own.
            const ocMessage = this._modeler?.kernel?.()?.getOc?.()
                ?.OCJS?.getStandard_FailureData?.(e)?.GetMessageString?.();
            return ocMessage
                ? `geometry kernel error: ${ocMessage}`
                : `geometry kernel error (OpenCascade exception ${e})`;
        }

        if (e && typeof e === 'object')
        {
            const m = (e as any).message ?? (e as any).error ?? (e as any).text;
            if (m){ return String(m) }
            try { return JSON.stringify(e) } catch { /* circular */ }
        }

        return String(e);
    }

    _handleExecutionError(scope: RunnerScriptScope, request:RunnerScriptExecutionRequest,code:string, e:Error):RunnerScriptExecutionResult
    {
        // NOTE: code can be just a small part of the request.script.code
        // Get context of error by parsing the stack trace
        const extracted = this._extractScriptContextFromErrorStack(e, code);
        const lineInfo = extracted ? `\n- line: ${extracted.line}, column: ${extracted.column}` : '';
        const description = this._describeThrown(e);
        const errorMessage = `
**** EXECUTION ERROR ****
- error: '${description}' ${lineInfo}
- context: 
${extracted?.context ?? ''}
${description === '***** CODE ****\nUnexpected end of input' ? code : ''}
**** END ERROR ****`; 

        // Also add to local console
        console.error(errorMessage);

            // Mirror execution failures into the Archiyou console buffer so UI
            // consoles that render result.messages also receive thrown errors.
            scope?._archiyou?.console?.error(errorMessage);

        return {
            status: 'error',
            errors: [{ status: 'error', 
                        message: errorMessage, 
                        code: code, 
                        lineStart: extracted?.line,
                        lineEnd: extracted?.line, // for now the same
                    } as ScriptStatementResult],
            // get all messages out too, this could help debugging
            messages: scope._archiyou.console.getBufferedMessages(['user', 'exec','warn', 'error']),
            request: request, // original request in response for debugging
        } as RunnerScriptExecutionResult
    }

    _extractScriptContextFromErrorStack(e:Error, code:string): { line: number; column: number; context: string } | null
    {
        /* Within eval we get something like:
         
            TypeError: roundTo is not a function
            at eval (eval at <anonymous> (file:///app/lib/archiyou-core/src/Runner.ts:1:13312), <anonymous>:216:14)
            at exec (/app/lib/archiyou-core/src/Runner.ts:834:21)
            at Runner._executeLocal (/app/lib/archiyou-core/src/Runner.ts:854:30)
            ...

            <anonymous>:216:14 contains line and column number of error. Extract that from the code.

            CORRECT_LINES_FOR_EVAL_WRAP accounts for the AsyncFunction wrapper lines generated by V8:
              - AsyncFunction header:  "async function anonymous(param1,param2\n,param3,param4\n) {\n" = 3 lines
                plus one "\n" separating the opening from the body start.
              - Body preamble: 6 lines (startRunFunc call, blank, with block, 'use strict', blank before code).
              Total = ~11 lines, making the first user code line appear at eval line ~12.
              The offset converts eval_line → 0-indexed array position in the user code lines array.
              If errors appear off by N lines, adjust this constant by N.
              Calibrated value: user code line 1 is at eval line 9 in V8,
              so CORRECT = -9 ensures arrayIndex = evalLine - 9 (0-indexed).
        */
        const CONTEXT_LINES_BEFORE = 3;
        const CONTEXT_LINES_AFTER = 6; // enough to show a multi-line call (e.g. make.wall(...)) without cutting off
        // Offset from raw V8 eval line number to 0-indexed position in the user's code array.
        // Calibrated by runner.test.ts error-line tests: user line 1 = eval line 9.
        const CORRECT_LINES_FOR_EVAL_WRAP = -9;

        const matches = e?.stack?.match(/<anonymous>:(\d+):(\d+)/);
        if(matches && matches.length === 3)
        {
            const evalLine = parseInt(matches[1]);
            const arrayIndex = evalLine + CORRECT_LINES_FOR_EVAL_WRAP; // 0-indexed position in user code
            const scriptLine = arrayIndex + 1;                          // 1-indexed line number to report
            const column = parseInt(matches[2]);

            if(arrayIndex < 0 || column < 0) {
                console.error(`Runner::_extractScriptContextFromErrorStack(): Computed invalid position from stack trace (evalLine=${evalLine}, arrayIndex=${arrayIndex}, column=${column}). Adjust CORRECT_LINES_FOR_EVAL_WRAP.`);
                return null;
            }

            // Extract the code around the error with a line-number gutter and a
            // marker on the error line. NOTE: the slice end is `arrayIndex + AFTER + 1`
            // (exclusive) so that CONTEXT_LINES_AFTER full lines are shown *after* the
            // error line — previously the off-by-one cut multi-line statements short.
            const lines = code.split('\n');
            const startIdx = Math.max(0, arrayIndex - CONTEXT_LINES_BEFORE);
            const endIdx = Math.min(lines.length, arrayIndex + CONTEXT_LINES_AFTER + 1);
            const gutterWidth = String(endIdx).length;

            // NOTE: no column caret — the V8 column is measured in the wrapped eval
            // source (the AsyncFunction wrapper shifts columns), so it does not line up
            // with the user's source columns. The `>` line marker is the reliable pointer.
            const contextLines: string[] = [];
            for (let i = startIdx; i < endIdx; i++)
            {
                const marker = i === arrayIndex ? '>' : ' ';
                contextLines.push(`${marker} ${String(i + 1).padStart(gutterWidth)} | ${lines[i]}`);
            }
            const context = contextLines.join('\n');

            return { line: scriptLine, column, context };
        }
        else {
            console.error(`Runner::_extractScriptContextFromErrorStack(): Failed to extract line and column from stack trace: ****'${e.stack}'****`);
            return null;
        }
    }


    /** Execute a request statement-by-statement in one shared scope.
     *
     *  Unlike the whole-script path, each statement is compiled and run on its own so we can:
     *   - time each statement (result.statements),
     *   - halt at the first failure while keeping the model built so far (partial output).
     *
     *  IMPORTANT: statements do NOT go through _execute() — that re-normalizes the request and
     *  emits several console lines per call, which the buffered Archiyou Console would multiply
     *  by the statement count. Setup (startRun) happens once up front and output collection
     *  (getScopeResults) once after the loop.
    */
    async _executeLocalInScriptStatements(request: RunnerScriptExecutionRequest):Promise<RunnerScriptExecutionResult>
    {
        // Wait for the kernel like _executeLocal does — re-enter once loaded.
        if(!this.loaded())
        {
            console.warn(`Runner::_executeLocalInScriptStatements(): WASM kernel not loaded yet. The request is executed once it is!`);
            return new Promise((resolve) => {
                const checkLoaded = () => {
                    if(this.loaded()){ resolve(this._executeLocalInScriptStatements(request)); }
                    else { setTimeout(checkLoaded, 100); }
                };
                checkLoaded();
            });
        }

        // Ensure BinPacker WASM is ready so synchronous make.pack() calls don't race (see _executeLocal).
        try { await this._modeler?.make?.packReady?.(); }
        catch(e){ console.warn(`Runner::_executeLocalInScriptStatements(): BinPacker WASM failed to load: ${e}`); }

        await this._prefetchComponentScripts(request); // idempotent; needed when called via executeUrl()
        await this._prefetchImportAssets(request);      // idempotent; $import() assets for the direct path
        await this._prepareModules(request);            // idempotent; script modules for the direct path
        await this._loadFabWhenUsed(request);           // idempotent; `fab` for the direct path

        const executeStartTime = performance.now();

        // Fresh scope + one-time run setup (params, module resets) — mirrors startRun in _executeLocal.
        this.createScope('default');
        const scope = this.getActiveScope();
        this._executionStartRunInScope.call(scope, scope, request);

        // Split into statements. A syntax error surfaces here as a single whole-script error.
        let statements:Array<ScriptStatement>;
        try {
            const codeParser = new CodeParser(request.script.code, {}, null);
            statements = codeParser.getStatementsWithoutImports(); // sync — $import/$load path is dead
        }
        catch(e)
        {
            return this._handleExecutionError(scope, request, request.script.code, e as Error);
        }

        console.info(`Runner::_executeLocalInScriptStatements(): Executing ${statements.length} statements in scope '${this._activeScope?.name}'`);

        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        const statementResults:Array<ScriptStatementResult> = [];
        let failed:ScriptStatementResult | null = null;

        for(let s = 0; s < statements.length; s++)
        {
            const stmt = statements[s];
            const stmtStartTime = performance.now();
            try
            {
                // Keep sub-millisecond precision: fast geometry ops round to 0ms, which would
                // make every durationPerc zero. Display code rounds when it renders.
                await this._runStatementInScope(scope, stmt.code, AsyncFunction);
                statementResults.push({ ...stmt, status: 'success', duration: performance.now() - stmtStartTime });
            }
            catch(e)
            {
                const duration = performance.now() - stmtStartTime;

                // exit() halts the loop like an error does, but the run stays successful:
                // the statement itself counts as executed and no error is attached.
                if(isScriptExitSignal(e))
                {
                    statementResults.push({ ...stmt, status: 'success', duration });
                    console.warn(`Runner::_executeLocalInScriptStatements(): ${SCRIPT_EXIT_WARNING} at line ${stmt.lineStart}`);
                    break;
                }

                const message = this._formatStatementError(stmt, request, e as Error);
                failed = { ...stmt, status: 'error', message, duration };
                statementResults.push(failed);
                // Mirror into the Archiyou console buffer so UI consoles surface it.
                scope?._archiyou?.console?.error(message);
                console.error(`Runner::_executeLocalInScriptStatements(): ERROR at line ${stmt.lineStart}: ${message}`);
                break; // halt, keep the partial model
            }
        }

        // Collect outputs ONCE from whatever was built (partial on failure). getScopeResults sets
        // status:'success'/errors:[] — we override below when a statement failed.
        let result:RunnerScriptExecutionResult;
        try {
            result = await this.getScopeResults(scope, request);
        }
        catch(e)
        {
            // Output collection itself failed on a half-built scope — report that instead.
            return this._handleExecutionError(scope, request, request.script.code, e as Error);
        }

        // Attach per-statement profiling (durationPerc relative to summed statement time).
        const totalStatementTime = statementResults.reduce((sum, r) => sum + (r.duration ?? 0), 0);
        result.statements = statementResults.map(r => ({
            ...r,
            durationPerc: totalStatementTime > 0 ? Math.round(((r.duration ?? 0) / totalStatementTime) * 100) : 0,
        }));

        // A failed statement makes the whole run an error, keeping the partial model in result.state.
        if(failed)
        {
            result.status = 'error';
            result.errors = [failed];
        }

        this._finalizeExecutionDuration(result, executeStartTime);

        return result;
    }

    /** Compile and run a single statement's code inside the shared scope.
     *  Lean by design: no per-statement setup or output collection (done once by the caller),
     *  so only the compile + call cost is paid per statement. Mirrors the whole-script wrapper
     *  shape (`with(scope){ 'use strict'; … }`) so scope semantics are identical.
    */
    async _runStatementInScope(scope:RunnerScriptScope, code:string, AsyncFunction:any):Promise<any>
    {
        const fn = new AsyncFunction('scope', `with (scope) { 'use strict'; ${code} }`);
        return await fn.call(scope, scope);
    }

    /** Build an error message for a failing statement, anchored to its original source line.
     *  Statement mode knows each statement's line range from acorn, so we don't need the
     *  V8-eval-offset calibration that _extractScriptContextFromErrorStack() relies on.
    */
    _formatStatementError(stmt:ScriptStatement, request:RunnerScriptExecutionRequest, e:Error):string
    {
        const CONTEXT_LINES_BEFORE = 3;
        const CONTEXT_LINES_AFTER = 3;
        const lines = (request.script.code ?? '').split('\n');
        const line = stmt.lineStart ?? 1;                 // 1-indexed
        const errIdx = Math.max(0, line - 1);             // 0-indexed anchor
        const endIdx = Math.min(lines.length, (stmt.lineEnd ?? line));
        const startIdx = Math.max(0, errIdx - CONTEXT_LINES_BEFORE);
        const stopIdx = Math.min(lines.length, endIdx + CONTEXT_LINES_AFTER);
        const gutterWidth = String(stopIdx).length;

        const contextLines:string[] = [];
        for(let i = startIdx; i < stopIdx; i++)
        {
            const marker = (i >= errIdx && i < (stmt.lineEnd ?? line)) ? '>' : ' ';
            contextLines.push(`${marker} ${String(i + 1).padStart(gutterWidth)} | ${lines[i]}`);
        }

        return `
**** EXECUTION ERROR ****
- error: '${e.message}'
- line: ${line}
- context:
${contextLines.join('\n')}
**** END ERROR ****`;
    }



    /** Setup for every execution run inside execution scope
     *  IMPORTANT: 'this' is the execution scope
    */
    _executionStartRunInScope(scope:RunnerScriptScope, request: RunnerScriptExecutionRequest):void
    {
        // Setup ParamManager - it still uses Array of Param defintions with _value
        const paramDefsWithValues = [...Object.values(request.script.params || {})] as Array<ScriptParam|ScriptParamData>; // param names are uppercase
        const paramValues = request.params || {};
        paramDefsWithValues.forEach(pd =>
        {
            const n = Object.keys(paramValues).find( p => p.toLowerCase() === pd.name.toLowerCase())
            pd._value = (n !== undefined) ? paramValues[n] : pd.default;
        });

        console.info(`Runner::_executionStartRunInScope()[in execution context]: Setting up ParamManager in scope with params '${JSON.stringify(paramDefsWithValues)}'`);

        // NOTE: ParamManager sets values in scope 
        scope._paramManager = new ParamManager(paramDefsWithValues).setParent(scope);
        scope.$PARAMS = scope._paramManager;
        
        // Reset some modules
        scope._archiyou.modeler.reset(); // reset before we begin
        // Select the kernel for this run. The actual (async) kernel load already happened in
        // execute() -> _ensureKernel(); the scope Modeler inherited the loaded kernels, so this
        // only has to point it at the right one. Whole-run only: no switching mid-script.
        scope._archiyou.modeler.mode(request.kernel ?? 'mesh');
        // Apply the display unit-system preference (presentation only). Geometry
        // stays in the script's model unit (mm unless $modeler.units() is set);
        // dimension lines / doc SVG convert to metric/imperial for display.
        if (request.unitSystem) { scope._archiyou.modeler.unitSystem(request.unitSystem); }
        scope._archiyou.docs.reset(); // TODO: check after rename doc => docs
        scope._archiyou.calc.reset();
        scope._archiyou.annotator?.reset(); // doesnt have it
        // beginRun registers the script identity so getManagedHandlesData() can detect
        // script switches and produce delete/add ops accordingly. Also passes param names
        // so the Interactor can validate paramsFn key references at first definition time.
        const scriptKey = request?.script?.id ?? request?.script?.fileId ?? 'default';
        const knownParamNames = Object.keys(request?.script?.params ?? {});
        scope._archiyou.interactor?.beginRun(scriptKey, knownParamNames, request?.selection ?? [], scope._paramManager);
        // scope._archiyou.gizmos = []; // TODO AFTER REFACTOR
    }

    //// EXECUTION COMPONENT SCRIPTS ////

    /** Link a array of Scripts that can be called as components
     *  Mostly used in in browser editor context
     *  We take it that this reference is updated
     */
    linkComponentScripts(scripts:Array<Script> = [])
    {
        this._linkedComponentScripts = scripts.filter(s => Script.isScript(s));
        if(scripts.length !== this._linkedComponentScripts.length)
        {
            console.warn(`Runner::linkComponentScripts(): Some scripts in the provided array are not valid Script objects and will be ignored!`);    
        }
    }

    /** The components a script can use: first the author's own (linked workspace) scripts
     *  as `@author/name:dev` (their latest version), then the shared ones as `@author/name`,
     *  own shares included. Each group sorted. Own scripts are listed by bare name when the
     *  author is unknown (anonymous, tests). Used by $component().list(). */
    listComponentGroups():{ own:Array<string>; shared:Array<string> }
    {
        const me = this._ownComponentAuthor();
        const sorted = (names:Array<string>) => Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));

        const own = sorted(this._linkedComponentScripts
            .filter(s => s.name)
            .map(s => (s.author ?? me) ? `@${s.author ?? me}/${s.name}:${DEV_COMPONENT_VERSION}` : s.name as string));
        const shared = sorted(this._sharedComponentNames);
        return { own, shared };
    }

    /** listComponentGroups(), own first, as one list. */
    listComponentNames():Array<string>
    {
        const { own, shared } = this.listComponentGroups();
        return [...own, ...shared];
    }

    /** The author whose workspace `@author/name:dev` resolves locally for: the author of the
     *  running script, else of the linked scripts. Undefined when nobody is known. */
    _ownComponentAuthor():string|undefined
    {
        return this._componentLibrary?.author?.toLowerCase()
            ?? this._linkedComponentScripts.find(s => s.author)?.author;
    }

    /** Fill _sharedComponentNames from the shared library: community shares plus, with a
     *  token, those shared with the user. Never throws; without a library it stays empty. */
    async _fetchSharedComponentNames():Promise<void>
    {
        const lib = this._componentLibrary;
        if(!lib){ this._sharedComponentNames = []; return; }

        const get = async (path:string, headers:Record<string,string> = {}):Promise<Array<ScriptData>> =>
        {
            try
            {
                const res = await fetch(`${lib.url}${path}`, { headers });
                if(!res.ok) return [];
                const body = await res.json();
                const data = body?.data ?? body;
                return Array.isArray(data) ? data : [];
            }
            catch(e)
            {
                console.error(`Runner::_fetchSharedComponentNames(): Failed to fetch '${path}': ${(e as Error)?.message ?? e}`);
                return [];
            }
        };

        const lists = await Promise.all([
            get('/scripts/shared'),
            lib.authToken ? get('/scripts/shared/with-me', { Authorization: `Bearer ${lib.authToken}` }) : Promise.resolve([]),
        ]);
        this._sharedComponentNames = lists.flat()
            .filter(d => d?.author && d?.name)
            .map(d => `@${String(d.author).toLowerCase()}/${String(d.name).toLowerCase()}`);
    }

    /** Execute a component script in a seperate scope
     *  This is always done in local context 
     *   because executing components comes from within execution scope and context
     *   IMPORTANT: 
     *      - We want to avoid writing in a script: await $component('name').get(..)
     *          which will be ugly and prone to errors
     *      - So a sync function is used to execute component scripts
     *      - This also means that we need to pre-fetch all component scripts before executing them
     */
    _executeComponentScript(request:RunnerScriptExecutionRequest): RunnerScriptExecutionResult
    {
        console.info(`Runner::_executeComponentScript(): Executing component script '${request.component}' in separate scope!`);

        // Refuse a component that is already executing further up the chain. Without this a
        // cycle (a uses b, b uses a) recurses until the JS stack blows, which surfaces as an
        // unrelated-looking RangeError. The static walk in _prefetchComponentScripts cannot
        // catch every case either - $component(someVariable) is only known at call time - so
        // this runtime guard is the authoritative one.
        const chain = [...this._componentExecStack, request.component];
        if(this._componentExecStack.includes(request.component))
        {
            throw new Error(`$component(): circular component reference: ${chain.join(' -> ')}. A component cannot use itself, directly or indirectly.`);
        }
        if(this._componentExecStack.length >= MAX_COMPONENT_DEPTH)
        {
            throw new Error(`$component(): components nested deeper than ${MAX_COMPONENT_DEPTH} levels: ${chain.join(' -> ')}. Try to flatten your component tree.`);
        }

        // Everything below has to be unwound even when the component throws, or the parent
        // keeps running against the component's scope and request.
        const parentScopeName = this._activeScope?.name ?? 'default';
        const parentRequest = this._activeExecRequest;
        // Unique per activation: the same reference can legitimately appear twice on the way
        // down, and two scopes under one name would delete each other.
        const scopeName = `component:'${request.component}'#${++this._componentScopeSeq}`;

        this._componentExecStack.push(request.component);
        this.createScope(scopeName); // automatically becomes current scope

        try
        {
            return this._executeLocalComponent(request, true, true); // start run and output
        }
        finally
        {
            this.deleteLocalScope(scopeName, parentScopeName); // hand the parent scope back
            this._activeExecRequest = parentRequest; // ...and the parent's request (doc titleblock reads it)
            this._componentExecStack.pop();
        }
    }

     /** For executing component scripts we need to have synchronous execution function
     *  Because we don't want to write await $component('name').get() in the code
     *  This is possible only if we use sync methods in the code
     *  In this case that's no problem because we need the existing internal instances 
     *      from Component scope for model, metrics, docs, tables
     *  
     *  NOTE: This is run in the local scope, so 'this' is the execution scope
     */
     _executeLocalComponent(request: RunnerScriptExecutionRequest, startRun:boolean=true, output:boolean=true):RunnerScriptExecutionResult|null
     {
         if(!this.loaded())
         { 
             throw new Error(`Runner::_executeLocalComponent(): Modeler kernel not loaded yet`);
         }

         console.info(`Runner:_executeLocalComponent(): Executing script in active component context: '${this._activeScope.name}'`);
         console.info(`* With execution request settings: { params: ${JSON.stringify(request.params)} and outputs: ${JSON.stringify(request.outputs)} }`);

         this._activeExecRequest = request;
         const executeStartTime = performance.now()
 
         const scope = this.getActiveScope();
         const code = request.script.code
         
         const startRunFunc = (startRun) ? this._executionStartRunInScope : () => {};
         const outputFunc = (output) 
                             ? this.getScopeResultsComponent.bind(this) // <== this is a special sync function only used for Components
                             : () => null; // output or return null
      
         const exec = () =>
         {
             try 
             {
                 return (new Function(  
                         'request',
                         'scope', 
                         'startRunFunc',
                         'outputFunc',
                             // function body
                             `
                             startRunFunc.call(scope, scope, request); // first is this, the rest args
                             // To deal with replaced async functions in old JS enviroments
 
                             // run code in scope
                             with (scope)
                             {
                                 'use strict'; 
                                 ${code};
                             }
                             // export results
                             return outputFunc(scope, request);
             
                             `
                     ))(this._activeExecRequest, scope, startRunFunc, outputFunc) as RunnerScriptExecutionResult;    
             }
             catch(e)
             {
                // Any error while executing code is caught here
                return this._handleExecutionError(scope, this._activeExecRequest, code, e);
             }
         }
 
         const result = exec();
         
         this._finalizeExecutionDuration(result, executeStartTime);
 
         return result;
     }

    /* Prefetch component scripts from request script code
     *
     *  Walks the WHOLE component tree, not just the top level: a component may use
     *  components of its own, and because $component() executes synchronously every one of
     *  them has to be in the cache before the script runs.
     *
     *  @param level    - current depth; only level 0 captures the shared-library fallback
     *  @param visited  - references already walked on this call. Terminates cycles and stops
     *                    a diamond (a->b, a->c, b->d, c->d) resolving d twice. Deliberately
     *                    per-call, never an instance field: the editor re-runs on every
     *                    keystroke and a component's code changes between runs.
     */
    async _prefetchComponentScripts(request:string|Script|RunnerScriptExecutionRequest, level:number=0, visited:Set<string>=new Set()):Promise<{ scripts: Record<string,Script>; missing: string[] }>
    {

        /* $component(<<script>>) can have multiple ways to reference a script

            - $component('<<code>>'). ie. $component('myComponent = box(10,20,30);')
            - $component('<<local file path>>'). ie. './components/myComponent.js'
            - $component('<<local file name>>'). ie. 'mylocalcomponent' (if linked in with linkComponentScripts())
            - $component('<<library path>>'). ie. 'archiyou/mycomponent:1.0.0'

            - $component('<<external library path>>'). ie. 'https://lib.cadcompany.com/ourcompany/componentscript:1.0.0'
            - $component('<<url>>'). ie. 'https://github.com/archiyouApp/archiyou-core/examples/cadscripts/myComponent.js'
            
            We first support the first 3 because they are pretty safe. 
            The others need some warning (of save execution mechanism): since you are executing untrusted external code            

            See Runner._prepareComponentScript(name) for actual fetching logic

        */
        let scriptCode = (typeof request === 'string')
                            ? request
                            : (Script.isScript(request))
                                ? request.code
                                : request?.script?.code;

        // Capture the fallback library for this run. Only a top-level execution request
        // carries it; the recursive calls below pass a Script, which must keep resolving
        // against the SAME author (a component's own components live in that author's
        // workspace too, not in the visitor's).
        // NOTE: _sharedComponentFetches is deliberately NOT cleared here. execute() prefetches
        // twice (see the executeUrl() path), and a configurator re-runs on every param change —
        // all of which would otherwise refetch the same unchanged components over the network.
        if(level === 0)
        {
            this._componentLibrary = this._getComponentLibraryFromRequest(request);
            // Latest script versions (own stored ones, others' ':dev' copies) change between runs
            this._renamedComponentFetches = {};
            Object.keys(this._sharedComponentFetches)
                .filter(key => key.endsWith(`:${DEV_COMPONENT_VERSION}`))
                .forEach(key => delete this._sharedComponentFetches[key]);
        }

        if(!scriptCode)
        {
            console.warn(`Runner::_prefetchComponentScripts(): No script code found in request to prefetch component scripts from!`);
            return { scripts: this._componentScripts, missing: [] };
        }

        // remove escape characters for quotes to avoid issues in regex matching
        scriptCode = scriptCode.replaceAll(/\\([''`])/g, '$1');

        // NOTE: for (recursive) components defined inline ($component(<<<code>>>))
        // This matches only top level $component calls - recurse for the rest
        const componentMatches = this._extractTopLevelComponentCalls(scriptCode);

        if(componentMatches.length === 0)
        {
            return { scripts: this._componentScripts, missing: [] }; // no components to fetch
        }

        // Fetch all top-level component scripts
        const preparedComponentScripts: Array<Script> = [];
        const missing: string[] = [];
        let listsShared = false;

        for(let i = 0; i < componentMatches.length; i++)
        {
            const match = componentMatches[i];
            const name = match.content;

            // $component() without a name only lists the available components (.list()),
            // which includes the shared library: fetch that list now, the listing is sync
            if(!name.trim())
            {
                if(level === 0 && !listsShared){ listsShared = true; await this._fetchSharedComponentNames(); }
                continue;
            }

            // Already walked on this pass? Then it is cached (or already reported missing)
            // and recursing again would loop forever on a cycle. Keyed exactly like
            // addComponentScriptToCache() so the two always agree on identity.
            const visitKey = name.replaceAll(/\\/g,'');
            if(visited.has(visitKey)){ continue; }
            visited.add(visitKey);

            // Fetch component script
            const componentScript = await this._prepareComponentScript(name);
            if(!componentScript)
            {
                console.error(`Runner::_prefetchComponentScripts(): Can't resolve component '${name}'.`);
                missing.push(name);
                continue; // nothing to cache or recurse into
            }

            preparedComponentScripts.push(componentScript);

            // Add component to cache (_componentScripts)
            this.addComponentScriptToCache(name, componentScript);
        };

        // Now walk into what those components reference themselves.
        // IMPORTANT: this loop is awaited. It used to be `forEach(async cs => await ...)`,
        // which discards the promises — so execute() carried on before the nested components
        // were cached and $component() at depth >= 2 hit an empty cache. Sequential rather
        // than Promise.all: shared-library lookups are already memoised by
        // _sharedComponentFetches, and it keeps the log readable.
        if(level < MAX_COMPONENT_DEPTH)
        {
            console.info(`Runner::_prefetchComponentScripts(): Recursing nested $component() references. Recursion level: ${level + 1}`);
            for(const cs of preparedComponentScripts)
            {
                const nested = await this._prefetchComponentScripts(cs, level + 1, visited);
                // Merge nested misses upward, or execute()'s pre-flight check only ever sees
                // the top level and a missing sub-component surfaces mid-run instead.
                missing.push(...nested.missing);
            }
        }
        else {
            console.error(`Runner::_prefetchComponentScript: Quit recursion after level ${MAX_COMPONENT_DEPTH}. Try to flatten your component tree.`)
        }

        console.log(`Runner::_prefetchComponentScripts(): Fetched ${Object.keys(this._componentScripts).length} component scripts: ${Object.keys(this._componentScripts).join(', ')}`);

        return { scripts: this._componentScripts, missing: Array.from(new Set(missing)) }; // return all fetched component scripts
    }

    //// SCRIPT MODULES ////

    /** Public accessor, so apps and tests can inspect or configure the registry
     *  without reaching into a private field. */
    get modules():ModuleRegistry { return this._moduleRegistry; }

    /** Resolve the script modules this run may use.
     *
     *  Same two-phase trick as _prefetchImportAssets(): the async work (fetching a
     *  gated bundle, and any module's own init()) happens out here, so the scope —
     *  which is built synchronously — can just read the result. Never throws;
     *  a module that cannot be resolved becomes a stub that explains itself when
     *  the script touches it. */
    async _prepareModules(request:string|Script|RunnerScriptExecutionRequest):Promise<void>
    {
        const code = (typeof request === 'string')
                        ? request
                        : (Script.isScript(request))
                            ? request.code
                            : request?.script?.code;

        const catalog = (typeof request === 'object' && request !== null && 'modules' in request)
                            ? (request as RunnerScriptExecutionRequest).modules
                            : undefined;

        if(!code || !catalog?.length) return;

        const req = request as RunnerScriptExecutionRequest;
        this._moduleRegistry.setOptions({
            moduleApiUrl: req.moduleApiUrl ?? '',
            authToken: req.authToken,
        });

        await this._moduleRegistry.prepare(code, catalog);

        // Then let each module pull in whatever the script should be able to
        // reach synchronously. Separate from prepare() because a warm-up needs
        // to know the run — chiefly its asset proxy, which is the only way a
        // browser worker can fetch a third-party host at all. This is the last
        // async moment before the scope is built.
        await this._moduleRegistry.warmModules({ assetProxyUrl: req.assetProxyUrl });
    }

    //// $import ASSETS ////

    /** Extract the string-literal URLs of every `$import('url'[, {...}])` in the code.
     *  Deduplicated. Only static string literals are pre-fetchable (like $component);
     *  a dynamic `$import(someVar)` is reported at call time as a cache miss. */
    _extractImportUrls(code:string):Array<string>
    {
        const urls = new Set<string>();
        const re = /\$import\s*\(\s*(['"`])([^'"`]+)\1/g;
        let m:RegExpExecArray | null;
        while((m = re.exec(code)) !== null)
        {
            const url = m[2].trim();
            if(url) urls.add(url);
        }
        return Array.from(urls);
    }

    /** Fetch (through the asset proxy) every $import() URL in the script and cache the
     *  raw payload by URL. Runs before execution so the in-scope $import() is synchronous.
     *  Already-cached URLs are skipped so editor re-runs don't re-fetch. */
    async _prefetchImportAssets(request:string|Script|RunnerScriptExecutionRequest):Promise<void>
    {
        const code = (typeof request === 'string')
                        ? request
                        : (Script.isScript(request))
                            ? request.code
                            : request?.script?.code;
        if(!code) return;

        const proxyUrl = (typeof request === 'object' && request !== null && 'assetProxyUrl' in request)
                            ? (request as RunnerScriptExecutionRequest).assetProxyUrl
                            : undefined;

        const urls = this._extractImportUrls(code).filter(u => !this._importAssets[u]);
        if(urls.length === 0) return;

        console.info(`Runner::_prefetchImportAssets(): fetching ${urls.length} asset(s): ${urls.join(', ')}`);
        await Promise.all(urls.map(async (url) =>
        {
            this._importAssets[url] = await AssetImporter.fetch(url, { proxyUrl });
        }));
    }

    /** Manage component script cache */
    addComponentScriptToCache(name: string, script: Script):string
    {
        // Use hash for stability, especially for name = inline code (with \n and whitespaces)
        const cleanName = name.replaceAll(/\\/g,''); // remove all escape chars
        const nameHash = hash(cleanName)
        script._component = cleanName;
        this._componentScripts[nameHash] = script;
        return nameHash;
    }

    
    /** Fetch/Prepare component script from: 
     *    
     *    - single code string 'myComponentBox = box();'
     *    - library path: '/archiyou/wall'
     *    - external library url: 'https://lib.cadcompany.com/teamx/someComponent:1.0.0'
     *    - local file path: './myComponent.js'
     *    - local file name: './myLocalComponent
     * 
     *  NOT YET: 
     *      - external file url
     * */
    async _prepareComponentScript(path?:string):Promise<Script|null>
    {
        if(!path && typeof path !== 'string'){ throw new Error(`$component('${path}')::_prefetchComponentScript(): Cannot fetch. Component name not set!`);}

        // '@author/name[:version]': the shared library, the same for own scripts as for
        // anyone else's. ':dev' is the latest script version instead.
        const authored = parseAuthoredComponentRef(path);
        if(authored)
        {
            if(authored.version === DEV_COMPONENT_VERSION)
            {
                return await this._getDevComponentScript(authored.name, authored.author);
            }
            return await this._getSharedComponentScript(authored.name, authored.author, authored.version);
        }

        // 'wall:dev' / './wall:0.6': a versioned own script, like '@me/wall:dev' / '@me/wall:0.6'
        const versioned = parseVersionedLocalComponentRef(path);
        if(versioned)
        {
            const me = this._ownComponentAuthor();
            if(versioned.version === DEV_COMPONENT_VERSION)
            {
                // A workspace name, like './wall': the linked script of that name, whoever the
                // workspace says wrote it (it can hold scripts of several accounts)
                const linked = this._linkedComponentScripts.find(s => s.name === versioned.name);
                if(linked) return linked;
                return me
                    ? await this._getDevComponentScript(versioned.name, me)
                    : await this._resolveLocalComponentScript(versioned.name);
            }
            return await this._getSharedComponentScript(versioned.name, me, versioned.version);
        }

        // Local file path like './myComponent.ts' (in node) for local scripting and debug
        if(path.includes('.js'))
        {
            if(!this.inNode())
            {
                throw new Error(`$component('${path}')::_prepareComponentScript(): Cannot fetch component script from local file in the browser!`);    
            }

            console.info(`$component('${path}')::_prepareComponentScript(): Fetching local component script at '${path}'...`);

            // Load dynamically to avoid issues in browser
            const FS_PROMISES_LIB = 'fs/promises'; // avoid problems with older build systems preparsing import ScriptStatement
            const fs = await import(FS_PROMISES_LIB); // use promises version of fs
            const pathLib = await import('path');

            // NOTE: absolute paths are recommended - otherwise we take the working directory as root
            // There is no way to get the main script from here
            if(path[0] === '.')
            {
                path = pathLib.resolve(process.cwd(), path);
                console.warn(`$component('${path}')::_prepareComponentScript(): Resolved relative path using current working to: '${path}'`);
            }

            try {
                // Scripts are modules (not JSON)
                const data:ScriptData = (await import(path))?.default;

                if(!data){ throw new Error(`$component('${path}')::_prepareComponentScript(): Cannot read component script from file '${path}'. File is empty!`);}

                const componentScript = Script.fromData(data);
                if(!componentScript)
                {
                    throw new Error(`$component('${path}')::_prepareComponentScript(): Invalid script data in file '${path}'`);
                }
                return componentScript;
            }
            catch(e)
            { 
                throw new Error(`$component('${path}')::_prepareComponentScript(): Cannot read component script from file '${path}'. File not found`);
            }
            
        }
        else if(path.startsWith('./'))
        {
            // Local component reference like './mybox' — resolved against the
            // set of Scripts handed to runner.linkComponentScripts(). Names are
            // already lowercased by Script.fromData(), so compare lowercased.
            const localName = path.slice(2).toLowerCase();
            const resolved = await this._resolveLocalComponentScript(localName);
            if (resolved) return resolved;

            console.warn(`$component('${path}')::_prepareComponentScript(): No linked component matched local name '${localName}'.`);
            return null;
        }
        // path in format like 'archiyou/testcomponent:0.5' or 'archiyou/testcomponent' (default library)
        // or externally: 'pubv2.archiyou.com/archiyou/myscript:1.0'
        else if(Script.isPath(path))
        {
            return await this.getScriptFromUrl(path); // get library instance
        }
        else if(Script.isProbablyCode(path))
        {
            const componentScript = Script.fromData({ code: path });
            if(!componentScript)
            {
                throw new Error(`Runner::_prepareComponentScript(): Cannot create inline component from provided code`);
            }
            componentScript._inline = true; // mark as inline
            return componentScript;
        }
        else if(!path.includes('/') && !path.includes('.') && !path.includes('://'))
        {
            // Bare script name like 'timberwall' — resolve against linked component scripts
            return await this._resolveLocalComponentScript(path.toLowerCase()); // same as './name'
        }
        else {
            return null;
        }
    }

    /** '@author/name:dev': the latest script version, not a shared one.
     *    - own script: the workspace copy (possibly unsaved), else the latest stored version;
     *    - another author's: their latest working copy, if they shared it with dev access.
     *  When neither is readable (a visitor of a published configurator, or no dev access)
     *  the latest shared version is used, with a warning. */
    async _getDevComponentScript(name:string, author:string):Promise<Script|null>
    {
        const me = this._ownComponentAuthor();
        if(!me || author === me)
        {
            // When the own author is unknown, only a linked script that does not say it
            // belongs to someone else counts
            const linked = this._linkedComponentScripts.find(s => s.name === name && (!s.author || s.author === author));
            if(linked) return linked;

            const stored = await this._getRenamedComponentScript(name);
            if(stored) return stored;
        }

        const dev = await this._getSharedComponentScript(name, author, DEV_COMPONENT_VERSION);
        if(dev) return dev;

        const shared = await this._getSharedComponentScript(name, author);
        if(shared)
        {
            console.warn(`$component('@${author}/${name}:dev'): The latest script version is not readable. Using shared version ${shared.version ?? 'latest'} instead.`);
        }
        return shared;
    }

    /** Resolve a workspace-local component name ('./wall' or bare 'wall'), in order:
     *    1. a linked script with that name (the editor's workspace);
     *    2. a linked script that USED to have that name — it was renamed, and the
     *       referencing script still uses the old one (see _getRenamedComponentScript);
     *    3. the author's shared library (a published configurator) — which is itself
     *       rename-aware server-side. */
    async _resolveLocalComponentScript(localName:string):Promise<Script|null>
    {
        const linked = this._linkedComponentScripts.find(s => s.name === localName);
        if (linked)
        {
            console.info(`$component('./${localName}')::_resolveLocalComponentScript(): Resolved against linked component '${linked.name}'.`);
            return linked;
        }

        const renamed = await this._getRenamedComponentScript(localName);
        if (renamed) return renamed;

        const shared = await this._getSharedComponentScript(localName);
        if (shared && this._linkedComponentScripts.length > 0)
        {
            // In the editor an own script should never come from the shared library: that is
            // a released version, not the latest code. Only reached without a (valid) login.
            console.warn(`$component('./${localName}')::_resolveLocalComponentScript(): Not in your workspace. Using shared version ${shared.version ?? 'latest'}, which may be older than your latest code.`);
        }
        return shared;
    }

    //// COMPONENTS FROM THE AUTHOR'S SHARED LIBRARY ////

    /** The shared-library fallback for this run, or null when the request cannot describe
     *  one. Needs both halves: where the backend is (componentLibraryUrl, possibly '' for
     *  a root-relative same-origin call) and whose workspace to look in (the script's
     *  author). A Script/string request carries neither, so those never get a fallback. */
    _getComponentLibraryFromRequest(request:string|Script|RunnerScriptExecutionRequest):{ url:string; author?:string; authToken?:string; fileId?:string }|null
    {
        if(typeof request !== 'object' || request === null || Script.isScript(request)) return null;

        const req = request as RunnerScriptExecutionRequest;
        const url = req.componentLibraryUrl;
        if(typeof url !== 'string') return null; // not '!url' — '' is a valid (same-origin) base

        // No author (a new or not yet synced script): bare names have no library to fall back
        // to, but '@author/name' still does
        const author = (req.script as any)?.author;
        return {
            url,
            author: (typeof author === 'string' && author) ? author.toLowerCase() : undefined,
            authToken: req.authToken,
            fileId: (req.script as any)?.fileId,
        };
    }

    /** Rename fallback for linked (workspace) components.
     *
     *  A script references its components by name, so renaming a component breaks every
     *  script that still uses the old name. Name history lives server-side (each version
     *  row keeps the name it was saved under), so ask the author's own store which file
     *  carried `localName` and take the linked script with that same fileId — the latest
     *  (possibly unsaved) working copy. If that file is not linked, the stored latest
     *  version is used instead.
     *
     *  Owner-only route, so it needs the run's authToken and linked scripts (i.e. the
     *  author working in the editor). Returns null (never throws) on any failure. */
    async _getRenamedComponentScript(localName:string):Promise<Script|null>
    {
        const lib = this._componentLibrary;
        if(!lib?.author || !lib.authToken || this._linkedComponentScripts.length === 0) return null;

        const cacheKey = `${lib.author}/${localName}`;
        const url = `${lib.url}/scripts/${encodeURIComponent(lib.author)}/by-name/${encodeURIComponent(localName)}`;

        this._renamedComponentFetches[cacheKey] ??= (async ():Promise<ScriptData|null> =>
        {
            try
            {
                const res = await fetch(url, { headers: { Authorization: `Bearer ${lib.authToken}` } });
                if(!res.ok) return null; // 404: no script ever had this name
                const body = await res.json();
                const data = body?.data ?? body; // owner routes return ScriptData raw
                return data?.fileId ? data : null;
            }
            catch(e)
            {
                console.error(`$component('./${localName}')::_getRenamedComponentScript(): Failed to fetch '${url}': ${(e as Error)?.message ?? e}`);
                return null;
            }
        })();

        const data = await this._renamedComponentFetches[cacheKey];
        // The running script itself used to have this name: never import it into itself.
        if(!data || data.fileId === lib.fileId) return null;

        const script = this._linkedComponentScripts.find(s => s.fileId === data.fileId) ?? Script.fromData(data);
        if(!script) return null;

        // Not renamed, just not linked: the latest stored version of the own script
        if(script.name === localName)
        {
            console.info(`$component('./${localName}')::_getRenamedComponentScript(): Resolved to the latest stored version of own script '${script.name}'.`);
            return script;
        }

        console.warn(`$component('./${localName}')::_getRenamedComponentScript(): '${localName}' was renamed to '${script.name}'. Using its latest version — update the reference to $component('./${script.name}').`);
        return script;
    }

    /** Fetch a component the author shared, by its local name — how a published
     *  configurator resolves $component('./timberwall') for a visitor who has no copy of
     *  the author's workspace. Publishing shares the referenced components automatically
     *  (see the editor's component-sharing service), which grants read access WITHOUT
     *  making them configurators of their own.
     *
     *  Resolves to the LATEST shared version, so re-sharing a component updates every
     *  configurator that uses it. Returns null (never throws) on any failure — an
     *  unresolvable component is reported by the caller as a missing component. */
    async _getSharedComponentScript(localName:string, author?:string, version?:string):Promise<Script|null>
    {
        const lib = this._componentLibrary;
        author ??= lib?.author;
        if(!lib || !author) return null;

        const nameAndVersion = version ? `${localName}:${version}` : localName;
        const cacheKey = `${author}/${nameAndVersion}`;
        if(this._sharedComponentFetches[cacheKey]) return this._sharedComponentFetches[cacheKey];

        const url = `${lib.url}/scripts/shared/${encodeURIComponent(author)}/${encodeURIComponent(localName)}${version ? `:${encodeURIComponent(version)}` : ''}`;

        const fetching = (async ():Promise<Script|null> =>
        {
            try
            {
                console.info(`$component('./${localName}')::_getSharedComponentScript(): Fetching from the author's shared library at '${url}'...`);
                // A token lets a share restricted to this user (onlyUsers) through
                const res = await fetch(url, lib.authToken ? { headers: { Authorization: `Bearer ${lib.authToken}` } } : undefined);
                if(!res.ok)
                {
                    // 404 = never shared; 403 = shared but restricted with onlyUsers.
                    console.error(`$component('./${localName}')::_getSharedComponentScript(): '${author}/${nameAndVersion}' is not readable (HTTP ${res.status}). The author must share it for this configurator to work.`);
                    return null;
                }
                const body = await res.json();
                const data = body?.data ?? body; // library GETs wrap in { success, data }
                const script = Script.fromData(data);
                if(!script)
                {
                    console.error(`$component('./${localName}')::_getSharedComponentScript(): Invalid script data returned by '${url}'.`);
                    return null;
                }
                console.info(`$component('./${localName}')::_getSharedComponentScript(): Resolved to shared '${author}/${script.name}:${script.version ?? 'latest'}'.`);
                return script;
            }
            catch(e)
            {
                console.error(`$component('./${localName}')::_getSharedComponentScript(): Failed to fetch '${url}': ${(e as Error)?.message ?? e}`);
                return null;
            }
        })();

        this._sharedComponentFetches[cacheKey] = fetching;
        return fetching;
    }

    /** Get component from cache in componentScripts 
     *  Cache needs to be filled by this._prefetchComponentScripts()
    */
    getComponentScriptFromCache(name:string):Script|null
    {
        const cleanName = name.replaceAll(/\\/g,''); // remove all escape chars
        const nameHash = hash(cleanName);
        if(!this._componentScripts[nameHash])
        {
            console.warn(`Runner::getComponentScriptFromCache(): Component script '${name}' [hash=${nameHash}] not found in cache. `);
            console.info(`Current cache: ****`);
            Object.entries(this._componentScripts)
                        .forEach(([key, script]) => console.log(` - ${key}: '${script._component}'`));

            return null;
        }
        return this._componentScripts[nameHash];
    }

    //// COMPONENT EXECUTION RESULT CACHE ////

    /* $component() is executed synchronously, once per call site, in a throwaway scope. Two
       identical calls therefore ran the same script twice - which for a wall repeated across
       a facade is the dominant cost of the whole run. The cache below memoises the raw
       RunnerScriptExecutionResult so the second call only has to re-import the outputs.

       Correctness rests on the key: it must cover EVERYTHING the component's outputs can
       depend on, because nothing else invalidates it. See _componentResultCacheKey().

       What it cannot see is a component that is not a pure function of its inputs (reading a
       $import()ed asset that changed under it, or a module with its own state). Those call
       $component(..).noCache(). */

    /** Cache identity for one component activation.
     *
     *  - component  the reference/label. Not cosmetic: toComponentGraph() prefixes every
     *               scene node name with it, so two labels are two different trees.
     *  - code       the component's own source, so an edit in the editor misses by itself
     *               (the prefetch overwrites _componentScripts with the new code each run).
     *  - params     what the caller passed in. Key-order-insensitive, see stableStringify.
     *  - outputs    a request for fewer outputs must not be served the fuller result, and
     *               vice versa. Sorted: order carries no meaning.
     *  - kernel/units  the same code models differently under brep and mesh.
     */
    _componentResultCacheKey(script:Script, request:RunnerScriptExecutionRequest):string
    {
        return hash(stableStringify({
            component: request.component ?? '',
            code: script?.code ?? '',
            params: request.params ?? {},
            outputs: [...(request.outputs ?? [])].sort(),
            kernel: request.kernel ?? '',
            unitSystem: request.unitSystem ?? '',
        }));
    }

    /** Memoised result for a key, or null. A hit is refreshed to the most-recent end so the
     *  eviction in addComponentResultToCache() drops what is genuinely least used. */
    getComponentResultFromCache(key:string):RunnerScriptExecutionResult|null
    {
        const hit = this._componentResults.get(key);
        if(!hit){ return null; }
        this._componentResults.delete(key);
        this._componentResults.set(key, hit);
        return hit;
    }

    /** Memoise a component result. Errors are never cached: a component that threw must get
     *  another chance next run, otherwise a transient failure sticks for the session. */
    addComponentResultToCache(key:string, result:RunnerScriptExecutionResult):void
    {
        if(!result || result.status === 'error'){ return; }

        this._componentResults.delete(key); // re-insert at the recent end
        this._componentResults.set(key, result);

        while(this._componentResults.size > MAX_COMPONENT_RESULT_CACHE)
        {
            const oldest = this._componentResults.keys().next().value as string;
            this._componentResults.delete(oldest);
        }
    }

    /** Drop one memoised result, or the whole cache when no key is given. */
    clearComponentResultCache(key?:string):this
    {
        if(key === undefined)
        {
            console.info(`Runner::clearComponentResultCache(): Dropped all ${this._componentResults.size} memoised component results.`);
            this._componentResults.clear();
        }
        else {
            this._componentResults.delete(key);
        }
        return this;
    }

    /** Number of memoised component results. For tests and debugging. */
    get componentResultCacheSize():number { return this._componentResults.size; }

    /** Build the ArchiyouStateData payload for a finished execution scope.
     *  Delegates to Modeler.toArchiyouState so Modeler.toGLB embeds the
     *  identical state in GLB extras. */
    private _buildArchiyouState(scope: RunnerScriptScope): ArchiyouStateData
    {
        const annotations = scope._archiyou?.annotator?.getAnnotationsData?.() ?? [];
        // Only emit managed-handle ops and interactive-shape paths for the main scope
        // to avoid contaminating the registry / leaking component-scope interactions.
        const managedHandles = scope._main
            ? (scope._archiyou?.interactor?.getManagedHandlesData?.() ?? [])
            : [];
        const interactiveShapes = scope._main
            ? (scope._archiyou?.interactor?.interactivePaths?.() ?? [])
            : [];
        // Params/presets the script defined this run (main scope only) — merged
        // into the param menu by the app. Code is the source of truth.
        const managedParams = scope._main
            ? (scope._paramManager?.getManagedParams?.() ?? undefined)
            : undefined;
        const managedPresets = scope._main
            ? (scope._paramManager?.getDefinedPresets?.() ?? undefined)
            : undefined;
        // Dynamic param behaviours (enableIf/visibleIf/...) — separate channel from
        // managedParams so decorating a UI-authored param never flips it programmatic.
        const managedBehaviours = scope._main
            ? (scope._paramManager?.getManagedBehaviours?.() ?? undefined)
            : undefined;

        const state = scope.modeler?.toArchiyouState?.(annotations, managedHandles, interactiveShapes)
            ?? { scenegraph: undefined, annotations, managedHandles, interactiveShapes };
        state.managedParams = managedParams;
        state.managedPresets = managedPresets;
        state.managedBehaviours = managedBehaviours;

        /*  Instructables, resolved. Only the main scope: a component's manual is its own
            business and would otherwise be merged into the host's step list. Wrapped so one
            bad instructable cannot fail a run that is otherwise fine — resolving touches the
            scene, and a manual is never the reason someone pressed run. */
        if (scope._main)
        {
            try
            {
                const instructs = scope._archiyou?.docs?._instructs ?? [];
                if (instructs.length) { state.instruct = instructs.map((i: any) => i.toData()) }
            }
            catch (e)
            {
                console.warn(`Runner::_buildArchiyouState(): could not resolve an instructable: ${e}`);
            }
        }

        return state;
    }

    //// PIPELINE ////

    async executePipeline(pipeline:Pipeline, request:RunnerScriptExecutionRequest): Promise<RunnerScriptExecutionResult|null>
    {
        if(!pipeline){ console.error(`Runner::_executePipeline(): No pipeline object given!`); return null; }

        const result = await this._executePipelineIsolated(pipeline, request); // start run and output
        this.deleteLocalScope(`pipeline:${pipeline.name}`); // delete scope after execution
        console.info(`******* Runner::executePipeline(): Finished executing pipeline '${pipeline.name}' *****`);
        return result;
    }

    /** Execute a Pipeline in a isolated scope and extract requested outputs
     *  NOTE: Based on _executeLocal() but simplified for ease of use
     */
    private async _executePipelineIsolated(pipeline:Pipeline, request:RunnerScriptExecutionRequest):Promise<RunnerScriptExecutionResult|null>
    {
        console.info(`Runner::_executePipelineIsolated(): Executing pipeline '${pipeline.name}' in seperate scope!`);

        const mainScope = this.getActiveScope();

        const executeStartTime = performance.now()

        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

        const scopeName = `pipeline:${pipeline.name}`;

        this.createScope(scopeName); // isolated pipeline scope, automatically becomes current scope
        const pipelineScope = this.getActiveScope();

        // IMPORTANT: Needs to be async !!!
        const outputFunc = async (scope:RunnerScriptScope) => { return await this.getScopeResults(scope, request); };

        const exec = async () =>
        {
            try 
            {
                return await (new AsyncFunction(  
                        'mainScope',
                        'pipelineScope',
                        'pipeline',
                        'outputFunc',
                            // function body
                            `
                            console.log('***** EXECUTING PIPELINE '${pipeline.name}' IN ISOLATED SCOPE (ASYNC) *****');
                            // run pipeline function in own scope, and supplying mainScope as argument
                            await pipeline._function.call(pipelineScope, mainScope); 
                            
                            // export results
                            /*
                            asyncOutput = outputFunc.constructor.name === 'AsyncFunction'; 
                            
                            return (asyncOutput) 
                                        ? Promise.resolve(outputFunc(pipelineScope)) // avoid await keyword - again for Webpack 4
                                        : outputFunc(pipelineScope);
                            */
                            return await outputFunc(pipelineScope);
            
                            `
                    ))(mainScope, pipelineScope, pipeline, outputFunc) as Promise<RunnerScriptExecutionResult>|RunnerScriptExecutionResult;    
            }
            catch(e)
            {
               return this._handleExecutionError(pipelineScope, request, outputFunc.toString(), e);
            }
        }

        const result = await exec();
        
        this._finalizeExecutionDuration(result, executeStartTime);

        return result;
    }

    //// EXECUTION UTILS ////

    /** Execute from URL of Archiyou library */
    async executeUrl(url:string, params?:Record<string,ScriptParamData>, outputs?:Array<string>):Promise<RunnerScriptExecutionResult>
    {
        const script = await this.getScriptFromUrl(url);
        if(!script){ throw new Error(`Runner::executeUrl(): Script not found at URL '${url}'`);}


        const request:RunnerScriptExecutionRequest = {
            kernel: 'mesh',
            script: script,
            params: params || Object.values(script.params).reduce((agg, p) => { agg[p.name] = p.default; return agg; }, {}), // use default param values if not provided
            outputs: outputs || this.DEFAULT_OUTPUTS, // default output
        };
        
        console.info(`Runner::executeUrl(): Executing script from URL '${url}' with params ${JSON.stringify(request.params)}`);

        const r = await this.executeInScriptStatements(request); // execute script in active scope
        return r;
    }

    getDefaultComponentLibraryUrl():string
    {
        return process.env.COMPONENT_LIBRARY_URL || 'http://localhost:4000';
    }

    getServicesUrl():string
    {
        if(process.env.SERVICES_API_URL)
        {
            return process.env.SERVICES_API_URL;
        }
        console.warn(`Runner::getServicesUrl(): SERVICES_API_URL is not defined: Please set in ENV!`);
    }

    /** Get a script directly from URL
     * We need to parse the url to get the library address and that of the script */
    async getScriptFromUrl(url:string):Promise<Script>
    {
        const libUrl = this._getLibUrlFromScriptUrl(url);

        if(!libUrl){ throw new Error(`Runner::getScriptFromUrl(): Cannot extract library URL from script URL '${url}'`); }

        console.info(`Runner::getScriptFromUrl(): Fetching script from '${url}' at library '${libUrl}'`);

        const _LibraryConnector = (globalThis as any).LibraryConnector; // TODO: LibraryConnector not yet implemented
        const library = new _LibraryConnector(libUrl);
        await library.connect();
        return await library.getScriptFromUrl(url); // get script from library
    }

    _getLibUrlFromScriptUrl(url:string):string|null
    {
        const match = url.match(/^(.*\/)([^\/]+)$/);
        return match ? match[1] : null;
    }

    _getScriptPathFromScriptUrl(url:string):string|null
    {
        const match = url.match(/^(.*\/)([^\/]+)$/);
        return match ? match[2] : null;
    }

    //// RESULTS ////

    _addMetaToResult(scope:RunnerScriptScope, request:RunnerScriptExecutionRequest, result:RunnerScriptExecutionResult):RunnerScriptExecutionResult
    {
        const shapes = scope.modeler.all();
        const bbox = shapes.length ? shapes.bbox() : undefined;
        const bboxArr = bbox ? bbox.min().toArray().concat(bbox.max().toArray()) : undefined;

        // Add meta info to result
        result.meta = {
            units: scope.modeler.units(),
            docs : scope.docs.docs(), // available doc names
            pipelines: this.getPipelineNames(),  // names of defined pipelines
            tables: scope.calc.getTableNames(), // names of available tables
            metrics : scope.calc.getMetricNames(),
            bbox : bboxArr, 
            numShapes: shapes.length,
        } as ScriptMeta;

        console.info(`****Runner::_addMetaToResult(): Added meta to result: ${JSON.stringify(result.meta)} ****`);

        return result;
    }

    /** Get results out of local execution scope  
     *  This function is bound to the scope - so 'this' is the execution scope
    */
    async getScopeResults(scope:RunnerScriptScope, request:RunnerScriptExecutionRequest):Promise<RunnerScriptExecutionResult>
    {
        console.info(`****Runner::getScopeResults(): Getting results from execution scope '${scope._scope}' ****`);
        console.info(`Request outputs:`)
            request.outputs?.forEach(o => console.info(` * ${o}`));
   
        const result = {} as RunnerScriptExecutionResult;

        // Basic data
        result.created = new Date();
        result.status = 'success'; // if this method is run, this means no errors were thrown
        result.request = request; // Keep the original request
        result.errors = []; // no errors by definition
        // TODO: more duration to Runner
        //result.duration = scope.modeler._duration; // duration of the last operation

        // Archiyou state data: scenegraph (path-keyed) + annotations.
        // The viewer and scene-navigator reconcile against this on every run.
        result.state = this._buildArchiyouState(scope);

        // Meta
        this._addMetaToResult(scope, request, result);
        
        // Outputs (needs to be after meta, because we need that info)
        if(request.outputs)
        {
            // NOTE: we supply result instead of result.meta, because warnings can be added
            result.outputs = await this.getScopeResultOutputs(scope, request, result);
        }
        else {
            throw new Error(`Runner::getScopeResults(): No outputs requested`);
        }

        // Output console messages
        const DEFAULT_OUTPUT_MESSAGES = ['user'] as Array<ConsoleMessageType>
        const messagesToOutput = (Array.isArray(request.messages)) 
                                    ? request.messages 
                                    : DEFAULT_OUTPUT_MESSAGES; // default messages to output
        // add buffered messages of given types
        result.messages = scope.console.getBufferedMessages(messagesToOutput);

        return result;
    }


    /** Get results from local execution scope based on 
     *  request.outputs paths
     *  We gather result by pipeline, because we can have multiple pipelines in the request that need to be run
     * 
     *  @scope - execution scope to get results from
     *  @request - execution request with outputs
     * 
     *  @returns - Array of ScriptOutputData with path and output data { path: ScriptOutputPath, output: any }
     * 
     *  NOTE: There is a recursive aspect here, because in the default pipeline (main scope) we run pipelines first 
     *      in a seperate scope and get its results. Here this function is used too.
    */
    async getScopeResultOutputs(scope:RunnerScriptScope, 
            request:RunnerScriptExecutionRequest, 
            result:RunnerScriptExecutionResult):Promise<Array<ScriptOutputData>>
    {
        const outputs = [] as Array<ScriptOutputData>;
        const outputManager = new ScriptOutputManager().loadRequest(request, result);
        const requestedPipelineNames = outputManager.getPipelines(); 

        // If we are in main scope, we need to run other pipelines first and get their results
        console.info(`**** Runner::getScopeResultOutputs(): Getting results from execution scope '${scope._scope}'. Requested pipelines: '${requestedPipelineNames.length ? requestedPipelineNames.join('') : 'none'}' ****`);

        for(let i = 0; i < requestedPipelineNames.length; i++)
        {
            const pipelineName = requestedPipelineNames[i];

            // Execute this pipeline if needed (when it is not the default)
            if(pipelineName !== 'default' && scope._main === true) // IMPORTANT: Only pipelines from main/default scope - otherwise loops happen
            {
                // Default pipeline is already run, only run others    
                const curPipeline = this.getPipelineByName(pipelineName);

                if(!curPipeline) // TODO: check valid
                {
                    console.warn(`Runner::getScopeResultOutputs: Can't get pipeline '${pipelineName}'`);
                }
                else 
                {

                    console.info(`'Runner::getScopeResultOutputs(): Running extra pipeline: '${pipelineName}'`);
                    /* NOTE: executePipeline actually uses this same function (so there is recursion here)
                        It's important that we create a specific request with only the outputs of current pipeline
                        Otherwise we would end up in infinite loops
                    */
                    const pipelineOutputs = outputManager.getOutputsByPipeline(pipelineName).map(p => p.resolvedPath);
                    const pipelineResults = await this.executePipeline(curPipeline, { ...request, outputs: pipelineOutputs });
                    if(!pipelineResults){ console.error(`Runner::getScopeResultOutputs: No results from pipeline '${pipelineName}'`); }
                    else { // Add the results to outputs of main scope
                        outputs.push(...pipelineResults.outputs);
                    }
                }
            }
            else {
                // Gather results per pipeline and add to array
                console.info(`**** Runner::getScopeResultOutputs(): Exporting outputs for pipeline '${pipelineName}' ****`);
                outputs.push(...await this._exportPipelineModels(scope, request, pipelineName, result));
                outputs.push(...await this._exportPipelineMetrics(scope, request, pipelineName, result));
                outputs.push(...await this._exportPipelineTables(scope, request, pipelineName, result));
                outputs.push(...await this._exportPipelineDocs(scope, request, pipelineName, result));
            }
        }
        
        return outputs;        
        
    }    

    /**
     * Get results out of local execution scope synchronously for Components
     * For special cases like importing components we want to avoid async methods  */
    getScopeResultsComponent(scope:any, request:RunnerScriptExecutionRequest):RunnerScriptExecutionResult
    {
        console.info('**** DEBUG - Runner::getScopeResultsComponent(): Getting results from execution scope for Component ****');
        const result = {} as RunnerScriptExecutionResult;

        this._addMetaToResult(scope, request, result);

        // Param definitions, for RunnerComponentImporter.info()
        result.params = (scope._paramManager?.getParams?.() ?? []).map((p:any) => p.toData?.() ?? p);

        // Outputs
        if(request.outputs)
        {
            console.log('**** DEBUG OUTPUT');
            console.info(`Runner::getScopeResultsComponent(): Getting results from execution scope. Requested outputs: '${request.outputs.join('')}'`);
            result.outputs = this.getScopeResultOutputsInternal(scope, request, result);
        }
        return result;
    }

        
    /** Export models from given scope, pipeline and using output paths in request.outputs and place in ExecutionResult tree */
    async _exportPipelineModels(scope:RunnerScriptScope, request:RunnerScriptExecutionRequest, pipeline:string, result:RunnerScriptExecutionResult):Promise<Array<ScriptOutputData>>
    {
        const outputManager = new ScriptOutputManager().loadRequest(request, result);
        const outputPaths = outputManager.getOutputsByPipelineCategory(pipeline, 'model') as Array<ScriptOutputPath>;

        if (outputPaths.length === 0)
        {
            console.warn(`Runner::_exportPipelineModels(): No output paths found for pipeline '${pipeline}'`);
            return [];
        }

        const outputs = [] as Array<ScriptOutputData>;

        for(let m = 0; m < outputPaths.length; m++)
        {
            const outputPath = outputPaths[m] as ScriptOutputPath;
            const startNumOutputs = outputs.length;

            const outputPathData = outputPath.toData();
            let outp:any;
        
            switch(outputPath.format as ScriptOutputFormatModel)
            {
                // NOTE: No internal here, use _exportPipelineModelsInternal()
                case 'buffer':
                    outp = scope.brep.scene.toMeshShapeBuffer();
                    if(outp)
                    {
                        outputs.push({ 
                            path: outputPathData,
                            output: outp,
                        } as ScriptOutputData);
                    }
                    break;

                case 'gltf':
                case 'glb':
                    
                    const gltfOutputOptions = { 
                        ...SCRIPT_OUTPUT_GLTF_OPTIONS_DEFAULT,
                        ...outputPath?.formatOptions as ExecutionRequestOutputFormatGLTFOptions
                    };
                    
                    const outpfn = (outputPath.format === 'gltf') ? scope.modeler.toGLTF : scope.modeler.toGLB;
                    outp = await outpfn.call(scope.modeler, gltfOutputOptions); 

                    if(outp)
                    {
                        outputs.push({
                            path: outputPathData,
                            output: outp
                        });
                    }
                    break;

                case 'svg': // 2D SVG export (via the new Modeler pipeline)
                {
                    // `thumbnail`/`view`/`cam` opt into the 3D hidden-line projection, which
                    // does not need the script to have authored any 2D geometry. Without them
                    // this is byte-identical to the pre-projection behaviour, so every existing
                    // 'default/model/svg' path keeps working exactly as before.
                    const svgOpts = (outputPath?.formatOptions ?? {}) as any;
                    outp = svgOpts.thumbnail
                            ? (scope.modeler.toThumbnailSVG(svgOpts)?.svg ?? null)
                         : (svgOpts.view || svgOpts.cam)
                            ? scope.modeler.toProjectionSVG(svgOpts)
                            : scope.modeler.toSVG();
                    if(outp)
                    {
                        outputs.push({
                            path: outputPathData,
                            output: outp // force 2D
                        } as ScriptOutputData);
                    }
                    break;
                }

                case 'dxf': // 2D DXF export (via the new Modeler pipeline)
                    outp = scope.modeler.toDXF(outputPath?.formatOptions as any);
                    if(outp)
                    {
                        outputs.push({
                            path: outputPathData,
                            output: outp
                        } as ScriptOutputData);
                    }
                    break;

                case 'step':
                    outp = await (scope.exporter as any).exportToSTEP();
                    if(outp)
                    {
                        outputs.push({
                            path: outputPathData,
                            output: outp
                        });
                    }
                    break;

                case 'ifc': // IFC4 building model, classified automatically, see IFC4Exporter.ts
                {
                    const script = request.script as any;
                    outp = await scope.modeler.toIFC({
                        ...(outputPath?.formatOptions as any ?? {}),
                        name: script?.name,
                        version: script?.version,
                    });
                    if(outp)
                    {
                        outputs.push({
                            path: outputPathData,
                            output: outp
                        } as ScriptOutputData);
                    }
                    break;
                }

                case 'scad': // OpenSCAD: recipes become CSG, the rest polyhedra, see SCADExporter.ts
                {
                    const script = request.script as any;
                    outp = await scope.modeler.toSCAD({
                        ...(outputPath?.formatOptions as any ?? {}),
                        name: script?.name,
                        version: script?.version,
                        params: scope._paramManager?.getParams?.() ?? [],
                    });
                    if(outp)
                    {
                        outputs.push({
                            path: outputPathData,
                            output: outp
                        } as ScriptOutputData);
                    }
                    break;
                }

                case 'btlx': // BTLx timber machining data: parts with saw cuts and drillings, see BTLxExporter.ts
                {
                    const script = request.script as any;
                    outp = await scope.modeler.toBTLx({
                        ...(outputPath?.formatOptions as any ?? {}),
                        name: script?.name,
                        version: script?.version,
                    });
                    if(outp)
                    {
                        outputs.push({
                            path: outputPathData,
                            output: outp
                        } as ScriptOutputData);
                    }
                    break;
                }

                case 'fcstd': // FreeCAD document: recipes become parametric features, see FCStdExporter.ts
                {
                    const script = request.script as any;
                    outp = await scope.modeler.toFCStd({
                        ...(outputPath?.formatOptions as any ?? {}),
                        params: scope._paramManager?.getParams?.() ?? [],
                        meta: { script: script?.name, version: script?.version, variant: request.variantId },
                    });
                    if(outp)
                    {
                        outputs.push({
                            path: outputPathData,
                            output: outp
                        } as ScriptOutputData);
                    }
                    break;
                }

                case 'amf': // AMF document of all scene meshes (via the new Modeler pipeline)
                    outp = scope.modeler.toAMF();
                    if(outp)
                    {
                        outputs.push({
                            path: outputPathData,
                            output: outp
                        } as ScriptOutputData);
                    }
                    break;

                case 'stl': // binary STL of all scene meshes (via the new Modeler pipeline)
                    outp = scope.modeler.toSTL();
                    if(outp)
                    {
                        outputs.push({
                            path: outputPathData,
                            output: outp
                        });
                    }
                    break;

                case 'dae': // COLLADA of the whole scene graph (via the new Modeler pipeline)
                    outp = await scope.modeler.toDAE(outputPath?.formatOptions as any);
                    if(outp)
                    {
                        outputs.push({
                            path: outputPathData,
                            output: outp
                        } as ScriptOutputData);
                    }
                    break;

                // Using external services
                case 'obj':
                    if(!(await scope.ay.services.isUp()))
                    {
                        console.error(`Runner::_getScopeRunnerScriptExecutionResult(): Cannot export to ${outputPath.format} because Archiyou Services are not available at: '${this.getServicesUrl()}'!`);
                    }
                    else 
                    {
                        const glb = await (scope.exporter as any)
                            .exportToGLTF(null, 
                                { archiyouFormat: false, includePointsAndLines: false, extraShapesAsPointLines: false }, 
                                null);
                        const conversion = await scope.ay.services.convert(glb, 'glb', outputPath.format);
                        if(!conversion.success)
                        { 
                            console.error(`Runner::_getScopeRunnerScriptExecutionResult(): ${outputPath.format} conversion failed: ${conversion.error}`); 
                        }
                        else 
                        {
                            outputs.push({
                                path: outputPath.toData(),
                                output: conversion.data
                            });
                        }
                    }
                    break;

                default:
                    console.error(`Runner::_getScopeRunnerScriptExecutionResult(): Skipped unknown model format '${outputPath.format}' in requested output '${outputPath.resolvedPath}'`); 
            }

            // Check if any output was added
            if(startNumOutputs + 1 === outputs.length)
            {
                console.info(`Runner::_exportPipelineModels(): Exported model at '${outputPath.resolvedPath}' to format '${outputPath.format}' with size ${((outputs[outputs.length -1].output as any)?.length ?? (outputs[outputs.length -1].output as ArrayBuffer)?.byteLength) ?? '<unknown>'} bytes`);
            }
            else {
                console.warn(`Runner::_exportPipelineModels(): No output generated for model at '${outputPath.resolvedPath}' to format '${outputPath.format}'`);
            }
        }

        return outputs;
    }


    async _exportPipelineMetrics(scope:any, request:RunnerScriptExecutionRequest, pipeline:string, result:RunnerScriptExecutionResult):Promise<Array<ScriptOutputData>>
    {
        const outputManager = new ScriptOutputManager().loadRequest(request, result);
        const outputPathsMetrics = outputManager.getOutputsByPipelineCategory(pipeline, 'metrics') as Array<ScriptOutputPath>;

        // real results
        const outputs = [] as Array<ScriptOutputData>;

        // Check if we need anything to export for current request and pipeline
        if(outputPathsMetrics.length === 0)
        { 
            console.info(`Runner::_exportPipelineMetrics(): No metrics to export`);
            return []; // no metrics to export
        } 

        for (let m = 0; m < outputPathsMetrics.length; m++)
        {
            const outputPathMetric = outputPathsMetrics[m];


            // Now do export
            switch (outputPathMetric.format)
            {
                    case 'json':
                        outputs.push({
                            path: outputPathMetric.toData(),
                            output: scope.calc.toMetricsData(outputPathMetric.entityName) // by name
                        });
                        break;
                    // TODO: more
                    default:
                        throw new Error(`Runner::_getScopeRunnerScriptExecutionResult(): Unknown metric export format '${outputPathMetric.format}'`);
            }
        }
        return outputs;
    }


    async _exportPipelineTables(scope: any, request: RunnerScriptExecutionRequest, pipeline: string, result:RunnerScriptExecutionResult): Promise<Array<ScriptOutputData>>
    {
        console.log('==== EXPORT PIPELINE TABLES ====');

        const outputManager = new ScriptOutputManager().loadRequest(request, result);
        // All table output paths for this pipeline
        const outputPathsTables = outputManager.getOutputsByPipelineCategory(pipeline, 'tables') as Array<ScriptOutputPath>;

        console.log(outputPathsTables);
        
        // real table outputs
        const outputs = [] as Array<ScriptOutputData>;

        // Check if we need anything to export for current request and pipeline
        if(outputPathsTables.length === 0)
        { 
            console.info(`Runner::_exportPipelineTables(): No tables to export`);
            return [];
        } 
        
        for (let t = 0; t < outputPathsTables.length; t++)
        {
            const outputPathTable = outputPathsTables[t];
            
            // Now do export
            switch (outputPathTable.format)
            {
                case 'json':
                    const tableData = scope.calc.toTableData(outputPathTable.entityName); // table data by name
                    // computed footer rows (aggregations) for this table, kept separate from the data rows
                    const footerRows = scope.calc?.db?.table(outputPathTable.entityName)?.computeFooterRows?.() ?? [];
                    outputs.push({
                        path: outputPathTable.toData(),
                        output: (typeof tableData === 'object') ? Object.values(tableData)[0] : null, // force only one table without name key
                        footer: footerRows
                    } as ScriptOutputData);
                    break;
                case 'xlsx':
                    const xlsxBuffer = await (scope.calc.db as Db).toTableExcel(outputPathTable.entityName);
                    outputs.push({
                        path: outputPathTable.toData(),
                        output: (typeof xlsxBuffer === 'object') ? Object.values(xlsxBuffer)[0] : null
                    } as ScriptOutputData);
                    break;
                default:
                    throw new Error(`Runner::_getScopeRunnerScriptExecutionResult(): Unknown table export format '${outputPathTable.format}'`);
            }
        };

        return outputs;
    }


    async _exportPipelineDocs(scope: any, request: RunnerScriptExecutionRequest, pipeline:string, result:RunnerScriptExecutionResult): Promise<Array<ScriptOutputData>>
    {
        const outputManager = new ScriptOutputManager().loadRequest(request, result);
        // All table output paths for this pipeline
        const outputPathsDocs = outputManager.getOutputsByPipelineCategory(pipeline, 'docs') as Array<ScriptOutputPath>;
        // real doc outputs
        const outputs = [] as Array<ScriptOutputData>;

        // Check if we need anything to export for current pipeline and tables
        if(outputPathsDocs.length === 0)
        { 
            console.info(`Runner::_exportPipelineDocs(): No docs to export`);
            return []; // no docs to export
        } 
        
        // Now generate the docs
        for(let d = 0; d < outputPathsDocs.length; d++)
        {
            const outputPathDoc = outputPathsDocs[d];

            // Now do export
            switch (outputPathDoc.format)
            {
                case 'json':
                    const docOutputsByName = await (scope.doc as Docs).toData(outputPathDoc.entityName) as Record<string, DocData> // by name. TODO: remove name key?
                    const docOutput = Object.values(docOutputsByName)[0]; // single doc name return single result object

                    outputs.push({
                        path: outputPathDoc.toData(),
                        output: docOutput 
                    });
                    break;
                case 'pdf':
                    const pdfBuffer = await (scope.doc as Docs).toPDF(outputPathDoc.entityName) as ArrayBuffer // single doc name return single result buffer

                    outputs.push({
                        path: outputPathDoc.toData(),
                        output: pdfBuffer as ArrayBuffer
                    });
                    break;
                case 'svg':
                    const svgResult = await (scope.doc as Docs).toSVG(outputPathDoc.entityName);
                    if (typeof svgResult === 'string')
                    {
                        // Single doc returned as a plain string; retrieve the real name from scope
                        const docName = (scope.doc as Docs).docs()[0] ?? 'document';
                        outputs.push({
                            path: { ...outputPathDoc.toData(), entityName: docName },
                            output: svgResult,
                        });
                    }
                    else
                    {
                        Object.entries(svgResult).forEach(([docName, svgStr]) =>
                        {
                            outputs.push({
                                path: { ...outputPathDoc.toData(), entityName: docName },
                                output: svgStr,
                            });
                        });
                    }
                    break;
                case 'svg-pages':
                    // Per-page standalone SVGs, used by the app (document-viewer) to
                    // build PDFs on the main thread where a DOM is available.
                    const svgPagesResult = await (scope.doc as Docs).toSVGPages(outputPathDoc.entityName);
                    if (Array.isArray(svgPagesResult))
                    {
                        // Single doc returned as a plain array; retrieve the real name from scope
                        const docName = (scope.doc as Docs).docs()[0] ?? 'document';
                        outputs.push({
                            path: { ...outputPathDoc.toData(), entityName: docName },
                            output: svgPagesResult,
                        });
                    }
                    else
                    {
                        Object.entries(svgPagesResult).forEach(([docName, pages]) =>
                        {
                            outputs.push({
                                path: { ...outputPathDoc.toData(), entityName: docName },
                                output: pages,
                            });
                        });
                    }
                    break;
                default:
                        throw new Error(`Runner::_getScopeRunnerScriptExecutionResult(): Unknown doc export format '${outputPathDoc.format}'`);
            }
        };

        return outputs;
    }

  
    //// INTERNAL DATA OUTPUTS FOR USE WITH COMPONENTS ////

    /** Get internal outputs synchronously per pipeline
     *  Iterate from outputs and run pipelines where needed
    */
    getScopeResultOutputsInternal(scope:any, request:RunnerScriptExecutionRequest, result:RunnerScriptExecutionResult):Array<ScriptOutputData>
    {
        const outputManager = new ScriptOutputManager().loadRequest(request,result,false); // IMPORTANT: don't resolve because we don't have entity names
        const pipelines = outputManager.getPipelines();

        console.info(`Runner::getScopeResultOutputsInternal(): Getting results from execution scope. Running pipelines: ${pipelines.join(',')}`);

        const outputs = [] as Array<ScriptOutputData>;

        for(let i = 0; i < pipelines.length; i++)
        {
            const pipeline = pipelines[i];
            
            // Default pipeline is already run, only run others
            if(pipeline !== 'default')
            {
                console.info(`Runner::getScopeResultOutputsInternal(): Running extra pipeline: '${pipelines[i]}'`);
                console.error(`Runner::getScopeResultOutputsInternal(): Running pipeline '${pipeline}' not implemented yet`);
                // TODO: run specific pipeline
            }

            // Gather raw results from pipeline
            outputs.push(...this._exportPipelineModelsInternal(scope, request, pipeline, result));
            outputs.push(...this._exportPipelineMetricsInternal(scope, request, pipeline, result));
            outputs.push(...this._exportPipelineTablesInternal(scope,request, pipeline, result));
            outputs.push(...this._exportPipelineDocsInternal(scope, request, pipeline, result));

            console.info(`**** Runner::getScopeResultOutputsInternal(): Finished exporting '${outputs.length}' internal outputs for pipeline '${pipeline}' ****`);
            outputs.forEach(o => {
                console.info(`  - ${o.path.resolvedPath} : ${(typeof o.output)}`);
            });
        };

        return outputs;
    }

    /** Get internal Obj/Shape model data from local execution scope */
    _exportPipelineModelsInternal(scope:any, request:RunnerScriptExecutionRequest, pipeline:string, result:RunnerScriptExecutionResult):Array<ScriptOutputData>
    {
        const outputManager = new ScriptOutputManager().loadRequest(request,result, false);
        const outputPaths = outputManager.getOutputsByPipelineEntityFormats(pipeline, 'model', ['internal']); // get the models to export for current pipeline

        const outputs = [] as Array<ScriptOutputData>;

        for(let i = 0; i < outputPaths.length; i++)
        {
            const outputPath = outputPaths[i];

            outputs.push({
                path: outputPath.toData(),
                // Export the component's scene as a plain tree of SceneNodeData.
                // Shapes still carry their _modeler from the component scope;
                // RunnerComponentImporter rebinds them when reconstructing the
                // tree under the parent scope's modeler.
                output: scope.modeler.scene().toComponentGraph(request.component)
            })
        }
        console.info(`Runner::_exportPipelineModelsInternal(): Exported ${outputs.length} models of Pipeline '${pipeline}'`);

        return outputs;
    }

    /** Get internal Metric data from local execution scope and set in result tree */
    _exportPipelineMetricsInternal(scope:any, request:RunnerScriptExecutionRequest, pipeline:string, result:RunnerScriptExecutionResult):Array<ScriptOutputData>
    {
        const outputManager = new ScriptOutputManager().loadRequest(request,result, false);
        const outputPathsForMetrics = outputManager.getOutputsByPipelineEntityFormats(pipeline, 'metrics', ['internal']); // get the metrics to export for current pipeline
        
        const outputs = [] as Array<ScriptOutputData>;

        // We result all metrics per pipeline (no per-metric export here)
        
        const metrics = scope.calc.getMetrics();
        if(typeof metrics === 'object' && Object.keys(metrics).length > 0 )
        {
            outputPathsForMetrics.forEach((outputPath) => 
            {
                outputs.push({
                    path: outputPath.toData(),
                    output: scope.calc.getMetrics(),
                });
            });
            console.info(`Runner::_exportPipelineMetricsInternal(): Exported ${Object.keys(metrics).length} metrics of Pipeline '${pipeline}' for output paths '${outputPathsForMetrics.map(m => m.entityName).join(', ')}'`);
        }
        else {
            console.info(`Runner::_exportPipelineMetricsInternal(): No metrics to export for Pipeline '${pipeline}'`);
        }

        return outputs;
    }

    /** Get internal Table data from local execution scope and set in result tree */
    _exportPipelineTablesInternal(scope:any, request:RunnerScriptExecutionRequest, pipeline:string, result:RunnerScriptExecutionResult):Array<ScriptOutputData>
    {
        const outputManager = new ScriptOutputManager().loadRequest(request,result, false);
        // Get all table outputs for this pipeline in internal format
        const outputPathsForTables = outputManager.getOutputsByPipelineCategory(pipeline, 'tables') as Array<ScriptOutputPath>;

        // Filter out doubles
        const outputs = [] as Array<ScriptOutputData>;
        
        outputPathsForTables.forEach((path) => 
        {   
            outputs.push({
                path: path.toData(),
                output: null // TODO
            });

        });

        console.info(`Runner::_exportPipelineTablesInternal(): Exported ${outputs.length} tables of Pipeline '${pipeline}' with output request: '${outputPathsForTables.map(o => o.entityName).join(', ')}'`);

        return outputs;
    }

 
    /** Get internal Doc data from local execution scope and set in result tree 
     *  Because of the Doc module is tied to the execution scope, we export raw data here (Doc.toData())
    */
    _exportPipelineDocsInternal(scope:RunnerScriptScope, request:RunnerScriptExecutionRequest, pipeline:string, result:RunnerScriptExecutionResult):Array<ScriptOutputData>
    {
        const outputManager = new ScriptOutputManager().loadRequest(request,result, false);
        const outputPathsForDocs = outputManager.getOutputsByPipelineEntityFormats(pipeline, 'docs', ['internal']); // get the docs to export for current pipeline
        
        const outputs = [] as Array<ScriptOutputData>;

        const docNames = scope.docs.docs();

        if(docNames.length > 0)
        {
            outputPathsForDocs.forEach((outputPath) => 
            {
                // TODO: keep track of Component in docs
                
                outputs.push({
                    path: outputPath.toData(),
                    /* Before we can export internal doc data, 
                        We need to make sure all references from execution scope are removed
                        This applies to shapes mostly, which are turned into SVG's
                        NOTE: doc.toData() is not possible because it's async
                    */
                    output: (scope.docs as Docs).toInternalData(), 
                });     
            });

            console.info(`Runner::_exportPipelineDocsInternal(): Exported ${docNames.length} docs of Pipeline '${pipeline}' with output requests: '${outputPathsForDocs.map(d => d.entityName).join(', ')}'`);   
        }
        else {
            console.info(`Runner::_exportPipelineDocsInternal(): No docs in scope to export for Pipeline '${pipeline}'`);
        }

        return outputs;
    }

    //// UTILS ////

    inNode():boolean
    {
        return (typeof process !== 'undefined' && process.versions?.node) ? true : false;
    }

    /**
     * Convert a string value to its native type if possible.
     * - 'true'/'false' (case-insensitive) => boolean
     * - Numeric strings => number
     * - Otherwise, return as string
     */
    _convertStringValue(value: string): string | number | boolean {
        if (typeof value !== 'string') return value;
        const lower = value.toLowerCase();
        if (lower === 'true') return true;
        if (lower === 'false') return false;
        if (!isNaN(Number(value)) && value.trim() !== '') return Number(value);
        return value;
    }

    /**
    * Returns the longest substring that is both a suffix of str1 and a prefix of str2.
    */
    _stringOverlap(str1: string, str2: string): string 
    {
        let longest = '';
        for (let i = 0; i < str1.length; i++) {
            for (let j = i + 1; j <= str1.length; j++) {
                const substr = str1.slice(i, j);
                if (substr.length > longest.length && str2.includes(substr)) {
                    longest = substr;
                }
            }
        }
        return longest;
    }

    /** Thin delegates to runner/componentRefs.ts — the editor needs the same parsing
     *  without constructing a Runner (which would load the kernel), so the
     *  implementation lives there. Kept as methods because existing call sites and
     *  tests use them. */
    _extractTopLevelComponentCalls(code: string): Array<ComponentCall>
    {
        return extractTopLevelComponentCalls(code);
    }

    _extractFirstArg(argsText: string): string
    {
        return extractFirstArg(argsText);
    }

}
