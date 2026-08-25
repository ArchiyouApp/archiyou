# shape-picker — example plugin

The smallest real archiyou **guest plugin** (`script` mode): a dropdown that picks a
primitive shape — **cube / sphere / cylinder** — plus a size, and runs the main script to
generate it. It is implementation slice 1 of the plugin architecture described in
[`../README.md`](../README.md).

## Structure

```
shape-picker/
  manifest.json          # id, engine ^1, mode "script", mainScript, paramMenu
  scripts/main.js        # declares $PARAMS (SHAPE options + SIZE number) → the input schema
  ui/param-menu.html     # the custom dropdown, driven over the `archiyou` bridge
  README.md
```

`main.js` is plain ESM (no build step) so it can be loaded at runtime by URL.

- **`scripts/main.ts`** is the geometry logic. Its `$PARAMS` **is** the input schema; the
  `SHAPE` param is an `options` type, and the code branches to `box()` / `sphere()` /
  `cylinder()` (all script-scope globals).
- **`ui/param-menu.html`** is a self-contained flattened part. It receives the schema via
  `archiyou.onSchema(...)`, builds the `<select>` from `SHAPE`'s `schema.enum`, and calls
  `archiyou.submit({ SHAPE, SIZE })` on change. archiyou validates the values against the
  schema and executes.

## How it runs

- **In the editor at `/plugin`:** the `PluginManager` loads this folder at runtime over HTTP
  (`fetch(manifest.json)` + dynamic `import(main.js)` + `fetch(param-menu.html)`), runs the
  main script in the shared worker, mounts `ui/param-menu.html` as a sandboxed `srcdoc` iframe
  driven by the `archiyou` bridge, and shows the result in the host `<model-viewer>`. Changing
  the dropdown → `archiyou.submit(values)` → re-run → viewer. In dev, the repo-root `plugins/`
  dir is served at `/plugins/*` by a Vite middleware (see `apps/editor/vite.config.ts`).
- **Standalone review:** `param-menu.html` opened on its own renders against a small built-in
  stub bridge (interactions log to the console) so it stays reviewable in isolation.
- **Headless:** the main script is covered by
  `packages/core/tests/unit/runner/shape-picker.plugin.test.ts`, which asserts cube / sphere /
  cylinder produce distinct geometry.

## Notes

- `mode: "script"` → functional `params → run → outputs`; the menu is a schema-driven form.
- No `coreModules`, so this is a **sandbox-tier** plugin (safe, AI-generatable).
