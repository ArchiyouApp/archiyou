/**
 * tests/unit/socialCard.test.ts — what a link crawler sees of a published configurator.
 *
 * The properties that matter:
 *
 *   1. The page route can never break the configurator. Anything that is not a published
 *      configurator gets the SPA shell exactly as Caddy would have served it.
 *   2. The card reads a link the way the page does (core's decodeParamValues): a value the
 *      configurator would ignore never appears on the card.
 *   3. Everything from the link or the script that lands in the HTML is escaped.
 *
 * Runs against an in-memory PGlite database, a throwaway thumbnail directory and a
 * throwaway SPA shell, all set before the modules that read them are imported.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Resvg } from '@resvg/resvg-js';

import type { ScriptData } from '@archiyou/core/src/execution/types';

let social: typeof import('../../src/services/SocialCard');
let config: typeof import('../../src/config').config;

const AUTHOR = 'tester';
const FRONTEND = 'https://configure.example.com';
const SHELL = '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>Archiyou</title>\n  </head>\n  <body><app-shell></app-shell></body>\n</html>\n';

/** The params of the house the feature was made for, trimmed to one of each type. */
const PARAMS = {
  WIDTH: { name: 'WIDTH', type: 'number', label: 'Width', order: 0, units: 'mm', default: 4000, schema: { type: 'number', default: 4000, minimum: 2000, maximum: 10000, multipleOf: 10 } },
  ROOF_TYPE: { name: 'ROOF_TYPE', type: 'options', label: 'Roof Type', order: 3, default: 'gable', schema: { type: 'string', enum: ['gable', 'shed'], default: 'gable' } },
  OVERHANGS_SAME: { name: 'OVERHANGS_SAME', type: 'boolean', label: 'Overhangs same', order: 7, default: true, schema: { type: 'boolean', default: true } },
  OPENINGS: { name: 'OPENINGS', type: 'list', label: 'Openings', order: 14, default: [], schema: { type: 'array', default: [], items: { type: 'object', properties: { wall: { type: 'string' }, width: { type: 'number' } } } } },
};

const OPENINGS = encodeURIComponent(JSON.stringify([{ wall: 'front', width: 1000 }, { wall: 'back', width: 2000 }]));

function house(over: Partial<ScriptData> = {}): ScriptData
{
  return {
    name: 'house', author: AUTHOR, version: '1.0.0', code: 'box(1);',
    params: PARAMS as unknown as ScriptData['params'],
    published: { public: true, title: 'Ur house', description: 'A small house.' },
    ...over,
  } as ScriptData;
}

/** A real 512×512 PNG: resvg has to be able to decode the thumbnail it draws. */
function picture(): Buffer
{
  return new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect x="100" y="100" width="312" height="312" fill="#2447e6"/></svg>').render().asPng();
}

function pngSize(png: Buffer): { width: number; height: number }
{
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

beforeAll(async () =>
{
  process.env.SERVER_DATABASE_URL = 'memory://';
  const root = mkdtempSync(join(tmpdir(), 'ay-social-'));
  process.env.SERVER_THUMBNAIL_PATH = join(root, 'thumbnails');
  process.env.SERVER_THUMBNAIL_LOG = join(root, 'thumbnails.log');
  process.env.SERVER_SPA_INDEX = join(root, 'index.html');
  process.env.FRONTEND_URL = FRONTEND;
  process.env.SERVER_API_BASE_URL = '/api';
  writeFileSync(process.env.SERVER_SPA_INDEX, SHELL);

  social = await import('../../src/services/SocialCard');
  config = (await import('../../src/config')).config;
});

describe('cardContent — what the link says', () =>
{
  it('shows the values the link sets, read the way the configurator reads them', () =>
  {
    const content = social.cardContent(house(), `width=5000&OPENINGS=${OPENINGS}&ROOF_TYPE=shed&OVERHANGS_SAME=0`);
    expect(content).toEqual({
      title: 'Ur house',
      description: 'A small house.',
      author: AUTHOR,
      chips: [
        { label: 'Width', value: '5000 mm' },
        { label: 'Roof Type', value: 'shed' },
        { label: 'Overhangs same', value: 'off' },
        { label: 'Openings', value: '2' },
      ],
    });
  });

  it('leaves out what the configurator would ignore', () =>
  {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Out of range, not an option, not a param, the locale, and a campaign tag.
    const content = social.cardContent(house(), 'WIDTH=99999&ROOF_TYPE=dome&COLOUR=red&lang=de&utm_source=x');
    expect(content.chips).toEqual([]);
    vi.restoreAllMocks();
  });

  it('speaks the language ?lang= asks for, and falls back to the author per string', () =>
  {
    const translated = house({
      published: {
        public: true, title: 'Ur house', description: 'A small house.',
        translations: {
          sourceLocale: 'en', sourceHash: 'x', generated: '2026-10-06',
          locales: { de: { title: 'Urhaus', 'params.WIDTH.label': 'Breite', 'params.ROOF_TYPE.options.shed': 'Pultdach' } },
        },
      },
    });
    const content = social.cardContent(translated, 'lang=de&WIDTH=5000&ROOF_TYPE=shed');
    expect(content.title).toBe('Urhaus');
    expect(content.description).toBe('A small house.');
    expect(content.chips).toEqual([{ label: 'Breite', value: '5000 mm' }, { label: 'Roof Type', value: 'Pultdach' }]);
  });

  it('falls back to the script name when the version has no title', () =>
  {
    expect(social.cardContent(house({ published: { public: true } }), '').title).toBe('house');
  });
});

describe('configuratorPage — the shell with tags', () =>
{
  const urls = { page: `${FRONTEND}/configurators/a/b:1`, image: `${FRONTEND}/api/cards/a/b:1.png` };

  it('writes the title and the social tags into <head>, and changes nothing else', () =>
  {
    const page = social.configuratorPage(SHELL, social.cardContent(house(), 'WIDTH=5000'), urls);
    expect(page).toContain('<title>Ur house · Archiyou</title>');
    expect(page).toContain('<meta property="og:title" content="Ur house" />');
    expect(page).toContain('<meta property="og:description" content="A small house. — Width 5000 mm" />');
    expect(page).toContain(`<meta property="og:image" content="${urls.image}" />`);
    expect(page).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(page.indexOf('og:image')).toBeLessThan(page.indexOf('</head>'));
    expect(page).toContain('<body><app-shell></app-shell></body>');
  });

  it('escapes what the script and the link put in it', () =>
  {
    const content = { title: '"><script>alert(1)</script> $& $1', description: 'a & b', author: AUTHOR, chips: [] };
    const page = social.configuratorPage(SHELL, content, { page: `${FRONTEND}/configurators/a/b?x="><b>`, image: urls.image });
    expect(page).not.toContain('<script>');
    expect(page).not.toContain('"><b>');
    expect(page).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; $&amp; $1 · Archiyou</title>');
    expect(page).toContain('content="a &amp; b"');
  });
});

describe('socialUrls', () =>
{
  it('makes absolute URLs that carry the link unchanged', () =>
  {
    const urls = social.socialUrls('/configurators/tester/house:1.0.0?WIDTH=5000&lang=de', AUTHOR, 'house:1.0.0');
    expect(urls.page).toBe(`${FRONTEND}/configurators/tester/house:1.0.0?WIDTH=5000&lang=de`);
    expect(urls.image).toBe(`${FRONTEND}/api/cards/tester/house:1.0.0.png?WIDTH=5000&lang=de`);
  });

  it('follows an absolute API base, as in development', () =>
  {
    const before = config.social.apiBaseUrl;
    config.social.apiBaseUrl = 'http://localhost:4100';
    expect(social.socialUrls('/configurators/tester/house', AUTHOR, 'house').image).toBe('http://localhost:4100/cards/tester/house.png');
    config.social.apiBaseUrl = before;
  });
});

describe('routes', () =>
{
  let app: FastifyInstance;

  beforeAll(async () =>
  {
    const { runMigrations } = await import('../../src/db/migrate');
    await runMigrations();
    const { scriptStore } = await import('../../src/services/ScriptStore');
    const { thumbnailStore } = await import('../../src/services/ThumbnailStore');
    const { registerLibraryRoutes } = await import('../../src/routes/library');

    // Two published versions: one with a stored thumbnail, one without.
    const { fileId } = await scriptStore.create(AUTHOR, { name: 'house', code: 'box(1);', params: PARAMS });
    const data = house();
    const v1 = await scriptStore.publish(AUTHOR, fileId as string, { ...data, version: '1.0.0' });
    await scriptStore.publish(AUTHOR, fileId as string, { ...data, version: '1.1.0' });
    const url = await thumbnailStore.write(AUTHOR, fileId as string, v1.id as string, picture(), 'test');
    expect(url, 'stored thumbnail').toBeTruthy();
    await scriptStore.setThumbnail(AUTHOR, v1.id as string, url);

    app = Fastify();
    // As plugin.ts does: the page route must opt out of it.
    await app.register(import('@fastify/helmet'), { contentSecurityPolicy: false });
    await app.register(registerLibraryRoutes);
    await app.ready();
  });

  afterAll(async () => app?.close());

  it('serves the configurator page with its tags', async () =>
  {
    const res = await app.inject({ method: 'GET', url: '/configurators/tester/house:1.0.0?WIDTH=5000' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['cross-origin-opener-policy']).toBeUndefined();
    expect(res.body).toContain('<meta property="og:title" content="Ur house" />');
    expect(res.body).toContain(`<meta property="og:image" content="${FRONTEND}/api/cards/tester/house:1.0.0.png?WIDTH=5000" />`);
  });

  it.each([
    ['an unknown configurator', '/configurators/tester/nothing:1.0.0'],
    ['an unknown author', '/configurators/nobody/house:1.0.0'],
    ['a path that is no configurator', '/configurators/tester'],
    ['a deeper path', '/configurators/tester/house:1.0.0/more'],
  ])('serves the shell unchanged for %s', async (_case, url) =>
  {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(SHELL);
  });

  it('answers 503 when there is no shell, so Caddy serves its own copy', async () =>
  {
    const before = config.social.spaIndexPath;
    config.social.spaIndexPath = join(tmpdir(), 'ay-social-no-such-shell.html');
    const res = await app.inject({ method: 'GET', url: '/configurators/tester/house:1.0.0' });
    config.social.spaIndexPath = before;
    expect(res.statusCode).toBe(503);
  });

  it('draws a 1200×630 card, the same bytes for the same link', async () =>
  {
    const url = `/cards/tester/house:1.0.0.png?WIDTH=5000&OPENINGS=${OPENINGS}`;
    const first = await app.inject({ method: 'GET', url });
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toBe('image/png');
    expect(first.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(pngSize(first.rawPayload)).toEqual({ width: 1200, height: 630 });

    const again = await app.inject({ method: 'GET', url });
    expect(again.rawPayload.equals(first.rawPayload)).toBe(true);

    const other = await app.inject({ method: 'GET', url: '/cards/tester/house:1.0.0.png?WIDTH=6000' });
    expect(other.rawPayload.equals(first.rawPayload)).toBe(false);
  });

  it('draws a card for a version without a thumbnail', async () =>
  {
    const res = await app.inject({ method: 'GET', url: '/cards/tester/house:1.1.0.png' });
    expect(res.statusCode).toBe(200);
    expect(pngSize(res.rawPayload)).toEqual({ width: 1200, height: 630 });
  });

  it('answers 404 for a card of nothing', async () =>
  {
    const res = await app.inject({ method: 'GET', url: '/cards/tester/nothing.png' });
    expect(res.statusCode).toBe(404);
  });
});
