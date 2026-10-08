/**
 *  Lookups that need no kernel, so they answer instantly: the API reference, the guide and
 *  tutorials, the example scripts. Progressive disclosure for the agent: the skill stays short
 *  and points here.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { DATA, out } from './common';

//// API ////

interface ApiParam { name: string; type?: string; optional?: boolean; default?: string; doc?: string }
interface ApiEntry
{
    id: string;
    name: string;
    owner?: string;
    kind: 'function' | 'method' | 'property' | 'class' | 'module';
    sig?: string;
    doc?: string;
    params?: Array<ApiParam>;
    examples?: Array<string>;
}

const MAX_MATCHES = 8;
const FULL_MATCHES = 3; // the best few in full, the rest one line each

function apiEntries(): Array<ApiEntry>
{
    return JSON.parse(readFileSync(DATA.api, 'utf8')).entries;
}

function firstSentence(doc: string = ''): string
{
    const line = doc.split('\n\n')[0].replace(/\s+/g, ' ').trim();
    const end = line.search(/\.\s|\.$/);
    return end > 0 ? line.slice(0, end + 1) : line;
}

function signature(e: ApiEntry): string
{
    return `${e.owner ? e.owner + '.' : ''}${e.name}${e.sig ?? ''}`;
}

function printFull(e: ApiEntry): void
{
    out(`${signature(e)}    [${e.kind}]`);
    if (e.doc) { e.doc.trim().split('\n').forEach(line => out(`  ${line}`)); }
    (e.params ?? []).forEach(p =>
        out(`  - ${p.name}${p.optional ? '?' : ''}${p.type ? ': ' + p.type : ''}${p.default ? ' = ' + p.default : ''}${p.doc ? '  ' + p.doc.replace(/\s+/g, ' ') : ''}`));
    const example = e.examples?.[0];
    if (example)
    {
        out('  example:');
        example.split('\n').forEach(line => out(`    ${line}`));
    }
}

/** `api <query>`: a class gives its members, one line each; anything else the best matches */
export function api(query: string | undefined): number
{
    if (!query)
    {
        out('usage: archiyou api <name>      e.g. archiyou api box, archiyou api Mesh.fillet, archiyou api Mesh');
        return 1;
    }
    const entries = apiEntries();
    const q = query.toLowerCase();

    const members = entries.filter(e => e.owner?.toLowerCase() === q);
    if (members.length > 0)
    {
        const cls = entries.find(e => e.kind === 'class' && e.name.toLowerCase() === q);
        out(`${members[0].owner}${cls?.doc ? ': ' + firstSentence(cls.doc) : ''}  (${members.length} members; archiyou api ${members[0].owner}.<name> for one)`);
        [...members].sort((a, b) => a.name.localeCompare(b.name)).forEach(m => out(`  ${m.name}${m.sig ?? ''}`));
        return 0;
    }

    const exact = entries.filter(e => e.id.toLowerCase() === q);
    const scored = (exact.length > 0 ? exact : entries)
        .map(e =>
        {
            const name = e.name.toLowerCase();
            const score = (e.id.toLowerCase() === q ? 200 : 0)
                + (name === q ? 100 + (e.kind === 'function' ? 20 : 0) : 0)
                + (name.startsWith(q) && name !== q ? 40 : 0)
                + (e.id.toLowerCase().includes(q) && !name.startsWith(q) ? 20 : 0)
                + ((e.doc ?? '').toLowerCase().includes(q) ? 5 : 0);
            return { e, score };
        })
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_MATCHES);

    if (scored.length === 0)
    {
        out(`no API entry matches "${query}". Try a shorter name, or archiyou docs for the guide.`);
        return 1;
    }
    scored.forEach((s, i) =>
    {
        if (i < FULL_MATCHES)
        {
            if (i > 0) { out(); }
            printFull(s.e);
        }
        else
        {
            if (i === FULL_MATCHES) { out(); out('also:'); }
            out(`  ${signature(s.e)}  ${firstSentence(s.e.doc)}`);
        }
    });
    return 0;
}

//// DOCS ////

interface Page { topic: string; title: string; file: string }

function pages(): Array<Page>
{
    const roots: Array<[string, string]> = [['', DATA.guide], ['tutorial/', DATA.tutorials]];
    return roots
        .filter(([, dir]) => existsSync(dir))
        .flatMap(([prefix, dir]) => (readdirSync(dir, { recursive: true }) as Array<string>)
            .filter(f => f.endsWith('.md'))
            .sort()
            .map(f =>
            {
                const text = readFileSync(join(dir, f), 'utf8');
                const title = text.match(/^title:\s*"?([^"\n]+)"?\s*$/m)?.[1] ?? text.match(/^#\s+(.+)$/m)?.[1] ?? f;
                return { topic: prefix + f.replace(/\.md$/, '').replace(/\\/g, '/'), title, file: join(dir, f) };
            }));
}

/** `docs [topic]`: the list of pages, or one page as Markdown without its images */
export function docs(query: string | undefined): number
{
    const all = pages();
    if (!query)
    {
        out('archiyou docs <topic>:');
        all.forEach(p => out(`  ${p.topic.padEnd(36)} ${p.title}`));
        return 0;
    }
    const q = query.toLowerCase();
    const matches = all.filter(p => p.topic.toLowerCase() === q)
        .concat(all.filter(p => basename(p.topic).toLowerCase() === q))
        .concat(all.filter(p => p.topic.toLowerCase().includes(q) || p.title.toLowerCase().includes(q)));
    const unique = [...new Map(matches.map(p => [p.topic, p])).values()];
    if (unique.length === 0)
    {
        out(`no page matches "${query}". archiyou docs lists them all.`);
        return 1;
    }
    const exact = unique.find(p => p.topic.toLowerCase() === q || basename(p.topic).toLowerCase() === q);
    if (!exact && unique.length > 1)
    {
        out(`"${query}" matches ${unique.length} pages:`);
        unique.forEach(p => out(`  ${p.topic.padEnd(36)} ${p.title}`));
        return 0;
    }
    const page = exact ?? unique[0];
    const text = readFileSync(page.file, 'utf8')
        .replace(/^---\n[\s\S]*?\n---\n/, '')          // frontmatter
        .replace(/!\[[^\]]*\]\([^)]*\)\s*\n?/g, '')     // images: the agent reads text
        .replace(/\n{3,}/g, '\n\n');
    out(`# ${page.title}  (${page.topic})`);
    out(text.trim());
    return 0;
}

//// EXAMPLES ////

/** `examples [name]`: the list of example scripts, or one script */
export function examples(name: string | undefined): number
{
    const files = readdirSync(DATA.examples).filter(f => f.endsWith('.js')).sort();
    if (!name)
    {
        out('archiyou examples <name>:');
        files.forEach(f =>
        {
            const description = readFileSync(join(DATA.examples, f), 'utf8').split('\n')[1]?.replace(/^\/\/\s*/, '') ?? '';
            out(`  ${f.replace(/\.js$/, '').padEnd(22)} ${description}`);
        });
        return 0;
    }
    const file = files.find(f => f === name || f === `${name}.js`) ?? files.find(f => f.includes(name));
    if (!file)
    {
        out(`no example "${name}". archiyou examples lists them.`);
        return 1;
    }
    out(readFileSync(join(DATA.examples, file), 'utf8').trimEnd());
    return 0;
}

//// SUGGESTIONS ////

function distance(a: string, b: string): number
{
    const row0 = Array.from({ length: b.length + 1 }, (_, j) => j);
    return [...a].reduce((prev, ca, i) =>
        [...b].reduce((row, cb, j) => [...row, Math.min(row[j] + 1, prev[j + 1] + 1, prev[j] + (ca === cb ? 0 : 1))], [i + 1]),
    row0)[b.length];
}

/** API entries close to a mistyped name, for "x is not a function" errors: with their owner
 *  (Curve.fillet), since a close name on another class is not a fix by itself */
export function suggestNames(name: string): Array<string>
{
    const n = name.toLowerCase();
    return apiEntries()
        .filter(e => e.kind === 'function' || e.kind === 'method')
        .map(e => ({ id: e.id, d: distance(n, e.name.toLowerCase()) }))
        .filter(s => s.d > 0 && s.d <= Math.max(1, Math.floor(n.length / 4)))
        .sort((a, b) => a.d - b.d || a.id.localeCompare(b.id))
        .slice(0, 3)
        .map(s => s.id);
}
