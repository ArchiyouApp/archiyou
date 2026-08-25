/**
 *  mesh ⇆ brep parity sweep.
 *
 *  Runs every script in the local library through the Runner twice: first on the mesh kernel,
 *  then — only if mesh succeeded — on brep. Mesh is the control: a script that cannot run at
 *  all (missing component, genuine syntax error, unfinished work-in-progress) tells us nothing
 *  about the kernels, so it is reported and skipped rather than counted as a brep failure.
 *
 *  This is a corpus test, not a unit test: it reads the developer's real database and is slow
 *  (two full geometry runs per script, plus the ~10MB OpenCascade WASM on the first brep run).
 *  It therefore lives outside tests/unit and has its own script:
 *
 *      pnpm --filter @archiyou/server test:parity
 *
 *  The database is opened READ-ONLY — this never writes to your library.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import Database from 'better-sqlite3'
import { Runner } from '@archiyou/core/src/runner/Runner'
import type { RunnerScriptExecutionRequest, RunnerScriptExecutionResult } from '@archiyou/core/src/runner/types'

const DB_FILE = resolve(process.env.SERVER_DATABASE_FILE ?? './data/archiyou.db')

/** Per-script wall-clock ceiling. A hung kernel must not take the whole sweep down. */
const SCRIPT_TIMEOUT_MS = 60_000

type ScriptRow = {
    id: string
    file_id: string
    author: string | null
    name: string | null
    version: string | null
    code: string
    params: string | null
}

type Outcome = {
    name: string
    meshOk: boolean
    meshError?: string
    brepOk?: boolean
    brepError?: string
    meshMs?: number
    brepMs?: number
}

/** The newest stored version of every script in the library. */
function loadLatestScripts(): ScriptRow[]
{
    const db = new Database(DB_FILE, { readonly: true })
    try
    {
        return db.prepare(`
            SELECT id, file_id, author, name, version, code, params
            FROM (
                SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY file_id ORDER BY updated DESC, rowid DESC
                ) AS rn
                FROM script_versions
            )
            WHERE rn = 1 AND code IS NOT NULL AND TRIM(code) != ''
            ORDER BY author, name
        `).all() as ScriptRow[]
    }
    finally { db.close() }
}

/** First error of a result, reduced to one readable line.
 *
 *  The Runner wraps failures in a multi-line banner:
 *      **** EXECUTION ERROR ****
 *      - error: 'the actual message'
 *      - context: …
 *  so the useful part is the `- error:` line, not the first line (which is blank). */
function errorOf(result: RunnerScriptExecutionResult): string
{
    const first: any = result.errors?.[0]
    const raw = String(first?.message ?? first?.text ?? JSON.stringify(first ?? {}))

    const errorLine = raw.match(/^- error:\s*'?([\s\S]*?)'?\s*$/m)?.[1]
    const text = (errorLine ?? raw).replace(/\s+/g, ' ').trim()
    return text.slice(0, 180) || '(no message)'
}

async function runScript(runner: Runner, row: ScriptRow, kernel: 'mesh' | 'brep')
    : Promise<{ ok: boolean; error?: string; ms: number }>
{
    const request = {
        kernel,
        script: {
            id: row.id,
            fileId: row.file_id,
            author: row.author ?? undefined,
            name: row.name ?? undefined,
            code: row.code,
            params: row.params ? JSON.parse(row.params) : undefined,
        },
        outputs: ['default/model/glb'],
        messages: ['error'],
    } as unknown as RunnerScriptExecutionRequest

    const started = Date.now()
    try
    {
        const result = await Promise.race([
            runner.execute(request),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`timed out after ${SCRIPT_TIMEOUT_MS}ms`)), SCRIPT_TIMEOUT_MS)),
        ])

        const ms = Date.now() - started
        return (result.status === 'success')
            ? { ok: true, ms }
            : { ok: false, error: errorOf(result), ms }
    }
    catch (e: any)
    {
        // A throw here is the Runner itself failing (or our timeout), not a script error
        return { ok: false, error: `THREW: ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`, ms: Date.now() - started }
    }
}

describe.skipIf(!existsSync(DB_FILE))('mesh ⇆ brep parity over the local script library', () =>
{
    let scripts: ScriptRow[] = []
    let runner: Runner

    beforeAll(async () =>
    {
        scripts = loadLatestScripts()
        runner = await new Runner().load()
    }, 120_000)

    it('every script that runs on mesh also runs on brep', async () =>
    {
        const outcomes: Outcome[] = []

        for (const row of scripts)
        {
            const label = `${row.author ?? '?'}/${row.name ?? row.file_id}${row.version ? `:${row.version}` : ''}`

            const mesh = await runScript(runner, row, 'mesh')
            if (!mesh.ok)
            {
                // Mesh is the control — if the script is broken there, it says nothing about brep
                outcomes.push({ name: label, meshOk: false, meshError: mesh.error, meshMs: mesh.ms })
                continue
            }

            const brep = await runScript(runner, row, 'brep')
            outcomes.push({
                name: label,
                meshOk: true, meshMs: mesh.ms,
                brepOk: brep.ok, brepError: brep.error, brepMs: brep.ms,
            })
        }

        //// REPORT ////

        const brokenOnMesh = outcomes.filter(o => !o.meshOk)
        const comparable   = outcomes.filter(o => o.meshOk)
        const brepFailures = comparable.filter(o => !o.brepOk)
        const bothOk       = comparable.filter(o => o.brepOk)

        const lines: string[] = []
        lines.push('')
        lines.push('═══ mesh ⇆ brep parity ═══')
        lines.push(`  scripts in library : ${outcomes.length}`)
        lines.push(`  broken on mesh     : ${brokenOnMesh.length}  (skipped — not a kernel issue)`)
        lines.push(`  comparable         : ${comparable.length}`)
        lines.push(`  ✓ both kernels     : ${bothOk.length}`)
        lines.push(`  ✗ brep-only failure: ${brepFailures.length}`)

        if (brepFailures.length)
        {
            lines.push('')
            lines.push('─── brep failures (mesh works, brep does not) ───')
            // group identical errors so a systemic cause shows up as one entry
            const byError = new Map<string, string[]>()
            brepFailures.forEach(f =>
            {
                const key = f.brepError ?? 'unknown'
                byError.set(key, [...(byError.get(key) ?? []), f.name])
            })
            ;[...byError.entries()]
                .sort((a, b) => b[1].length - a[1].length)
                .forEach(([error, names]) =>
                {
                    lines.push(`  [${names.length}×] ${error}`)
                    names.slice(0, 8).forEach(n => lines.push(`         · ${n}`))
                    if (names.length > 8) lines.push(`         · …and ${names.length - 8} more`)
                })
        }

        if (brokenOnMesh.length)
        {
            lines.push('')
            lines.push('─── skipped: broken on mesh too ───')
            brokenOnMesh.slice(0, 15).forEach(f => lines.push(`  ${f.name}: ${f.meshError}`))
            if (brokenOnMesh.length > 15) lines.push(`  …and ${brokenOnMesh.length - 15} more`)
        }

        lines.push('')
        console.log(lines.join('\n'))

        expect(brepFailures.map(f => `${f.name}: ${f.brepError}`)).toEqual([])
    }, 30 * 60_000)
})
