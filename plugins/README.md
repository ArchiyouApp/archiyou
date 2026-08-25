# Developing an Archiyou plugin

**IN DEVELOPMENT**

Archiyou plugins are **guests** in the Archiyou editor: the editor keeps owning the shell,
the 3D viewer, and execution, while a plugin contributes to a small set of extension points.
This is a hands-on manual for the parts that work today. The rest of the architecture —
`session` mode, worker-scope modules, permissions, the embed path — is still being designed
and is not documented here yet.

> **Status.** Implemented today: `script`-mode plugins with a **main script**, a **custom main
> UI**, and **toolbar tools** (with `archiyou.generate` + `archiyou.download` + `archiyou.ui`), loaded at
> runtime (by URL or from a local folder, with auto-reload) and previewed at `/plugin`.
> Not yet wired into the loader: worker-scope core modules, `session` mode, and permissions.

---

## 1. What a plugin is

A plugin is a **directory** with a manifest, one or more scripts, and one or more UI parts:

```
my-plugin/
  manifest.json          # describes the plugin
  scripts/
    main.js              # the entry script — declares $PARAMS (the input schema)
  ui/
    ui.html              # the plugin main UI (a self-contained HTML part)
    tools/
      export.html        # optional: a toolbar tool (panel + button)
  README.md
```

- **`scripts/main.js`** is the geometry logic in the Archiyou script language. Its `$PARAMS`
  declarations *are* the plugin's input schema.
- **`ui/ui.html`** is one self-contained HTML file (inline CSS + JS). It runs in a
  sandboxed iframe and talks to the host over the `archiyou` bridge.

The fastest way to start is to copy [`shape-picker/`](shape-picker/) and edit it.

---

## 2. `manifest.json`

Minimum for a `script`-mode plugin with a custom menu:

```jsonc
{
  "id": "my-plugin",             // kebab-case, unique
  "name": "My Plugin",
  "version": "0.1.0",
  "engine": "^1",                // host API version gate
  "mode": "script",              // functional: params -> run -> outputs
  "mainScript": "scripts/main.js",
  "ui": "ui/ui.html"
}
```

`mainScript` **must be plain ESM** (`.js`) so it can be loaded at runtime without a build step.
Paths are relative to the plugin folder. The fields above are the ones the loader reads today.

---

## 3. The main script (`scripts/main.js`)

Plain ESM exporting a script-data object. The `code` string is the Archiyou script language:

```js
export default {
  name: 'my-plugin',
  code: `
    units('mm');

    // Declare the input schema. These become $WIDTH / $ROUND at runtime.
    $PARAMS.define('WIDTH', 'number',  { minimum: 10, maximum: 300, multipleOf: 5, default: 100 });
    $PARAMS.define('ROUND', 'boolean', { default: false });

    // Build geometry. box/sphere/cylinder/… are scope globals and auto-add to the scene.
    const b = box($WIDTH, $WIDTH, $WIDTH).color('blue');
    if ($ROUND) b.fillet?.(5);
  `,
  params: {},
};
```

Key points:

- **Parameter types:** `number`, `boolean`, `text`, `options`, `list`, `object`.
  Use JSON-Schema keywords in the options object — `minimum` / `maximum` / `multipleOf` for
  numbers, `options: [...]` for `options` (an enum). The `{ min, max, step }` shorthand does
  **not** populate schema bounds, so prefer the schema keywords.
- **Values** are read in code as `$NAME` (e.g. `$WIDTH`). Names are upper-cased.
- **Globals** available in `code` include `units`, `box`, `sphere`, `cylinder`, `cone`,
  `modeler`, `docs`, `$PARAMS`, `$component`, and more (see
  `packages/core/src/constants.ts` › `MODELER_METHODS_INTO_GLOBAL`).

The schema you declare here is what the main UI renders — the script is the single source
of truth for parameters.

---

## 4. The main UI (`ui/ui.html`)

One self-contained HTML document. The host injects a `window.archiyou` bridge before your
script runs, then hands you the schema. Your job: render inputs, collect a **values object**,
and submit it. The host validates and executes; you never call the engine directly.

```html
<!doctype html>
<html><head><style>/* your styles */</style></head>
<body>
  <div id="root"></div>
  <script>
    const values = {};

    // 1. Receive the input schema (the main script's $PARAMS).
    archiyou.onSchema((schema) => {
      const width = schema.find(p => p.name === 'WIDTH');
      values.WIDTH = width._value ?? width.schema.default;
      render(schema);            // build your inputs from schema.*
    });

    // 2. On change, submit the whole values object. The host runs the script.
    function onChange(name, value) {
      values[name] = value;
      archiyou.submit({ ...values });
    }
  </script>
</body></html>
```

The **`archiyou` bridge** (available inside the iframe):

| Call | Direction | Purpose |
|---|---|---|
| `archiyou.onSchema(cb)` | host → part | Receive the schema: `ScriptParamData[]` (`name`, `label`, `_value`, `schema`). |
| `archiyou.submit(values)` | part → host | Submit a `{ NAME: value }` object → validate + execute + repaint the viewer. |
| `archiyou.onResult(cb)` | host → part | Receive the run summary: `{ status, meta, outputPaths }` (no heavy buffers). |
| `archiyou.generate(selectors)` | part → host | `await` the requested outputs, e.g. `['default/model/glb']` → `[{ path, data }]`. |
| `archiyou.download(name, data)` | part → host | Download `data` (ArrayBuffer/string) as a file. |
| `archiyou.ui.open/close/toggle(tool)` | part → host | Open/close/toggle a tool panel by name or id, e.g. `archiyou.ui.open('Export')`. |

Each schema entry's `schema` is JSON Schema: `schema.enum` for `options`,
`schema.minimum` / `schema.maximum` / `schema.multipleOf` for numbers, etc.

### Toolbar tools

Declare tools in the manifest; each is another flattened HTML part that gets a toolbar button
and a side panel:

```jsonc
"tools": [
  { "id": "export", "name": "Export", "icon": "download", "ui": "ui/tools/export.html" }
]
```

`icon` is a [lucide](https://lucide.dev) icon name; in editor plugin mode the tool appears in
the right toolbar with this icon, tinted to stand apart from the built-in tools.

A tool typically listens with `archiyou.onResult(...)` (to show info / metrics for the current
model) and calls `archiyou.generate([...])` + `archiyou.download(...)` to export. See
[`shape-picker/ui/tools/export.html`](shape-picker/ui/tools/export.html) — it shows the bounding
box and downloads GLB / STL. Output selectors are `pipeline/category/name/format`, e.g.
`default/model/glb`, `default/model/stl`, `default/tables/*/xlsx`, `default/docs/*/svg`.

**Tips**
- The part is sandboxed (`sandbox="allow-scripts"`, null origin): no access to the host DOM,
  other plugins, or the network beyond what a manifest permits (permissions land later).
- Keep it one file per panel. Opened standalone (outside the editor), guard a missing
  `archiyou` so the file still renders — see `shape-picker/ui/ui.html`.

---

## 5. Running & testing your plugin

### In the editor (`/plugin`)

Start the editor dev server and open `/plugin`:

```bash
cd apps/editor && pnpm dev        # then open http://localhost:5173/plugin
```

- On load it runs the bundled **shape-picker** example.
- **Open folder** → pick your plugin directory to load it straight off disk
  (Chromium browsers; uses the File System Access API).
- **auto** (on by default once a folder is open) polls the folder ~1×/s and reloads on edits;
  **Reload** does it on demand — the inner dev loop.
- Tool buttons (bottom of the menu) toggle each tool's side panel.
- Change an input → the viewer repaints.

> If the dev server dies with `ENOSPC … file watchers`, raise your inotify limit
> (`sysctl fs.inotify.max_user_watches`) or run with `CHOKIDAR_USEPOLLING=true`.

### By URL (runtime loading)

In dev, the repo-root `plugins/` dir is served at `/plugins/*` (a Vite middleware in
`apps/editor/vite.config.ts`). The editor loads the example via
`loadPluginFromUrl('/plugins/shape-picker')` — the same path a published plugin would use.

### Headless (CI)

Test the main script against the real engine with vitest — assert distinct output for
distinct inputs, not just `status: success`. See
[`../packages/core/tests/unit/runner/shape-picker.plugin.test.ts`](../packages/core/tests/unit/runner/shape-picker.plugin.test.ts)
for a template:

```ts
const runner = await new Runner().load();
// Capture the param defs from a first run, then pass them back as script.params
// on each run so submitted `params` values actually bind.
const r = await runner.execute({ kernel: 'mesh', script: { code, params: defs },
                                 params: { WIDTH: 200 }, outputs: ['default/model/gltf'] });
expect(r.status).toBe('success');
```

> **Gotcha:** if you run the script with only `{ code }` and `params`, the values won't bind
> and every run falls back to the defaults. You must include the param **definitions** in
> `script.params` (this is what `PluginManager` does for you in the editor).

---

## 6. Where to look

- **Example:** [`shape-picker/`](shape-picker/) — a dropdown (cube/sphere/cylinder) + size.
- **Loader / bridge / preview:** `apps/editor/src/plugins/` and `apps/editor/src/pages/plugin.ts`.
