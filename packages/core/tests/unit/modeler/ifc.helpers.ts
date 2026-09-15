/**
 * ifc.helpers.ts — checks for written IFC4 files, shared by ifc.export.test.ts and ifc.house.test.ts.
 */

import { execFileSync } from 'child_process'
import * as WebIFC from 'web-ifc'

export interface ParsedIFC { lines: Map<number, { entity: string; args: string }>; text: string }

export function parseIFC(text: string): ParsedIFC
{
    const lines = new Map<number, { entity: string; args: string }>()
    text.split('\n').forEach(line =>
    {
        const m = /^#(\d+)=([A-Z0-9]+)\((.*)\);$/.exec(line)
        if (m) lines.set(Number(m[1]), { entity: m[2], args: m[3] })
    })
    return { lines, text }
}

const withoutStrings = (args: string) => args.replace(/'(?:[^']|'')*'/g, "''")
const refsIn = (args: string) => [...withoutStrings(args).matchAll(/#(\d+)/g)].map(m => Number(m[1]))

/** Structural problems in an IFC4 file, as readable sentences; empty when it is sound */
export function structuralProblems(file: ParsedIFC, productEntities: string[]): string[]
{
    const problems: string[] = []
    const { lines, text } = file
    if (!text.startsWith('ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(')) problems.push('bad header')
    if (!text.includes("FILE_SCHEMA(('IFC4'));")) problems.push('schema is not IFC4')
    if (!text.trimEnd().endsWith('ENDSEC;\nEND-ISO-10303-21;')) problems.push('bad footer')

    const ids = [...lines.keys()]
    ids.forEach((id, i) => { if (id !== i + 1) problems.push(`#${id} out of sequence`) })
    lines.forEach((l, id) => refsIn(l.args).forEach(r => { if (!lines.has(r)) problems.push(`#${id} ${l.entity} refers to missing #${r}`) }))

    const guids = [...text.matchAll(/=IFC[A-Z0-9]+\('([0-9A-Za-z_$]{22})'/g)].map(m => m[1])
    const seen = new Set<string>()
    guids.forEach(g => { if (seen.has(g)) problems.push(`GlobalId ${g} used twice`); seen.add(g) })
    if (guids.some(g => !'0123'.includes(g[0]))) problems.push('GlobalId with an impossible first character')

    // every product: exactly one parent
    const upper = new Set(productEntities.map(e => e.toUpperCase()))
    const products = ids.filter(id => upper.has(lines.get(id)!.entity))
    const parents = new Map<number, number>()
    const count = (id: number) => parents.set(id, (parents.get(id) ?? 0) + 1)
    lines.forEach(l =>
    {
        const refs = refsIn(l.args)
        if (l.entity === 'IFCRELCONTAINEDINSPATIALSTRUCTURE') refs.slice(1, -1).forEach(count)
        if (l.entity === 'IFCRELAGGREGATES') refs.slice(2).forEach(count)
        if (l.entity === 'IFCRELVOIDSELEMENT') count(refs[refs.length - 1])
    })
    products.forEach(id =>
    {
        const n = parents.get(id) ?? 0
        if (n !== 1) problems.push(`#${id} ${lines.get(id)!.entity} has ${n} parents`)
    })
    return problems
}

/** Entity counts and meshed products as web-ifc reads the file */
export async function readBack(text: string): Promise<{ count: (entity: string) => number; productsWithGeometry: number; vertices: number }>
{
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = api.OpenModel(new TextEncoder().encode(text))
    let productsWithGeometry = 0
    let vertices = 0
    api.StreamAllMeshes(model, mesh =>
    {
        productsWithGeometry++
        for (let i = 0; i < mesh.geometries.size(); i++)
        {
            const geometry = api.GetGeometry(model, mesh.geometries.get(i).geometryExpressID)
            vertices += geometry.GetVertexDataSize() / 6
        }
    })
    const count = (entity: string) => api.GetLineIDsWithType(model, (WebIFC as any)[entity.toUpperCase()]).size()
    const result = { count, productsWithGeometry, vertices }
    return result
}

/** IfcOpenShell schema validation, when available: returns its log lines, or null when skipped */
export function validateWithIfcOpenShell(path: string): string[] | null
{
    const python = process.env.IFCOPENSHELL_PYTHON
    if (!python) return null
    const script = [
        'import sys, logging, ifcopenshell, ifcopenshell.validate',
        'f = ifcopenshell.open(sys.argv[1])',
        'logger = ifcopenshell.validate.json_logger()',
        'ifcopenshell.validate.validate(f, logger, express_rules=True)',
        'print("\\n".join(str(s.get("message")) + " " + str(s.get("instance")) for s in logger.statements))',
    ].join('\n')
    const out = execFileSync(python, ['-c', script, path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    return out.split('\n').filter(Boolean)
}

