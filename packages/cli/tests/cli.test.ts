import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';
import { beforeAll, describe, expect, it } from 'vitest';

// The CLI runs as a subprocess from source (tsx + tsconfig.runtime.json), so what is tested is
// what an agent sees: stdout, stderr and the exit code

const CLI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(CLI_DIR, 'tests/fixtures');
const EXAMPLES = resolve(CLI_DIR, '../core/tests/cadscripts/scripts');
const MESHUP_BUILT = existsSync(resolve(CLI_DIR, '../meshup/dist/index.js'));

function cli(args: Array<string>, cwd: string = CLI_DIR): { stdout: string; stderr: string; status: number | null }
{
    const r = spawnSync(join(CLI_DIR, 'node_modules/.bin/tsx'),
        ['--tsconfig', join(CLI_DIR, 'tsconfig.runtime.json'), join(CLI_DIR, 'src/archiyou.ts'), ...args],
        { cwd, encoding: 'utf8', env: { ...process.env, INIT_CWD: cwd } });
    return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

function pngSize(file: string): { width: number; height: number }
{
    const buf = readFileSync(file);
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

let tmp: string;

beforeAll(() =>
{
    tmp = mkdtempSync(join(tmpdir(), 'archiyou-cli-test-'));
});

describe('lookups (no kernel)', () =>
{
    it('api: a function with its signature, parameters and example', () =>
    {
        const r = cli(['api', 'box']);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('box(width?: number');
        expect(r.stdout).toContain('example:');
    });

    it('api: a class lists its members', () =>
    {
        const r = cli(['api', 'Mesh']);
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/^Mesh.*members/);
        expect(r.stdout).toContain('  volume(): number');
    });

    it('docs: a guide page as text, without images', () =>
    {
        const r = cli(['docs', 'csg']);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('Constructive Solid Geometry');
        expect(r.stdout).not.toMatch(/!\[[^\]]*\]\(/);
    });

    it('examples: the list, and one script', () =>
    {
        expect(cli(['examples']).stdout).toContain('programmaticparams');
        expect(cli(['examples', 'programmaticparams']).stdout).toContain('$PARAMS.define');
    });

    it('an unknown command exits 1 with the usage on stderr', () =>
    {
        const r = cli(['frobnicate']);
        expect(r.status).toBe(1);
        expect(r.stdout).toBe('');
        expect(r.stderr).toContain('unknown command');
    });
});

describe('init', () =>
{
    it('writes the skill and an AGENTS.md block, and a second run changes nothing', () =>
    {
        const project = mkdtempSync(join(tmpdir(), 'archiyou-init-'));
        writeFileSync(join(project, 'AGENTS.md'), '# My project\n\nOwn notes.\n');

        const first = cli(['init'], project);
        expect(first.status).toBe(0);
        expect(readFileSync(join(project, '.agents/skills/archiyou/SKILL.md'), 'utf8')).toContain('name: archiyou');
        expect(existsSync(join(project, '.claude/skills/archiyou/SKILL.md'))).toBe(true);
        const agents = readFileSync(join(project, 'AGENTS.md'), 'utf8');
        expect(agents).toContain('Own notes.');
        expect(agents).toContain('<!-- archiyou:start -->');

        const second = cli(['init'], project);
        expect(second.stdout.match(/up to date/g)?.length).toBe(3);
        expect(readFileSync(join(project, 'AGENTS.md'), 'utf8')).toBe(agents);
    });
});

describe.skipIf(!MESHUP_BUILT)('run (needs pnpm build:meshup)', () =>
{
    it('prints a summary on a clean stdout and writes model.glb and views.png', () =>
    {
        const out = join(tmp, 'plate');
        const r = cli(['run', join(FIXTURES, 'plate.js'), '--out', out]);
        expect(r.status).toBe(0);
        const lines = r.stdout.trim().split('\n');
        expect(lines[0]).toMatch(/^OK {2}plate\.js {2}mesh/);
        expect(r.stdout).toContain('size 200 x 100 x 60');
        expect(r.stdout).toMatch(/blockL\s+Mesh\s+40 x 100 x 50\s+200000/);
        expect(r.stdout).toContain('print: width 200');
        expect(r.stdout).not.toMatch(/Runner::|ShapeCollection::/); // core's own logging stays out
        expect(statSync(join(out, 'model.glb')).size).toBeGreaterThan(1000);
        expect(pngSize(join(out, 'views.png'))).toEqual({ width: 1800, height: 1260 }); // 4 views, 3 columns
        expect(statSync(join(out, 'views.png')).size).toBeGreaterThan(10_000);
    });

    it('-p changes the model of a script that declares its params only in code', () =>
    {
        const r = cli(['run', join(FIXTURES, 'plate.js'), '-p', 'WIDTH=300', '-p', 'TOP=false', '--views', 'none']);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('size 300 x 100 x 50');
        expect(r.stdout).toContain('params WIDTH=300 TOP=false');
    });

    it('a broken script exits 1 with the line, the lines around it and a suggestion', () =>
    {
        const r = cli(['run', join(FIXTURES, 'broken.js'), '--views', 'none']);
        expect(r.status).toBe(1);
        expect(r.stdout).toContain('ERROR  broken.js  line 3: a.filet is not a function');
        expect(r.stdout).toContain('>    3 | b = a.filet(5);');
        expect(r.stdout).toContain('did you mean Curve.fillet?');
    });

    it('--json gives the same data as one object', () =>
    {
        const r = cli(['run', join(FIXTURES, 'plate.js'), '--json', '--views', 'none']);
        const data = JSON.parse(r.stdout);
        expect(data.ok).toBe(true);
        expect(data.size).toEqual([200, 100, 60]);
        expect(data.parts.map((p: any) => p.name)).toEqual(['blockL', 'blockR', 'plate']);
        expect(data.params.find((p: any) => p.name === 'WIDTH')).toMatchObject({ value: 200, min: 100, max: 400 });
    });

    it('--clash reports the pairs that share volume, not the pair that touches', () =>
    {
        const r = cli(['run', join(FIXTURES, 'clash.js'), '--clash', '--views', 'none']);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('clashes 2');
        expect(r.stdout).toMatch(/ {2}a x b {2}125000 mm3/);
        // a after its first clash: the check must not have replaced it by the shared volume
        expect(r.stdout).toMatch(/ {2}a x d {2}8000 mm3/);
    });

    it('--pipeline writes what a pipeline makes; the parts stay those of the model', () =>
    {
        const script = join(tmp, 'drawn.js');
        writeFileSync(script, `${readFileSync(join(FIXTURES, 'plate.js'), 'utf8')}
$pipeline('drawings', function(){ return { front: all().elevation('front') } });`);
        const outDir = join(tmp, 'drawn');

        const r = cli(['run', script, '--views', 'none', '--pipeline', 'drawings:dxf,svg', '--pipeline', 'nope', '--out', outDir]);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('pipelines drawings');
        expect(r.stdout).toContain(`no pipeline 'nope'`);
        expect(r.stdout).toContain('parts 3');
        expect(readFileSync(join(outDir, 'drawings.dxf'), 'utf8')).toContain('front');
        expect(readFileSync(join(outDir, 'drawings.svg'), 'utf8')).toContain('<svg');
    });

    it('--check compares the parts with an inventory', () =>
    {
        const ok = cli(['run', join(FIXTURES, 'plate.js'), '--check', join(FIXTURES, 'plate.inventory.json'), '--views', 'none']);
        expect(ok.stdout).toContain('check ok (8 rules)');

        // Without the plate: one count off, and the rules about the plate find nothing
        const off = cli(['run', join(FIXTURES, 'plate.js'), '-p', 'TOP=false', '--check', join(FIXTURES, 'plate.inventory.json'), '--views', 'none']);
        expect(off.stdout).toContain('plate: 0, expected 1');
        expect(off.stdout).toContain('no part matches "plate"');
    });

    it('--ref and --overlay put photos on the sheet; the overlay reports the proportions', () =>
    {
        // A "photo": a 400 x 300 picture of a dark rectangle on white, the object 60 % wide and tall
        const photo = join(tmp, 'photo.png');
        writeFileSync(photo, new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#fff"/><rect x="80" y="60" width="240" height="180" fill="#333"/></svg>').render().asPng());
        const out = join(tmp, 'photos');
        const r = cli(['run', join(FIXTURES, 'plate.js'), '--views', 'front', '--ref', photo, '--overlay', `${photo}@front@0.2,0.2,0.8,0.8`, '--out', out]);
        expect(r.status).toBe(0);
        expect(pngSize(join(out, 'views.png')).width).toBe(1800); // photo, overlay, front
        expect(r.stdout).toMatch(/overlay photo\.png: width\/height model 3\.33, photo 1\.33 \(\+150 %\)/);
    });

    it('--expect names the axis that is off', () =>
    {
        expect(cli(['run', join(FIXTURES, 'plate.js'), '--expect', '200x100x60', '--views', 'none']).stdout).toContain('expect ok (200 x 100 x 60)');
        expect(cli(['run', join(FIXTURES, 'plate.js'), '--expect', '200x120x60', '--views', 'none']).stdout)
            .toContain('expect: size 200 x 100 x 60, expected 200 x 120 x 60 (x +0, y -20, z +0)');
    });

    it('touches measures the real shapes: a tilted board 20 mm off a lath does not touch it', () =>
    {
        const inventory = join(tmp, 'tilt.inventory.json');
        writeFileSync(inventory, JSON.stringify({ relations: [['board', 'touches', 'lath'], ['board2', 'touches', 'lath']] }));
        // with --clash first (board2 runs into the lath): the clash check must leave the shapes as they are
        const r = cli(['run', join(FIXTURES, 'tilt.js'), '--clash', '--check', inventory, '--views', 'none']);
        expect(r.stdout).toContain('clashes 1');
        expect(r.stdout).toContain('check 1 mismatches (2 rules)');
        expect(r.stdout).toContain('board does not touch lath');
    });

    it('--views around draws eight camera directions; overlays are also written full size', () =>
    {
        const photo = join(tmp, 'around-photo.png');
        writeFileSync(photo, new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#fff"/></svg>').render().asPng());
        const out = join(tmp, 'around');
        const r = cli(['run', join(FIXTURES, 'plate.js'), '--views', 'around', '--overlay', `${photo}@right@0.2,0.2,0.8,0.8`, '--out', out]);
        expect(r.status).toBe(0);
        expect(pngSize(join(out, 'views.png'))).toEqual({ width: 1800, height: 1890 }); // 1 overlay + 8 views
        expect(pngSize(join(out, 'overlay-1-around-photo.png'))).toEqual({ width: 800, height: 600 });
    });

    it('output larger than a pipe buffer arrives whole', () =>
    {
        const r = cli(['run', join(FIXTURES, 'many.js'), '--json', '--views', 'none']);
        expect(r.stdout.length).toBeGreaterThan(65536);
        expect(JSON.parse(r.stdout).parts.length).toBe(600);
    });

    it('a WebP photo is refused with a clear message', () =>
    {
        const webp = join(tmp, 'photo.webp');
        writeFileSync(webp, Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]));
        const r = cli(['run', join(FIXTURES, 'plate.js'), '--ref', webp, '--views', 'none', '--out', join(tmp, 'webp')]);
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('WebP is not supported, convert it to PNG or JPEG');
    });
});

describe.skipIf(!MESHUP_BUILT)('sweep and mark', () =>
{
    it('--modules loads a built client module that the script declares', () =>
    {
        const r = cli(['run', join(FIXTURES, 'twice.js'), '--modules', join(FIXTURES, 'modules'), '--views', 'none']);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('size 100 x 10 x 10');
        expect(r.stdout).toContain('print: doubled 42');
    });

    it('a module that is not in --modules fails at its declaration', () =>
    {
        const r = cli(['run', join(FIXTURES, 'twice.js'), '--modules', FIXTURES, '--views', 'none']); // no module in it
        expect(r.status).toBe(1);
        expect(r.stdout).toContain("ERROR  twice.js  line 1: $module('twice'): no such module");
    });

    it('sweep runs the defaults and every parameter at its extremes', () =>
    {
        const r = cli(['sweep', join(EXAMPLES, 'programmaticparams.js'), '--clash']);
        expect(r.status).toBe(0);
        // defaults + WIDTH, DEPTH, HEIGHT at min and max + SHOW_LID flipped
        expect(r.stdout).toMatch(/^sweep programmaticparams\.js {2}8 runs/);
        expect(r.stdout).toMatch(/WIDTH\s+20\s+OK\s+20 x 120/);
        expect(r.stdout.trim().endsWith('sweep clean')).toBe(true);
    });

    it('sweep --corners runs every combination of the extremes', () =>
    {
        const r = cli(['sweep', join(FIXTURES, 'plate.js'), '--corners']);
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/^sweep plate\.js {2}5 runs/);
        expect(r.stdout).toMatch(/corner\s+WIDTH=400 TOP=false\s+OK\s+400 x 100 x 50/);
    });

    it('sweep exits 1 when a run is not clean', () =>
    {
        const r = cli(['sweep', join(FIXTURES, 'plate.js'), '--check', join(FIXTURES, 'plate.inventory.json')]);
        expect(r.status).toBe(1);
        expect(r.stdout).toContain('TOP=false (besides the defaults\'):');
        expect(r.stdout.trim().endsWith('sweep NOT clean')).toBe(true);
    });

    it('mark draws numbered markers on a photo', () =>
    {
        const photo = join(tmp, 'mark-photo.png');
        writeFileSync(photo, new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#ddd"/></svg>').render().asPng());
        const marks = join(tmp, 'marks.json');
        writeFileSync(marks, JSON.stringify([{ at: [0.25, 0.5], label: 'leg' }, { at: [300, 150], label: 'seat' }]));
        const r = cli(['mark', photo, marks, '--out', join(tmp, 'marks')]);
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/^2 marks {2}files .*mark-photo\.marked\.png$/m);
        expect(pngSize(join(tmp, 'marks', 'mark-photo.marked.png')).width).toBeGreaterThan(400); // photo + legend
    });
});
