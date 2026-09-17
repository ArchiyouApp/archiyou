/**
 * Central route configuration.
 *
 * Routes are public and login is opt-in via the nav-bar Sign in button — with one
 * exception: /admin redirects anyone who is not an operator. That guard is a
 * courtesy, not a control. It only keeps a non-operator from landing on a screen
 * whose every request would 403; the actual gate is requireAdmin on the server
 * (apps/server/src/routes/admin.ts), which re-reads users.is_admin per request.
 */

import { Router, type Route } from '@vaadin/router';

import { userState } from '../../state/core.js';

export const routes: Route[] = [
  // --- OAuth pages (no layout) ---
  {
    path: '/login',
    component: 'page-login',
    action: async () => { await import('../../pages/login.js'); },
  },
  {
    path: '/callback',
    component: 'page-callback',
    action: async () => { await import('../../pages/callback.js'); },
  },
  {
    path: '/forgot-password',
    component: 'page-forgot-password',
    action: async () => { await import('../../pages/forgot-password.js'); },
  },
  {
    path: '/reset-password',
    component: 'page-reset-password',
    action: async () => { await import('../../pages/reset-password.js'); },
  },
  {
    // Landing page for the link in the confirmation email; the server builds
    // this URL from FRONTEND_URL (apps/server/src/routes/auth.ts).
    path: '/verify-email',
    component: 'page-verify-email',
    action: async () => { await import('../../pages/verify-email.js'); },
  },

  // --- Published configurator (standalone, no nav-bar — embeddable) ---
  {
    path: '/configurators/:user/:scriptAndVersion',
    component: 'page-published-configurator',
    action: async () => { await import('../../pages/published-configurator.js'); },
  },

  // --- App (with nav-bar layout) ---
  {
    path: '/',
    component: 'layout-main',
    action: async () => { await import('../../layouts/layout-main.js'); },
    children: [
      {
        path: '',
        action: (_ctx, commands) => commands.redirect('/editor'),
      },
      {
        // /browser/{section}; /browser is Home (pages/browser.ts)
        path: 'browser/:section?',
        component: 'page-browser',
        action: async () => { await import('../../pages/browser.js'); },
      },
      // Script deep links (see services/script-links.ts):
      //   /editor/{author}/{name}[:{version}]  someone else's shared script
      //   /editor/{name}[:{version|latest}]    one of my own
      // The two-segment form is registered first so it wins over the optional
      // single-segment one.
      {
        path: 'editor/:author/:scriptAndVersion',
        component: 'page-editor',
        action: async () => { await import('../../pages/editor.js'); },
      },
      {
        path: 'editor/:scriptAndVersion?',
        component: 'page-editor',
        action: async () => { await import('../../pages/editor.js'); },
      },
      {
        // /admin/{section}; /admin shows the first section (pages/admin.ts)
        path: 'admin/:section?',
        component: 'page-admin',
        action: async (_ctx, commands) => {
          // userState is derived from the auth service's restored session, so this is
          // already settled by the time a route resolves.
          if (!userState.get().isAdmin) return commands.redirect('/editor');
          await import('../../pages/admin.js');
          return undefined;
        },
      },
    ],
  },

  // --- 404 catch-all ---
  {
    path: '(.*)',
    action: (_ctx, commands) => commands.redirect('/editor'),
  },
];

export function initRouter(outlet: HTMLElement): Router {
  const router = new Router(outlet);
  router.setRoutes(routes);
  return router;
}
