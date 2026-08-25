/**
 * Minimal plugin types for the guest-model loader (implementation slice 2).
 * A subset of the manifest spec in plugins/README.md — enough to load a
 * `script`-mode plugin with a custom param menu.
 */

export interface PluginToolManifest
{
  id: string;
  name: string;
  ui: string;
  icon?: string;
  outputs?: string[];
  placement?: 'left' | 'right' | 'bottom';
  exclusive?: boolean;
}

export interface PluginManifest
{
  id: string;
  name: string;
  version: string;
  engine: string;
  description?: string;
  author?: string;
  license?: string;
  icon?: string;
  mode?: 'script' | 'session';
  mainScript?: string;
  scripts?: string[];
  /** Main UI part (replaces the default param panel); was `paramMenu`. */
  ui?: string;
  tools?: PluginToolManifest[];
  coreModules?: unknown[];
  permissions?: unknown;
}

/**
 * A plugin whose bytes have been fetched. How the bytes are obtained (Vite
 * glob today, runtime `fetch` later) is deliberately decoupled from what the
 * PluginManager does with them.
 */
export interface LoadedPlugin
{
  manifest: PluginManifest;
  /** archiyou script code from `manifest.mainScript`. */
  mainCode: string;
  /** `$component` scripts from `manifest.scripts`, keyed by file stem → code. */
  scripts: Record<string, string>;
  /** Full script-module default objects (main + components), keyed by stem — for save-back. */
  scriptModules: Record<string, Record<string, unknown>>;
  /** manifest-relative path → HTML source (e.g. the param menu, tools). */
  parts: Record<string, string>;
}
