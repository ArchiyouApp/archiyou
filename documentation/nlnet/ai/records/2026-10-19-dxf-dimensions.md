# DXF and SVG export: readable, portable dimensions

| | |
|---|---|
| Dates | 2026-10-19 → 2026-10-24 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent |
| Human | Mark van der Net: asked for the DXF check against the timberwall doc pipeline with a separate validation pipeline, approved the proposed fixes |
| Branch | `develop` |
| Session transcript | kept locally; the prompts are reproduced in full below |

## Prompts (verbatim, local time)
```
2026-10-19 23:25 +0200  Can you check and see how far DXF export is? Last time i checked the dimension lines were not working. Can you test? Use the timberwall script (doc pipeline) in the tunneled database under archiyou user as a test. Please use a seperate pipeline to validate the dxf.
2026-10-19 23:29 +0200  [Image: original 2100x1650, displayed at 2000x1571. Multiply coordinates by 1.05 to map to original image.]
2026-10-19 23:41 +0200  ok go ahead
2026-10-19 23:45 +0200  [Image: original 2100x1650, displayed at 2000x1571. Multiply coordinates by 1.05 to map to original image.]
2026-10-19 23:50 +0200  Can you add dimension lines in SVG export too?
```

## Plan (agent output, reviewed by the human before implementation)

### Findings that led to it

The `timberwall` script (owner `archiyou`, shared database) was run headless with an extra
`$pipeline('dxftest')` around its `docPipeline()`, and the DXF it wrote was checked outside Archiyou
with ezdxf (strict read, audit, entity check, render of the baked blocks, and a render after ezdxf
regenerated every dimension from the entity alone). The file was well formed and all 31 measurements
right, but:

1. Dimension text and arrows were 2.5 model units (`DXFDocument.TEXT_HEIGHT`/`ARROW_SIZE`): 2.5 mm
   on a 3 m wall, invisible in any viewer and again after a CAD regen.
2. Dimensions were written as ALIGNED (type 1) without an angle; ezdxf, which takes the direction from
   group 50, redrew every vertical one as a horizontal "0".

### Changes (`packages/core/src/modeler/DXFExporter.ts`, `src/annotator/AnnotatorDimensionLine.ts`)

- Dimension sizes are paper millimeters (ISO-25: DIMTXT 2.5, DIMASZ 2.5, DIMGAP/DIMEXO 0.625,
  DIMEXE 1.25) times the drawing scale, written as DIMSCALE (model units per paper mm). The scale is
  `toDXF({ scale: 50 })` for 1:50, or picked from the drawing's extent the way SVG export sizes text
  without a page (a ~200 mm wide view), snapped to 1/2/2.5/5 per decade.
- Dimensions are collected and written at `stringify()`, once the extent and so the scale are known.
- Written as ROTATED linear dimensions (type 0 + 32, group 50 angle, `AcDbRotatedDimension`, actual
  measurement in group 42), as DIMLINEAR and ezdxf write them. Also right for `ortho` dimensions,
  which measure along an axis between points that are not level.
- Baked blocks match a CAD regen: text above the line (DIMTAD 1, DIMTIH/DIMTOH 0), readable direction
  (vertical text bottom to top, on the left), extension lines with DIMEXO/DIMEXE and none where the
  dimension runs over its own points, arrows outside when two do not fit.
- MTEXT direction written as a vector (group 11) instead of group 50, which the DXF reference calls
  radians and AutoCAD/ezdxf read as degrees (vertical text came out level).
- `addAlignedDim()` renamed `addDimension()`; `DimensionLine.toDXF()` no longer passes a text position.
- Tests in `tests/unit/modeler/dxf.test.ts` (`dimensions`): rotated vertical dimension, text direction,
  automatic and explicit scale, model unit scaling, arrows outside.

### Follow-up: dimensions in SVG export (asked by the human after the DXF changes)

A pipeline's SVG is the scene drawing (`sceneSVG()`: one `<g>` per scene node, kept for Illustrator
layers), which never drew annotations, and the Runner called `modeler.toSVG()` without options, so
`?annotations=true` did not reach it.

- `sceneSVG(root, plane, annotations)` draws the given annotations as `<g id="dimensions">` after the
  scene (a layer of its own, like the DXF `dimensions` layer), taken to the drawing plane with the
  geometry, sized to the drawing as a drawing without a page is, and grows the viewBox to hold them.
- `Modeler.toSVG({ annotations: true })` passes the same annotations toDXF() writes (a pipeline's,
  inside `withScene()`); without it the scene SVG is unchanged.
- The Runner passes `?annotations=true` of an svg output path through; the CLI asks for it on
  `--pipeline name:svg`, as it did for dxf and glb.
- Tests: `tests/unit/modeler/svg.test.ts` (`dimensions`), `tests/unit/runner/runner.pipeline.test.ts`.

### Not in this unit (reported)

- Pipeline DXF includes dimensions not in the pipeline's output (the script's interactive dims).
- `DIMENSION_OFFSET_DEFAULT` is 10 model units: 10 m in a metre model.
- Chains of narrow dimensions (38 mm studs) overlap their text.

## Review and decisions by the human

- Asked for the check on the timberwall doc pipeline, with a separate pipeline to validate the DXF.
- Sent two screenshots during the check, approved the proposed fixes ("ok go ahead").
- Asked for the dimensions in SVG export too (the follow-up above).
- Asked for the commit on 2026-10-24.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | DXF and SVG export: readable, portable dimensions | all of the above |
