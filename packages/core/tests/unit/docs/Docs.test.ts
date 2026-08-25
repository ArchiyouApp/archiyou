import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'


import { save } from '@archiyou/meshup/src/utils'
import { DOC_DEFAULT_SVG_FONT_FAMILY, DOC_TEXT_HEIGHT_TO_FONT_SIZE_FACTOR } from '../../../src/constants'

import { Modeler } from '../../../src/modeler/Modeler'
import { Docs } from '../../../src/docs/Docs'
import { pointsToMm, mmToPoints } from '../../../src/docs/utils'
import { ShapeCollection as SmartShapeCollection } from '@archiyou/meshup'

const TEST_OUTPUTS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../outputs/docs')

function createDoc(customArchiyou: Record<string, any> = {})
{
	const scope: Record<string, any> = { existing: 'keep' }
	const archiyou = {
		runner: {
			getActiveScope()
			{
				return scope
			},
		},
		calc: {
			metrics()
			{
				return {}
			},
		},
		...customArchiyou,
	} as any

	return {
		doc: new Docs(null, archiyou), // no settings like proxy (not needed in node)
		scope,
	}
}

describe('Doc', () =>
{
	it('creates a default document when doc settings are used before create()', () =>
	{
		const { doc } = createDoc()

		doc.name('sheet-set')
			.units('cm')
			.pageSize('A3')
			.pageOrientation('portrait')

		const activeDoc = doc.getDoc('sheet-set')

		expect(doc.hasDocs()).toBe(true)
		expect(doc.docs()).toEqual(['sheet-set'])
		expect(activeDoc?._units).toBe('cm')
		expect(activeDoc?._pageSize).toBe('A3')
		expect(activeDoc?._pageOrientation).toBe('portrait')
	})

	it('creates pages and applies page-level settings on the active page', () =>
	{
		const { doc } = createDoc()

		doc.create('manual')
			.page('cover')
			.size('A5')
			.padding('10%')
			.orientation('portrait')

		const page = doc.getDoc('manual')?._pages[0]

		expect(page?.name).toBe('cover')
		expect(page?._size).toBe('A5')
		expect(page?._orientation).toBe('portrait')
		expect(page?._padding).toEqual([0.1, 0.1])
	})

	it('executes included pipelines and exposes returned values on the runner scope', () =>
	{
		const { doc, scope } = createDoc()

		doc.create('primary').pipeline(function()
		{
			return {
				result: 42,
				copied: this.existing,
			}
		})

		doc.create('secondary').pipeline(function()
		{
			return { skipped: true }
		})

		doc.executePipelines(['primary'])

		expect(scope.result).toBe(42)
		expect(scope.copied).toBe('keep')
		expect(scope.skipped).toBeUndefined()
		expect(doc.getDoc('primary')?._pipelines[0].done).toBe(true)
		expect(doc.getDoc('secondary')?._pipelines[0].done).toBe(false)
	})

	it('filters getDocs() output and does not rerun completed pipelines', () =>
	{
		const { doc, scope } = createDoc()
		let executions = 0

		doc.create('first').pipeline(function()
		{
			executions += 1
			return { runCount: executions }
		})

		doc.create('second')

		const filteredDocs = doc.getDocs(['first'])
		const filteredDocsAgain = doc.getDocs(['first'])

		expect(filteredDocs.map(curDoc => curDoc._name)).toEqual(['first'])
		expect(filteredDocsAgain.map(curDoc => curDoc._name)).toEqual(['first'])
		expect(executions).toBe(1)
		expect(scope.runCount).toBe(1)
	})

	it('builds metric, param and version summaries from Archiyou state', () =>
	{
		const { doc } = createDoc({
			calc: {
				metrics()
				{
					return {
						BEAM_LENGTH: {
							name: 'BEAM_LENGTH',
							label: 'Beam Length',
							data: '123.456mm',
							options: { unit: 'mm' },
						},
					}
				},
			},
			// The live params of the running script come from the ParamManager in the
			// active scope, and the version from the request the Runner is executing.
			// (This used to stub an `_archiyou.worker` module — which nothing ever sets,
			// so these summaries were dead in every real run: always "no parameters"/v0.)
			runner: {
				getActiveScope()
				{
					return {
						_paramManager: {
							getParams()
							{
								return [{ name: 'BEAM_WIDTH', label: 'Beam Width', _value: '1200mm' }]
							},
						},
					}
				},
				getActiveExecRequest()
				{
					return { script: { version: '2.3.4' } }
				},
			},
		})

		// summary helpers now live on the Document instance
		const summaryDoc = doc.create('summaries')

		expect(summaryDoc._splitStringRecurse(['beam-width value'], ['-', ' '])).toEqual(['beam', 'width', 'value'])
		expect(summaryDoc._formatMetricParamValue('123.456mm')).toBe('123.4')
		expect(summaryDoc._getMetricSummary()).toBe('BL:123.4 mm')
		expect(summaryDoc._getParamSummary()).toBe('BW:1200')
		expect(summaryDoc._getVersion()).toBe('v2.3.4')
		// Stamped at render time — the request carries no creation timestamp.
		expect(summaryDoc._getVersionSummary()).toMatch(/^v2\.3\.4 at .+/)
	})

	it('summarises "no metrics"/"no parameters" instead of throwing when there are none', () =>
	{
		// Regression: _getMetricSummary() ran Object.values() on a possibly-undefined
		// calc.metrics(), which THREW instead of returning 'no metrics' — and since
		// titleblock() calls it, that took the whole document down with it.
		const { doc } = createDoc({ calc: undefined, runner: { getActiveScope: () => ({}) } })
		const summaryDoc = doc.create('empty-summaries')

		expect(summaryDoc._getMetricSummary()).toBe('no metrics')
		expect(summaryDoc._getParamSummary()).toBe('no parameters')
		expect(summaryDoc._getVersion()).toBe('v0')
	})

	it('exports two simple documents to SVG and saves them to disk', async () =>
	{
		const { doc } = createDoc()

		doc.create('doc-alpha')
			.page('alpha-page')
			.text('Alpha document')

		doc.create('doc-beta')
			.page('beta-page')
			.text('Beta document')

		const svgByDoc = await doc.toSVG() as Record<string, string>

		expect(Object.keys(svgByDoc)).toEqual(['doc-alpha', 'doc-beta'])

		for (const [docName, svg] of Object.entries(svgByDoc))
		{
			await save(resolve(TEST_OUTPUTS_PATH, `${docName}.svg`), svg)
		}

		const alphaSvgPath = resolve(TEST_OUTPUTS_PATH, 'doc-alpha.svg')
		const betaSvgPath = resolve(TEST_OUTPUTS_PATH, 'doc-beta.svg')

		const alphaSvg = await readFile(alphaSvgPath, 'utf8')
		const betaSvg = await readFile(betaSvgPath, 'utf8')

		expect(alphaSvg).toContain('<svg')
		expect(alphaSvg).toContain('inkscape:label="alpha-page"')
		expect(alphaSvg).toContain('Alpha document')
		expect(alphaSvg).not.toContain('width="0"')

		expect(betaSvg).toContain('<svg')
		expect(betaSvg).toContain('inkscape:label="beta-page"')
		expect(betaSvg).toContain('Beta document')
		expect(betaSvg).not.toContain('width="0"')
	})

	it('exports per-page standalone SVGs via toSVGPages()', async () =>
	{
		const { doc } = createDoc()

		doc.create('paged')
			.page('page-one')
			.text('Page one content')
			.page('page-two')
			.text('Page two content')

		// Single doc -> returns an Array<DocSVGPage>
		const pages = await doc.toSVGPages() as Array<any>

		expect(Array.isArray(pages)).toBe(true)
		expect(pages.length).toBe(2)

		expect(pages[0].name).toBe('page-one')
		expect(pages[1].name).toBe('page-two')

		// A4 landscape default -> 297 x 210 mm
		expect(Math.round(pages[0].widthMm)).toBe(297)
		expect(Math.round(pages[0].heightMm)).toBe(210)
		expect(pages[0].orientation).toBe('landscape')

		// Each entry is a self-contained, single-page <svg> sized to that page
		expect(pages[0].svg).toContain('<svg')
		expect(pages[0].svg).toContain('width="297mm"')
		expect(pages[0].svg).toContain('viewBox="0 0 297 210"')
		expect(pages[0].svg).toContain('inkscape:label="page-one"')
		expect(pages[0].svg).toContain('Page one content')
		// No multi-page combined-document artifacts in a single page export
		expect(pages[0].svg).not.toContain('data-multipage')
		expect(pages[0].svg).not.toContain('inkscape:label="page-two"')

		expect(pages[1].svg).toContain('inkscape:label="page-two"')
		expect(pages[1].svg).toContain('Page two content')
	})

	it('should output the right text size', async () =>
	{
		const { doc } = createDoc()

		doc.create('text-size-check')
			.page('text-size-check')
			.text('Ten millimeter text', { size: '10mm' })
			.text('Five millimeter text', { size: '5mm' })

		const svg = await doc.toSVG() as string

		const expectedTen = pointsToMm(mmToPoints(10) * DOC_TEXT_HEIGHT_TO_FONT_SIZE_FACTOR)
		const expectedFive = pointsToMm(mmToPoints(5) * DOC_TEXT_HEIGHT_TO_FONT_SIZE_FACTOR)
		const fontSizes = Array.from(svg.matchAll(/font-size="([\d.]+)"/g)).map(match => Number(match[1]))

		expect(svg).toContain('height="210mm"')
		expect(svg).not.toContain('font-size="10mm"')
		expect(svg).not.toContain('font-size="5mm"')
		expect(fontSizes.some(size => Math.abs(size - expectedTen) < 0.0001)).toBe(true)
		expect(fontSizes.some(size => Math.abs(size - expectedFive) < 0.0001)).toBe(true)
	})

	it('exports a richer document to SVG and saves it to disk', async () =>
	{
		// Stub the network: this document (and the titleblock it places) loads images by
		// URL, and a live fetch made the test depend on a CMS being up — it fails at the
		// 5s timeout whenever that host is slow or down. The bytes are irrelevant here;
		// what is asserted below is the SVG the document builds around them.
		const realFetch = globalThis.fetch
		globalThis.fetch = (async () => ({
			status: 200,
			arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
			text: async () => '<svg></svg>',
		})) as any

		try {

		const { doc } = createDoc()

        // make a isometric drawing too
        const modeler = new Modeler();
        await modeler.load();

        const iso = modeler.box(10,20,30).iso();

		doc.create('test')
			.page('test')
			.text('Hello from archiyou!', { size: '10mm' })
			.pivot(0.5, 0)
			.position(0.5, 0.5)
			.text('Small text', { size: '5mm' })
			.position(1, 0)
			.titleblock({ title: 'Test Document', designer: 'Archiyou' })
			.image('https://cms.shopxyz.nl/uploads/archiyou_about_8d54d26442.jpg')
			.width(0.5)
			.height(0.5)
			.position(0.5, 0.0)
            // iso view
            .view('iso')
            .shapes(iso as SmartShapeCollection)
            .width(0.5)
            .height(0.5);

		const svg = await doc.toSVG() as string
		const svgPath = resolve(TEST_OUTPUTS_PATH, 'test.rich.svg')

		await save(svgPath, svg)

		const savedSvg = await readFile(svgPath, 'utf8')

		expect(savedSvg).toContain('<svg')
		expect(savedSvg).toContain('width="297mm"')
		expect(savedSvg).toContain('height="210mm"')
		expect(savedSvg).toContain(`font-family="${DOC_DEFAULT_SVG_FONT_FAMILY}"`)
		expect(savedSvg).toContain('font-size="9"')
		expect(savedSvg).toContain('font-size="4.5"')
		expect(savedSvg).toContain('Hello from archiyou!')
		expect(savedSvg).toContain('Test Document')

		} finally { globalThis.fetch = realFetch }
	})

	it('exports a mesh-mode document pipeline view built from collection iso()', async () =>
	{
		const { doc } = createDoc()

		const modeler = new Modeler()
		await modeler.load()
		modeler.box(10, 20, 30)
		const sceneShapes = modeler.all()

		doc.create('mesh-pipeline')
			.pipeline(function()
			{
				return {
					iso: sceneShapes.iso([1, -1, 1]),
				}
			})
			.page('main')
			.view('iso')
			.shapes('iso')
			.width(0.5)
			.height(0.5)

		const svg = await doc.toSVG() as string

		expect(svg).toContain('<svg')
		expect(svg).not.toContain('ShapeCollection::toSVG() — nothing 2D to draw')
	})

	it('exports a mesh-mode pipeline view built from a collection of copied subcollections', async () =>
	{
		const { doc } = createDoc()

		const modeler = new Modeler()
		await modeler.load()

		const left = modeler.collection(
			modeler.box(10, 20, 30),
			modeler.box(5, 10, 15).move(20, 0, 0),
		)
		const right = left.copy().move(40, 0, 0)

		doc.create('mesh-subcollections')
			.pipeline(function()
			{
				const combined = modeler.collection(left.copy(), right.copy())
				return {
					iso: combined.iso([1, -1, 1]),
				}
			})
			.page('main')
			.view('iso')
			.shapes('iso')
			.width(0.5)
			.height(0.5)

		const svg = await doc.toSVG() as string

		expect(svg).toContain('<svg')
		expect(svg).not.toContain('ShapeCollection::toSVG() — nothing 2D to draw')
	})
})


