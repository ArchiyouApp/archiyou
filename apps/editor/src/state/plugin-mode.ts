/**
 * plugin-mode — editor "plugin mode" state.
 *
 * When set, the editor is scoped to a single plugin (its scripts in the codebox,
 * its custom param menu + tools) and clearly flagged. It is an ISOLATED session:
 * the personal `editorScript` / `scripts` signals and localStorage are never
 * touched, so exiting simply restores the user's normal working set.
 */

import { signal } from '@lit-labs/signals';

import type { LoadedPlugin } from '../plugins/types';
import type { PluginManager } from '../plugins/PluginManager';

export interface PluginModeState
{
  plugin: LoadedPlugin;
  /** Present when opened from disk (enables opt-in save-back). */
  dirHandle: FileSystemDirectoryHandle | null;
  /** The live manager running/holding the plugin's working set. */
  manager: PluginManager;
}

export const pluginMode = signal<PluginModeState | null>(null);

export function enterPluginMode(state: PluginModeState): void
{
  pluginMode.set(state);
}

export function exitPluginMode(): void
{
  pluginMode.set(null);
}

export function isPluginMode(): boolean
{
  return pluginMode.get() !== null;
}
