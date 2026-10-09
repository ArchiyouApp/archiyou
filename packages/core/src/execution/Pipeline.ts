/**
 *  Pipeline.ts
 *      A named step that runs after the model: drawings of it, a cutting plan, an offer.
 *      Its output is kept apart from the model, so a script can have several of them and
 *      the user picks which one to see or export.
 *
 *      $pipeline('drawings', function()
 *      {
 *          iso = all().iso();
 *          front = all().elevation('front').autoDim();
 *          return { iso, front }; // the output: layers 'iso' and 'front'
 *      });
 *
 *      doc.create('spec').pipeline('drawings')   // or .pipeline(fn): a pipeline named 'spec'
 *          .page('p').view('iso').shapes('iso');
 *
 *      Outputs: drawings/model/dxf, drawings/model/glb, drawings/docs/spec/pdf (see ScriptOutputManager)
 *
 *     NOTES:
 *          - RUNS: only when one of its outputs is requested (or a document bound to it is
 *                  exported), at most once per execution, after the default outputs are made.
 *          - SCOPE: the function is written in the main script, so it reads the model, its
 *                  variables and helper functions like any other code there. What it makes stays
 *                  with the pipeline:
 *                      - variables it assigns (and the ones it returns) go to an overlay on the
 *                        main scope (vars()), so two pipelines can both have an 'iso'
 *                      - shapes it makes go to a capture (Modeler.beginCapture), not the model
 *                      - annotations it makes go with its output, not the model's
 *                  It can still change shapes of the model in place (model.move()): copy first.
 *          - RETURN: `return { name: shape, ... }` makes the output scene, one layer per key.
 *                  Without a return the shapes it made are the output.
 *          - SYNC/ASYNC: the function can be async; the Runner awaits it before exporting.
 */

import type { SceneNode } from '@archiyou/meshup'

import { collectAnnotations } from '../annotator/annotationLayer'
import { isKernelShapeOrCollection } from '../modeler/typeguards'

/** What one run of a pipeline left */
export interface PipelineRun
{
    returned: Record<string, any> | null // what the function returned, as { name: value }
    output: SceneNode | null // the scene its model outputs export
    annotations: Array<any> // the annotations its model outputs export
    created: { docs: Array<string>, tables: Array<string>, metrics: Array<string> } // entities it made
    error: Error | null
}

/** The state before a run, to compare with and restore afterwards */
interface PipelineRunStart
{
    overlay: Record<string, any> | null
    capturing: boolean
    annotations: Array<any>
    docs: Array<string>
    tables: Array<string>
    metrics: Array<string>
}

export class Pipeline
{
    name: string
    _function: (mainScope?: any) => any
    /** Registered by a document (doc.pipeline(fn)) and named after it */
    _auto = false
    /** Called when the function throws. Set by the Runner; else the error goes to the scope console */
    onError: ((e: Error) => void) | null = null

    private _vars: Record<string, any> = {}
    private _run: PipelineRun | null = null
    private _pending: Promise<this> | null = null

    constructor(name: string, fn?: (mainScope?: any) => any)
    {
        this.name = name;
        if (fn) { this.do(fn) }
    }

    /** Set the function of the pipeline */
    do(fn: (mainScope?: any) => any): this
    {
        if (typeof fn !== 'function')
        {
            throw new Error(`$pipeline('${this.name}', fn): Please give a function, like $pipeline('${this.name}', function(){ ...; return { iso } })`);
        }
        this._function = fn;
        return this;
    }

    //// RESULTS ////

    /** Has it run (successfully or not) */
    get done(): boolean
    {
        return this._run !== null;
    }

    /** What the last run left, or null when it did not run yet */
    result(): PipelineRun | null
    {
        return this._run;
    }

    error(): Error | null
    {
        return this._run?.error ?? null;
    }

    /** The scene its model outputs export */
    output(): SceneNode | null
    {
        return this._run?.output ?? null;
    }

    /** The variables it assigned and returned */
    vars(): Record<string, any>
    {
        return this._vars;
    }

    //// RUN ////

    /** Run the function once (later calls give the same run), awaiting it when it is async.
     *  @param scope the main execution scope
     *  @param modules the Archiyou modules of that scope (modeler, annotator, docs, calc, console) */
    async run(scope: Record<string, any>, modules: Record<string, any>): Promise<this>
    {
        if (this._run) { return this }
        if (this._pending) { return this._pending }

        this._pending = (async () =>
        {
            const start = this._begin(scope, modules);
            let value: any = null;
            let error: Error | null = null;
            try
            {
                value = await this._function.call(scope, scope);
            }
            catch (e)
            {
                error = e as Error;
            }
            this._finish(scope, modules, start, value, error);
            return this;
        })();

        return this._pending;
    }

    /** Run the function once without awaiting, for code that needs the result right away
     *  (documents outside a Runner, component internals). An async function is not awaited:
     *  what it returns later still reaches vars(), but its shapes are not captured. */
    runSync(scope: Record<string, any>, modules: Record<string, any>): this
    {
        if (this._run || this._pending) { return this }

        const start = this._begin(scope, modules);
        let value: any = null;
        let error: Error | null = null;
        try
        {
            value = this._function.call(scope, scope);
        }
        catch (e)
        {
            error = e as Error;
        }

        if (typeof value?.then === 'function')
        {
            console.warn(`Pipeline::runSync(): Pipeline '${this.name}' is async, but its results are needed right away. Request one of its outputs instead (like '${this.name}/model/glb').`);
            value.then((v: any) => Object.assign(this._vars, this._returnedOf(v) ?? {}), () => {});
            value = null;
        }

        this._finish(scope, modules, start, value, error);
        return this;
    }

    private _begin(scope: Record<string, any>, modules: Record<string, any>): PipelineRunStart
    {
        const start = {
            overlay: scope._overlay ?? null,
            capturing: typeof modules?.modeler?.beginCapture === 'function',
            annotations: [...(modules?.annotator?.getAnnotations?.() ?? [])],
            docs: modules?.docs?.docs?.() ?? [],
            tables: modules?.calc?.getTableNames?.() ?? [],
            metrics: modules?.calc?.getMetricNames?.() ?? [],
        };

        if (start.capturing) { modules.modeler.beginCapture(this.name) }
        scope._overlay = this._vars; // variable writes go to this pipeline (see Runner.createScope)
        return start;
    }

    private _finish(scope: Record<string, any>, modules: Record<string, any>, start: PipelineRunStart, value: any, error: Error | null): void
    {
        scope._overlay = start.overlay;
        const capture = start.capturing ? modules.modeler.endCapture() : null;

        const returned = error ? null : this._returnedOf(value);
        Object.assign(this._vars, returned ?? {});

        // The annotations it made go with its output: take them out of the model's
        const annotator = modules?.annotator;
        const before = new Set(start.annotations);
        const made = (annotator?.getAnnotations?.() ?? []).filter((a: any) => !before.has(a));
        if (made.length > 0) { annotator?.setAnnotations?.(start.annotations) }

        const fromReturned = Object.values(returned ?? {})
            .filter(v => isKernelShapeOrCollection(v))
            .flatMap(v => collectAnnotations(v));

        const createdOf = (now: Array<string>, then: Array<string>) => now.filter(n => !then.includes(n));

        this._run = {
            returned,
            output: modules?.modeler?.pipelineScene?.(this.name, capture, returned) ?? capture,
            annotations: [...new Set([...made, ...fromReturned])],
            created: {
                docs: createdOf(modules?.docs?.docs?.() ?? [], start.docs),
                tables: createdOf(modules?.calc?.getTableNames?.() ?? [], start.tables),
                metrics: createdOf(modules?.calc?.getMetricNames?.() ?? [], start.metrics),
            },
            error,
        };

        if (error)
        {
            const message = `Pipeline '${this.name}' failed: ${error?.name ?? 'Error'}: ${error?.message ?? error}`;
            console.error(`Pipeline::run(): ${message}`);
            this.onError ? this.onError(error) : modules?.console?.error?.(message);
        }
    }

    /** What the function returned as { name: value }: an object as is, a single shape under
     *  the pipeline name, anything else nothing */
    private _returnedOf(value: any): Record<string, any> | null
    {
        if (isKernelShapeOrCollection(value)) { return { [this.name]: value } }
        if (value && typeof value === 'object' && !Array.isArray(value)) { return value }
        return null;
    }
}
