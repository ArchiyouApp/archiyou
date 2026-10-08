import { defineConfig } from 'tsup';
import { cp, mkdir, readdir } from 'node:fs/promises';

/**
 *  Build config for the published CLI: one ESM file with a shebang, run by Node.
 *
 *    - `dependencies` stay external: @archiyou/core resolves to its Node build (the `node`
 *      export condition), @resvg/resvg-js to its prebuilt binary for the platform.
 *    - The data the lookups and `init` read is copied into dist/data, because an npx user has
 *      no repo: the API reference, the guide and tutorials (Markdown only), the example
 *      scripts, the skill and the font for the sheet labels. From source, src/common.ts reads
 *      the same files where they live in the repo.
 */
export default defineConfig({
    entry: { 'archiyou': 'src/archiyou.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    splitting: false,
    sourcemap: false,
    clean: true,
    dts: false,
    banner: { js: '#!/usr/bin/env node' },

    onSuccess: async () =>
    {
        const markdownOnly = async (from: string, to: string) =>
        {
            const files = (await readdir(from, { recursive: true }) as Array<string>).filter(f => f.endsWith('.md'));
            await Promise.all(files.map(f => cp(`${from}/${f}`, `${to}/${f}`)));
        };
        await mkdir('dist/data/skill', { recursive: true });
        await mkdir('dist/data/fonts', { recursive: true });
        await cp('../ui/src/editor/help/api.generated.json', 'dist/data/api.json');
        await markdownOnly('../../help/guide/en', 'dist/data/guide');
        await markdownOnly('../../help/tutorials/en', 'dist/data/tutorials');
        await cp('../core/tests/cadscripts/scripts', 'dist/data/examples', { recursive: true, filter: f => !f.includes('/_') });
        await cp('skill/SKILL.md', 'dist/data/skill/SKILL.md');
        await cp('assets/PlusJakartaSans-Regular.ttf', 'dist/data/fonts/PlusJakartaSans-Regular.ttf');
        await cp('assets/OFL-PlusJakartaSans.txt', 'dist/data/fonts/OFL-PlusJakartaSans.txt');
    },
});
