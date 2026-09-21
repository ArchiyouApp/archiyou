import { defineConfig } from 'vite';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// The editor's own package.json version is the single source of truth for the
// version shown in the UI (bump it with `pnpm version` in apps/editor). A CI or
// deploy script can override it per build with VITE_APP_VERSION, e.g. to append
// a git short-sha: VITE_APP_VERSION=0.1.0+a1b2c3d pnpm build.
const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string };
const appVersion = process.env['VITE_APP_VERSION'] || pkg.version;

export default defineConfig(() => {
  // APP env var selects a single app for dev/build:
  //   APP=workspace pnpm build
  // When unset, all apps are included. There is currently one app; the
  // standalone `viewer` entry was removed in the open-source release cleanup
  // because it was a stub importing a `viewer-3d` component that was never
  // written. The real viewer lives in packages/ui/src/viewer/model-viewer.ts
  // and is used by the configurator route inside the workspace app.
  const app = process.env['APP'];

  const allInputs: Record<string, string> = {
    workspace: 'index.html',
  };

  const inputs = app ? { [app]: allInputs[app] } : allInputs;

  return {
    // Expose SERVER_*-prefixed env vars to client code (in addition to the
    // default VITE_*), so `import.meta.env.SERVER_API_BASE_URL` is available.
    envPrefix: ['VITE_', 'SERVER_'],

    // Build-time constant; declared in src/vite-env.d.ts, read via settings.ts.
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },

    // WASM files served as assets; consumers use `?url` imports
    assetsInclude: ['**/*.wasm'],

    build: {
      target: 'es2022',
      rollupOptions: {
        input: inputs,
        output: {
          manualChunks: {
            codemirror: ['codemirror', '@codemirror/view', '@codemirror/state', '@codemirror/lang-javascript', '@codemirror/autocomplete', '@codemirror/language'],
            three:      ['three'],
          },
        },
      },
    },

    resolve: {
      alias: {
        // packages/ui reaches back into this app's source for shared state and
        // services (state/workspace, services/publishing, ...). That used to
        // resolve through a `@archiyou/editor: workspace:*` dependency in
        // packages/ui, but declaring it made ui and editor depend on each other,
        // and turbo refuses to build a cyclic package graph — `pnpm build` and
        // `pnpm test` both died on "Cyclic dependency detected" before running
        // anything. The import is a dev-time source alias, not a package
        // dependency (ui has no build output, this app is private), so the alias
        // lives here instead. Both tsconfigs carry the matching `paths` entry.
        // Remove this once that shared state moves down into a package both
        // sides can depend on.
        '@archiyou/editor/src': path.resolve(import.meta.dirname, 'src'),
      },
    },

    // Workers must be ES modules so they can use dynamic imports and top-level await
    worker: {
      format: 'es' as const,
    },

    server: {
      port: 5173,
      // Backend calls go directly to apps/server via SERVER_API_BASE_URL (see
      // apps/editor/.env). The server enables CORS for local origins, so no dev
      // proxy is needed.
    },
  };
});
