/**
 * plugin-session — tiny hand-off for a plugin directory picked in the editor
 * (via the Plugins ▸ Add plugin menu) so the /plugin page can load it after
 * navigation. A FileSystemDirectoryHandle can't be passed through a URL, so it
 * is stashed here and consumed once.
 */

let pending: FileSystemDirectoryHandle | null = null;

export function setPendingPluginDir(handle: FileSystemDirectoryHandle): void
{
  pending = handle;
}

/** Return the pending handle (if any) and clear it. */
export function takePendingPluginDir(): FileSystemDirectoryHandle | null
{
  const handle = pending;
  pending = null;
  return handle;
}
