/**
 * state/param-behaviours.ts — dynamic, app-side-evaluated param behaviours.
 *
 * Scripts declare behaviours like `$PARAMS.OTHER.enableIf(p => p.SHOWBOX === false)`.
 * The worker serializes each behaviour function to source and ships them via the
 * dedicated `managedBehaviours` channel on the execution result (NOT managedParams,
 * so decorating a UI-authored param never flips it to programmatic mode).
 *
 * Here we:
 *   - hydrate the source strings back into functions (hydrateBehaviour)
 *   - store them on the in-memory ScriptParam._behaviours (applyManagedBehaviours)
 *   - evaluate them against the current param-value snapshot, writing the result
 *     onto enabled / visible / schema.enum / _value (evaluateParamBehaviours)
 *
 * Evaluation runs after each execution and on every client-side value change, so
 * dependent params react instantly without a re-run. Behaviours are never
 * persisted (ScriptParam.toData() omits _behaviours) and never count as a
 * definition change.
 */

import type { Script } from '@archiyou/core/src/Script';
import type { ScriptParam } from '@archiyou/core/src/execution/ScriptParam';
import type { ManagedBehavioursData, ParamBehaviourTarget, ParamBehaviourFn } from '@archiyou/core/src/execution/types';
import { paramValue } from './types';

/**
 * Re-hydrate a serialized behaviour function source into a callable.
 * Returns null (and logs) when the source can't be parsed.
 *
 * ⚠️  TRUST BOUNDARY. This is `new Function` on script-derived source, evaluated
 * on the MAIN THREAD — unlike script execution itself, which is confined to the
 * Web Worker. Main-thread code reaches `document` and `localStorage`, and the
 * session JWT lives in localStorage, so evaluating a *foreign* author's source
 * here would hand a malicious published configurator the viewer's token.
 *
 * Callers must therefore only hydrate behaviours for scripts the signed-in user
 * owns; `applyManagedBehaviours` enforces that via its `trusted` argument. The
 * cost is that dynamic behaviours (enableIf/visibleIf/…) do not animate in a
 * foreign script — params render in their declared state instead.
 *
 * Removing the eval altogether would mean evaluating behaviours in the worker and
 * shipping results rather than sources; that is the proper fix and is tracked as
 * a follow-up.
 */
export function hydrateBehaviour(src: string): ParamBehaviourFn | null
{
  try
  {
    // Wrap so both arrow (`p => ...`) and function-expression sources evaluate
    // to the function value rather than being treated as a statement.
    // eslint-disable-next-line no-new-func
    const fn = new Function('return (' + src + ')')();
    return (typeof fn === 'function') ? (fn as ParamBehaviourFn) : null;
  }
  catch (e)
  {
    console.error('hydrateBehaviour(): failed to parse behaviour source:', src, e);
    return null;
  }
}

/**
 * Replace every param's in-memory behaviours with the freshly-declared set from
 * the latest run (full sync). Hydrates sources to functions; touches nothing
 * else on the param (no definition fields, no _definedProgrammatically).
 *
 * `trusted` must be false whenever the script belongs to someone other than the
 * signed-in user (a published configurator or a foreign shared script). Hydration
 * is `new Function` on the main thread — see hydrateBehaviour — so for untrusted
 * scripts the behaviours are cleared and simply not installed.
 */
export function applyManagedBehaviours(
  script: Script,
  managed?: ManagedBehavioursData,
  trusted = true,
): void
{
  if (!script?.params) return;

  // Clear first — behaviours are re-declared identically every run, so a param
  // no longer decorated this run must lose its stale behaviour.
  for (const p of Object.values(script.params) as ScriptParam[])
  {
    if (p._behaviours) p._behaviours = {};
  }

  if (!managed) return;

  // Foreign script: leave the behaviours cleared rather than evaluating another
  // author's source in this page's context.
  if (!trusted)
  {
    if (Object.keys(managed).length > 0)
    {
      console.info(
        `applyManagedBehaviours(): skipped ${Object.keys(managed).length} behaviour(s) ` +
        `from a script you do not own — dynamic param behaviours are disabled for foreign scripts.`,
      );
    }
    return;
  }

  for (const [name, targets] of Object.entries(managed))
  {
    const upper = name.toUpperCase();
    const param = script.params[upper];
    if (!param || !targets) continue; // behaviours attach to existing params only

    const hydrated: Partial<Record<ParamBehaviourTarget, ParamBehaviourFn>> = {};
    for (const [target, src] of Object.entries(targets))
    {
      const fn = hydrateBehaviour(src as string);
      if (fn) hydrated[target as ParamBehaviourTarget] = fn;
    }
    param._behaviours = hydrated;
  }
}

/** Evaluate all param behaviours against a single snapshot of current values and
 *  apply the results. One synchronous pass (no cascade) so it can never loop.
 *  Mutates param fields in place; returns whether anything changed. The caller
 *  is responsible for bumping the script signal (this never persists/saves). */
export function evaluateParamBehaviours(script: Script | null): boolean
{
  if (!script?.params) return false;

  const params = Object.values(script.params) as ScriptParam[];

  // Snapshot { NAME: value } — the argument every behaviour function receives.
  const values: Record<string, any> = {};
  for (const p of params) values[p.name] = paramValue(p);

  let changed = false;

  for (const p of params)
  {
    const behaviours = p._behaviours;
    if (!behaviours || Object.keys(behaviours).length === 0) continue;

    for (const [target, fn] of Object.entries(behaviours))
    {
      if (typeof fn !== 'function') continue;
      let result: any;
      try { result = (fn as ParamBehaviourFn)(values); }
      catch (e)
      {
        console.error(`evaluateParamBehaviours(): behaviour "${target}" on param "${p.name}" threw:`, e);
        continue;
      }

      switch (target as ParamBehaviourTarget)
      {
        case 'enable':
        {
          const next = !!result;
          if (p.enabled !== next) { p.enabled = next; changed = true; }
          break;
        }
        case 'visible':
        {
          const next = !!result;
          if (p.visible !== next) { p.visible = next; changed = true; }
          break;
        }
        case 'options':
        {
          const schema = p.schema as any;
          if (Array.isArray(result)) { schema.enum = result; changed = true; }
          break;
        }
        case 'value':
        {
          if (p.validateValue(result) && p._value !== result) { p._value = result; changed = true; }
          break;
        }
        // 'values' | 'start' | 'end' — framework targets, not wired in the UI yet.
        default:
          break;
      }
    }
  }

  return changed;
}
