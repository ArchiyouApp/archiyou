#!/usr/bin/env node
// Commit generated code with an AI disclosure block, as NLnet's GenAI policy asks
// (https://nlnet.nl/foundation/policies/generativeAI/). The human writes the summary;
// the model, prompt and record fields are filled in and the whole message is shown
// before anything is committed. See documentation/nlnet/ai/README.md.
//
//   pnpm commit:ai                      interactive: pick a record, type the summary, approve
//   pnpm commit:ai -- --dry-run ...     print the message only (used by agents to show it first)
//   pnpm commit:ai -- --yes ...         commit without the y/N question (after the user approved)
//
// Flags: --record <path> --summary <line> --body <text> | --body-file <path>
//        --prompt <text> --review <text> --dry-run --yes --help

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const RECORDS_DIR = 'documentation/nlnet/ai/records';
const FORBIDDEN = [/claude\.ai/i, /https?:\/\//i, /co-authored-by/i];
const SUBJECT_MAX = 72;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function fail(message)
{
    console.error(`ai-commit: ${message}`);
    process.exit(1);
}

function parseArgs(argv)
{
    const out = {};
    for (let i = 0; i < argv.length; i++)
    {
        const arg = argv[i];
        if (arg === '--') continue; // pnpm passes its separator through
        if (!arg.startsWith('--')) fail(`unexpected argument "${arg}"`);
        const key = arg.slice(2);
        if (key === 'dry-run' || key === 'yes' || key === 'help') { out[key] = true; continue; }
        const value = argv[++i];
        if (value === undefined) fail(`--${key} needs a value`);
        out[key] = value;
    }
    return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help)
{
    console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 12).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(0);
}

process.chdir(git('rev-parse', '--show-toplevel'));

const interactive = stdin.isTTY && stdout.isTTY;
const rl = interactive ? createInterface({ input: stdin, output: stdout }) : null;
const ask = async (question) =>
{
    if (!rl) fail(`missing value; pass it as a flag or run in a terminal (${question.trim()})`);
    return (await rl.question(question)).trim();
};

// 1. The record this commit belongs to
let record = args.record;
if (!record)
{
    const records = existsSync(RECORDS_DIR)
        ? readdirSync(RECORDS_DIR).filter(f => f.endsWith('.md')).sort().reverse()
        : [];
    if (records.length === 0) fail(`no records in ${RECORDS_DIR}; write one first (see documentation/nlnet/ai/README.md)`);
    if (!rl) fail(`--record is required; candidates: ${records.join(', ')}`);
    records.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    const pick = Number(await ask('Record [1]: ') || '1');
    if (!(pick >= 1 && pick <= records.length)) fail('no such record');
    record = join(RECORDS_DIR, records[pick - 1]);
}
if (!existsSync(record)) fail(`record not found: ${record}`);
record = relative(process.cwd(), record);

const modelRow = readFileSync(record, 'utf8').match(/^\|\s*Model\s*\|\s*(.+?)\s*\|\s*$/m);
if (!modelRow) fail(`${record} has no "| Model | ... |" row`);
const model = modelRow[1];
const product = model.split(/\s*[(,]/)[0].trim();

// 2. The human's summary
const summary = args.summary ?? await ask('Summary (one line): ');
if (!summary) fail('a summary is required');
if (summary.length > SUBJECT_MAX) fail(`summary is ${summary.length} chars, keep it under ${SUBJECT_MAX}`);

let body = args['body-file'] ? readFileSync(args['body-file'], 'utf8') : args.body;
if (body === undefined && rl)
{
    console.log('Description (optional, end with an empty line):');
    const lines = [];
    for (;;)
    {
        const line = await ask('');
        if (line === '') break;
        lines.push(line);
    }
    body = lines.join('\n');
}
body = (body ?? '').trim();

// 3. Disclosure fields
const prompt = args.prompt ?? await ask('Prompt that led to this commit: ');
if (!prompt) fail('the prompt is required');
const review = (args.review ?? (rl ? await ask('Review by the human [reviewed by the author]: ') : '')) || 'reviewed by the author';

// 4. Assemble
const author = `${git('config', 'user.name')} with ${product} <${git('config', 'user.email')}>`;
const message = [
    summary,
    '',
    ...(body ? [body, ''] : []),
    `Model: ${model}`,
    `Prompt: "${prompt.replace(/\s+/g, ' ')}"`,
    `Record: ${record}`,
    'Output: (this commit)',
    `Review: ${review}`,
    '',
].join('\n');

// 5. Validate
for (const pattern of FORBIDDEN)
{
    if (pattern.test(message) || pattern.test(author)) fail(`message must not contain ${pattern} (no links, no co-author trailers)`);
}
if (!args['dry-run'])
{
    try { git('diff', '--cached', '--quiet'); fail('nothing staged; git add the files first'); }
    catch (e) { if (e.status !== 1) throw e; }
}

// 6. Show, approve, commit
console.log(`\nAuthor: ${author}\n\n${message}`);
if (args['dry-run']) { rl?.close(); process.exit(0); }

if (!args.yes)
{
    const answer = await ask('Commit? [y/N] ');
    if (answer.toLowerCase() !== 'y') { console.log('not committed'); rl?.close(); process.exit(0); }
}
rl?.close();

const file = join(mkdtempSync(join(tmpdir(), 'ai-commit-')), 'message.txt');
writeFileSync(file, message);
git('commit', `--author=${author}`, '-F', file);
console.log(git('log', '-1', '--format=%h %s'));
