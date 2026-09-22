// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { fileURLToPath } from 'node:url';

import { starlightLocales, helpSidebar } from './src/help.ts';
import { readApi, referenceSidebar } from './src/reference.ts';

const HELP_DIR = fileURLToPath(new URL('../../help/', import.meta.url));

export default defineConfig({
  site: 'https://docs.archiyou.com',
  vite: {
    plugins: [
      {
        // The pages live in help/ at the repository root, outside this app, where the dev
        // server does not look for changes. Watch it, so edits show up without a restart.
        name: 'archiyou-watch-help',
        configureServer(server)
        {
          server.watcher.add(HELP_DIR);
        },
      },
    ],
  },
  integrations: [
    starlight({
      title: 'Archiyou',
      description: 'Tutorials and guides for Archiyou, the open-source code-CAD editor',
      // The wordmark includes the name, so it replaces the text title
      logo: { src: '../../packages/core/assets/archiyou_logo_header_white_small.png', alt: 'Archiyou', replacesTitle: true },
      head: [
        // Plus Jakarta Sans, the editor's typeface (apps/editor/index.html)
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' } },
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' } },
        { tag: 'link', attrs: { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap' } },
      ],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/ArchiyouApp/archiyou' },
      ],
      editLink: {
        // Starlight appends each page's path relative to this app: '../../help/…' (the pages
        // live in help/ at the repository root, see src/content.config.ts). Based on apps/docs/,
        // the '../..' resolves back to the repository root.
        baseUrl: 'https://github.com/ArchiyouApp/archiyou/edit/main/apps/docs/',
      },
      locales: starlightLocales(HELP_DIR),
      customCss: ['./src/styles/archiyou.css'],
      // Built from help/ (Starlight's autogenerate only reads src/content/docs/), then the
      // API reference pages (src/pages/reference/)
      sidebar: [...helpSidebar(HELP_DIR), referenceSidebar(readApi())],
    }),
  ],
});
