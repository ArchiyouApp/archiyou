/**
 *  archiyou: run, check and look up Archiyou CAD scripts from the command line.
 *
 *  The harness a coding agent needs to model with Archiyou: run a script headless, read a
 *  compact summary, look at line views and photo overlays, check clashes and an inventory,
 *  sweep the parameters, and look up the API and guide. `init` puts the skill in a project.
 *
 *  Results on stdout, problems with the command on stderr, exit code 1 when a script fails.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Args, BASE_DIR, DATA, fail, out, parseArgs } from './common';
import { api, docs, examples } from './lookup';

const USAGE = `archiyou <command>

  init                      put the Archiyou skill in this project (.agents/ and .claude/, AGENTS.md)
  run <file.js>             run a script: summary on stdout, model.glb and views.png in --out
      -p NAME=value           a parameter value (repeatable)
      --views iso,front,cam:x,y,z   the sheet's views (default iso,front,right,top; none for no views;
                              around: eight directions, to find the one that matches a photo)
      --ref <photo>           a photo on the sheet (repeatable; PNG, JPEG)
      --overlay <photo>@<view>@x0,y0,x1,y1   the model drawn over a photo, fitted into the
                              object's rectangle in it (fractions or pixels; repeatable)
      --expect WxDxH          the size asked for, e.g. 200x120x20: a line when the model is off
      --clash                 list parts that share volume (touching does not count)
      --check <inventory.json>  compare the parts with an inventory (counts, axes, floor, relations)
      --kernel mesh|brep      default mesh
      --out <dir>             default <tmp>/archiyou/<name>
      --parts                 list every part, even in a large model
      --json                  everything as one JSON object
      --verbose               core's own logging on stderr
  sweep <file.js>           the defaults and every parameter at its extremes, one table;
                            --corners: every combination of the extremes instead;
                            takes -p, --clash, --check, --json; exit 1 unless clean
  api <name>                the API reference: a function, Class.member, or a class's members
  docs [topic]              the guide and tutorials, as Markdown
  examples [name]           example scripts
  mark <photo> <marks.json> the photo with numbered markers and a legend (--out dir)
  eval <dir>                score solutions (<dir>/<id>.js) against an eval set (--evals file)`;

//// INIT ////

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENTS_START = '<!-- archiyou:start -->';
const AGENTS_END = '<!-- archiyou:end -->';
const SKILL_TARGETS = ['.agents/skills/archiyou/SKILL.md', '.claude/skills/archiyou/SKILL.md'];

function packageJson(): { name: string; version: string }
{
    return JSON.parse(readFileSync(join(HERE, '../package.json'), 'utf8'));
}

/** How this CLI is called in the user's project: by its package name through npx */
function cliCommand(): string
{
    return existsSync(join(HERE, 'data')) ? `npx ${packageJson().name}` : 'pnpm -s archiyou';
}

function agentsBlock(cli: string): string
{
    return [
        AGENTS_START,
        '## Archiyou',
        'Models here are Archiyou scripts (parametric CAD in JavaScript). Follow the archiyou skill',
        '(`.agents/skills/archiyou/SKILL.md`). The CLI it uses is called as:',
        '',
        `    ${cli} <command>        e.g. ${cli} run chair.js, ${cli} api box`,
        AGENTS_END,
    ].join('\n');
}

/** Write a file unless it is already up to date; an older copy only with --force */
function writeOnce(path: string, content: string, force: boolean): string
{
    if (existsSync(path))
    {
        const current = readFileSync(path, 'utf8');
        if (current === content) { return 'up to date'; }
        if (!force) { return 'differs, kept (--force to replace)'; }
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    return 'written';
}

function init(args: Args): number
{
    const force = args.bools.has('force');
    const skill = readFileSync(DATA.skill, 'utf8');
    SKILL_TARGETS.forEach(target => out(`${target}  ${writeOnce(join(BASE_DIR, target), skill, force)}`));

    const agentsPath = join(BASE_DIR, 'AGENTS.md');
    const block = agentsBlock(cliCommand());
    const current = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '';
    const start = current.indexOf(AGENTS_START), end = current.indexOf(AGENTS_END);
    const next = (start >= 0 && end > start)
        ? current.slice(0, start) + block + current.slice(end + AGENTS_END.length)
        : (current.trimEnd() ? current.trimEnd() + '\n\n' : '') + block + '\n';
    out(`AGENTS.md  ${next === current ? 'up to date' : (writeFileSync(agentsPath, next), current ? 'updated' : 'written')}`);
    out('');
    out('Next: open your coding agent in this folder and describe what to model, e.g.');
    out('  "I have some sketches and photos here, make me a parametric model."');
    return 0;
}

//// MAIN ////

async function main(argv: Array<string>): Promise<number>
{
    const [command, ...rest] = argv;
    const args = parseArgs(rest);
    switch (command)
    {
        case 'init': return init(args);
        case 'run': return (await import('./run')).run(args);
        case 'sweep': return (await import('./run')).sweep(args);
        case 'eval': return (await import('./run')).evaluate(args);
        case 'mark': return (await import('./run')).markPhoto(args);
        case 'api': return api(args.positional.join(' ') || undefined);
        case 'docs': return docs(args.positional.join(' ') || undefined);
        case 'examples': return examples(args.positional[0]);
        case '--version': case '-v': case 'version': out(packageJson().version); return 0;
        case undefined: case 'help': case '--help': case '-h': out(USAGE); return 0;
        default:
            fail(`archiyou: unknown command "${command}"\n\n${USAGE}`);
            return 1;
    }
}

/** Exit once stdout is flushed: piped output is written asynchronously, and process.exit()
 *  right away cuts it off at the pipe buffer (64 KB). The Runner keeps handles open, so the
 *  process does not end on its own */
function exit(code: number): void
{
    process.stdout.write('', () => process.exit(code));
}

main(process.argv.slice(2)).then(
    code => exit(code),
    (e: Error) =>
    {
        fail(`archiyou: ${e.message}`);
        exit(1);
    });
