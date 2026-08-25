/**
 * PluginManager (implementation slice 2) — loads a `script`-mode guest plugin,
 * runs its main script in the shared worker, and pushes the result into the
 * host-owned viewer WITHOUT mutating the user's active editor script.
 *
 * This is the minimal real loader behind the `/plugin` preview page. The
 * `archiyou` bridge (param menu ↔ execution) lives in <plugin-part-frame>.
 */

import { Script } from '@archiyou/core/src/Script';
import type {
  RunnerScriptExecutionRequest,
  RunnerScriptExecutionResult,
} from '@archiyou/core/src/runner/types';
import type { ScriptParamData } from '@archiyou/core/src/execution/types';

import { runScript } from '../services/execution-service';
import { executionResult } from '../state/core';
import { scenegraph, reconcileScenegraph, setInteractiveShapes } from '../state/editor';

import type { LoadedPlugin, PluginManifest } from './types';
import { scriptStem } from './plugin-loader';

/** An editable script in the plugin working set (main or a $component). */
export interface PluginScriptEntry
{
  name: string;   // file stem; used for $component resolution
  code: string;
  isMain: boolean;
}

/** A generated output, unwrapped to plain data for a tool to consume/download. */
export interface GeneratedOutput
{
  path: string;
  data: ArrayBuffer | string;
}

/** Lightweight, clone-safe run summary handed to tool parts (no heavy buffers). */
export interface PluginResultSummary
{
  status?: string;
  meta?: unknown;
  outputPaths: string[];
}

export class PluginManager
{
  private plugin: LoadedPlugin | null = null;
  /** Editable working set: the main script + any $component scripts. */
  private workingSet: PluginScriptEntry[] = [];
  /**
   * Param definitions captured from the first run's managedParams. They must be
   * sent back on every run (as `script.params`) so the Runner sets up the
   * ParamManager with these params and can bind the submitted `params` values —
   * otherwise the in-code `$PARAMS.define(...)` defaults win and values are lost.
   */
  private paramDefs: Record<string, ScriptParamData> = {};
  /** Most recently submitted values — reused for tool-driven `generate()` calls. */
  private lastParams: Record<string, any> = {};
  private _summary: PluginResultSummary | null = null;
  private _schema: ScriptParamData[] = [];

  get active(): LoadedPlugin | null { return this.plugin; }
  get manifest(): PluginManifest | null { return this.plugin?.manifest ?? null; }
  /** Last run summary (status + meta + output paths), for tool parts. */
  get summary(): PluginResultSummary | null { return this._summary; }
  /** Input schema (main script's $PARAMS) captured on activate, for the param menu. */
  get schema(): ScriptParamData[] { return this._schema; }

  /** HTML source of a declared part (param menu or a tool), by manifest-relative path. */
  partHtml(path: string): string | null
  {
    return this.plugin?.parts[path] ?? null;
  }

  /** The editable working set (main + $component scripts), for the plugin-mode codebox. */
  scripts(): PluginScriptEntry[] { return this.workingSet; }
  scriptCode(name: string): string | undefined { return this.workingSet.find(s => s.name === name)?.code; }
  mainScriptName(): string | undefined { return this.workingSet.find(s => s.isMain)?.name; }

  /** Update a working-set script's code (from the codebox). Caller re-runs. */
  setScriptCode(name: string, code: string): void
  {
    const entry = this.workingSet.find(s => s.name === name);
    if (entry) entry.code = code;
  }

  /**
   * Load + first run. Returns the input schema (the main script's $PARAMS,
   * as ScriptParamData[]) for the param menu to render.
   */
  async activate(plugin: LoadedPlugin): Promise<ScriptParamData[]>
  {
    this.plugin = plugin;

    const mainName = scriptStem(plugin.manifest.mainScript ?? 'main');
    this.workingSet = [
      { name: mainName, code: plugin.mainCode, isMain: true },
      ...Object.entries(plugin.scripts ?? {}).map(([name, code]) => ({ name, code, isMain: false })),
    ];

    const result = await this.run({});
    const defs = result?.state?.managedParams?.new ?? [];
    for (const p of defs) { if (p.name) this.paramDefs[p.name] = p; }
    this._schema = defs;
    return defs;
  }

  /** Run the plugin's main script with the given param values; updates the viewer. */
  async run(params: Record<string, any>): Promise<RunnerScriptExecutionResult | undefined>
  {
    this.lastParams = params;
    const result = await this._execute(params, ['default/model/glb']);
    if (result)
    {
      this._applyToViewer(result);
      this._summary = {
        status: result.status,
        meta: result.meta,
        outputPaths: (result.outputs ?? []).map(o => o.path.requestedPath),
      };
    }
    return result;
  }

  /**
   * Produce the requested outputs for the current param values, without touching
   * the viewer. Used by toolbar tools via `archiyou.generate(selectors)`.
   */
  async generate(selectors: string[]): Promise<GeneratedOutput[]>
  {
    const result = await this._execute(this.lastParams, selectors);
    return (result?.outputs ?? [])
      .map(o => ({ path: o.path.requestedPath, data: unwrapOutput(o.output) }))
      .filter((o): o is GeneratedOutput => o.data !== undefined);
  }

  private _execute(params: Record<string, any>, outputs: string[]): Promise<RunnerScriptExecutionResult | undefined>
  {
    const main = this.workingSet.find(s => s.isMain);
    if (!main) throw new Error('PluginManager: no active plugin');

    const script = Script.fromData({ name: main.name, code: main.code })?.toData();
    if (!script) throw new Error(`PluginManager: invalid main script "${main.name}"`);
    script.params = { ...(script.params ?? {}), ...this.paramDefs };

    // $component scripts, linked in the worker (linkComponentScripts) by name.
    const componentScripts = this.workingSet
      .filter(s => !s.isMain)
      .map(s => Script.fromData({ name: s.name, code: s.code })?.toData())
      .filter((d): d is NonNullable<typeof d> => Boolean(d));

    const request: RunnerScriptExecutionRequest = {
      kernel: 'mesh', script, params, outputs, messages: ['error'], componentScripts,
    };
    return runScript(request);
  }

  /** The HTML source of the plugin's main UI part, if it declares one. */
  mainUiHtml(): string | null
  {
    const p = this.plugin;
    if (!p?.manifest.ui) return null;
    return p.parts[p.manifest.ui] ?? null;
  }

  /**
   * Push execution output into the host-owned viewer signals. Mirrors the
   * viewer-relevant half of state/core.setExecutionResult(), but deliberately
   * skips the managed-param merge so it never clobbers the user's active script.
   */
  private _applyToViewer(result: RunnerScriptExecutionResult): void
  {
    scenegraph.set(reconcileScenegraph(scenegraph.get(), result.state?.scenegraph ?? null));
    setInteractiveShapes(result.state?.interactiveShapes ?? []);
    executionResult.set(result);
  }
}

/**
 * Unwrap a script output to plain data (mirrors <model-viewer>._loadGlbOutput):
 * raw Uint8Array / ArrayBuffer / string, or a wrapped `{ encoding?, data }`.
 */
function unwrapOutput(output: unknown): ArrayBuffer | string | undefined
{
  if (output instanceof Uint8Array) return output.slice().buffer;
  if (output instanceof ArrayBuffer) return output;
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object' && 'data' in (output as any))
  {
    const w = output as { encoding?: string; data: ArrayBuffer | string };
    if (w.encoding === 'base64' && typeof w.data === 'string')
    {
      const bin = atob(w.data);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      return buf.buffer;
    }
    if (w.data instanceof ArrayBuffer || typeof w.data === 'string') return w.data;
  }
  return undefined;
}
