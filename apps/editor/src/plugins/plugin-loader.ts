/**
 * plugin-loader — loads a plugin's bytes into a LoadedPlugin descriptor.
 *
 * Three sources, same output:
 *  - loadPluginFromUrl(baseUrl)      — runtime URL loading (fetch + dynamic import).
 *      In dev the repo-root `plugins/` dir is served at /plugins/* by a Vite
 *      middleware (see vite.config.ts).
 *  - loadPluginFromDirectory(handle) — the in-editor "Open plugin folder" flow on
 *      Chromium, reading files straight off disk via the File System Access API.
 *      Gives a live, writable handle (hot-reload + save-back).
 *  - loadPluginFromFiles(files)      — read-only fallback for Firefox/Safari, which
 *      have no showDirectoryPicker(). Files come from a one-shot
 *      `<input webkitdirectory>` snapshot: no live handle, so no hot-reload or
 *      save-back — the user re-picks to refresh.
 *
 * The main script is imported from a blob URL so it stays a real ESM module.
 * Nothing here is bundled at build time.
 */

import type { LoadedPlugin, PluginManifest } from './types';

/** UI part paths declared by a manifest (param menu + tools). */
function partPaths(manifest: PluginManifest): string[]
{
  return [manifest.ui, ...(manifest.tools ?? []).map(t => t.ui)].filter(Boolean) as string[];
}

/** `$component` script name for a manifest path (its file stem: scripts/bracket.ts → bracket). */
export function scriptStem(path: string): string
{
  return path.split('/').pop()!.replace(/\.[^.]+$/, '');
}

/** Import an ESM `export default {...}` module from source text, return its default object. */
async function importDefaultModule(source: string, id: string): Promise<Record<string, unknown>>
{
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try
  {
    const mod = await import(/* @vite-ignore */ url);
    const def = mod?.default;
    if (!def || typeof def.code !== 'string') throw new Error(`Plugin "${id}": script has no code`);
    return def as Record<string, unknown>;
  }
  finally
  {
    URL.revokeObjectURL(url);
  }
}

// ── URL source ─────────────────────────────────────────────────────────────

/** Load a plugin directory served at `baseUrl` (no trailing slash). */
export async function loadPluginFromUrl(baseUrl: string): Promise<LoadedPlugin>
{
  const base = baseUrl.replace(/\/$/, '');
  const manifest = await fetchJson<PluginManifest>(`${base}/manifest.json`);
  if (!manifest.mainScript) throw new Error(`Plugin "${manifest.id}": no mainScript`);

  const mainMod = (await import(/* @vite-ignore */ `${base}/${manifest.mainScript}`))?.default;
  if (!mainMod || typeof mainMod.code !== 'string') throw new Error(`Plugin "${manifest.id}": mainScript has no code`);

  const scriptModules: Record<string, Record<string, unknown>> = { [scriptStem(manifest.mainScript)]: mainMod };
  const scripts: Record<string, string> = {};
  for (const p of manifest.scripts ?? [])
  {
    const mod = (await import(/* @vite-ignore */ `${base}/${p}`))?.default;
    if (mod && typeof mod.code === 'string') { scripts[scriptStem(p)] = mod.code; scriptModules[scriptStem(p)] = mod; }
  }

  const parts: Record<string, string> = {};
  for (const p of partPaths(manifest)) parts[p] = await fetchText(`${base}/${p}`);

  return { manifest, mainCode: mainMod.code as string, scripts, scriptModules, parts };
}

/** The bundled example plugin, loaded over HTTP like any other. */
export function loadShapePicker(): Promise<LoadedPlugin>
{
  return loadPluginFromUrl('/plugins/shape-picker');
}

// ── Directory source (a local folder, read by relative path) ────────────────

/** Reads a plugin file's text by its manifest-relative, `/`-separated path. */
type PluginFileReader = (relPath: string) => Promise<string>;

/** Build a LoadedPlugin from any reader (disk handle or `<input>` snapshot). */
async function loadPluginWith(read: PluginFileReader): Promise<LoadedPlugin>
{
  const manifest = JSON.parse(await read('manifest.json')) as PluginManifest;
  if (!manifest.mainScript) throw new Error(`Plugin "${manifest.id}": no mainScript`);

  const mainMod = await importDefaultModule(await read(manifest.mainScript), manifest.id);

  const scriptModules: Record<string, Record<string, unknown>> = { [scriptStem(manifest.mainScript)]: mainMod };
  const scripts: Record<string, string> = {};
  for (const p of manifest.scripts ?? [])
  {
    const mod = await importDefaultModule(await read(p), scriptStem(p));
    scripts[scriptStem(p)] = mod.code as string;
    scriptModules[scriptStem(p)] = mod;
  }

  const parts: Record<string, string> = {};
  for (const p of partPaths(manifest)) parts[p] = await read(p);

  return { manifest, mainCode: mainMod.code as string, scripts, scriptModules, parts };
}

/** Load a plugin from a directory the user picked with showDirectoryPicker() (Chromium). */
export function loadPluginFromDirectory(dir: FileSystemDirectoryHandle): Promise<LoadedPlugin>
{
  return loadPluginWith(p => readFileText(dir, p));
}

/**
 * Load a plugin from a `<input webkitdirectory>` snapshot (read-only fallback for
 * browsers without the File System Access API). `webkitRelativePath` is
 * `<rootFolder>/<path>`, so the shared root segment is stripped to recover the
 * manifest-relative path.
 */
export function loadPluginFromFiles(files: FileList | File[]): Promise<LoadedPlugin>
{
  const byRelPath = new Map<string, File>();
  for (const f of Array.from(files))
  {
    const rel = (f as any).webkitRelativePath as string || f.name;
    const stripped = rel.split('/').slice(1).join('/') || rel;
    byRelPath.set(stripped, f);
  }
  return loadPluginWith(async (relPath) =>
  {
    const f = byRelPath.get(relPath);
    if (!f) throw new Error(`Plugin file not found: ${relPath}`);
    return f.text();
  });
}

/** True when the browser supports the live, writable "Open plugin folder" flow (Chromium only). */
export function directoryPickerSupported(): boolean
{
  return typeof (globalThis as any).showDirectoryPicker === 'function';
}

/**
 * Read-only folder pick via a hidden `<input webkitdirectory>`. Resolves with the
 * selected files, or null if the dialog was dismissed with no selection. Used on
 * Firefox/Safari, where showDirectoryPicker() is unavailable.
 */
export function pickPluginFolderFiles(): Promise<File[] | null>
{
  return new Promise((resolve) =>
  {
    const input = document.createElement('input');
    input.type = 'file';
    (input as any).webkitdirectory = true;
    input.multiple = true;
    input.style.display = 'none';
    input.addEventListener('change', () =>
    {
      const files = input.files ? Array.from(input.files) : [];
      input.remove();
      resolve(files.length ? files : null);
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Newest mtime across a plugin's files (manifest + main script + parts). Used to
 * poll a picked directory for edits (the browser has no native file-watch).
 */
export async function pluginMaxMtime(dir: FileSystemDirectoryHandle, manifest: PluginManifest): Promise<number>
{
  const paths = ['manifest.json', manifest.mainScript, ...partPaths(manifest)].filter(Boolean) as string[];
  let max = 0;
  for (const p of paths)
  {
    try
    {
      const file = await (await getFileHandle(dir, p)).getFile();
      if (file.lastModified > max) max = file.lastModified;
    }
    catch { /* file may be missing mid-edit; ignore */ }
  }
  return max;
}

/** Resolve a `/`-separated path to a FileSystemFileHandle relative to a directory. */
async function getFileHandle(dir: FileSystemDirectoryHandle, relPath: string, create = false): Promise<FileSystemFileHandle>
{
  const segments = relPath.split('/').filter(Boolean);
  let handle: FileSystemDirectoryHandle = dir;
  for (let i = 0; i < segments.length - 1; i++)
  {
    handle = await handle.getDirectoryHandle(segments[i]!, { create });
  }
  return handle.getFileHandle(segments[segments.length - 1]!, { create });
}

/** Request read-write access to a directory handle (returns true if granted). */
export async function requestWritePermission(dir: FileSystemDirectoryHandle): Promise<boolean>
{
  const opts = { mode: 'readwrite' as const };
  const anyDir = dir as any;
  if ((await anyDir.queryPermission?.(opts)) === 'granted') return true;
  return (await anyDir.requestPermission?.(opts)) === 'granted';
}

/** Write text to a file at a `/`-separated path relative to a directory handle. */
export async function writeFileText(dir: FileSystemDirectoryHandle, relPath: string, content: string): Promise<void>
{
  const fileHandle = await getFileHandle(dir, relPath, true);
  const writable = await (fileHandle as any).createWritable();
  await writable.write(content);
  await writable.close();
}

/** Read a file at a `/`-separated path relative to a directory handle. */
async function readFileText(dir: FileSystemDirectoryHandle, relPath: string): Promise<string>
{
  return (await (await getFileHandle(dir, relPath)).getFile()).text();
}

// ── fetch helpers ──────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T>
{
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string>
{
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.text();
}
