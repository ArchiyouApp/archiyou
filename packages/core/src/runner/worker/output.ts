/**
 * output.ts
 *
 * Core-side helper to pull a single output out of a RunnerScriptExecutionResult
 * and unwrap it into plain, ready-to-use data (e.g. a GLB ArrayBuffer). Used by
 * RunnerWorker.execute() and exported for headless consumers.
 *
 * This mirrors the unwrap the viewer does in model-viewer.ts `_loadGlbOutput`,
 * but returns the data instead of feeding it to Three.js.
 */

import type { RunnerScriptExecutionResult } from '../types';
import type { ScriptOutputData, ScriptOutputDataWrapper } from '../../execution/types';

/** Unwrapped output value: binary as ArrayBuffer, else the raw string / object / array. */
export type OutputData = ArrayBuffer | string | Record<string, any> | Array<any>;

/** Cross-environment base64 → ArrayBuffer (works in browser workers and Node). */
function base64ToArrayBuffer(b64: string): ArrayBuffer
{
  if (typeof Buffer !== 'undefined')
  {
    const buf = Buffer.from(b64, 'base64');
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Unwrap a single ScriptOutputData.output into plain data. */
export function unwrapOutput(entry: ScriptOutputData): OutputData
{
  const raw = entry.output;

  if (raw instanceof ArrayBuffer) return raw;
  if (raw instanceof Uint8Array) return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;

  // Wrapped binary data: { encoding?: 'base64', data }
  if (raw && typeof raw === 'object' && 'data' in raw)
  {
    const wrapper = raw as ScriptOutputDataWrapper;
    if (wrapper.encoding === 'base64' && typeof wrapper.data === 'string')
    {
      return base64ToArrayBuffer(wrapper.data);
    }
    return wrapper.data as OutputData;
  }

  return raw as OutputData;
}

/**
 * Find the output whose requested path matches `path` (e.g. 'default/model/glb')
 * and return its unwrapped data, or `undefined` if not present.
 */
export function getOutput(result: RunnerScriptExecutionResult, path: string): OutputData | undefined
{
  const entry = result.outputs?.find(o => o.path?.requestedPath === path);
  return entry ? unwrapOutput(entry) : undefined;
}
