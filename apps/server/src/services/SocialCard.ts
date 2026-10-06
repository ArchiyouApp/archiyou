/**
 * SocialCard.ts — what a link crawler sees for a published configurator.
 *
 * Slack, LinkedIn, WhatsApp, X and the rest read a page's Open Graph tags without running
 * any JavaScript, so a configurator link pasted anywhere used to show the bare SPA shell:
 * "Archiyou", no picture. Two things fix that, both served by the API (Caddy sends
 * /configurators/* here, see the Caddyfile; routes in routes/library.ts):
 *
 *   the page   the SPA shell with a title, a description and og:/twitter: tags written
 *              into <head> (configuratorPage). Nothing else about it changes, so the
 *              configurator loads exactly as it did from the static file.
 *   the card   a 1200×630 PNG (renderCard): the version's stored thumbnail beside its
 *              title, author, description and the values the link sets ("Width 5000 mm").
 *
 * The picture is the model at its DEFAULTS: the thumbnail the editor rendered when the
 * version was published. The server runs no script for a card; the chips are what make it
 * the configuration the link holds. Drawing the link's own model, for admin-validated
 * versions, is the next step (plans/SOCIAL_CARDS.md).
 *
 * The link is read with core's decodeParamValues, the function the page itself uses, so a
 * card never shows a value the configurator would ignore.
 *
 * Cards are cached in memory by content. Crawlers fetch an image once and keep their own
 * copy, so a small LRU is plenty, and no supply of param combinations can fill a disk.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { Resvg, type ResvgRenderOptions } from '@resvg/resvg-js';

import type { ScriptData } from '@archiyou/core/src/execution/types';
import { Script } from '@archiyou/core/src/Script';
import { decodeParamValues, type ScriptParam } from '@archiyou/core/src/execution/ScriptParam';
import { makeTranslator, type TranslatorFn } from '@archiyou/core/src/i18n/resolve';
import { TITLE_KEY, DESCRIPTION_KEY, paramLabelKey, paramOptionKey } from '@archiyou/core/src/i18n/keys';

import { config } from '../config';
import { thumbnailStore } from './ThumbnailStore';

/** The size every platform agrees on for a large preview (1.91:1). */
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const CACHE_SIZE = 64;
const DESCRIPTION_MAX_CHARS = 300;

//// CONTENT ////

/** One value the link sets, as the card shows it: "Width" + "5000 mm". */
export interface CardChip
{
  label: string;
  value: string;
}

/** What the page's tags and the card say about one version, opened from one link. */
export interface CardContent
{
  title: string;
  description: string;
  author: string;
  chips: Array<CardChip>;
}

/**
 * Title, description and chips for a published version and a query string, in the
 * language `?lang=` asks for, falling back per string to what the author wrote, the way
 * the configurator header does. A chip for every param the link sets: the link only holds
 * values a visitor changed, so they were visible to them, even when the param is hidden
 * by default and a behaviour showed it.
 */
export function cardContent(data: ScriptData, search: string): CardContent
{
  const t = makeTranslator(data, new URLSearchParams(search).get('lang') ?? '');
  const script = Script.fromData(data);
  const params = script ? Object.values(script.params).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [];
  const values = decodeParamValues(search, params);

  return {
    title: t(TITLE_KEY, data.published?.title || data.name || 'Untitled'),
    description: t(DESCRIPTION_KEY, data.published?.description ?? data.description ?? '').trim(),
    author: data.author ?? '',
    chips: params
      .filter(p => p.name in values)
      .map(p => ({ label: t(paramLabelKey(p.name), p.label || p.name), value: chipValue(p, values[p.name], t) })),
  };
}

function chipValue(param: ScriptParam, value: any, t: TranslatorFn): string
{
  switch (param.type)
  {
    case 'number':
      return [formatNumber(value), param.units].filter(Boolean).join(' ');
    case 'number-ranges':
      return (value as Array<number>).map(formatNumber).join(', ');
    case 'boolean':
      return value ? 'on' : 'off';
    case 'options':
      return t(paramOptionKey(param.name, value), String(value));
    case 'list':
      return String((value as Array<unknown>).length);
    case 'object':
      return ''; // nothing short to say about it: the label alone says it was set
    default:
      return String(value);
  }
}

function formatNumber(n: number): string
{
  return String(Math.round(n * 100) / 100);
}

//// PAGE ////

/** The built SPA shell, or null when there is none (the editor is not built yet). */
export async function readShell(): Promise<string | null>
{
  try
  {
    return await readFile(config.social.spaIndexPath, 'utf8');
  }
  catch
  {
    return null;
  }
}

/** Absolute URLs, as crawlers need: the page as it was requested, and its card. Both
 *  carry the request's query unchanged, so the card reads the same link the page does. */
export function socialUrls(requestUrl: string, user: string, scriptAndVersion: string): { page: string; image: string }
{
  const frontend = config.frontendUrl.replace(/\/+$/, '');
  const api = new URL(config.social.apiBaseUrl, `${frontend}/`).href.replace(/\/+$/, '');
  const query = requestUrl.includes('?') ? requestUrl.slice(requestUrl.indexOf('?')) : '';
  // ':' between name and version stays literal, as in the configurator URL itself
  const file = encodeURIComponent(scriptAndVersion).replace(/%3A/gi, ':');
  return {
    page: `${frontend}${requestUrl}`,
    image: `${api}/cards/${encodeURIComponent(user)}/${file}.png${query}`,
  };
}

/** The shell with this configurator's title and social tags written into <head>. */
export function configuratorPage(shell: string, content: CardContent, urls: { page: string; image: string }): string
{
  const description = describe(content);
  const tags = [
    ['name', 'description', description],
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'Archiyou'],
    ['property', 'og:title', content.title],
    ['property', 'og:description', description],
    ['property', 'og:url', urls.page],
    ['property', 'og:image', urls.image],
    ['property', 'og:image:type', 'image/png'],
    ['property', 'og:image:width', String(CARD_WIDTH)],
    ['property', 'og:image:height', String(CARD_HEIGHT)],
    ['property', 'og:image:alt', content.author ? `${content.title} by ${content.author}` : content.title],
    ['name', 'twitter:card', 'summary_large_image'],
  ]
    .map(([attribute, key, value]) => `    <meta ${attribute}="${key}" content="${escapeXml(value)}" />`)
    .join('\n');

  // Replacer functions, not strings: a title may well contain `$&`.
  return shell
    .replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeXml(content.title)} · Archiyou</title>`)
    .replace(/<\/head>/i, () => `${tags}\n  </head>`);
}

/** The description crawlers show: the author's own words, then what the link sets. */
function describe(content: CardContent): string
{
  const chips = content.chips.map(c => [c.label, c.value].filter(Boolean).join(' ')).join(' · ');
  const text = [content.description, chips].filter(Boolean).join(' — ')
    || (content.author ? `A configurable design by ${content.author}` : 'A configurable design');
  return (text.length > DESCRIPTION_MAX_CHARS) ? `${text.slice(0, DESCRIPTION_MAX_CHARS - 1).trimEnd()}…` : text;
}

function escapeXml(text: string): string
{
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

//// CARD ////

const FONT_DIR = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));
/** The brand logo, from the editor's own public assets (the api container mounts the whole
 *  checkout). A card without it is still a card. */
const LOGO_PATH = fileURLToPath(new URL('../../../editor/public/img/archiyou_logo_header.png', import.meta.url));

/** resvg loads no system fonts (the container has none): only the two families the app
 *  itself uses, as static TTFs — resvg reads no WOFF. Glyphs outside them stay blank. */
const RESVG: ResvgRenderOptions = {
  font: {
    fontFiles: ['Outfit-SemiBold.ttf', 'PlusJakartaSans-Regular.ttf', 'PlusJakartaSans-SemiBold.ttf'].map(f => `${FONT_DIR}${f}`),
    loadSystemFonts: false,
    defaultFontFamily: 'Plus Jakarta Sans',
  },
};

/** The app's design tokens (apps/editor/src/styles/design-tokens.ts) as plain values: this
 *  is a picture, not a page, so there is nothing for a CSS variable to resolve against. */
const COLORS = {
  background: '#ffffff',
  picture: '#f1f5f9', // the viewer's background, so the drawing sits as it does in the app
  title: '#180c2d',   // colorSecondary
  text: '#414651',    // colorText
  muted: '#6c7285',   // colorTextGray
  chip: '#eef1fe',    // colorPrimarySubtle
  chipValue: '#1b35b0', // colorPrimaryDark
};

interface TextStyle
{
  family: string;
  weight: number;
  size: number;
  color: string;
}

const TITLE: TextStyle = { family: 'Outfit', weight: 600, size: 56, color: COLORS.title };
const TITLE_WIDE: TextStyle = { ...TITLE, size: 64 };
const AUTHOR: TextStyle = { family: 'Plus Jakarta Sans', weight: 400, size: 24, color: COLORS.muted };
const BODY: TextStyle = { family: 'Plus Jakarta Sans', weight: 400, size: 26, color: COLORS.text };
const CHIP_LABEL: TextStyle = { family: 'Plus Jakarta Sans', weight: 400, size: 21, color: COLORS.muted };
const CHIP_VALUE: TextStyle = { ...CHIP_LABEL, weight: 600, color: COLORS.chipValue };
const FOOTER: TextStyle = { family: 'Plus Jakarta Sans', weight: 600, size: 21, color: COLORS.muted };

const MARGIN = 56;
const PICTURE_PANEL = 580;
const PICTURE_SIZE = 512;
const LOGO_HEIGHT = 36;
const CHIP_HEIGHT = 44;
const CHIP_PADDING = 16;
const CHIP_GAP = 10;
const CHIP_ROWS = 2;
const CHIP_TEXT_MAX = 40;

const cache = new Map<string, Buffer>();
let logo: Promise<Buffer | null> | null = null;

/** The card PNG for this content, from the cache when the same card was drawn before. */
export async function renderCard(data: ScriptData, content: CardContent): Promise<Buffer>
{
  const key = createHash('sha256').update(JSON.stringify([data.thumbnail ?? null, content])).digest('hex');
  const hit = cache.get(key);
  if (hit)
  {
    cache.delete(key); // re-insert: Map order is the LRU order
    cache.set(key, hit);
    return hit;
  }

  logo ??= readFile(LOGO_PATH).catch(() => null);
  const [picture, logoPng] = await Promise.all([thumbnailStore.read(data.thumbnail), logo]);
  const png = new Resvg(cardSvg(content, picture, logoPng), RESVG).render().asPng();

  cache.set(key, png);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  return png;
}

/**
 * The card as SVG. Left the picture on the viewer's background; right, top to bottom, the
 * logo, the title block (title, author, description) centred in the space that is left, the
 * chips, and the site's host. Without a picture the text takes the whole width.
 *
 * resvg lays text out but does not wrap it, so lines are broken here, measured with resvg
 * itself (textWidth).
 */
function cardSvg(content: CardContent, picture: { bytes: Buffer; type: string } | null, logoPng: Buffer | null): string
{
  const x = picture ? PICTURE_PANEL + 60 : 80;
  const width = CARD_WIDTH - x - (picture ? 60 : 80);
  const titleStyle = picture ? TITLE : TITLE_WIDE;

  const footerBaseline = CARD_HEIGHT - MARGIN;
  const chips = layoutChips(content.chips, x, width, footerBaseline - FOOTER.size - 28);
  const regionTop = MARGIN + LOGO_HEIGHT + 40;
  const regionBottom = (chips.top ?? footerBaseline - FOOTER.size) - 36;

  const titleLines = wrapText(content.title, titleStyle, width, picture ? 3 : 2);
  const titleHeight = titleLines.length * lineHeight(titleStyle);
  const authorHeight = content.author ? 12 + lineHeight(AUTHOR) : 0;
  const descriptionRoom = Math.floor((regionBottom - regionTop - titleHeight - authorHeight - 24) / lineHeight(BODY));
  const descriptionLines = (content.description && descriptionRoom > 0)
    ? wrapText(content.description, BODY, width, Math.min(3, descriptionRoom))
    : [];
  const descriptionHeight = descriptionLines.length ? 24 + descriptionLines.length * lineHeight(BODY) : 0;

  const blockTop = regionTop + Math.max(0, (regionBottom - regionTop - titleHeight - authorHeight - descriptionHeight) / 2);
  const authorTop = blockTop + titleHeight + 12;
  const descriptionTop = blockTop + titleHeight + authorHeight + 24;

  const parts = [
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${COLORS.background}"/>`,
    picture ? `<rect width="${PICTURE_PANEL}" height="${CARD_HEIGHT}" fill="${COLORS.picture}"/>` : '',
    picture ? image(picture.bytes, picture.type, (PICTURE_PANEL - PICTURE_SIZE) / 2, (CARD_HEIGHT - PICTURE_SIZE) / 2, PICTURE_SIZE, PICTURE_SIZE) : '',
    logoPng ? image(logoPng, 'image/png', x, MARGIN, LOGO_HEIGHT * 5, LOGO_HEIGHT) : '',
    ...titleLines.map((line, i) => textNode([[line, titleStyle]], x, blockTop + i * lineHeight(titleStyle) + baseline(titleStyle))),
    content.author ? textNode([[`by ${content.author}`, AUTHOR]], x, authorTop + baseline(AUTHOR)) : '',
    ...descriptionLines.map((line, i) => textNode([[line, BODY]], x, descriptionTop + i * lineHeight(BODY) + baseline(BODY))),
    ...chips.placed.map(chipNode),
    textNode([[new URL(config.frontendUrl).host, FOOTER]], x, footerBaseline),
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">${parts.join('')}</svg>`;
}

function lineHeight(style: TextStyle): number
{
  return Math.round(style.size * 1.18);
}

/** From the top of a line to its baseline. */
function baseline(style: TextStyle): number
{
  return Math.round(style.size * 0.9);
}

function image(bytes: Buffer, type: string, x: number, y: number, width: number, height: number): string
{
  return `<image href="data:${type};base64,${bytes.toString('base64')}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>`;
}

/** One <text> of styled runs, so a chip's label and value can differ in weight and colour. */
function textNode(runs: Array<[string, TextStyle]>, x: number, y: number): string
{
  const spans = runs
    .map(([text, s]) => `<tspan font-family="${s.family}" font-weight="${s.weight}" font-size="${s.size}" fill="${s.color}">${escapeXml(text)}</tspan>`)
    .join('');
  return `<text x="${x}" y="${y}" xml:space="preserve">${spans}</text>`;
}

/** How wide these runs are once drawn: resvg lays them out and reports the bounding box. */
function textWidth(runs: Array<[string, TextStyle]>): number
{
  if (runs.every(([text]) => text.trim() === '')) return 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="200">${textNode(runs, 0, 120)}</svg>`;
  const box = new Resvg(svg, RESVG).getBBox();
  return box ? box.x + box.width : 0;
}

/**
 * Break `text` into at most `maxLines` lines no wider than `width`; when it does not fit,
 * the last line ends in an ellipsis. A word wider than a line is cut where it overflows.
 */
function wrapText(text: string, style: TextStyle, width: number, maxLines: number): Array<string>
{
  const fits = (line: string) => textWidth([[line, style]]) <= width;
  const cut = (word: string): Array<string> => fits(word)
    ? [word]
    : Array.from(word).reduce<Array<string>>((lines, char) =>
    {
      const last = lines[lines.length - 1];
      return (last !== undefined && fits(last + char)) ? [...lines.slice(0, -1), last + char] : [...lines, char];
    }, []);

  const lines = text.split(/\s+/).filter(Boolean).reduce<Array<string>>((acc, word) =>
  {
    if (acc.length > maxLines) return acc; // already too long: stop measuring
    const last = acc[acc.length - 1];
    return (last !== undefined && fits(`${last} ${word}`)) ? [...acc.slice(0, -1), `${last} ${word}`] : [...acc, ...cut(word)];
  }, []);

  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines - 1), ellipsize(lines[maxLines - 1], fits)];
}

/** The longest start of `line` that fits with an ellipsis after it. */
function ellipsize(line: string, fits: (line: string) => boolean): string
{
  const chars = Array.from(line);
  const keep = chars.map((_, i) => chars.length - i).find(n => fits(`${chars.slice(0, n).join('').trimEnd()}…`)) ?? 0;
  return `${chars.slice(0, keep).join('').trimEnd()}…`;
}

interface PlacedChip
{
  label: string;
  value: string;
  x: number;
  y: number;
  width: number;
}

/**
 * Chips flowed into at most CHIP_ROWS rows above `bottom`. What does not fit becomes a
 * "+N more" chip at the end. `top` is where the first row starts (undefined: no chips).
 */
function layoutChips(chips: Array<CardChip>, x: number, width: number, bottom: number): { placed: Array<PlacedChip>; top?: number }
{
  const sized = chips.map(chip => sizeChip(clip(chip.label), clip(chip.value), width));
  const rows = flow(sized, width);
  if (rows.length === 0) return { placed: [] };

  const kept = rows.slice(0, CHIP_ROWS);
  const shown = kept.flat().length;
  if (shown < sized.length)
  {
    // Make room for "+N more" in the last row, dropping chips from its end until it fits.
    const last = kept[kept.length - 1];
    const fitting = last.map((_, i) => last.length - i).find((n) =>
    {
      const more = sizeChip(`+${sized.length - shown + (last.length - n)} more`, '', width);
      return rowWidth([...last.slice(0, n), more]) <= width;
    }) ?? 0;
    kept[kept.length - 1] = [...last.slice(0, fitting), sizeChip(`+${sized.length - shown + (last.length - fitting)} more`, '', width)];
  }

  const top = bottom - kept.length * CHIP_HEIGHT - (kept.length - 1) * CHIP_GAP;
  const placed = kept.flatMap((row, r) => row.reduce<Array<PlacedChip>>((acc, chip) =>
  {
    const previous = acc[acc.length - 1];
    const left = previous ? previous.x + previous.width + CHIP_GAP : x;
    return [...acc, { ...chip, x: left, y: top + r * (CHIP_HEIGHT + CHIP_GAP) }];
  }, []));

  return { placed, top };
}

function clip(text: string): string
{
  const chars = Array.from(text);
  return (chars.length > CHIP_TEXT_MAX) ? `${chars.slice(0, CHIP_TEXT_MAX - 1).join('').trimEnd()}…` : text;
}

/** A chip's width: its label and value as drawn, plus padding, never wider than a row. */
function sizeChip(label: string, value: string, maxWidth: number): { label: string; value: string; width: number }
{
  const width = Math.ceil(textWidth(chipRuns(label, value))) + 2 * CHIP_PADDING;
  if (width <= maxWidth) return { label, value, width };
  // Too wide for a whole row: keep the label, shorten the value (or the label, if alone).
  const room = (line: string) => textWidth(value ? chipRuns(label, line) : chipRuns(line, '')) + 2 * CHIP_PADDING <= maxWidth;
  return value
    ? { label, value: ellipsize(value, room), width: maxWidth }
    : { label: ellipsize(label, room), value, width: maxWidth };
}

function chipRuns(label: string, value: string): Array<[string, TextStyle]>
{
  return value ? [[`${label} `, CHIP_LABEL], [value, CHIP_VALUE]] : [[label, CHIP_LABEL]];
}

function flow<T extends { width: number }>(chips: Array<T>, width: number): Array<Array<T>>
{
  return chips.reduce<Array<Array<T>>>((rows, chip) =>
  {
    const last = rows[rows.length - 1];
    return (last && rowWidth([...last, chip]) <= width) ? [...rows.slice(0, -1), [...last, chip]] : [...rows, [chip]];
  }, []);
}

function rowWidth(chips: Array<{ width: number }>): number
{
  return chips.reduce((sum, chip) => sum + chip.width, 0) + Math.max(0, chips.length - 1) * CHIP_GAP;
}

function chipNode(chip: PlacedChip): string
{
  const textY = chip.y + Math.round(CHIP_HEIGHT / 2 + CHIP_LABEL.size * 0.36);
  return `<rect x="${chip.x}" y="${chip.y}" width="${chip.width}" height="${CHIP_HEIGHT}" rx="10" fill="${COLORS.chip}"/>`
    + textNode(chipRuns(chip.label, chip.value), chip.x + CHIP_PADDING, textY);
}
