import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  DIMENSION_LINE_COLOR,
  DIMENSION_ARROW_LENGTH,
  DIMENSION_ARROW_RADIUS,
} from '@archiyou/editor/src/settings';

import { executionResult, scriptModelUnits } from '@archiyou/editor/src/state/workspace';
import type { ModelUnits } from '@archiyou/core/src/modeler/types';
import type { UnitSystem } from '@archiyou/core/src/units/UnitConverter';
import { MM_PER_UNIT, toMM, formatLength } from '@archiyou/core/src/units/UnitConverter';

/** The display system used for the current execution (metric fallback). */
function _runDisplaySystem(): UnitSystem
{
  return (executionResult.get()?.request?.unitSystem as UnitSystem) ?? 'metric';
}

/**
 * Render archiyou annotations carried in the GLB root `extras`.
 *
 * GLTFBuilder.addData() writes `{ annotations: AnnotationData[] }` into the
 * glTF root extras (Three's GLTFLoader exposes raw json at gltf.parser.json →
 * root extras at gltf.parser.json.extras).
 *
 *  - dimension lines  → 3D line + arrowhead cones (added under modelGroup)
 *                       PLUS
 *                       an HTML overlay label for the value text.
 *  - labels           → an HTML overlay element, optionally with a CSS leader
 *                       line + arrow (screen-space length/angle).
 *
 * No troika / in-scene text: all text is HTML, styled via CSS in
 * `viewer-labels-overlay`.
 */

interface DimensionLineData
{
  type?: 'dimensionLine';
  start: [number, number, number];
  end: [number, number, number];
  dir?: [number, number, number];
  value: number | string;
  units?: string;
  showUnits?: boolean;
  round?: boolean;
  roundDecimals?: number;
  _labelPosition?: [number, number, number];
  /** Name of a script parameter bound via DimensionLine.bindParam(name).
   *  Combined with `interactive`, the overlay turns this label into an
   *  inline editor that writes back to the param-menu. */
  param?: string;
  /** Source of the optional remap function of `.param(name, remap)` — maps the
   *  edited dimension value to the parameter value. Re-created here, in the main
   *  thread, so it is self-contained by contract (see DimensionLine.bindParam). */
  paramRemapSrc?: string;
  interactive?: boolean;
}

interface LabelData
{
  type: 'label';
  position: [number, number, number];
  value: string;
  class?: string;
  shape?: 'circle' | 'rect';
  target?: 'circle' | 'arrow' | 'none';
  labelOnly?: boolean;
  line?: boolean;
  length?: number;
  offset?: number;
  angle?: number;
  circle?: boolean;
}

type AnnotationItem = DimensionLineData | LabelData;

/** A label rendered by the HTML overlay (anchor in modelGroup-local coords) */
export interface HtmlLabelDef
{
  id: string;
  text: string;
  variant: 'label' | 'dimension';
  anchorLocal: THREE.Vector3;
  class?: string;
  /** The box the text sits in: 'circle' (a manual's circled letter) or 'rect'. */
  shape?: 'circle' | 'rect';
  /** What marks the anchor end of the leader. */
  target?: 'circle' | 'arrow' | 'none';
  /** Just the label — no leader, no marker. */
  labelOnly?: boolean;
  /** Optional CSS leader (screen space) */
  line?: boolean;
  length?: number;
  offset?: number;
  angle?: number;
  circle?: boolean;
  /** When set, the overlay renders this label as an inline editor that
   *  writes back to the named script parameter on commit. */
  param?: string;
  /** Source of the optional `.param(name, remap)` function (see DimensionLineData). */
  paramRemapSrc?: string;
  interactive?: boolean;
  /** Raw numeric value (for dimensions) — used as the starting input value
   *  when the user clicks the label to edit it. */
  rawValue?: number | string;
  /** Source dimension data (for dimensions) — lets the viewer re-format the
   *  label text when the Metric/Imperial switch flips, without a rebuild. */
  dim?: { value: number | string; units?: string; showUnits?: boolean; round?: boolean; roundDecimals?: number };
}

export interface AnnotationsResult
{
  htmlLabels: HtmlLabelDef[]; // projected to screen by the caller each frame
}

// Z-up: world space (kernel Z-up) == Three.js world space when camera.up=(0,0,1)
function _worldToViewerPoint(point: [number, number, number]): THREE.Vector3
{
  return new THREE.Vector3(point[0], point[1], point[2]);
}

function _worldToViewerVector(vector: [number, number, number]): THREE.Vector3
{
  return new THREE.Vector3(vector[0], vector[1], vector[2]);
}

export async function applyAnnotations(
  gltf: GLTF,
  modelGroup: THREE.Object3D,
  /** Annotations from the execution result (preferred). When absent, fall
   *  back to `gltf.parser.json.extras.state.annotations` (new) and then to
   *  `extras.annotations` (legacy) so a standalone .glb can still render. */
  override?: AnnotationItem[],
  /** Multiplier applied to arrowhead length/radius so dimension arrows scale
   *  with the viewer's scene radius. 1 = use the constants as-is. */
  arrowScale: number = 1,
): Promise<AnnotationsResult>
{
  const extras = (gltf.parser?.json?.extras ?? {}) as
    { annotations?: AnnotationItem[]; state?: { annotations?: AnnotationItem[] } };
  const anns = override ?? extras.state?.annotations ?? extras.annotations;
  if (!Array.isArray(anns) || anns.length === 0) return { htmlLabels: [] };

  const htmlLabels: HtmlLabelDef[] = [];
  const dims: DimensionLineData[] = [];

  anns.forEach((an, i) =>
  {
    if (an && (an as LabelData).type === 'label')
    {
      const l = an as LabelData;
      if (!Array.isArray(l.position)) return;
      htmlLabels.push({
        id: `label-${i}`,
        text: String(l.value ?? ''),
        variant: 'label',
        anchorLocal: _worldToViewerPoint(l.position),
        class: l.class,
        shape: l.shape,
        target: l.target,
        /*  Left as the script set it, `null` included: the page and the viewer default this
            one differently on purpose (see AnnotatorLabel's header), and the viewer's default
            is applied where it is read, not here. */
        labelOnly: l.labelOnly ?? undefined,
        line: l.line,
        length: l.length,
        offset: l.offset,
        angle: l.angle,
        circle: l.circle,
      });
    }
    else
    {
      dims.push(an as DimensionLineData);
    }
  });

  if (dims.length === 0) return { htmlLabels };

  // 3D dimension-line geometry (line + arrowhead cones). Sizes are world units,
  // scaled by `arrowScale` so arrows stay legible across very different model sizes.
  const arrowLen = DIMENSION_ARROW_LENGTH * arrowScale;
  const arrowRad = DIMENSION_ARROW_RADIUS * arrowScale;

  const group = new THREE.Group();
  group.name = 'Dimensions';
  group.userData.isViewerHelper = true; // excluded from scene tree

  // toneMapped:false — annotation geometry is a UI overlay; AgX tone mapping
  // would otherwise desaturate the color toward gray.
  const lineMat = new THREE.LineBasicMaterial({ color: DIMENSION_LINE_COLOR, toneMapped: false });
  const coneMat = new THREE.MeshBasicMaterial({ color: DIMENSION_LINE_COLOR, toneMapped: false });
  const coneGeo = new THREE.ConeGeometry(arrowRad, arrowLen, 8); // 8 segments — matches the gizmo's arrowhead cones

  dims.forEach((d, i) =>
  {
    if (!d?.start || !d?.end) return;

    const a = _worldToViewerPoint(d.start);
    const b = _worldToViewerPoint(d.end);
    const dir = (d.dir ? _worldToViewerVector(d.dir) : b.clone().sub(a)).normalize();

    // main line
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), lineMat));

    // arrowheads at both ends (cone's +Y is its tip → orient to the line dir)
    const qEnd = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const qStart = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate());

    const coneEnd = new THREE.Mesh(coneGeo, coneMat);
    coneEnd.position.copy(b).addScaledVector(dir, -arrowLen / 2);
    coneEnd.quaternion.copy(qEnd);
    group.add(coneEnd);

    const coneStart = new THREE.Mesh(coneGeo, coneMat);
    coneStart.position.copy(a).addScaledVector(dir, arrowLen / 2);
    coneStart.quaternion.copy(qStart);
    group.add(coneStart);

    // value text → HTML overlay label at the midpoint / _labelPosition
    const lp = d._labelPosition
      ? _worldToViewerPoint(d._labelPosition)
      : a.clone().add(b).multiplyScalar(0.5);
    htmlLabels.push({
      id: `dim-${i}`,
      text: formatDimensionValue(d),
      variant: 'dimension',
      anchorLocal: lp,
      param: d.param,
      paramRemapSrc: d.paramRemapSrc,
      interactive: !!d.interactive && !!d.param,
      rawValue: d.value,
      dim: { value: d.value, units: d.units, showUnits: d.showUnits, round: d.round, roundDecimals: d.roundDecimals },
    });
  });

  modelGroup.add(group);
  return { htmlLabels };
}

/**
 * Format a dimension value for display, converting from the dimension's source
 * unit (the script's model unit) into the run's Metric/Imperial display system
 * with an auto-picked unit + fractional inches. Always converts + labels so the
 * value is unambiguous and updates when the switch flips. Reads the execution
 * result + scriptModelUnits so it reflects the current run each time it runs.
 */
export function formatDimensionValue(
  d: Pick<DimensionLineData, 'value' | 'units' | 'showUnits' | 'round' | 'roundDecimals'>,
): string
{
  // Non-numeric values are custom text — pass through unchanged.
  if (typeof d.value !== 'number') return String(d.value);

  const src: ModelUnits = (d.units && (d.units as ModelUnits) in MM_PER_UNIT)
    ? (d.units as ModelUnits)
    : scriptModelUnits.get();

  // No valid source unit → fall back to the raw (optionally rounded) number.
  if (!((src as string) in MM_PER_UNIT))
  {
    return (d.round ? _round(d.value, d.roundDecimals ?? 0) : d.value).toString();
  }

  // Convert to the run's display system with unit label (auto unit + fractions).
  return formatLength(toMM(d.value, src), _runDisplaySystem(), { withUnit: true });
}

function _round(n: number, decimals: number): number
{
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}
