import { defineConfig, type Plugin } from 'vite';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const PLUGIN_MIME: Record<string, string> = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
};

/**
 * Dev-only: serve the repo-root `plugins/` directory at /plugins/* so plugins
 * can be loaded at runtime by URL (fetch + dynamic import) instead of being
 * bundled. Mirrors how a published plugin would be served from a static host.
 */
function servePluginsDir(): Plugin {
  const root = path.resolve(process.cwd(), '../../plugins');
  return {
    name: 'serve-plugins-dir',
    configureServer(server) {
      // Registered here (not via a returned fn) so it runs before Vite's
      // internal middlewares and can claim the /plugins/* prefix.
      server.middlewares.use('/plugins', async (req, res, next) => {
        try {
          const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
          const file = path.join(root, rel);
          if (!file.startsWith(root)) { res.statusCode = 403; return res.end('Forbidden'); }
          const body = await readFile(file);
          res.setHeader('Content-Type', PLUGIN_MIME[path.extname(file)] ?? 'application/octet-stream');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(body);
        } catch {
          next();
        }
      });
    },
  };
}

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
    plugins: [servePluginsDir()],

    // Expose SERVER_*-prefixed env vars to client code (in addition to the
    // default VITE_*), so `import.meta.env.SERVER_API_BASE_URL` is available.
    envPrefix: ['VITE_', 'SERVER_'],

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
