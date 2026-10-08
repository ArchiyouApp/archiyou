/**
 *  Shared by the commands: output, muting core, data paths, arguments.
 *
 *  stdout belongs to the agent reading it: only results go there. Core logs a lot, and through
 *  more than one console (the Runner swaps globalThis.console), so while core runs both streams
 *  are muted at the stream itself, or with --verbose sent to stderr.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

//// OUTPUT ////

const stdoutWrite = process.stdout.write.bind(process.stdout);
const stderrWrite = process.stderr.write.bind(process.stderr);

/** One line on stdout */
export function out(line: string = ''): void
{
    stdoutWrite(line + '\n');
}

/** One line on stderr: problems with the command itself, not results */
export function fail(line: string): void
{
    stderrWrite(line + '\n');
}

/** Run fn with core's output muted (or, verbose, sent to stderr) */
export async function quiet<T>(verbose: boolean, fn: () => T | Promise<T>): Promise<T>
{
    const sink = verbose ? stderrWrite : (() => true);
    process.stdout.write = sink as typeof process.stdout.write;
    process.stderr.write = sink as typeof process.stderr.write;
    try
    {
        return await fn();
    }
    finally
    {
        process.stdout.write = stdoutWrite as typeof process.stdout.write;
        process.stderr.write = stderrWrite as typeof process.stderr.write;
    }
}

/** Fixed-width columns for the text tables */
export function columns(rows: Array<Array<string>>): Array<string>
{
    const widths = rows.reduce((w, row) => row.map((cell, i) => Math.max(w[i] ?? 0, cell.length)), [] as Array<number>);
    return rows.map(row => row.map((cell, i) => (i === row.length - 1) ? cell : cell.padEnd(widths[i])).join('  ').trimEnd());
}

export function round(n: number, digits: number = 0): string
{
    const f = Math.pow(10, digits);
    return String(Math.round(n * f) / f);
}

//// PATHS ////

/** Where the user ran the command: pnpm --filter changes cwd, INIT_CWD keeps the original */
export const BASE_DIR = process.env.INIT_CWD ?? process.cwd();

export function userPath(p: string): string
{
    return resolve(BASE_DIR, p);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILT = join(HERE, 'data');

/** The API reference, guide, examples, skill and font. Built: copied into dist/data by tsup.
 *  From source: read where they live in the repo. */
export const DATA = existsSync(BUILT)
    ? {
        api: join(BUILT, 'api.json'),
        guide: join(BUILT, 'guide'),
        tutorials: join(BUILT, 'tutorials'),
        examples: join(BUILT, 'examples'),
        skill: join(BUILT, 'skill', 'SKILL.md'),
        font: join(BUILT, 'fonts', 'PlusJakartaSans-Regular.ttf'),
        evals: null as string | null,
    }
    : {
        api: join(HERE, '../../ui/src/editor/help/api.generated.json'),
        guide: join(HERE, '../../../help/guide/en'),
        tutorials: join(HERE, '../../../help/tutorials/en'),
        examples: join(HERE, '../../core/tests/cadscripts/scripts'),
        skill: join(HERE, '../skill/SKILL.md'),
        font: join(HERE, '../assets/PlusJakartaSans-Regular.ttf'),
        evals: join(HERE, '../evals/evals.json') as string | null,
    };

//// ARGUMENTS ////

/** Flags that take no value */
const BOOLEAN_FLAGS = new Set(['json', 'verbose', 'clash', 'corners', 'force', 'parts', 'help', 'version']);
const ALIASES: Record<string, string> = { p: 'param', h: 'help', v: 'version' };

export interface Args
{
    positional: Array<string>;
    /** Every flag with a value, repeatable: --ref a --ref b */
    values: Record<string, Array<string>>;
    bools: Set<string>;
}

/** Hand-parsed like the repo's other scripts: --flag value, --flag=value, -p NAME=value */
export function parseArgs(argv: Array<string>): Args
{
    const init: Args & { pending: string | null } = { positional: [], values: {}, bools: new Set(), pending: null };
    const parsed = argv.reduce((acc, arg) =>
    {
        if (acc.pending)
        {
            (acc.values[acc.pending] ??= []).push(arg);
            acc.pending = null;
            return acc;
        }
        const flag = arg.match(/^--?([a-zA-Z][\w-]*)(?:=(.*))?$/);
        if (!flag)
        {
            acc.positional.push(arg);
            return acc;
        }
        const name = ALIASES[flag[1]] ?? flag[1];
        if (BOOLEAN_FLAGS.has(name))
        {
            acc.bools.add(name);
        }
        else if (flag[2] !== undefined)
        {
            (acc.values[name] ??= []).push(flag[2]);
        }
        else
        {
            acc.pending = name;
        }
        return acc;
    }, init);
    if (parsed.pending) { throw new Error(`--${parsed.pending} needs a value`); }
    return { positional: parsed.positional, values: parsed.values, bools: parsed.bools };
}

/** -p NAME=value pairs, values parsed as JSON when they are JSON (numbers, booleans, lists) */
export function paramValues(pairs: Array<string> = []): Record<string, any>
{
    return Object.fromEntries(pairs.map(pair =>
    {
        const at = pair.indexOf('=');
        if (at < 1) { throw new Error(`-p takes NAME=value, got "${pair}"`); }
        const raw = pair.slice(at + 1);
        const value = (() => { try { return JSON.parse(raw); } catch { return raw; } })();
        return [pair.slice(0, at), value];
    }));
}
