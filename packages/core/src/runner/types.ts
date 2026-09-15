import type { AyModuleCatalogEntry } from "../modules/sdkTypes";

import type { ArchiyouModules } from "../types";
import type { Modeler } from "../modeler/Modeler";
import type { ScriptOutputData } from '../execution/types';
import type { Docs } from "../docs/Docs";
import type { Calc } from "../calc/Calc";


import type { ConsoleMessage, ConsoleMessageType } from "../console/types";

import type { Script } from "../execution/Script";
import type { ScriptData, ScriptMeta, ScriptParamData,
    ScriptStatementResult } from "../execution/types";

import type { ModelMode } from "../modeler/types"; // mesh or brep
import type { ArchiyouStateData } from "../types";


/** Basic information of Runner scope */
export interface RunnerActiveScope
{
    name: string
    context?: string
}

/** Result of a Script execution in the Runner
 *   - contains basic information: status, duration, original request
 *   - state data like scenegraph, annotation, managed params that needs to be resolved in viewer
 */
export interface RunnerScriptExecutionResult
{
    created: Date,
    status:'success'|'error',
    duration: number
    request: RunnerScriptExecutionRequest,

    statements?: Array<ScriptStatementResult>
    errors?: Array<ScriptStatementResult>, // seperate the error statements (for backward compat)
    warnings?: Array<string>, // warnings that occured related to request or execution
    messages?: Array<ConsoleMessage>, // based on settings in request you find the relevant messages

    state: ArchiyouStateData // contains state data like annotations, scenegraph etc
    meta?: ScriptMeta, // meta information on the script execution
    
    // All outputs in flat array with request path and data
    outputs?: Array<ScriptOutputData>

    /** Components only: the param definitions the component ended up with (stored + defined
     *  in code with $PARAMS.define). Its scope is gone after execution, so this is the only
     *  place they survive - see RunnerComponentImporter.info() */
    params?: Array<ScriptParamData>
}

/** Basic structure and state of scope */
export interface RunnerScriptScope extends ProxyConstructor
{
    _scope:string // name of scope
    _main:boolean // is this the main scope
    _archiyou:ArchiyouModules // reference to modules
    [key:string]: any // dynamic scope properties (modeler, doc, calc, console, etc.)
    // for scope globals like docs, calc etc
    modeler:Modeler
    docs:Docs
    calc:Calc
}


/** Request results from executing a script */
export interface RunnerScriptExecutionRequest
{
    kernel: ModelMode // which kernel to use for execution - this can be switched in script but initial kernel is set here;
    script:Script|ScriptData // script to execute
    component?:string // name of component if any
    params?:Record<string,any> // param values
    /** Scene paths of shapes the viewer reports as selected (click-selection).
     *  Single-element today (single-select). Read by Interactor.beginRun so
     *  shape.selected()/shape.onClick() can react. Identity is the scene path
     *  (SmartSceneNode.path()), not the shape UUID. */
    selection?:Array<string>
    preset?:string // TODO: preset - overrides param values
    variantId?:string // hash of param values for identifying unique requests - is filled in on submission
    mode?: 'main'|'component'
    /** Display unit system (metric/imperial) — how dimension-line/doc SVG text
     *  is formatted for this run. Editor sends the script's system; the
     *  configurator sends the end-user's local choice. Presentation only;
     *  geometry stays in the script's model unit. */
    unitSystem?: 'metric'|'imperial'

    /** Execute the script statement-by-statement instead of as one block. A single
     *  failing statement then halts the run but keeps the model built so far (partial
     *  output), and per-statement timings are returned in result.statements. Opt-in:
     *  the editor sets it (user-toggleable), the server leaves it unset. */
    perStatement?: boolean

    /** Base URL of the Archiyou asset proxy (`${assetProxyUrl}/proxy?url=…`) used
     *  by `$import(...)` to fetch remote assets past browser CORS. The app fills it
     *  from SERVER_API_BASE_URL; empty string → root-relative `/proxy`. */
    assetProxyUrl?: string

    /** ABSOLUTE origin of the app serving the editor/configurator, e.g.
     *  'https://next.archiyou.com'. Only needed where the run has no origin of its
     *  own: a browser resolves a root-relative asset path ('/img/logo.png' — the
     *  default titleblock logo) against location.origin, but a node-side run has no
     *  location at all, and would otherwise drop the image. The server fills it from
     *  FRONTEND_URL. Ignored in the browser, where the real origin wins. */
    appBaseUrl?: string

    /** Local scripts the runner can resolve as components when the parent
     *  script references them via $component('./name'). Sent as ScriptData
     *  (structured-clone-safe over the worker boundary) — the worker shim
     *  hydrates these into Script instances and calls
     *  runner.linkComponentScripts(...) before execute. */
    componentScripts?: Array<ScriptData>;

    /** Optional script modules available to this run, as served by `GET /modules`
     *  (see modules/README.md). Each entry carries `entitled`, so the LOCKED ones
     *  must be included too: a script referencing a module the user lacks then
     *  fails with "not available on your account" instead of the
     *  "undefined is not a function" it would get if the name were simply absent.
     *  Plain data, so it survives the structured clone to the worker. */
    modules?: Array<AyModuleCatalogEntry>

    /** Base URL of the Archiyou backend for module bundle fetches and
     *  server-module calls. Filled by the app from SERVER_API_BASE_URL like
     *  assetProxyUrl; empty string → root-relative. */
    moduleApiUrl?: string

    /** Bearer token of the signed-in user. Module bundles and server-module calls
     *  are entitlement-gated, and this request otherwise carries no identity at
     *  all. Only ever set by the app for the user's own run — it is not read from
     *  or written to a script. */
    authToken?: string

    /** Base URL of the Archiyou backend used to resolve `$component('./name')`
     *  when nothing was linked in via componentScripts — the case for a published
     *  configurator, where the visitor has no copy of the author's workspace.
     *  The name is then looked up in the SHARED library of the script's own
     *  author: `${componentLibraryUrl}/scripts/shared/${author}/${name}`.
     *  Filled by the app from SERVER_API_BASE_URL; empty string → root-relative.
     *  Linked scripts always win, so the editor keeps resolving locally (and
     *  offline) against the author's unsaved working copies. */
    componentLibraryUrl?: string

    // What to calculate and output
    outputs?: Array<string> // requested output paths
    cache?:boolean // enable caching. Default is true
    messages?:Array<ConsoleMessageType>; // output messages of given types
    forceFileResponse?:boolean // if true, force response as file download (either single file or multiple files in zip)

    _onDone?: ((result:RunnerScriptExecutionResult) => any) // internal callback
}   


//// COMPONENTS ////


/** Results of component execution 
 *  This is a flattened version of RunnerScriptExecutionResult for direct use in execution scope
 *  Any output is in internal format
 *   - models -> Obj (which contains Shapes)
 *   - metrics -> Record<string,Metric>
 *   - tables -> CalcTable (or CalcDb?)
 *   - docs -> Doc
 *   
*/
export type ImportComponentOutput = any // TODO: Obj|Record<string,Metric>|Calc|Doc|null
export interface ImportComponentResultPipeline {
    model?: any, // TODO. Used to be Obj
    metrics?: any, // Record<string,Metric>|null,
    tables?: any, // CalcDb|null,
    docs?: any // Doc|null
}
/** Result with multiple pipelines */
export type ImportComponentResultPipelines = Record<string, ImportComponentResultPipeline>
/** Combined type: direct output, per pipeline or multiple pipelines */
export type ImportComponentResult = ImportComponentOutput|ImportComponentResultPipeline|ImportComponentResultPipelines