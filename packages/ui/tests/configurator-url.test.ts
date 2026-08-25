/**
 * The public configurator URL shown in the editor must follow the origin the
 * editor is actually served from — `published.url` is stamped server-side from
 * FRONTEND_URL at publish time, so a script published against a dev server (or by
 * a server deployed without that env var) carries a localhost URL forever.
 */

import { describe, it, expect, afterEach } from 'vitest';

import { onCurrentOrigin, configuratorUrl, publicConfiguratorUrl }
  from '../src/editor/publish-constants';

/** Pretend the page is served from `origin` (the suite runs in node, no DOM). */
function serveFrom(origin: string | null) {
  if (origin === null) delete (globalThis as Record<string, unknown>).window;
  else (globalThis as Record<string, unknown>).window = { location: { origin } };
}

afterEach(() => serveFrom(null));

describe('onCurrentOrigin', () => {
  it('rebases a stale localhost URL onto the current origin', () => {
    serveFrom('https://next.archiyou.com');
    expect(onCurrentOrigin('http://localhost:5173/configurators/archiyou/example_solids:0.4'))
      .toBe('https://next.archiyou.com/configurators/archiyou/example_solids:0.4');
  });

  it('keeps query and hash', () => {
    serveFrom('https://next.archiyou.com');
    expect(onCurrentOrigin('http://localhost:5173/configurators/a/b:1.0?WIDTH=1200#top'))
      .toBe('https://next.archiyou.com/configurators/a/b:1.0?WIDTH=1200#top');
  });

  it('resolves a relative stored URL against the current origin', () => {
    serveFrom('https://next.archiyou.com');
    expect(onCurrentOrigin('/configurators/a/b:1.0'))
      .toBe('https://next.archiyou.com/configurators/a/b:1.0');
  });

  it('returns null for a missing URL', () => {
    serveFrom('https://next.archiyou.com');
    expect(onCurrentOrigin(null)).toBeNull();
    expect(onCurrentOrigin(undefined)).toBeNull();
    expect(onCurrentOrigin('')).toBeNull();
  });

  it('leaves the URL alone off-browser (no window)', () => {
    expect(onCurrentOrigin('http://localhost:5173/configurators/a/b:1.0'))
      .toBe('http://localhost:5173/configurators/a/b:1.0');
  });
});

describe('publicConfiguratorUrl', () => {
  it('prefers the stored path, on the current origin', () => {
    serveFrom('https://next.archiyou.com');
    expect(publicConfiguratorUrl('http://localhost:5173/configurators/archiyou/old_name:0.1',
                                 'archiyou', 'new_name', '0.4'))
      .toBe('https://next.archiyou.com/configurators/archiyou/old_name:0.1');
  });

  it('builds the URL from author/name/version when nothing was stored', () => {
    serveFrom('https://next.archiyou.com');
    expect(publicConfiguratorUrl(null, 'archiyou', 'example_solids', '0.4'))
      .toBe('https://next.archiyou.com/configurators/archiyou/example_solids:0.4');
  });

  it('encodes segments with spaces', () => {
    serveFrom('https://next.archiyou.com');
    expect(configuratorUrl('archiyou', 'my script', '0.4'))
      .toBe('https://next.archiyou.com/configurators/archiyou/my%20script:0.4');
  });
});
