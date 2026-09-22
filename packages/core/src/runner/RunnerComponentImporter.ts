
/**
 *   RunnerComponentImporter.ts
 * 
 *   Exists in script execution scope
 *   And gathers all information needed to execute a component script 
 *   and return specific results
 * 
 *   Executing component script and getting result (async/sync)
 *      Script execution is async, but we want to avoid using 
 *      "await $component(...).get(...)" which is not user friendly
 *      
 *      Because internal data (the model Obj/Shapes, table data and doc instances)
 *      are by definition always directly available in the scope    
 *      We can avoid async by using the sync execution method "Runner._executeLocalSync"
 *      RunnerComponentImporter.get() => Runner._executeComponentScript => Runner._executeLocalSync
 * 
 *   How components work with RunnerComponentImporter class
 *   
 *   1. Runner preprocesses any $component(<<script>>, <<params>>) statements: loads them and caches in Runner._componentScripts
 *       This is needed because we need to wait until async fetching of scripts is done 
 *         before we can synchronous execute script, get results out and use them in main script scope
 * 
 *      argument <<script>> can point to a script in various ways:
 *      - $component("{{scriptname}}:{{version}}") 
 *         => Gets script from (local user) workspace
 *      - $component("{{author}}/{{scriptname}}:{{version}}") or $component("{{author}}/{{scriptname}}")
 *         => Gets script from default library (probably https://lib.archiyou.com)
 *      - $component("https://lib.notarchiyou.com/myorg/myscript")
 *          => Get script from external archiyou library
 *      - $component("./scripts/test.js") 
 *          => Get script from local path: relative or absolute (need for .js extension)( possibly later .ts)
 *      - $component(script:ScriptData)
 *          => Directly use script data 
 * 
 *   2. Main Execution: The main script is executed within its scope. 
 *         $component(..) refer to the RunnerComponentImporter constructor
 *         So every $component(...) statement creates and returns an RunnerComponentImporter instance
 *          This component importer instance has access to Runner instance and main execution scope 
 * 
 *   3. Executing the component script with params and getting results
 *       $component(<<script>>) just loads the script and creates the component importer instance
 *       Execution takes two steps (like all scripts):
 *          a. plug in param values: $component("test").params({ size: 100 })
 *          b. execute with request for outputs:
 *              - .pipeline(<<pipeline>>) - if only single pipeline, select it. default = "default"
 *              - .model() - get the model (ShapeCollection) for single pipeline (mostly default)
 *                  $component("test").params({ size: 100 }).model() ==> get model from (default or single) pipeline
 *              - .docs(<<name>>) - get all Documents (Array<Document>) or a specific one by name
 *                  $component("test").docs('spec') ==> Document "spec" from (default or single) pipeline
 *              - .get(<<output(s)>>)
 *                  get anything out (various pipelines, various entities) using output paths. 
 *                  Results by output path. So you can use destructing assignment:
 *                   const { "default/model" : mainModel, "cnc/model" : cncModel, "cnc/tables/parts" : cncPartsTable } = $component("test").get(["default/model", "cnc/model", "cnc/tables"]);
 * 
 *              - .all(): Get all outputs of pipeline (set with .pipeline() or "default")
 *                          returns { model, docs, tables, metrics }
 *
 *   4. Using component results
 *          Any results that $component(...).model()/get() etc returns are internal entities
 *          either ShapeCollection, Doc, Table, Metric that can be read and merged with others
 * 
 *          Use a wall component:
 *              myWall = $component("wall").params({ size: 100 }).model();
 *              // now use it as any other ShapeCollection
 *              myWall.align(otherMainWall, 'leftfront', 'rightfront'); 
 * 
 *          Merge a document of component:
 *          
 *           myWallDoc = $component("wall").params({ size: 100 }).docs("spec") // or .docs() for all documents
 *           // main document
 *           doc('mainDoc')
 *              .page('cover page')
 *              .title('MyProject')
 *              .merge(myWallDoc) // add all pages of myWallDoc to current Doc
 *              ..
 *      
 *      NOTE: 
 *          - no entity names, just entire instances: 
 *               - no "default/docs/somespecial" => just return Doc module instance
 *               - tables => Db instance
 *               these instances have inspection/selection functionality
 *          
 *   5. Caching: identical activations execute ONCE
 *
 *      Executing a component means running a whole script, so a wall repeated across a facade
 *      would model itself once per repeat. The Runner therefore memoises the raw execution
 *      result (Runner._componentResults) keyed on everything the outputs can depend on: the
 *      component's own code, the params, the requested outputs, the kernel and the units.
 *      See Runner._componentResultCacheKey().
 *
 *          wallA = $component('./wall').params({ w: 100 }).model(); // executes
 *          wallB = $component('./wall').params({ w: 100 }).model(); // memoised
 *          wallC = $component('./wall').params({ w: 200 }).model(); // different key: executes
 *
 *      The memo is NOT cleared between runs — the key contains the code, so editing the
 *      component invalidates by itself, and a configurator moving one param keeps the hits for
 *      every component that param does not reach.
 *
 *      Each caller still gets its OWN shapes: a memoised model tree is re-created with clones
 *      (see _copyComponentShape), because a Shape can only live in one SceneNode and the
 *      caller is free to move/mutate what it receives.
 *
 *      CAVEAT: the other categories (docs, tables, metrics) are handed out as the SAME module
 *      instances on every hit — they are not cloned. Reading and merging them is fine; a
 *      caller that mutates one in place should use noCache().
 *
 *      noCache() bypasses AND resets the memo, for a component that is not a pure function of
 *      its params (it reads a $import()ed asset that changed, or a stateful script module):
 *
 *          $component('./wall').noCache().params({ w: 100 }).model();
 * 
 */

import type { Runner } from './Runner'
import { Script } from '../Script';
import { ScriptOutputManager } from '../execution/ScriptOutputManager';
import { ScriptOutputPath } from '../execution/ScriptOutputPath';
import { isScriptOutputCategory } from '../execution/typeguards';
import { SCRIPT_OUTPUT_CATEGORIES } from '../constants';

import type { RunnerScriptExecutionRequest, RunnerScriptExecutionResult, RunnerScriptScope } from './types';
import { ScriptData, ScriptParamData } from '../execution/types';
import { ImportComponentResult, ImportComponentResultPipelines } from './types';
import { SceneNode } from '@archiyou/meshup';
import type { ComponentGraphNode } from '@archiyou/meshup';
import type { Document } from '../docs/Document';


/** What `$component()` returns: another script, used as a part of this one. Set its
 *  parameters, then take its model (or its drawings, tables, …):
 *
 *  ```js
 *  leg = $component('./table-leg').params({ HEIGHT: 720 }).model()
 *  ```
 *
 *  Nothing runs until `.model()`, `.get()`, `.docs()` or `.all()` asks for a result. */
export class RunnerComponentImporter
{
    //// SETTINGS ////
    DEFAULT_OUTPUTS = ['default/model/internal']; 

    ////  END SETTINGS ////
    
    _runner:Runner;
    _scope:RunnerScriptScope; // main scope to import into
    ref:string; // reference. Can be url, or inline code
    label:string; // nice label
    _params:Record<string,any> = {}; // overridden by .params({...}); kept as {} so callers like $component('./x').model() never pass undefined
    _pipeline:string = 'default'; // if single pipeline
    options:Record<string,any>; // TODO
    script?:ScriptData; // script to execute - will be fetched from library or from disk
    _requestedOutputs:Array<string> = [];  // requested outputs
    _entityFilters:Record<string,string> = {}; // '{pipeline}/docs' => name of the specific doc requested in get()
    _useCache:boolean = true; // see noCache()
    _listed:boolean = false; // component names already printed, see list()
    _fromCache:boolean = false; // whether the last execution was served from the cache (inspection/tests)

    
    constructor(runner:Runner, scope:RunnerScriptScope,  ref?:string)
    {
        this._runner = runner; // tied to runner
        this._scope = scope; // main scope to import into
        this.ref = ref ?? ''; // name of the component ('archiyou/testcomponent:0.5'). Empty for $component().list()
        this.label = this.generateName();

        console.info(`RunnerComponentImporter: Created importer for component from ref "${this.ref}"`);
    }

    /** Set the component's parameters, by name. Parameters left out keep their default.
     *
     *  @param params Values by parameter name, like `{ WIDTH: 800, HEIGHT: 720 }`
     */
    params(params?: Record<string, any>): this
    {
        if(typeof params !== 'object')
        {
            throw new Error(`$component("${this.label}")::params(): Invalid params object. Please supply something like { param1: val1, param2: val2 }`);
        }
        this._params = params || {};
        return this;
    }

    /** Take the results of one of the component's pipelines instead of the default one.
     *
     *  @param p Name of the pipeline (see `$pipeline()`)
     */
    pipeline(p:string): this
    {
        if(typeof p !== 'string')
        {
            throw new Error(`$component("${this.label}")::pipeline(): Invalid pipeline string. Please supply a valid pipeline string.`);
        }
        this._pipeline = p;
        return this;
    }

    /** Bypass AND reset the component execution result cache for this call.
     *
     *  By default an identical component activation (same code, params, outputs, kernel) is
     *  executed once and memoised on the Runner - so a wall repeated across a facade models
     *  once. Reach for noCache() when the component is not a pure function of its params and
     *  that memo would be wrong: it reads a $import()ed asset that changes under it, or a
     *  script module that carries state between calls.
     *
     *      $component('./wall').noCache().params({ w: 100 }).model();
     *
     *  It also DROPS whatever was already memoised under this call's key, so the next
     *  ordinary $component() re-executes rather than serving the result we just bypassed.
     *  Order in the chain does not matter - the cache is only consulted at execution time. */
    noCache(): this
    {
        this._useCache = false;
        return this;
    }

    /** 
     *  Get outputs from component script execution
     *   This will enable the user to get specific outputs from the component:
     *      - any pipeline
     *      - any category: model, docss, tables, metrics 
     *  
     *  @param p - path or array of paths to requested outputs (like 'default/model', 'cnc/model'),
     *      or several paths as separate arguments: get('default/model', 'default/docs/spec')
     * 
     *  Components only work with internal data, so we always get 'internal' format
     *  
     *  Paths are {pipeline}/{category}[/{entity}][/internal]. The format can be left out:
     *      'default/model', 'default/docs', 'default/docs/*', 'default/docs/spec', 'cnc/tables'
     *
     *  Some simplications:
     *      - no other formats than 'internal'
     *      - we export internal categories like 'model', 'tables', 'metrics' directly as module instances
     *      - docs are an Array<Document>, or a single Document when named: 'default/docs/spec'
     *      - if only one output path given (for example 'default/model') return that directly
     *
     *  See RunnerComponentImporter.model() and docs() for easy ways of getting model and docs
     *
     * */
    get(p:string|Array<string>, ...more:Array<string>): ImportComponentResult
    {
        if (typeof p === 'string') p = [p]; // convert to array if string
        if (more.length > 0 && Array.isArray(p)) p = [...p, ...more]; // get('default/model', 'default/docs/spec')
        if (!Array.isArray(p) || p.some(path => typeof path !== 'string'))
        {
            throw new Error(`$component("${this.label}")::get(): Invalid output path(s). Please supply a string, strings or an array of strings like "default/model" or "default/docs/spec"`);
        }

        this._entityFilters = {};

        const outputPaths = p.map((path) =>
        {
            // Parse ourselves: ScriptOutputPath requires a format and would read 'default/docs/spec' as format "spec"
            const segments = path.split('?')[0].split('/').map(s => s.trim());
            // Drop the optional format: 'default/model/internal', 'default/docs/internal', 'default/docs/spec/internal'
            if(segments.length === 4 || (segments.length === 3 && (segments[2] === 'internal' || segments[1] === 'model')))
            {
                const format = segments.pop();
                if(format !== 'internal' && format !== '*')
                {
                    throw new Error(`$component("${this.label}")::get(): Invalid format "${format}" in output path "${path}". Components only give internal outputs, so leave the format out: like "default/docs/spec"`);
                }
            }
            const [pipeline, category, entity] = segments;

            if(!pipeline || !isScriptOutputCategory(category) || segments.length > 3)
            {
                throw new Error(`$component("${this.label}")::get(): Invalid output path "${path}". Use {pipeline}/{category}[/{entity}], like "default/model", "default/docs/*" or "default/docs/spec". Categories: ${SCRIPT_OUTPUT_CATEGORIES.join(', ')}`);
            }

            // The internal export always contains all entities of a category, a specific one is picked after execution
            if(entity && entity !== '*')
            {
                if(category !== 'docs')
                {
                    throw new Error(`$component("${this.label}")::get(): Selecting a specific entity ("${path}") is only supported for docs. Use "${pipeline}/${category}/*" instead.`);
                }
                this._entityFilters[`${pipeline}/${category}`] = entity;
            }

            return new ScriptOutputPath(`${pipeline}/${category}/internal`).internalize().resolvedPath;
        });

        this._requestedOutputs = outputPaths;

        console.info(`$component("${this.label}")::get(): Requested outputs:"${this._requestedOutputs.join(',')}"`);

        return this._getAndExecute();
    }

    /** Run the component and get its shapes, to place in this model like any other shape. */
    model(): ImportComponentResult
    {
        return this.get(`${this._pipeline}/model/internal`);
    }

    /** Shortcut method for getting the documents of single pipeline
     *  @param name - name of a specific document. Without it all documents are returned
     *
     *      compDocs = $component('wall').docs(); // Array<Document>
     *      specDoc = $component('wall').docs('spec'); // Document
     *      docs.create('main').page('cover').merge(compDocs);
     */
    docs(name?:string): Document|Array<Document>
    {
        if(name !== undefined && typeof name !== 'string')
        {
            throw new Error(`$component("${this.label}")::docs(): Invalid document name. Please supply a string or nothing to get all documents.`);
        }

        return this.get(`${this._pipeline}/docs/${name ?? '*'}`) as Document|Array<Document>;
    }

    /** Shortcut method for getting everything of single/default pipeline */
    all(): ImportComponentResult
    {
        return this.get([
            `${this._pipeline}/model/internal`,
            `${this._pipeline}/tables/*/internal`,
            `${this._pipeline}/docs/*/internal`,
            `${this._pipeline}/metrics/*/internal`,
        ]);
        // TODO: flatten results to { model, tables, docs, metrics }
    }

    /** Print information on the component to the console: its script info, param
     *  definitions (with the values this importer would run with) and outputs.
     *  Chainable, so it can sit anywhere in a $component() statement:
     *
     *      $component('./timberwall').info();
     *      wall = $component('./timberwall', { WIDTH: 3000 }).info().model();
     *
     *  Params defined in code ($PARAMS.define) only exist while the component runs, so this
     *  executes the component for its model. That result is memoised like any other
     *  activation: a following .model() with the same params does not execute again. */
    info(): this
    {
        const script = this._getComponentScript();
        if(!script)
        {
            throw new Error(`$component("${this.label}")::info(): Cannot find component script in Runner.componentScripts cache. Make sure the component is loaded and available.`);
        }

        const outputs = [new ScriptOutputPath(`${this._pipeline}/model/internal`).internalize().resolvedPath];
        const r = this._executeRaw(script, outputs);

        const params = (r.params ?? Object.values(script.params ?? {}).map(p => p.toData()))
            .slice()
            .sort((a, b) =>
                Number((b.group ?? '').toLowerCase() === 'main') - Number((a.group ?? '').toLowerCase() === 'main') || // 'main' group first
                (a.group ?? '').localeCompare(b.group ?? '') ||
                (a.order ?? 0) - (b.order ?? 0));

        const lines:Array<string> = [];
        const title = [script.name, script.version && `v${script.version}`, script.author && `by ${script.author}`].filter(Boolean).join(' ');
        lines.push(`$component("${this.label}")${title ? ` - ${title}` : ''}`);
        if(script.description){ lines.push(`  ${script.description}`); }

        lines.push(`  params (${params.length}):`);
        if(params.length === 0){ lines.push('    (none)'); }

        let group:string|undefined;
        params.forEach(p =>
        {
            if((p.group ?? '') !== (group ?? ''))
            {
                group = p.group;
                lines.push(`    [${group ?? ''}]`);
            }
            const given = Object.keys(this._params).find(k => k.toUpperCase() === p.name.toUpperCase());
            const value = (given !== undefined)
                ? `= ${this._fmt(this._params[given])} (default: ${this._fmt(p.default)})`
                : `= ${this._fmt(p.default)} (default)`;
            const extra = [
                this._paramBounds(p),
                p.units,
                p.label && p.label.toUpperCase() !== p.name.toUpperCase() ? `"${p.label}"` : undefined,
                p.description,
            ].filter(Boolean).join(', ');
            lines.push(`    ${p.name} (${p.type}) ${value}${extra ? `  ${extra}` : ''}`);
        });

        // Params given that the component does not define are silently ignored when running
        const unknown = Object.keys(this._params).filter(k => !params.some(p => p.name.toUpperCase() === k.toUpperCase()));
        if(unknown.length > 0)
        {
            lines.push(`  WARNING: given params not defined by component (ignored): ${unknown.join(', ')}`);
        }

        const meta = r.meta;
        if(meta)
        {
            if(meta.pipelines?.length){ lines.push(`  pipelines: ${meta.pipelines.join(', ')}`); }
            if(meta.tables?.length){ lines.push(`  tables: ${meta.tables.join(', ')}`); }
            if(meta.docs?.length){ lines.push(`  docs: ${meta.docs.join(', ')}`); }
            if(meta.metrics?.length){ lines.push(`  metrics: ${meta.metrics.join(', ')}`); }
        }

        const msg = lines.join('\n');
        if(typeof this._scope?.console?.user === 'function'){ this._scope.console.user(msg); }
        else { console.info(msg); }

        return this;
    }

    /** Print and return the components available to $component('@author/name'): your own
     *  scripts first, as `:dev` (their latest version), then everything shared (latest
     *  shared version; add `:version` to pin one). $component() without a name prints
     *  them too.
     *
     *      $component();
     *      names = $component().list();
     *
     *  Printed once per importer, so $component().list() does not print twice. */
    list(): Array<string>
    {
        const { own, shared } = this._runner.listComponentGroups();
        const names = [...own, ...shared];
        if(this._listed){ return names; }
        this._listed = true;

        const lines = [(names.length > 0)
            ? `$component(): ${names.length} available component(s):`
            : `$component(): no components available. Add scripts to your workspace to use them as components.`];
        if(own.length > 0){ lines.push('  your scripts (latest version):', ...own.map(n => `    ${n}`)); }
        if(shared.length > 0){ lines.push('  shared (latest shared version, or add :version):', ...shared.map(n => `    ${n}`)); }
        const msg = lines.join('\n');
        if(typeof this._scope?.console?.user === 'function'){ this._scope.console.user(msg); }
        else { console.info(msg); }
        return names;
    }

    /** Short description of the value boundaries of a param, like "2000..8000 step 1" */
    _paramBounds(p:ScriptParamData):string|undefined
    {
        const s = (p.schema ?? {}) as Record<string, any>;
        if(Array.isArray(s.enum)){ return `options: ${s.enum.map(v => this._fmt(v)).join(' | ')}`; }
        const range = (s.minimum !== undefined || s.maximum !== undefined)
            ? `${s.minimum ?? ''}..${s.maximum ?? ''}`
            : undefined;
        const step = (s.multipleOf !== undefined) ? `step ${s.multipleOf}` : undefined;
        return [range, step].filter(Boolean).join(' ') || undefined;
    }

    _fmt(v:any):string
    {
        if(v === undefined){ return 'undefined'; }
        if(typeof v === 'string'){ return `"${v}"`; }
        try { return JSON.stringify(v); } catch { return String(v); }
    }

   
    /** Really get the script and execute in seperate component scope */
    _getAndExecute():ImportComponentResult
    {
        if(!this._runner){ throw new Error('ImportComponentController::_execute(): Runner not set!');}
        
        const script = this._getComponentScript();
    
        if(!script)
        {
            throw new Error(`$component("${this.label}")::_getAndExecute(): Cannot find component script in Runner.componentScripts cache. Make sure the component is loaded and available.`);
        }
        return this._executeComponentScript(script); // execute script in seperate component scope
    }

    /** Execute component script with params and requested outputs
     *  @param script - Script to execute
     *  @returns ImportComponentResult - result of the execution
     */
    _executeComponentScript(script:Script):ImportComponentResult
    {
        const requestedOutputs = (this._requestedOutputs.length === 0) ? this.DEFAULT_OUTPUTS : this._requestedOutputs;
        const r = this._executeRaw(script, requestedOutputs);

        //// TODO: 
        // Continue gathering results
        /* Check how we can flatten the result:
            - check how many pipelines
            - if single output
            - if multiple outputs
        */
        // A component without docs exports no docs output at all: requested docs still get an (empty) result
        const docsOutputs = (r.outputs ?? []).filter(o => o.path?.category === 'docs').map(o => o.path.pipeline);
        const missingDocs = requestedOutputs
            .map(p => new ScriptOutputPath(p).internalize())
            .filter(p => p.category === 'docs' && !docsOutputs.includes(p.pipeline))
            .map(p => ({ path: p.toData(), output: [] }));

        const outputManager = new ScriptOutputManager().fromResult({ ...r, outputs: [...(r.outputs ?? []), ...missingDocs] } as RunnerScriptExecutionResult); // tie outputs to path objects too

        // First make total tree, then apply shortcuts (if any)
        let result = {} as ImportComponentResult; 
        
        outputManager.getPipelines().forEach(pl => 
        {
            outputManager.getOutputsByPipeline(pl)
            .forEach( outPathObj =>
            {
                if(!result[pl]){ result[pl] = {} as ImportComponentResultPipelines };
                const pipelineResult = result[pl]; // reference
                // All outputs are grouped together (no specific entities like 'docs/report')
                // Make data directly available (flatten path and _output structure)
                pipelineResult[outPathObj.category] = outPathObj._output;

                // Docs are exported as Array<Document>. A doc without docs exports nothing
                if(outPathObj.category === 'docs')
                {
                    pipelineResult['docs'] = this._selectDoc(pl, (outPathObj._output ?? []) as Array<Document>);
                }

                // Special import for model category - recreate SceneNode tree in main scope
                if(outPathObj.category === 'model' && outPathObj._output)
                {
                    console.info(`$component("${this.label}")::_executeComponentScript(): Recreating component scene tree in main scope for pipeline "${pl}"...`);
                    const recreatedNode = this._recreateComponentObjTree(outPathObj._output as ComponentGraphNode, undefined, true, this._useCache);
                    // result is SmartShapeCollection of all (visible) shapes in the recreated subtree
                    const col = recreatedNode.shapes();
                    // Attach the root node so that .name() on the collection renames the scene node
                    col._layer = recreatedNode;
                    pipelineResult['model'] = col;

                    console.info(`$component("${this.label}")::_executeComponentScript(): Recreated component scene tree in main scope for pipeline "${pl}".`);
                }
            });
        });

        // Flatten result if possible
        if(outputManager.getPipelines().length === 1)
        {
            const singlePipeline = outputManager.getPipelines()[0];
            result = result[singlePipeline];   
            // only one result
            if(outputManager.getOutputsByPipeline(singlePipeline).length === 1)
            {
                const singleOutput = outputManager.getOutputsByPipeline(singlePipeline)[0];
                result = result[singleOutput.category];
                const resultType = result?.constructor?.name || typeof result;
                console.info(`$component("${this.label}")::_executeComponentScript(): Returning single output of category "${singleOutput.category}" with result of type "${resultType}".`);
            }
        }
        
        return result;

    }

    /** Pick the document requested by name for this pipeline in get(), or return all.
     *  Never mutates the (possibly memoised) docs array */
    _selectDoc(pipeline:string, docs:Array<Document>):Document|Array<Document>
    {
        const name = this._entityFilters[`${pipeline}/docs`];
        if(name === undefined){ return docs; }

        const doc = docs.find(d => d._name === name);
        if(!doc)
        {
            throw new Error(`$component("${this.label}"): No document "${name}" in pipeline "${pipeline}". Available: ${docs.map(d => `"${d._name}"`).join(', ') || '(none)'}`);
        }
        return doc;
    }

    /** Execute (or get memoised) raw Runner result of the component for the given outputs.
     *  No side effects in the calling scope: the component's scene tree is only recreated
     *  by _executeComponentScript() */
    _executeRaw(script:Script, outputs:Array<string>):RunnerScriptExecutionResult
    {
        // Inherit the run-wide settings from whoever is calling us — the main script, or the
        // enclosing component when this one is nested. Without kernel, _executionStartRunInScope
        // falls back to 'mesh' and every component in a brep run silently modelled in mesh.
        const parentRequest = this._runner.getActiveExecRequest();

        const request:RunnerScriptExecutionRequest = {
            kernel: parentRequest?.kernel ?? 'mesh',
            unitSystem: parentRequest?.unitSystem,
            script: script,
            component: this.label, // scope identifier
            params: this._params,
            outputs: outputs,
        };

        this._runner._checkRequestAndAddDefaults(request); // check request and add defaults if needed

        // Identity of this activation. Built AFTER _checkRequestAndAddDefaults, so the
        // defaults it fills in (outputs above all) are part of the key rather than a
        // difference the cache cannot see.
        const cacheKey = this._runner._componentResultCacheKey(script, request);

        // noCache() resets as well as bypasses: drop the stale memo now, so a later ordinary
        // $component() re-executes instead of serving exactly what we were asked to skip.
        if(!this._useCache){ this._runner.clearComponentResultCache(cacheKey); }

        let r = this._useCache ? this._runner.getComponentResultFromCache(cacheKey) : null;
        this._fromCache = !!r;

        if(r)
        {
            console.info(`$component("${this.label}")::_executeComponentScript(): Cache hit - reusing memoised result for outputs: "${request.outputs.join(',')}"`);
        }
        else
        {
            console.info(`$component("${this.label}")::_executeComponentScript(): Executing component script with outputs: "${request.outputs.join(',')}"`);

            r = this._runner._executeComponentScript(request);

            // Check for errors. Before caching: a component that threw gets another chance.
            if(r.status === 'error')
            {
                const msgs = (r.errors ?? []).map(e => (e && typeof e === 'object' && 'message' in e) ? (e as any).message : String(e)).join('; ');
                throw new Error(`$component("${this.label}")::_executeComponentScript(): Error executing component script: ${msgs}`);
            }

            if(this._useCache){ this._runner.addComponentResultToCache(cacheKey, r); }
        }

        return r;
    }

     /** Get component script from Runners cache (in Runner.componentScripts) */
    _getComponentScript():Script|null
    {
        return this._runner.getComponentScriptFromCache(this.ref);
    }

    /** Recreate a component's scene subtree under the parent scope's modeler.
     *
     *  Walks the ComponentGraphNode tree produced by SceneNode.toComponentGraph(),
     *  creating fresh SceneNodes and re-binding each shape's `_modeler` to
     *  the main scope's modeler so subsequent ops (export, layouter, etc.)
     *  resolve against the correct kernel. */
    _recreateComponentObjTree(tree: ComponentGraphNode, parentNode?: SceneNode, onlyVisible: boolean = true, copyShapes: boolean = false): SceneNode
    {
        if (onlyVisible && tree.style?.visible === false)
        {
            // Skip hidden subtrees entirely; mirrors the old onlyVisible filter.
            return parentNode ?? new SceneNode(tree.name);
        }

        const mainModeler = this._scope._archiyou.modeler;
        const newNode = new SceneNode(tree.name);

        if (tree.style && Object.keys(tree.style).length > 0)
        {
            newNode.setStyle(tree.style);
        }

        // Attach BEFORE setShape() below: adoption resolves the sid provider through the
        // scene root, which this node only reaches once it is in the caller's tree.
        if (parentNode)
        {
            parentNode.addChild(newNode);
        }
        else
        {
            // Land in the caller's active layer (set with layer('..')), like any shape it makes
            (mainModeler.activeLayer() ?? mainModeler.scene()).addChild(newNode);
        }

        if (tree.shape)
        {
            // Re-parenting MOVES a shape: it gets the main scope's modeler and a new node, and
            // the caller is free to mutate it afterwards. That is fine for a one-shot result,
            // but a memoised tree has to survive for the next hit - and a Shape can only be in
            // one SceneNode - so hand out a clone whenever the result is (or just became)
            // cached. Uncached calls keep the cheaper move.
            const shape = (copyShapes ? this._copyComponentShape(tree.shape) : tree.shape) as any;
            shape._modeler = mainModeler;
            shape._node = null;
            // The component ran in its own scope, with its own Modeler and so its own sid
            // sequence. Those numbers mean nothing here: drop them so the caller's scene
            // renumbers the shape on adoption, keeping the old one only as provenance. Without
            // this a moved (uncached) shape would keep a component-scope sid while a copied
            // (cached) one got a caller sid — the cache would be observable.
            if (shape._sid) { shape._sidFrom = shape._sid; shape._sid = 0; }
            newNode.setShape(shape);
        }

        tree.children.forEach(childData =>
        {
            this._recreateComponentObjTree(childData, newNode, onlyVisible, copyShapes);
        });

        return newNode;
    }

    /** Clone one shape out of a cached component tree.
     *
     *  Not simply `_copy()`: that is each kernel's PURE clone and the two carry different
     *  amounts of metadata with it - meshup drops name/material/modeler, brep keeps those but
     *  does not carry `style`, which is where `.color()` on a shape lands. Restoring both
     *  halves here keeps a cached component visually and nominally identical to an uncached
     *  one, instead of leaking the difference into the scene. */
    _copyComponentShape(shape: any): any
    {
        if (typeof shape?._copy !== 'function')
        {
            console.warn(`$component("${this.label}")::_copyComponentShape(): Shape has no _copy(); reusing the original. The memoised component tree may be mutated through it.`);
            return shape;
        }

        const copy = shape._copy();

        copy._inheritSid?.(shape);
        copy._name = shape._name;
        copy._nameInherited = shape._nameInherited;
        copy._material = shape._material;
        copy._scene = shape._node?.root?.() ?? shape._scene;

        if (shape.style && typeof copy.style?.merge === 'function')
        {
            copy.style.merge(shape.style.explicitData());
        }

        return copy;
    }

    //// UTILS ////

    /** Either directly name, or is a code a label with snippet */
    generateName()
    {
        return (Script.isProbablyCode(this.ref)) 
                    ? `<<inline code>>:${this.ref.trim().replace(/\s+/g, ' ').substring(0,20)}...`
                    : this.ref;
    }

}

