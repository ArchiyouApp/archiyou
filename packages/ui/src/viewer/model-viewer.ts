import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildScenegraphPath, executionResult, scenegraph, scriptParams, updateParam, selectedPath, setSelectedPath, interactiveShapes, activeParamEntry, setActiveParamEntry, isObjectListParam, paramItemSchema } from '@archiyou/editor/src/state/workspace';
import { formatDimensionValue } from './gltf-annotations.js';
import { scheduleExecution, resetCameraCounter,
         instructName, instructStep, setInstructAvailable } from '@archiyou/editor/src/state/viewer';
import type { ScriptOutputData } from '@archiyou/core/src/execution/types';
import type { SceneNodeData } from '@archiyou/core/src/modeler/types';
import { applyEdgeExtensions, applyPointStyles } from './gltf-edge-extensions.js';
import { applyAnnotations } from './gltf-annotations.js';
import type { HtmlLabelDef } from './gltf-annotations.js';
import './viewer-labels-overlay.js';
import type { ViewerLabelsOverlay, OverlayLabel, OverlayLabelPos, DimensionParamChangeDetail } from './viewer-labels-overlay.js';
import { handleDefFromData } from './gltf-handles.js';
import type { HandleDef } from './gltf-handles.js';
import type { ManagedHandlesData } from '@archiyou/core/src/interaction/types';
import { mapFunctionResult, parseParamRef, rebuildFunction, snapClampChanged } from './handle-param.js';
import type { HandleDrag } from '@archiyou/core/src/interaction/types';
import type { ParamEntryRef } from '@archiyou/editor/src/state/types';
import './viewer-handles-overlay.js';
import type { ViewerHandlesOverlay, HandleOverlay, HandleOverlayPos, HandleDragEventDetail } from './viewer-handles-overlay.js';
import { VIEWER_AUTO_FRAME_ON_FIRST_LOAD, VIEWER_BACKGROUND_COLOR, VIEWER_BACKGROUND_COLOR_DARK,
  VIEWER_SCENE_SIZE,
  VIEWER_GRID_SIZE_FACTOR_FROM_SCENE, VIEWER_GRID_MIN_SIZE, VIEWER_GRID_MAX_SIZE,
  VIEWER_GRID_TARGET_CELLS, VIEWER_GRID_RECALC_FRACTION,
  VIEWER_GIZMO_AXIS_LENGTH, VIEWER_GIZMO_COLOR_X, VIEWER_GIZMO_COLOR_Y,
  VIEWER_GIZMO_COLOR_Z, VIEWER_GIZMO_COLOR_ORIGIN, VIEWER_GIZMO_LABEL_SIZE,
  VIEWER_GIZMO_LABEL_GAP_RATIO,
  VIEWER_GIZMO_SIZE_FACTOR_FROM_SCENE, VIEWER_GIZMO_RECALC_FRACTION, VIEWER_GIZMO_MIN_SCALE,
  VIEWER_GIZMO_ARROW_LENGTH_RATIO, VIEWER_GIZMO_ARROW_RADIUS_RATIO,
  VIEWER_GIZMO_DASH_SIZE_RATIO, VIEWER_GIZMO_DASH_GAP_RATIO,
  VIEWER_MODEL_COORDSYSTEM, VIEWER_HANDLE_RANGE_LINE_COLOR, VIEWER_HANDLE_RANGE_LINE_WIDTH,
  VIEWER_LIGHT_POSITION } from '@archiyou/editor/src/settings';
import { THEME_CHANGE_EVENT } from '@archiyou/editor/src/styles/dark-theme.js';
import { VIEW_STYLES } from './view-styles.js';
import {
  applyInstructStep, clearInstructStep as clearInstructApplied,
  advanceInstructMove, instructCamera,
} from './instruct-playback.js';
import type { InstructApplied, InstructDoc, InstructStep } from './instruct-playback.js';
export type { InstructDoc, InstructStep } from './instruct-playback.js';
import type { ViewStyle, ViewStyleMaterialConfig } from './view-styles.js';
import { FadingGrid } from './fading-grid.js';

/** Raw geometry node types that are implementation details of a GLB scene — never a
 *  scenegraph node of their own. They may be children of a named container. Shared by the
 *  viewer's path map and the thumbnail renderer, which align GLB children with the
 *  runner's scenegraph by walking the two side by side. */
const GEO_TYPES = new Set(['Mesh', 'LineSegments', 'LineSegments2', 'Line', 'Line2', 'Points']);
import './viewer-menu.js';

// ── Handle drag helpers ───────────────────────────────────────────────────────

/** Project a 3-D hit point onto the handle's u/v axes.
 *  Relative: project relative to the plane origin (offset from start).
 *  Absolute: project in world space (raw world coordinate along the axis). */
function _resolveHandleScalars(
  h: { plane: { origin: THREE.Vector3; uAxis: THREE.Vector3; vAxis: THREE.Vector3 }; rangeRelative: boolean },
  hit: THREE.Vector3,
): { uScalar: number; vScalar: number }
{
  const ref = h.rangeRelative ? hit.clone().sub(h.plane.origin) : hit.clone();
  return { uScalar: ref.dot(h.plane.uAxis), vScalar: ref.dot(h.plane.vAxis) };
}

/** Compute the base world position for placing the handle anchor, preserving
 *  the origin's components that are perpendicular to the drag axes.
 *
 *  Relative: base = origin  →  anchor = origin + uClamped·uAxis
 *  Absolute: base = origin stripped of its uAxis (and vAxis) component
 *            →  anchor = base + uClamped·uAxis   (preserves Z/Y of origin)
 *
 *  Example: origin=(50,0,50), uAxis=(1,0,0)
 *    Absolute base = (0,0,50)  →  anchor = (uClamped, 0, 50)  ✓  Z preserved
 */
function _handleBase(
  h: { plane: { origin: THREE.Vector3; uAxis: THREE.Vector3; vAxis: THREE.Vector3 }; rangeType: '1d'|'2d'; rangeRelative: boolean },
): THREE.Vector3
{
  if (h.rangeRelative) return h.plane.origin.clone();
  // Absolute: remove the u-component (and v-component for 2D) from origin
  const base = h.plane.origin.clone()
    .addScaledVector(h.plane.uAxis, -h.plane.origin.dot(h.plane.uAxis));
  if (h.rangeType === '2d')
    base.addScaledVector(h.plane.vAxis, -h.plane.origin.dot(h.plane.vAxis));
  return base;
}

function _clampHandleScalars(
  h: { rangeType: '1d' | '2d'; rangeMin: number | [number,number]; rangeMax: number | [number,number] },
  u: number, v: number,
): [number, number]
{
  if (h.rangeType === '1d')
  {
    return [Math.max(h.rangeMin as number, Math.min(h.rangeMax as number, u)), v];
  }
  const [minU, minV] = h.rangeMin as [number,number];
  const [maxU, maxV] = h.rangeMax as [number,number];
  return [Math.max(minU, Math.min(maxU, u)), Math.max(minV, Math.min(maxV, v))];
}

/** Postcondition checks applied to mapped values before `param.validateValue()`.
 *  Applied automatically to every handle path (single-param and multi-param)
 *  so script authors don't need to guard map functions against schema constraints. */
const PARAM_MAP_PRECHECKS: Array<{
  check: (param: { schema: any }) => boolean;
  fix:   (value: any, param: { schema: any }) => any;
}> = [
  // Number params with a multipleOf step → round to nearest valid multiple.
  // Covers integers (multipleOf:1) and any other step size (multipleOf:5, 0.1, …).
  {
    check: (p) => p.schema?.type === 'number' && typeof p.schema?.multipleOf === 'number' && p.schema.multipleOf > 0,
    fix:   (v, p) => Math.round(v / p.schema.multipleOf) * p.schema.multipleOf,
  },
];

// ── Grid helper ───────────────────────────────────────────────────────────────

/** Round a raw step size up to the nearest "nice" number (1, 2, 5, 10, 20, …). */
function _niceGridStep(rawStep: number): number
{
  if (rawStep <= 0) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm  = rawStep / power;
  if (norm < 1.5) return power;
  if (norm < 3.5) return 2 * power;
  if (norm < 7.5) return 5 * power;
  return 10 * power;
}

/** Derive a stepped grid size + division count from the current scene size.
 *  The extent scales with the model (clamped to a min/max); the cell size snaps
 *  to a "nice" step so the grid keeps ~VIEWER_GRID_TARGET_CELLS cells at any scale. */
function _computeGridParams(sceneSize: number): { size: number; divisions: number }
{
  const extent = Math.min(
    VIEWER_GRID_MAX_SIZE,
    Math.max(VIEWER_GRID_MIN_SIZE, sceneSize * VIEWER_GRID_SIZE_FACTOR_FROM_SCENE),
  );
  const cellStep  = _niceGridStep(extent / VIEWER_GRID_TARGET_CELLS);
  const size      = Math.ceil(extent / cellStep) * cellStep;
  const divisions = Math.max(1, Math.round(size / cellStep));
  return { size, divisions };
}

/**
 * <model-viewer> — Three.js GLTF viewer with IBL, spotlight shadows, and AgX tone mapping.
 */
@customElement('model-viewer')
export class ModelViewer extends SignalWatcher(LitElement)
{
  // ── 1. Render ──
  override render()
  {
    // Read signals so SignalWatcher tracks them and re-renders on change
    this._pendingGlbOutput = executionResult.get()?.outputs
      ?.find(o => o.path.requestedPath === 'default/model/glb');
    this._pendingScenegraph = scenegraph.get();
    this._pendingResetCount = resetCameraCounter.get();
    this._pendingSelectedPath = selectedPath.get();
    this._interactiveShapes = interactiveShapes.get();
    this._pendingActiveEntry = activeParamEntry.get();
    this._pendingUnitSystem = (executionResult.get()?.request?.unitSystem as string) ?? null;
    this._pendingInstructName = instructName.get();
    this._pendingInstructStep = instructStep.get();

    return html`
      <canvas></canvas>
      <viewer-labels-overlay
        @dim-param-change=${this._onDimParamChange}
      ></viewer-labels-overlay>
      <viewer-handles-overlay
        .activeId=${this._activeHandleIdFor(this._pendingActiveEntry)}
        @handle-drag-start=${this._onHandleDragStart}
        @handle-drag-move=${this._onHandleDragMove}
        @handle-drag-end=${this._onHandleDragEnd}
      ></viewer-handles-overlay>
      <viewer-menu
        .activeStyleId=${this._activeStyleId}
        .arSupported=${this._arSupported}
        .arActive=${this._arActive}
        .isOrtho=${this._isOrtho}
        .gridVisible=${this._gridVisible}
        .gizmoVisible=${this._gizmoVisible}
        .animations=${this._animationClips.map(c => c.name)}
        .activeAnimation=${this._activeAnimationName}
        @viewer-zoom-in=${this._zoomIn}
        @viewer-zoom-out=${this._zoomOut}
        @viewer-center=${this._centerCamera}
        @viewer-set-style=${(e: Event) =>
          this._applyViewStyle((e as CustomEvent<{ styleId: string }>).detail.styleId)}
        @viewer-set-animation=${(e: Event) =>
          this._playAnimation((e as CustomEvent<{ name: string | null }>).detail.name)}
        @viewer-toggle-ar=${this._toggleAR}
        @viewer-toggle-projection=${this._toggleProjection}
        @viewer-toggle-grid=${this._toggleGrid}
        @viewer-toggle-gizmo=${this._toggleGizmo}
      ></viewer-menu>
    `;
  }

  // ── 3. Lifecycle ──
  override firstUpdated()
  {
    const canvas = this.renderRoot.querySelector('canvas')!;
    this._initRenderer(canvas);
    this._initScene();
    this._initLights();
    this._initGround();
    this._initGizmo();
    this._initControls(canvas);
    this._initLoaders();
    this._initAR();
    this._loop();

    canvas.addEventListener('pointerdown', this._hitTestGizmo);
    canvas.addEventListener('pointerdown', this._onPickPointerDown);
    canvas.addEventListener('pointerup', this._onPickPointerUp);

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(this);

    window.addEventListener(THEME_CHANGE_EVENT, this._onThemeChange);
  }

  /** Re-apply the current view style so the neutral background swaps light/dark. */
  private _onThemeChange = () =>
  {
    if (this._renderer) this._applyViewStyle(this._activeStyleId);
    this._syncDimBackground();
  };

  /** Keep the HTML dimension-value background matched to the (theme-resolved)
   *  viewer background, so the text stays readable in both themes. */
  private _syncDimBackground()
  {
    const overlay = this.renderRoot?.querySelector('viewer-labels-overlay') as HTMLElement | null;
    if (!overlay) return;
    const bg = this._resolveBackground(VIEWER_BACKGROUND_COLOR);
    overlay.style.setProperty('--ay-dim-bg', '#' + bg.toString(16).padStart(6, '0'));
  }

  override updated(_changed: Map<string, unknown>)
  {
    if (this._pendingResetCount !== this._lastHandledResetCount)
    {
      this._lastHandledResetCount = this._pendingResetCount;
      this._forceFrameOnNextLoad  = true;
      this._hasFramedCamera       = false;
    }

    const glbOutput = this._pendingGlbOutput;
    if (glbOutput && glbOutput !== this._lastGlbOutput && this._renderer)
    {
      this._lastGlbOutput = glbOutput;
      this._loadGlbOutput(glbOutput);
    }

    // GLB supplied imperatively via load() (standalone), flushed once the
    // renderer exists. Edges + annotations render from the GLB's own extras.
    if (this._directGlbOutput && this._directGlbOutput !== this._lastGlbOutput && this._renderer)
    {
      this._lastGlbOutput = this._directGlbOutput;
      this._loadGlbOutput(this._directGlbOutput);
    }

    /*  Instruct playback, driven by a tool through the signals rather than by the tool
        reaching for this element across shadow roots. The API below is the real interface;
        this is only the editor's way of calling it. */
    if (this._pendingInstructStep !== this._instructIndex
        || (this._pendingInstructStep >= 0 && this._pendingInstructName !== this._instructName))
    {
      if (this._pendingInstructStep < 0) { if (this._instructIndex >= 0) this.clearInstruct() }
      else if (this._renderer)
      {
        this.showInstructStep(this._pendingInstructStep, { name: this._pendingInstructName ?? undefined });
      }
    }

    // Metric/Imperial switch flipped → re-format existing dimension labels
    // in place (no 3D rebuild needed; geometry is unit-agnostic).
    if (this._pendingUnitSystem !== this._lastUnitSystem)
    {
      this._lastUnitSystem = this._pendingUnitSystem;
      this._refreshDimLabelText();
    }

    // Re-apply full view style when the scenegraph signal mutates (toggle, or
    // a fresh result reconciled into a new tree). The signal always replaces
    // the root reference on mutation, so cheap reference compare is enough.
    if (this._pendingScenegraph !== this._lastAppliedScenegraph && this._renderer)
    {
      this._lastAppliedScenegraph = this._pendingScenegraph;
      this._applyViewStyle(this._activeStyleId);
    }

    // Selection highlight (driven by the selectedPath signal, identity by path).
    if (this._pendingSelectedPath !== this._lastAppliedSelectedPath && this._renderer)
    {
      this._lastAppliedSelectedPath = this._pendingSelectedPath;
      this._applySelectionHighlight(this._pendingSelectedPath);
    }
  }

  /**
   * Load a standalone GLB into the viewer, imperatively.
   *
   * Use this for standalone / headless setups (no editor signal store): feed it
   * the GLB produced by the kernel, e.g.
   *
   * ```ts
   * const glb = await worker.execute('box(100,100,100)', { outputs: ['default/model/glb'] });
   * document.querySelector('model-viewer').load(glb);
   * ```
   *
   * CAD hard edges and dimension/label annotations render from the GLB's own
   * glTF extensions/extras — no execution-result state is required. Interactive
   * editing features (drag handles, click-selection, scenegraph toggles) still
   * require the editor's signal wiring and are inert here.
   *
   * @param glb GLB bytes as an `ArrayBuffer`/`Uint8Array`, or a full
   *            `ScriptOutputData` (as returned in a result's `outputs`).
   */
  load(glb: ArrayBuffer | Uint8Array | ScriptOutputData): void
  {
    const entry: ScriptOutputData = (glb && typeof glb === 'object' && 'output' in glb)
      ? glb as ScriptOutputData
      : { output: glb } as ScriptOutputData;

    this._directGlbOutput = entry;

    if (this._renderer)
    {
      this._lastGlbOutput = entry;
      this._loadGlbOutput(entry);
    }
    else
    {
      // Renderer not ready yet — flush in updated() once _initRenderer has run.
      this.requestUpdate();
    }
  }

  override disconnectedCallback()
  {
    super.disconnectedCallback();
    window.removeEventListener(THEME_CHANGE_EVENT, this._onThemeChange);
    cancelAnimationFrame(this._frameId);
    this._resizeObserver?.disconnect();
    this._controls?.dispose();
    this._renderer?.dispose();
    this._roomEnvTexture?.dispose();
  }

  // ── 4. State ──

  // Reactive state that updates viewer-menu props
  @state() private _activeStyleId = 'realistic';
  @state() private _arSupported = false;
  @state() private _arActive = false;
  @state() private _isOrtho = false;
  @state() private _gridVisible = true;
  @state() private _gizmoVisible = true;

  // Three.js scene objects
  private _renderer!: THREE.WebGLRenderer;
  private _scene!: THREE.Scene;
  private _camera!: THREE.PerspectiveCamera;
  private _orthoCamera?: THREE.OrthographicCamera;
  private _controls!: OrbitControls;
  private _ambientLight!: THREE.AmbientLight;
  private _keyLight!: THREE.DirectionalLight;
  private _hemiLight?: THREE.HemisphereLight;
  private _groundMesh?: THREE.Mesh;
  private _groundShadowMesh?: THREE.Mesh;
  private _gridHelper?: FadingGrid;
  private _appliedGridPrimary?:   number;
  private _appliedGridSecondary?: number;
  private _appliedGridPrimaryEvery?: number;
  /** Grid geometry currently applied, and the scene size at the last rebuild.
   *  `_gridAppliedSize === 0` means "not yet sized". Used to step the grid to the
   *  scene size (like the gizmo) without rebuilding on small parametric changes. */
  private _gridAppliedSize      = 0;
  private _gridAppliedDivisions = 0;
  private _gridSceneSize        = 0;
  private _gizmoGroup?: THREE.Group;
  /** Scene size (largest bbox dimension) at the last gizmo-scale recalc, and the
   *  scale currently applied. `_gizmoScale === 0` means "not yet computed". */
  private _gizmoSceneSize = 0;
  private _gizmoScale = 0;
  private _roomEnvTexture?: THREE.Texture;

  // Model / animation
  private _gltfLoader!: GLTFLoader;
  private _resizeObserver?: ResizeObserver;
  private _frameId = 0;
  private _mixer?: THREE.AnimationMixer;
  private _clock = new THREE.Clock();
  @state() private _animationClips: THREE.AnimationClip[] = [];
  @state() private _activeAnimationName: string | null = null;
  private _dirty = true;
  private _currentModel?: THREE.Object3D;
  /** The labels being projected each frame: the annotations, or the current step's. */
  private _htmlLabels: HtmlLabelDef[] = [];
  /** The model's own annotations, as applyAnnotations() returned them. */
  private _annotationLabels: HtmlLabelDef[] = [];
  /** The current instruct step's labels, empty when playback is off. */
  private _instructLabels: HtmlLabelDef[] = [];

  // Instruct — step-by-step assembly playback. API only; the controls live in a tool.
  /** Instructables from the run's state (or a standalone GLB's extras). */
  private _instructData: InstructDoc[] = [];
  /** Name of the instructable being stepped through, null when off. */
  private _instructName: string | null = null;
  /** Current step, -1 when off. */
  private _instructIndex = -1;
  /** Everything the current step changed in the scene, and enough to put it back. Kept apart
   *  from _userHiddenObjects, which belongs to the scene explorer. */
  private _instructApplied: InstructApplied | null = null;
  private _pendingUnitSystem: string | null = null;
  private _lastUnitSystem: string | null = null;
  private _htmlHandles: HandleDef[] = [];
  private _activeHandle: HandleDef | null = null;
  /** Anchor at drag start, so a gesture that turns out to be a click can be undone —
   *  _onHandleDragMove has already nudged anchorLocal by then. */
  private _dragStartAnchor: THREE.Vector3 | null = null;
  private _pendingActiveEntry: ParamEntryRef | null = null;
  private _handleHitPlane = new THREE.Plane();
  private _handleRaycaster = new THREE.Raycaster();
  private _rangeHelper?: THREE.Object3D;
  private _projV = new THREE.Vector3(); // reused for world→screen projection
  private _lastGlbOutput?: ScriptOutputData;
  private _pendingGlbOutput?: ScriptOutputData;
  /** GLB fed imperatively via load() (standalone use, no editor signals). Kept
   *  separate from _pendingGlbOutput because render() recomputes that from the
   *  executionResult signal each cycle and would clobber a direct load. */
  private _directGlbOutput?: ScriptOutputData;
  private _hasFramedCamera = false;
  private _pendingResetCount     = 0;
  private _lastHandledResetCount = 0;
  private _forceFrameOnNextLoad  = false;
  /** Bounding-sphere radius the camera was last framed for. Drives the
   *  outgrown-model re-frame in _refitIfOutgrown(). */
  private _framedRadius = 0;

  // View-style override tracking
  private _savedMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private _savedLineColors = new Map<THREE.Object3D, { color: THREE.Color; opacity: number; transparent: boolean; linewidth?: number; dashed?: boolean; dashSize?: number; gapSize?: number }>();
  private _overrideMaterials: THREE.Material[] = [];
  private _hiddenObjects: THREE.Object3D[] = [];
  private _userHiddenObjects: THREE.Object3D[] = [];

  // AR
  private _xrSession?: unknown;

  // Node visibility (driven by scenegraph signal, identity by path).
  private _pendingScenegraph: SceneNodeData | null = null;
  private _lastAppliedScenegraph: SceneNodeData | null = null;
  /** Path → Three.js object map rebuilt on every GLB load; matches the
   *  filtering rules used by the runner-side path emitter so paths line up. */
  private _pathToObject = new Map<string, THREE.Object3D>();

  // Click-selection (identity by scene path; see state/editor.ts selectedPath).
  private _pendingSelectedPath: string | null = null;
  private _pendingInstructName: string | null = null;
  private _pendingInstructStep = -1;
  /** Sentinel `undefined` so the first apply always runs (null is a valid state). */
  private _lastAppliedSelectedPath: string | null | undefined = undefined;
  /** Scene paths the last run declared interactive (onClick). A click on one of
   *  these triggers a re-run; other clicks only highlight + select. */
  private _interactiveShapes: string[] = [];
  /** Wireframe box drawn around the currently selected node. */
  private _selectionBox?: THREE.BoxHelper;
  // Pointer-down tracking so an orbit/pan drag isn't treated as a select-click.
  private _pickDownPos?: { x: number; y: number };
  private _pickDownTime = 0;
  /** Set when a pointerdown hit the gizmo, so the matching pointerup doesn't also pick. */
  private _skipNextPick = false;

  // Camera tween state for smooth axis-snap
  private _cameraTween?: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    upTarget: THREE.Vector3;
    t: number;
    duration: number;
  };

  // ── 5. Initialisation helpers ──

  private _initRenderer(canvas: HTMLCanvasElement)
  {
    const r = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
    });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setClearColor(this._resolveBackground(VIEWER_BACKGROUND_COLOR));
    this._renderer = r;
  }

  /** Resolve a style's background against the active theme. The neutral light
   *  background follows the theme (dark in dark mode); styles with their own
   *  deliberate background (blueprint, wireframe, …) are left untouched. */
  private _resolveBackground(styleBg: number): number
  {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return dark && styleBg === VIEWER_BACKGROUND_COLOR ? VIEWER_BACKGROUND_COLOR_DARK : styleBg;
  }

  private _initScene()
  {
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(this._resolveBackground(VIEWER_BACKGROUND_COLOR));

    // Image-based lighting from a procedural studio-style room environment
    const pmrem = new THREE.PMREMGenerator(this._renderer);
    const envScene = new RoomEnvironment();
    this._roomEnvTexture = pmrem.fromScene(envScene, 0.04).texture;
    this._scene.environment = this._roomEnvTexture;
    envScene.dispose();
    pmrem.dispose();

    this._camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    // Z-up coordinate system: camera looks from above-right-front in CAD space
    this._camera.up.set(0, 0, VIEWER_MODEL_COORDSYSTEM.up === 'z' ? 1 : 0);
    this._camera.position.set(3, -3, 2);
  }

  private _initLights()
  {
    this._ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    this._scene.add(this._ambientLight);

    // Key directional light (parallel rays, no cone) for shadow casting.
    const dir = new THREE.DirectionalLight(0xffffff, 3);
    dir.position.set(...VIEWER_LIGHT_POSITION);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.bias = 0;
    dir.shadow.normalBias = 0.02;
    dir.shadow.radius = 6;
    // Frustum will be resized per model in _updateSpotlightForModel().
    // Use safe defaults until then.
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 3000;
    dir.shadow.camera.left   = -10;
    dir.shadow.camera.right  =  10;
    dir.shadow.camera.top    =  10;
    dir.shadow.camera.bottom = -10;
    this._scene.add(dir);
    this._scene.add(dir.target);
    this._keyLight = dir;
  }

  private _initGround()
  {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({
        color: 0xe5e7eb,
        roughness: 1,
        metalness: 0,
      }),
    );
    // PlaneGeometry lies in the XY plane by default, which is the Z=0 ground in Z-up
    mesh.receiveShadow = true;
    mesh.userData.isViewerHelper = true;
    mesh.visible = false;
    this._scene.add(mesh);
    this._groundMesh = mesh;

    const shadowMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: 0.28 }),
    );
    shadowMesh.receiveShadow = true;
    shadowMesh.userData.isViewerHelper = true;
    shadowMesh.visible = false;
    this._scene.add(shadowMesh);
    this._groundShadowMesh = shadowMesh;

    this._updateGroundPlane();
  }

  private _initControls(canvas: HTMLCanvasElement)
  {
    const c = new OrbitControls(this._camera, canvas);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.maxPolarAngle = Math.PI / 2 - 0.05;
    c.minDistance = 0.1;
    c.maxDistance = 50;
    c.target.set(0, 0, 0);
    c.update();

    // Belt-and-suspenders: mark dirty on any camera change event, in addition
    // to the controls.update() return-value check in the render loop.
    c.addEventListener('change', () => { this._dirty = true; });

    // On Linux/GTK, switching from a pointer-drag to a scroll wheel can fire
    // `pointercancel`, which releases browser pointer-capture without notifying
    // OrbitControls. OrbitControls leaves its internal `state` set to ROTATE/PAN,
    // and its wheel handler silently returns early while state !== _STATE.NONE (-1).
    // Resetting state here unblocks wheel events immediately.
    canvas.addEventListener('pointercancel', () =>
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c as any).state = -1; // _STATE.NONE = -1 in Three.js r0.171
    });

    this._controls = c;
  }

  private _initLoaders()
  {
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    this._gltfLoader = new GLTFLoader();
    this._gltfLoader.setDRACOLoader(draco);
  }

  private _initAR = async () =>
  {
    if ('xr' in navigator)
    {
      try
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this._arSupported = await (navigator as any).xr.isSessionSupported('immersive-ar');
      }
      catch
      {
        this._arSupported = false;
      }
    }
  };

  // ── 6. Navigation controls ──

  private _zoomIn = () =>
  {
    // OrbitControls always drives the perspective camera (single source of
    // truth); the ortho camera mirrors it. Dolly the perspective camera and
    // let the per-frame mirror rebuild the ortho frustum from the new distance.
    const dir = this._camera.position.clone().sub(this._controls.target);
    const dist = dir.length();
    const newDist = Math.max(this._controls.minDistance, dist * 0.8);
    this._camera.position.copy(
      this._controls.target.clone().add(dir.normalize().multiplyScalar(newDist)),
    );
    this._controls.update();
    if (this._isOrtho) this._buildOrthoFromPersp();
    this._dirty = true;
  };

  private _zoomOut = () =>
  {
    const dir = this._camera.position.clone().sub(this._controls.target);
    const dist = dir.length();
    const newDist = Math.min(this._controls.maxDistance, dist * 1.25);
    this._camera.position.copy(
      this._controls.target.clone().add(dir.normalize().multiplyScalar(newDist)),
    );
    this._controls.update();
    if (this._isOrtho) this._buildOrthoFromPersp();
    this._dirty = true;
  };

  private _centerCamera = () =>
  {
    if (this._currentModel)
    {
      this._frameCamera(this._currentModel);
    }
    else
    {
      this._controls.target.set(0, 0, 0);
      this._camera.position.set(3, -3, 2);
      this._controls.update();
      this._dirty = true;
    }
  };

  private _updateCameraRangesForObject(obj: THREE.Object3D, framedDistance?: number)
  {
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const currentDistance = this._camera.position.distanceTo(this._controls.target);
    const baseDistance = Math.max(framedDistance ?? 0, currentDistance, maxDim);

    this._controls.minDistance = Math.max(maxDim * 0.001, 0.01);
    this._controls.maxDistance = Math.max(baseDistance * 10, maxDim * 20);

    this._camera.near = Math.max(baseDistance * 0.001, 0.001);
    this._camera.far = Math.max(baseDistance * 50, maxDim * 50, this._camera.near + 1);
    this._camera.updateProjectionMatrix();

    if (this._isOrtho)
    {
      this._buildOrthoFromPersp();
    }
  }

  private _playAnimation(name: string | null)
  {
    if (!this._mixer) return;

    if (name === null)
    {
      const activeClip = this._activeAnimationName
        ? this._animationClips.find(c => c.name === this._activeAnimationName)
        : undefined;

      if (!activeClip)
      {
        this._activeAnimationName = null;
        this._dirty = true;
        return;
      }

      this._mixer.stopAllAction();
      this._playClip(activeClip, true);
      this._activeAnimationName = null;
      this._dirty = true;
      return;
    }

    this._mixer.stopAllAction();
    const clip = this._animationClips.find(c => c.name === name);

    if (clip)
    {
      this._playClip(clip);
    }

    this._activeAnimationName = name;
    this._dirty = true;
  }

  private _playClip(clip: THREE.AnimationClip, reverse = false)
  {
    if (!this._mixer) return;

    const action = this._mixer.clipAction(clip);
    action.reset();
    action.paused = false;
    action.enabled = true;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.setEffectiveTimeScale(reverse ? -1 : 1);
    action.setEffectiveWeight(1);
    action.time = reverse ? clip.duration : 0;
    action.play();
  }

  // ── 7. AR mode ──

  private _toggleAR = async () =>
  {
    if (!this._arSupported) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const xr = (navigator as any).xr;

    if (this._arActive && this._xrSession)
    {
      await (this._xrSession as { end(): Promise<void> }).end();
      return;
    }

    try
    {
      const session = await xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
      });
      this._xrSession = session;
      this._renderer.xr.enabled = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this._renderer.xr.setSession(session as any);
      this._arActive = true;

      // Switch from rAF to XR animation loop
      cancelAnimationFrame(this._frameId);
      this._renderer.setAnimationLoop(() =>
      {
        if (this._controls.update()) this._dirty = true;
        if (this._isOrtho) this._buildOrthoFromPersp();
        this._renderer.render(this._scene, this._isOrtho ? this._orthoCamera! : this._camera);
      });

      session.addEventListener('end', () =>
      {
        this._arActive = false;
        this._xrSession = undefined;
        this._renderer.xr.enabled = false;
        this._renderer.setAnimationLoop(null);
        this._loop();
        this._dirty = true;
      });
    }
    catch (e)
    {
      console.warn('AR session failed:', e);
    }
  };

  // ── 8. View styles ──

  private _buildOrthoFromPersp(): void
  {
    const dist = this._camera.position.distanceTo(this._controls.target);
    const fovRad = (this._camera.fov * Math.PI) / 180;
    const frustumH = 2 * dist * Math.tan(fovRad / 2);
    const aspect = this._camera.aspect;

    if (!this._orthoCamera)
    {
      this._orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 10000);
    }
    this._orthoCamera.left   = -(frustumH * aspect) / 2;
    this._orthoCamera.right  =  (frustumH * aspect) / 2;
    this._orthoCamera.top    =  frustumH / 2;
    this._orthoCamera.bottom = -frustumH / 2;
    this._orthoCamera.near   = this._camera.near;
    this._orthoCamera.far    = this._camera.far;
    this._orthoCamera.position.copy(this._camera.position);
    this._orthoCamera.quaternion.copy(this._camera.quaternion);
    this._orthoCamera.updateProjectionMatrix();
  }

  private _toggleProjection = () =>
  {
    // OrbitControls stays bound to the perspective camera in both modes. In
    // ortho mode we simply render through a mirrored orthographic camera that
    // is kept in sync each frame, so the viewpoint never jumps on toggle and
    // orbiting/zooming behaves identically to perspective mode.
    if (!this._isOrtho)
    {
      this._buildOrthoFromPersp();
      this._isOrtho = true;
    }
    else
    {
      this._isOrtho = false;
    }
    this._dirty = true;
  };

  private _toggleGrid = () =>
  {
    this._gridVisible = !this._gridVisible;
    this._updateGrid();
    this._dirty = true;
  };

  private _toggleGizmo = () =>
  {
    this._gizmoVisible = !this._gizmoVisible;
    if (this._gizmoGroup) this._gizmoGroup.visible = this._gizmoVisible;
    this._dirty = true;
  };

  private _updateGroundPlane()
  {
    if (!this._groundMesh || !this._groundShadowMesh) return;

    const size = VIEWER_SCENE_SIZE;
    const zOffset = 1;
    const shadowOffset = 0.25;

    this._groundMesh.scale.set(size, size, 1);
    this._groundShadowMesh.scale.set(size, size, 1);

    if (!this._currentModel)
    {
      this._groundMesh.position.set(0, 0, -zOffset);
      this._groundShadowMesh.position.set(0, 0, -zOffset + shadowOffset);
      return;
    }

    const box = new THREE.Box3().setFromObject(this._currentModel);
    if (box.isEmpty())
    {
      this._groundMesh.position.set(0, 0, -zOffset);
      this._groundShadowMesh.position.set(0, 0, -zOffset + shadowOffset);
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    this._groundMesh.position.set(center.x, center.y, -zOffset);
    this._groundShadowMesh.position.set(center.x, center.y, -zOffset + shadowOffset);
  }

  /** Scene size = largest dimension of the current model's bounding box (0 if none). */
  private _computeSceneSize(): number
  {
    if (!this._currentModel) return 0;
    const box = new THREE.Box3().setFromObject(this._currentModel);
    if (box.isEmpty()) return 0;
    const s = box.getSize(new THREE.Vector3());
    return Math.max(s.x, s.y, s.z);
  }

  /** Scale the origin gizmo (axis/origin) to the scene so it stays readable on
   *  large models — and legible (not oversized) on small ones. To avoid the
   *  gizmo jumping around while a parametric model changes by small amounts,
   *  the scale is only recomputed when the scene size (largest bbox dimension)
   *  has moved by more than VIEWER_GIZMO_RECALC_FRACTION of itself since the last
   *  recalc (like the grid). See the settings for the scale-factor formula
   *  (calibrated for a scene size of 100 → factor 1; proportional either way). */
  private _updateGizmoScale()
  {
    if (!this._gizmoGroup) return;

    const sceneSize = this._computeSceneSize();

    // Skip small changes — only recompute past the threshold (always compute the
    // first time, when the scale has not been established yet). The threshold is
    // relative: a fixed one in world units either never fires on a metric scene or
    // fires constantly on a millimetre one.
    const uninitialized = this._gizmoScale === 0;
    const threshold = this._gizmoSceneSize * VIEWER_GIZMO_RECALC_FRACTION;
    if (!uninitialized && Math.abs(sceneSize - this._gizmoSceneSize) < threshold)
    {
      return;
    }

    this._gizmoSceneSize = sceneSize;
    // Proportional to scene size in both directions (scene 100 → 1, scene 10 →
    // 0.1, scene 1000 → 10…). sceneSize is 0 only when no model is loaded yet —
    // keep the base scale then rather than shrinking the gizmo to nothing.
    const scaleFactor = sceneSize > 0
      ? Math.max(VIEWER_GIZMO_MIN_SCALE, sceneSize * VIEWER_GIZMO_SIZE_FACTOR_FROM_SCENE)
      : 1;
    this._gizmoScale = scaleFactor;
    this._gizmoGroup.scale.setScalar(scaleFactor);
  }

  private _updateSpotlightForModel()
  {
    // Derive a fixed unit direction and distance from VIEWER_LIGHT_POSITION.
    // We then offset BOTH the light position and its target from the model centre
    // by that direction, so the direction vector is always exactly constant
    // regardless of model position or bounding-box size.
    const lightVec = new THREE.Vector3(...VIEWER_LIGHT_POSITION);
    const lightDistance = lightVec.length();
    const lightDir = lightVec.clone().normalize();

    const center = (() =>
    {
      if (this._currentModel)
      {
        const b = new THREE.Box3().setFromObject(this._currentModel);
        if (!b.isEmpty()) return b.getCenter(new THREE.Vector3());
      }
      return new THREE.Vector3(0, 0, 0);
    })();

    const sceneRadius = (() =>
    {
      if (this._currentModel)
      {
        const b = new THREE.Box3().setFromObject(this._currentModel);
        if (!b.isEmpty())
        {
          const s = b.getSize(new THREE.Vector3());
          return Math.max(Math.max(s.x, s.y, s.z) * 0.5, 1);
        }
      }
      return 50;
    })();

    // Light position = model centre + light direction * fixed distance.
    // Target = model centre. Direction = lightDir always.
    const lightPos = center.clone().addScaledVector(lightDir, lightDistance);
    // Keep the frustum tight around the model — just enough to cast the shadow
    // onto the ground catcher. A tight frustum = more shadow-map texels per
    // world unit = no acne without needing a huge normalBias.
    const halfExtent = sceneRadius * 1.5;

    this._keyLight.position.copy(lightPos);
    this._keyLight.target.position.copy(center);
    this._keyLight.shadow.mapSize.set(2048, 2048);
    this._keyLight.shadow.camera.near = Math.max(lightDistance - sceneRadius * 6, 1);
    this._keyLight.shadow.camera.far  = lightDistance + sceneRadius * 6;
    this._keyLight.shadow.camera.left   = -halfExtent;
    this._keyLight.shadow.camera.right  =  halfExtent;
    this._keyLight.shadow.camera.top    =  halfExtent;
    this._keyLight.shadow.camera.bottom = -halfExtent;
    this._keyLight.shadow.bias = 0;
    this._keyLight.shadow.normalBias = 0.02;
    this._keyLight.shadow.radius = 6;
    this._keyLight.shadow.camera.updateProjectionMatrix();
    this._keyLight.target.updateMatrixWorld();
  }

  /**
  * Build the GridHelper once at a fixed scene size.
   * The grid colour is always allowed to change (driven by the active style).
   */
  private _updateGrid()
  {
    const style = VIEW_STYLES.find(s => s.id === this._activeStyleId);

    if (!this._gridVisible)
    {
      if (this._gridHelper) this._gridHelper.visible = false;
      return;
    }

    // Use a neutral fallback color when the active style has no grid config
    let primary        = style?.grid?.primaryColor   ?? 0x666666;
    let secondary      = style?.grid?.secondaryColor ?? 0xAAAAAA;
    const primaryEvery = style?.grid?.primaryEvery   ?? 5;

    // In dark mode, the neutral (light-background) styles get a dimmed grid that
    // fades into the dark background instead of glaring light lines.
    const styleBg  = style?.background ?? VIEWER_BACKGROUND_COLOR;
    const fadeColor = this._resolveBackground(styleBg);
    if (fadeColor !== styleBg) // neutral style, dark theme active
    {
      primary   = 0x475569; // slate-600
      secondary = 0x334155; // slate-700
    }

    if (!this._gridHelper)
    {
      const { size, divisions } = _computeGridParams(this._computeSceneSize());

      this._gridHelper = new FadingGrid(
        size, divisions, primary, secondary,
        fadeColor, primaryEvery,
      );
      // GridHelper is XZ by default; rotate to XY for Z-up ground plane
      this._gridHelper.rotation.x = -Math.PI / 2;
      this._gridHelper.userData.isViewerHelper = true;
      this._scene.add(this._gridHelper);
      this._appliedGridPrimary      = primary;
      this._appliedGridSecondary    = secondary;
      this._appliedGridPrimaryEvery = primaryEvery;
      this._gridAppliedSize         = size;
      this._gridAppliedDivisions    = divisions;
      this._gridSceneSize           = this._computeSceneSize();
      this._gridHelper.position.z = 0;
      return;
    }

    this._gridHelper.visible = true;
    this._gridHelper.position.z = 0;

    if (this._appliedGridPrimary !== primary || this._appliedGridSecondary !== secondary)
    {
      this._gridHelper.setColors(primary, secondary);
      this._appliedGridPrimary   = primary;
      this._appliedGridSecondary = secondary;
    }
    if (this._appliedGridPrimaryEvery !== primaryEvery)
    {
      this._gridHelper.setPrimaryEvery(primaryEvery);
      this._appliedGridPrimaryEvery = primaryEvery;
    }
    // Keep the radial fade matched to the (theme-resolved) background.
    this._gridHelper.setFadeColor(fadeColor);

    // Step the grid extent/cell size to the current scene (like the gizmo).
    this._updateGridSize();
  }

  /** Resize the grid geometry to the scene, stepped so the cell size snaps to
   *  "nice" values. Rebuild is gated on VIEWER_GRID_RECALC_FRACTION so small
   *  parametric changes don't churn the geometry. */
  private _updateGridSize()
  {
    if (!this._gridHelper) return;

    const sceneSize = this._computeSceneSize();

    // Skip small changes — only recompute once the scene size has moved past a
    // fraction of the current grid size (always compute the first time).
    const uninitialized = this._gridAppliedSize === 0;
    if (!uninitialized &&
        Math.abs(sceneSize - this._gridSceneSize) < this._gridAppliedSize * VIEWER_GRID_RECALC_FRACTION)
    {
      return;
    }

    const { size, divisions } = _computeGridParams(sceneSize);
    this._gridSceneSize = sceneSize;
    if (size === this._gridAppliedSize && divisions === this._gridAppliedDivisions) return;

    this._gridHelper.setSize(size, divisions);
    this._gridAppliedSize      = size;
    this._gridAppliedDivisions = divisions;
  }

  private _initGizmo()
  {
    this._gizmoGroup = new THREE.Group();
    this._gizmoGroup.userData.isViewerHelper = true;

    // Z-up: camera.up = (0,0,1), so world axes align directly with CAD axes
    const axes: Array<{ axis: 'x' | 'y' | 'z'; label: string; dir: THREE.Vector3; color: number }> = [
      { axis: 'x', label: 'X', dir: new THREE.Vector3(1,  0,  0), color: VIEWER_GIZMO_COLOR_X },
      { axis: 'y', label: 'Y', dir: new THREE.Vector3(0,  1,  0), color: VIEWER_GIZMO_COLOR_Y },
      { axis: 'z', label: 'Z', dir: new THREE.Vector3(0,  0,  1), color: VIEWER_GIZMO_COLOR_Z },
    ];

    const L = VIEWER_GIZMO_AXIS_LENGTH;

    for (const { axis, label, dir, color } of axes)
    {
      // positive solid line
      const posGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), dir.clone().multiplyScalar(L)]);
      const posMat = new THREE.LineBasicMaterial({ color, depthTest: false });
      const posLine = new THREE.Line(posGeo, posMat);
      posLine.renderOrder = 999;
      posLine.userData.isViewerHelper = true;
      this._gizmoGroup.add(posLine);

      // negative dashed line
      const negGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), dir.clone().multiplyScalar(-L)]);
      const negMat = new THREE.LineDashedMaterial({
        color,
        dashSize: L * VIEWER_GIZMO_DASH_SIZE_RATIO,
        gapSize:  L * VIEWER_GIZMO_DASH_GAP_RATIO,
        depthTest: false,
      });
      const negLine = new THREE.Line(negGeo, negMat);
      negLine.computeLineDistances();
      negLine.renderOrder = 999;
      negLine.userData.isViewerHelper = true;
      this._gizmoGroup.add(negLine);

      // positive arrowhead cone (clickable handle)
      const coneH = L * VIEWER_GIZMO_ARROW_LENGTH_RATIO;
      const coneR = L * VIEWER_GIZMO_ARROW_RADIUS_RATIO;
      const coneGeo = new THREE.ConeGeometry(coneR, coneH, 8);
      const coneMat = new THREE.MeshBasicMaterial({ color, depthTest: false });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      // place tip at L, base at L - coneH
      cone.position.copy(dir.clone().multiplyScalar(L - coneH / 2));
      // orient cone from its default +Y direction onto the current axis direction
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      cone.renderOrder = 999;
      cone.userData = { isViewerHelper: true, isGizmoHandle: true, axis, negative: false };
      this._gizmoGroup.add(cone);

      // negative arrowhead (clickable handle)
      const coneNegGeo = new THREE.ConeGeometry(coneR, coneH, 8);
      const coneNeg = new THREE.Mesh(coneNegGeo, coneMat.clone());
      coneNeg.position.copy(dir.clone().multiplyScalar(-(L - coneH / 2)));
      coneNeg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize().multiplyScalar(-1));
      coneNeg.renderOrder = 999;
      coneNeg.userData = { isViewerHelper: true, isGizmoHandle: true, axis, negative: true };
      this._gizmoGroup.add(coneNeg);

      // label sprite
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, 64, 64);
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      ctx.font = 'bold 42px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 32, 32);
      const tex = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.setScalar(VIEWER_GIZMO_LABEL_SIZE);
      // sprite is centred on its position: sit it a fixed gap past the axis tip
      sprite.position.copy(dir.clone().multiplyScalar(
        L + L * VIEWER_GIZMO_LABEL_GAP_RATIO + VIEWER_GIZMO_LABEL_SIZE / 2));
      sprite.renderOrder = 999;
      sprite.userData.isViewerHelper = true;
      this._gizmoGroup.add(sprite);
    }

    // small origin sphere
    const originGeo = new THREE.SphereGeometry(L * 0.06, 8, 8);
    const originMat = new THREE.MeshBasicMaterial({
      color:       VIEWER_GIZMO_COLOR_ORIGIN,
      depthTest:   false,
      toneMapped:  false, // keep the configured colour exact (AgX would otherwise tint pure white slightly)
    });
    const originSphere = new THREE.Mesh(originGeo, originMat);
    originSphere.renderOrder = 999;
    originSphere.userData.isViewerHelper = true;
    this._gizmoGroup.add(originSphere);

    this._scene.add(this._gizmoGroup);
  }

  private _hitTestGizmo = (e: PointerEvent) =>
  {
    if (!this._gizmoGroup) return;
    const canvas = this.renderRoot.querySelector('canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );

    const activeCamera = this._isOrtho ? (this._orthoCamera ?? this._camera) : this._camera;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, activeCamera);

    const handles = this._gizmoGroup.children.filter(c => c.userData.isGizmoHandle);
    const hits = raycaster.intersectObjects(handles, false);
    if (!hits.length) return;

    e.stopPropagation();
    e.preventDefault();
    this._skipNextPick = true; // don't let the matching pointerup select a shape behind the gizmo
    const hit = hits[0].object;
    this._snapCameraToAxis(hit.userData.axis as 'x' | 'y' | 'z', hit.userData.negative as boolean);
  };

  // ── Shape click-selection ──

  private _onPickPointerDown = (e: PointerEvent) =>
  {
    if (e.button !== 0) return;
    this._pickDownPos = { x: e.clientX, y: e.clientY };
    this._pickDownTime = performance.now();
  };

  private _onPickPointerUp = (e: PointerEvent) =>
  {
    const down = this._pickDownPos;
    this._pickDownPos = undefined;
    if (this._skipNextPick) { this._skipNextPick = false; return; }
    if (e.button !== 0 || !down) return;
    // Treat as a click only if the pointer barely moved and wasn't held long —
    // otherwise it's an OrbitControls rotate/pan, not a selection.
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved > 5 || performance.now() - this._pickDownTime > 500) return;
    // Handle clicks stop at the overlay, so any click reaching the canvas deselects the active handle
    if (activeParamEntry.get()) setActiveParamEntry(null);
    this._pickShapeAt(e);
  };

  /** Raycast the cursor against the loaded model and select the first shape hit
   *  (or clear selection on an empty-space click). */
  private _pickShapeAt(e: PointerEvent)
  {
    if (!this._currentModel) return;
    const canvas = this.renderRoot.querySelector('canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const cam = this._isOrtho ? (this._orthoCamera ?? this._camera) : this._camera;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, cam);

    const hits = raycaster.intersectObject(this._currentModel, true);
    let path: string | null = null;
    for (const hit of hits)
    {
      if (this._isHelperObject(hit.object)) continue;
      const p = this._scenePathOf(hit.object);
      if (p) { path = p; break; }
    }
    this._setSelection(path);
  }

  /** True if the object or any ancestor is a viewer helper (gizmo, grid, …). */
  private _isHelperObject(obj: THREE.Object3D): boolean
  {
    for (let o: THREE.Object3D | null = obj; o; o = o.parent)
      if (o.userData.isViewerHelper) return true;
    return false;
  }

  /** Walk up from a hit object to the nearest ancestor stamped with a scenePath
   *  (set by _buildPathMap), the identity used for selection. */
  private _scenePathOf(obj: THREE.Object3D): string | null
  {
    for (let o: THREE.Object3D | null = obj; o; o = o.parent)
      if (typeof o.userData.scenePath === 'string') return o.userData.scenePath;
    return null;
  }

  /** Apply a new selection. Re-runs the script only when the old or new shape is
   *  script-interactive (onClick), so handles appear/disappear; pure selection
   *  (highlight + scene navigator) needs no re-run. */
  private _setSelection(path: string | null)
  {
    const prev = selectedPath.get();
    if (path === prev) return;
    setSelectedPath(path);
    const wasInteractive = prev != null && this._interactiveShapes.includes(prev);
    const isInteractive  = path != null && this._interactiveShapes.includes(path);
    if (wasInteractive || isInteractive) scheduleExecution();
  }

  /** Draw / move / clear the wireframe box around the selected node. */
  private _applySelectionHighlight(path: string | null)
  {
    if (this._selectionBox)
    {
      this._scene.remove(this._selectionBox);
      this._selectionBox.geometry.dispose();
      (this._selectionBox.material as THREE.Material).dispose();
      this._selectionBox = undefined;
    }
    const obj = path ? this._pathToObject.get(path) : undefined;
    if (obj)
    {
      const box = new THREE.BoxHelper(obj, 0x3b82f6);
      box.userData.isViewerHelper = true;
      const mat = box.material as THREE.LineBasicMaterial;
      mat.depthTest = false;
      mat.transparent = true;
      box.renderOrder = 998;
      this._scene.add(box);
      this._selectionBox = box;
    }
    this._dirty = true;
  }

  //// INSTRUCT ////

  /*  Step-by-step playback of an instructable (docs.instruct in a script).
   *
   *  API only — no buttons, no overlay. The controls belong in a tool, the way the document
   *  viewer's do, so the viewer stays a viewer and a configurator can drive the same calls
   *  with completely different controls.
   *
   *  The scene work itself lives in instruct-playback.ts; this holds the state and the
   *  lifecycle. See that module for why the viewer does the work at all rather than just
   *  playing the clip GLTFBuilder.addInstruct() bakes.
   */

  /** The instructables available, as summaries. Empty when the script declared none. */
  instructs(): Array<{ name: string; title?: string; steps: number }>
  {
    return this._instructData.map(d => ({
      name: d.name, title: d.title, steps: d.steps?.length ?? 0,
    }));
  }

  /** One instructable's full data: the one named, else the one playing, else the first. */
  instruct(name?: string): InstructDoc | null
  {
    if (name) return this._instructData.find(d => d.name === name) ?? null;
    if (this._instructName) return this._instructData.find(d => d.name === this._instructName) ?? null;
    return this._instructData[0] ?? null;
  }

  /** Index of the step being shown, or -1 when playback is off. */
  instructStep(): number
  {
    return this._instructIndex;
  }

  /** Show one step: hide what it does not use, ghost its context, frame it, and slide its
   *  subject into place.
   *
   *  False when there is no such step, so a caller can walk to the end without tracking the
   *  count itself.
   */
  showInstructStep(index: number, options?: { name?: string; animate?: boolean; camera?: boolean }): boolean
  {
    const doc = options?.name ? this.instruct(options.name) : this.instruct();
    const step = doc?.steps?.[index];
    if (!doc || !step) return false;

    this._instructName = doc.name;
    this._instructIndex = index;

    this._clearInstructVisuals();
    this._instructApplied = applyInstructStep(step, this._pathToObject, {
      animate: options?.animate !== false,
    });
    this._showInstructLabels(step);

    if (options?.camera !== false) this._applyInstructCamera(step);

    this._dirty = true;
    this._emitInstructStep(doc, index, step);
    return true;
  }

  /** Step forward. False when already at the last step. */
  nextInstructStep(options?: { animate?: boolean; camera?: boolean }): boolean
  {
    return this.showInstructStep(this._instructIndex + 1, options);
  }

  /** Step back. False when already at the first step. */
  prevInstructStep(options?: { animate?: boolean; camera?: boolean }): boolean
  {
    if (this._instructIndex <= 0) return false;
    return this.showInstructStep(this._instructIndex - 1, options);
  }

  /** Leave playback: every part visible and solid again, as the model actually is. */
  clearInstruct(): void
  {
    this._clearInstructVisuals();
    this._instructName = null;
    this._instructIndex = -1;
    this._dirty = true;
    this.dispatchEvent(new CustomEvent('instruct-step', {
      detail: { name: null, index: -1, step: null, total: 0 },
      bubbles: true, composed: true,
    }));
  }

  /** Read the instructables off the run's state, falling back to a standalone GLB's extras.
   *  Called on every model load. */
  private _readInstruct(gltf?: any): void
  {
    const fromState = executionResult.get()?.state?.instruct as InstructDoc[] | undefined;
    const fromGlb = gltf?.parser?.json?.extras?.instruct ?? (gltf?.userData as any)?.instruct;

    this._instructData = Array.isArray(fromState) ? fromState
      : fromGlb ? [fromGlb as InstructDoc]
      : [];

    /*  Hold the step across a re-run: someone tweaking a parameter while looking at step 3
        wants to still be looking at step 3. Drop out only when that step is gone. The old
        scene went with the old model, so there is nothing left to restore. */
    const held = this._instructIndex;
    const doc = this._instructName ? this.instruct(this._instructName) : null;
    this._instructApplied = null;

    if (doc && held >= 0 && doc.steps?.[held]) this.showInstructStep(held, { animate: false });
    else if (held >= 0) { this._instructName = null; this._instructIndex = -1; }

    const available = this.instructs();
    setInstructAvailable(available);
    this.dispatchEvent(new CustomEvent('instruct-available', {
      detail: { instructs: available }, bubbles: true, composed: true,
    }));
  }

  /** Ease the camera to where the step says to look from, then hand control back to the orbit
   *  controls. Reuses the axis-snap tween, so it feels the same as the view gizmo. */
  private _applyInstructCamera(step: InstructStep): void
  {
    const view = instructCamera(step);
    if (!view) return;

    this._controls.target.copy(view.target);
    this._cameraTween = {
      from: this._camera.position.clone(), to: view.position,
      upTarget: view.up, t: 0, duration: 0.4,
    };
    this._dirty = true;
  }

  /** Undo everything the current step did to the scene. */
  private _clearInstructVisuals(): void
  {
    clearInstructApplied(this._instructApplied);
    this._instructApplied = null;

    if (!this._instructLabels.length) return;
    this._instructLabels = [];
    this._pushLabelsToOverlay();
  }

  /** Put the step's labels on screen: the part labels the manual is written in ('fit B into
   *  A'), and any the script wrote by hand.
   *
   *  Core resolves both, with the positions of THIS step — laid out where the step lays its
   *  parts out — so this only has to turn them into overlay elements. The same labels are on
   *  the printed step drawing, drawn there as SVG (Instruct._labelDrawing).
   */
  private _showInstructLabels(step: InstructStep): void
  {
    this._instructLabels = (step.labels ?? []).map((label, i) => ({
      id: `instruct-${step.index}-${i}`,
      text: label.text,
      variant: 'label' as const,
      anchorLocal: new THREE.Vector3(label.position[0], label.position[1], label.position[2]),
      class: label.kind === 'custom' ? 'instruct-label' : 'instruct-part-label',
      /*  Appearance comes resolved from core, so a script that restyles its labels restyles
          them here and on the page from one call. The leader is on unless the label says
          otherwise — the opposite of the page's default, and for the reason given in
          AnnotatorLabel's header: a label floating over the model needs the tie to a part
          that a label sitting on a drawing does not. */
      shape: label.options?.shape,
      target: label.options?.target,
      labelOnly: label.options?.labelOnly,
      line: label.options?.line,
      length: label.options?.length,
      angle: label.options?.angle,
      circle: label.options?.circle,
    }));

    this._pushLabelsToOverlay();
  }

  private _emitInstructStep(doc: InstructDoc, index: number, step: InstructStep): void
  {
    this.dispatchEvent(new CustomEvent('instruct-step', {
      detail: { name: doc.name, index, step, total: doc.steps.length },
      bubbles: true, composed: true,
    }));
  }

  private _snapCameraToAxis(axis: 'x' | 'y' | 'z', negative: boolean)
  {
    const target = this._controls.target.clone();
    const dist   = this._camera.position.distanceTo(target);

    const dir = new THREE.Vector3();
    if (axis === 'x') dir.set(negative ? -1 : 1, 0, 0);
    else if (axis === 'y') dir.set(0, negative ? -1 : 1, 0);
    else dir.set(0, 0, negative ? 1 : -1);

    const toPos = target.clone().add(dir.multiplyScalar(dist));
    // Z-up: camera.up is normally (0,0,1); avoid gimbal lock when looking along Z
    const upTarget = axis === 'z'
      ? new THREE.Vector3(0, negative ? -1 : 1, 0)
      : new THREE.Vector3(0, 0, 1);

    this._cameraTween = {
      from:      this._camera.position.clone(),
      to:        toPos,
      upTarget,
      t:         0,
      duration:  0.4,
    };
    this._dirty = true;
  }

  private _applyViewStyle(styleId: string)
  {
    const style = VIEW_STYLES.find(s => s.id === styleId);
    if (!style) return;

    // Restore materials from any previous override style before applying new one
    this._restoreStyleOverrides();

    // Background + renderer (neutral background follows the light/dark theme)
    const bg = this._resolveBackground(style.background ?? VIEWER_BACKGROUND_COLOR);
    this._scene.background = new THREE.Color(bg);
    this._renderer.setClearColor(bg);

    if (style.toneMapping !== undefined) this._renderer.toneMapping = style.toneMapping as THREE.ToneMapping;
    if (style.toneMappingExposure !== undefined) this._renderer.toneMappingExposure = style.toneMappingExposure;

    // Shadows
    const shadows = style.shadows ?? true;
    this._renderer.shadowMap.enabled = shadows;
    this._keyLight.castShadow = shadows;

    // Ground plane (shadow catcher only)
    if (this._groundMesh)
    {
      this._groundMesh.visible = false;
      this._updateGroundPlane();
    }
    if (this._groundShadowMesh)
    {
      this._groundShadowMesh.visible = style.groundPlane ?? false;
      const shadowMaterial = this._groundShadowMesh.material as THREE.ShadowMaterial;
      shadowMaterial.opacity = shadows ? 0.16 : 0;
    }

    // IBL environment
    if (style.environment === 'room')
    {
      if (!this._roomEnvTexture)
      {
        const pmrem = new THREE.PMREMGenerator(this._renderer);
        const envScene = new RoomEnvironment();
        this._roomEnvTexture = pmrem.fromScene(envScene, 0.04).texture;
        envScene.dispose();
        pmrem.dispose();
      }
      this._scene.environment = this._roomEnvTexture;
    }
    else if (style.environment === null)
    {
      this._scene.environment = null;
    }
    // Dial the IBL down so it fills without washing surfaces toward flat white.
    this._scene.environmentIntensity = style.environmentIntensity ?? 1;

    // Lighting
    this._applyLightConfig(this._ambientLight, style.ambientLight);
    this._applyLightConfig(this._keyLight, style.spotlight);

    if (style.hemiLight)
    {
      if (!this._hemiLight)
      {
        this._hemiLight = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
        this._scene.add(this._hemiLight);
      }
      this._applyLightConfig(this._hemiLight, style.hemiLight);
    }
    else if (this._hemiLight)
    {
      this._hemiLight.visible = false;
    }

    // Grid + Fog (auto-sized to scene bounds)
    this._activeStyleId = styleId;
    // Sync the user toggle to the style's default each time the style changes
    // so switching to realistic (grid off by default) hides the grid, but the
    // user can still toggle it on manually afterwards.
    this._gridVisible = style.grid?.visible ?? true;
    this._updateGrid();

    // Material overrides — traverse scene only when the style has mesh/line config
    if (style.mesh !== undefined || style.lines !== undefined)
    {
      this._scene.traverse((node) =>
      {
        if (node.userData.isViewerHelper) return;

        const isLineSegments2 = node.type === 'LineSegments2';
        const isNativeLine = node instanceof THREE.LineSegments || node instanceof THREE.Line;
        const isMeshSurface = (node as THREE.Mesh).isMesh && !isLineSegments2;

        if (isLineSegments2 || isNativeLine)
        {
          this._applyLineStyleOverride(node, style);
        }
        else if (isMeshSurface)
        {
          this._applyMeshStyleOverride(node as THREE.Mesh, style);
        }
      });
    }

    // Apply user-controlled node visibility on top of style overrides
    this._applyScenegraphVisibility(this._pendingScenegraph);

    this._dirty = true;
  }

  /** Walk the scenegraph; for every node with `style.visible === false`,
   *  look up its Three.js object by path and hide it. Restores previously
   *  user-hidden objects first so toggling back to visible always succeeds. */
  private _applyScenegraphVisibility(graph: SceneNodeData | null)
  {
    for (const obj of this._userHiddenObjects) obj.visible = true;
    this._userHiddenObjects = [];

    if (!graph || !this._currentModel) return;

    const walk = (node: SceneNodeData, parentPath: string) =>
    {
      const path = buildScenegraphPath(parentPath, node.name);
      if (node.style.visible === false)
      {
        const obj = this._pathToObject.get(path);
        if (obj)
        {
          obj.visible = false;
          this._userHiddenObjects.push(obj);
        }
      }
      node.children.forEach(c => walk(c, path));
    };
    walk(graph, '');
    this._dirty = true;
  }

  /** Rebuild `_pathToObject` from the freshly loaded model. When the runner
   *  scenegraph is available, use its canonical names directly so UI paths and
   *  viewer lookups stay aligned after refactors that changed GLTF node names.
   *  For standalone GLBs without state, fall back to inferred object names. */
  private _buildPathMap(root: THREE.Object3D, graph?: SceneNodeData | null): void
  {
    this._pathToObject.clear();
    const geoTypes = ModelViewer._GEO_TYPES;

    const semanticChildrenOf = (obj: THREE.Object3D) =>
      obj.children.filter((child) => !child.userData.isViewerHelper && !geoTypes.has(child.type));

    if (graph)
    {
      const recurWithGraph = (
        obj: THREE.Object3D,
        node: SceneNodeData,
        parentPath: string,
      ) =>
      {
        const path = buildScenegraphPath(parentPath, node.name);
        this._pathToObject.set(path, obj);
        // Stamp identity so a raycast hit can be mapped back to its scene path /
        // shape (used by click-selection). node.shape is the shape UUID or null;
        // node.sid is the shape's serial id (creation order), 0 for containers.
        obj.userData.scenePath = path;
        obj.userData.shapeId = node.shape ?? null;
        obj.userData.sid = node.sid ?? 0;

        const objectChildren = semanticChildrenOf(obj);
        const childCount = Math.min(objectChildren.length, node.children.length);
        for (let i = 0; i < childCount; i++)
        {
          recurWithGraph(objectChildren[i], node.children[i], path);
        }
      };

      recurWithGraph(root, graph, '');
      return;
    }

    const recur = (obj: THREE.Object3D, parentPath: string, nameOverride?: string) =>
    {
      const name = nameOverride ?? (parentPath === '' ? 'Scene' : (obj.name || obj.type));
      const path = parentPath ? `${parentPath}/${name}` : name;
      this._pathToObject.set(path, obj);

      const semanticChildren = semanticChildrenOf(obj);

      const nameCounts: Record<string, number> = {};
      for (const c of semanticChildren)
      {
        const cname = c.name || c.type;
        nameCounts[cname] = (nameCounts[cname] ?? 0) + 1;
      }
      const seen: Record<string, number> = {};

      for (const c of semanticChildren)
      {
        let cname = c.name || c.type;
        if (nameCounts[cname] > 1)
        {
          const idx = seen[cname] = (seen[cname] ?? 0) + 1;
          cname = `${cname}[${idx - 1}]`;
        }
        recur(c, path, cname);
      }
    };
    recur(root, '');
  }

  private _applyMeshStyleOverride(mesh: THREE.Mesh, style: ViewStyle)
  {
    if (style.mesh === null)
    {
      // Hide the surface through its material, NOT mesh.visible: a solid's edge lines are
      // children of its mesh, and an invisible object hides its whole subtree - so the
      // wireframe style would hide the very edges it is meant to show.
      this._savedMaterials.set(mesh, mesh.material);
      const hiddenMat = new THREE.MeshBasicMaterial({ visible: false });
      this._overrideMaterials.push(hiddenMat);
      mesh.material = hiddenMat;
    }
    else if (style.mesh !== undefined)
    {
      const existingMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      this._savedMaterials.set(mesh, mesh.material);
      const newMat = this._buildMeshMaterial(style.mesh, existingMat);
      this._overrideMaterials.push(newMat);
      mesh.material = newMat;
    }
  }

  private _applyLineStyleOverride(node: THREE.Object3D, style: ViewStyle)
  {
    if (style.lines === null)
    {
      this._hiddenObjects.push(node);
      node.visible = false;
    }
    else if (style.lines !== undefined)
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mat = (node as any).material;
      if (mat?.color)
      {
        // A line carrying per-vertex colour keeps its own. Both the native and the fat-line
        // shaders MULTIPLY material.color by the interpolated vertex colour, so forcing a view
        // style's line colour onto it would tint the gradient — or, with a dark style colour,
        // black it out entirely. Only the colour is skipped; opacity, width and dash still apply.
        //
        // This has to stay idempotent: a light/dark theme flip re-runs the whole view style over
        // every line, so it must not accumulate or drift on repeated application.
        const keepsOwnColor = node.userData.hasVertexGradient === true;

        this._savedLineColors.set(node, {
          color: mat.color.clone(),
          opacity: mat.opacity ?? 1,
          transparent: mat.transparent ?? false,
          linewidth: 'linewidth' in mat ? mat.linewidth : undefined,
          dashed: 'dashed' in mat ? mat.dashed : undefined,
          dashSize: 'dashSize' in mat ? mat.dashSize : undefined,
          gapSize: 'gapSize' in mat ? mat.gapSize : undefined,
        });
        if (style.lines.color !== undefined && !keepsOwnColor) mat.color.setHex(style.lines.color);
        if (style.lines.opacity !== undefined)
        {
          mat.opacity = style.lines.opacity;
          mat.transparent = style.lines.transparent ?? style.lines.opacity < 1;
        }
        if (style.lines.strokeWidth !== undefined && 'linewidth' in mat) mat.linewidth = style.lines.strokeWidth;
        if (style.lines.strokeDash !== undefined)
        {
          if ('dashed' in mat) mat.dashed = style.lines.strokeDash > 0;
          if ('dashSize' in mat) mat.dashSize = style.lines.strokeDash;
        }
      }
    }
  }

  private _restoreStyleOverrides()
  {
    for (const [mesh, mat] of this._savedMaterials)
    {
      mesh.material = mat;
    }
    this._savedMaterials.clear();

    for (const [obj, saved] of this._savedLineColors)
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mat = (obj as any).material;
      if (mat?.color)
      {
        // Never overridden above, so never restored — see _applyLineStyleOverride.
        if (obj.userData.hasVertexGradient !== true) { mat.color.copy(saved.color); }
        mat.opacity = saved.opacity;
        mat.transparent = saved.transparent;
        if (saved.linewidth !== undefined && 'linewidth' in mat) mat.linewidth = saved.linewidth;
        if (saved.dashed !== undefined && 'dashed' in mat) mat.dashed = saved.dashed;
        if (saved.dashSize !== undefined && 'dashSize' in mat) mat.dashSize = saved.dashSize;
        if (saved.gapSize !== undefined && 'gapSize' in mat) mat.gapSize = saved.gapSize;
      }
    }
    this._savedLineColors.clear();

    for (const obj of this._hiddenObjects)
    {
      obj.visible = true;
    }
    this._hiddenObjects = [];

    for (const mat of this._overrideMaterials)
    {
      mat.dispose();
    }
    this._overrideMaterials = [];
  }

  private _buildMeshMaterial(config: ViewStyleMaterialConfig, existingMat?: THREE.Material): THREE.Material
  {
    const existingColor = existingMat && 'color' in existingMat
      ? (existingMat as THREE.MeshBasicMaterial).color?.getHex()
      : undefined;
    const existingOpacity = existingMat?.opacity;
    const existingSide = existingMat?.side;
    const existingFlatShading = existingMat && 'flatShading' in existingMat
      ? (existingMat as THREE.MeshPhongMaterial).flatShading
      : undefined;

    const color = config.color ?? existingColor ?? 0xffffff;
    const opacity = config.opacity ?? existingOpacity ?? 1;
    const transparent = config.transparent ?? existingMat?.transparent ?? (opacity < 1);
    const side = config.side === 'double' ? THREE.DoubleSide
      : config.side === 'back' ? THREE.BackSide
      : config.side === 'front' ? THREE.FrontSide
      : existingSide ?? THREE.FrontSide;

    if (config.wireframe)
    {
      return new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        opacity,
        transparent,
        side,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
    }

    return new THREE.MeshPhongMaterial({
      color,
      opacity,
      transparent,
      side,
      depthTest: config.depthTest ?? true,
      depthWrite: !transparent,
      flatShading: config.flatShading ?? existingFlatShading ?? false,
      shininess: 10,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
  }

  private _applyLightConfig(
    light: THREE.Light,
    cfg: { enabled: boolean; color?: number; intensity?: number; castShadow?: boolean } | undefined,
  )
  {
    if (!cfg) return;
    light.visible = cfg.enabled;
    if (cfg.color !== undefined) light.color.setHex(cfg.color);
    if (cfg.intensity !== undefined) light.intensity = cfg.intensity;
    if (cfg.castShadow !== undefined && 'castShadow' in light)
    {
      light.castShadow = cfg.castShadow;
    }
  }

  // ── 8b. Dimension → param updates ──

  /** Forwarded from <viewer-labels-overlay> when the user edits a bound
   *  dimension label. We coerce to the parameter's declared type, run the
   *  script's optional remap function (`.param(name, remap)`) over it, validate
   *  against its JSON schema, and only call updateParam() on success — silent
   *  drops on invalid input per the design (mid-typing values can fail
   *  min/multipleOf, that's fine). */
  private _onDimParamChange = (e: Event) =>
  {
    const detail = (e as CustomEvent<DimensionParamChangeDetail>).detail;
    if (!detail?.param) return;

    const param = scriptParams.get().find(p => p.name === detail.param);
    if (!param)
    {
      console.warn(`Dimension bound to unknown param "${detail.param}"`);
      return;
    }

    const coerced = this._coerceParamValue(param, detail.value);
    if (coerced === undefined) return;

    // The dimension is measured in model units; the param need not be (a model in
    // mm dimensioning a param in cm). The script's remap bridges the two.
    let next = detail.remapSrc
      ? this._applyDimRemap(detail.remapSrc, detail.remapVars, coerced, param)
      : coerced;
    if (next === undefined) return;

    // Same prechecks as the handle map path: snap to the param's step before validating,
    // so a remapped 79.6 lands on a multipleOf:1 param instead of being dropped.
    for (const { check, fix } of PARAM_MAP_PRECHECKS)
    {
      if (check(param as any)) next = fix(next, param as any);
    }

    if (!param.validateValue(next)) return; // silent — wait for the user to type more

    updateParam(detail.param, { value: next });
    scheduleExecution();
  };

  /** Rebuild the script's remap function from source and map the edited dimension
   *  value to a parameter value. The function crossed the worker boundary as text,
   *  so it only ever sees its own arguments — `(value, currentParamValue)`.
   *  Returns undefined when it can't be rebuilt or throws (the edit is then dropped). */
  private _applyDimRemap(src: string, vars: Record<string, any> | null | undefined, value: unknown, param: any): unknown
  {
    let fn: ((v: unknown, current: unknown) => unknown) | null = null;
    try
    {
      fn = rebuildFunction(src, vars);
    }
    catch (err)
    {
      console.error(`Dimension remap function for param "${param.name}" could not be reconstructed:`, err);
      return undefined;
    }

    try
    {
      const out = fn!(value, param._value ?? param.default);
      return out === undefined ? undefined : out;
    }
    catch (err)
    {
      console.error(`Dimension remap function for param "${param.name}" threw:`, err);
      return undefined;
    }
  }

  /** Coerce the raw input string to the parameter's value type.
   *  Returns undefined when the string can't be interpreted as the target type
   *  (e.g. letters for a number) — the caller treats that as "drop silently". */
  private _coerceParamValue(param: { schema: { type?: string } }, raw: string): unknown
  {
    const t = param.schema?.type;
    if (t === 'number')
    {
      const trimmed = raw.trim();
      if (trimmed === '' || trimmed === '-' || trimmed === '.') return undefined;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : undefined;
    }
    if (t === 'boolean')
    {
      const s = raw.trim().toLowerCase();
      if (s === 'true' || s === '1') return true;
      if (s === 'false' || s === '0') return false;
      return undefined;
    }
    return raw;
  }

  // ── 9. Scene tree ──

  // Raw geometry node types that are implementation details — never shown as tree nodes.
  // They may be children of a named container; their material is surfaced on the container.
  private static readonly _GEO_TYPES = GEO_TYPES;

  // ── 10. Model loading ──

  private async _loadGLTFString(data: string | ArrayBuffer)
  {
    const shouldFrameCamera = VIEWER_AUTO_FRAME_ON_FIRST_LOAD && !this._currentModel && !this._hasFramedCamera;
    this._disposeModel();
    const gltf = await new Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTF>(
      (resolve, reject) =>
      {
        this._gltfLoader.parse(data, '', resolve, reject);
      },
    );
    this._applyGLTF(gltf, shouldFrameCamera);
  }

  private async _applyGLTF(
    gltf: import('three/examples/jsm/loaders/GLTFLoader.js').GLTF,
    shouldFrameCamera = false,
  )
  {
    const model = gltf.scene;

    // Enable shadow casting on every mesh so the model projects onto the
    // ground catcher. Avoid mesh self-receive here: the viewer's main shadow
    // use-case is the ground shadow, and self-shadowing from a single
    // directional shadow map is the main source of front-face acne / moire.
    // polygonOffset still pushes surfaces back so coplanar edge lines never
    // z-fight with them.
    model.traverse((n) =>
    {
      if ((n as THREE.Mesh).isMesh)
      {
        n.castShadow = true;
        n.receiveShadow = false;
        const mats = Array.isArray((n as THREE.Mesh).material)
          ? (n as THREE.Mesh).material as THREE.Material[]
          : [(n as THREE.Mesh).material as THREE.Material];
        mats.forEach((m) =>
        {
          m.polygonOffset = true;
          m.polygonOffsetFactor = 1;
          m.polygonOffsetUnits = 1;
        });
      }
    });

    this._scene.add(model);
    this._currentModel = model;

    // Reposition fixed-size helpers against the current model.
    this._updateGrid();
    this._updateGroundPlane();
    this._updateSpotlightForModel();
    this._updateGizmoScale();

    this._updateCameraRangesForObject(model);

    if ((shouldFrameCamera || this._forceFrameOnNextLoad) && !this._hasFramedCamera)
    {
      this._frameCamera(model);
      this._hasFramedCamera = true;
      this._forceFrameOnNextLoad = false;
    }
    else
    {
      this._refitIfOutgrown(model);
    }

    // Store animations for user selection — don't auto-play
    if (gltf.animations.length)
    {
      this._animationClips = gltf.animations;
      this._activeAnimationName = null;
      this._mixer = new THREE.AnimationMixer(model);
    }
    else
    {
      this._animationClips = [];
      this._activeAnimationName = null;
    }

    // Render CAD hard edges from custom GLTF extensions
    await applyEdgeExtensions(gltf, model);

    // Style CAD points (size / circle-square shape) from custom GLTF extensions
    applyPointStyles(model);

    // Render annotations: prefer the live execution result; fall back to GLB
    // extras for standalone .glb loads. Dimensions become 3D arrows + HTML
    // overlay value text; labels become HTML overlay elements.
    const anns = executionResult.get()?.state?.annotations as any[] | undefined;
    // Same scene-size scale factor as the origin gizmo (computed just above),
    // so dimension arrows stay proportionally legible across model sizes too.
    const { htmlLabels } = await applyAnnotations(gltf, model, anns, this._gizmoScale || 1);
    this._annotationLabels = htmlLabels;
    if (this.renderRoot.querySelector('viewer-labels-overlay'))
    {
      // dimension value text background = viewer background (kept in sync,
      // theme-aware so the text stays readable in dark mode)
      this._syncDimBackground();
    }
    this._pushLabelsToOverlay();

    // Reconcile interaction handles via the op stream from the execution result.
    // _reconcileHandles preserves dragged positions and only re-renders the overlay
    // when the set of handle ids changes (add/delete ops). A quiet param re-exec
    // emits [] and leaves all handles untouched.
    const managedHandles = executionResult.get()?.state?.managedHandles as ManagedHandlesData | undefined;
    if (managedHandles)
    {
      this._reconcileHandles(managedHandles);
    }

    this._dirty = true; // ensure a frame so labels/handles appear/position

    // Ensure LineMaterial resolution is set for pixel-accurate line width
    this._resize();

    // Build path → Three.js object map (mirrors the runner-side path rules).
    // Skip the gltf.scene wrapper Group; start from the GLTFBuilder content root
    // and label it 'Scene' so paths line up with the runner's emission.
    const contentRoot = model.children.find(c => !c.userData.isViewerHelper) ?? model;
    this._buildPathMap(contentRoot, this._pendingScenegraph);

    // Re-apply current view style to newly loaded geometry. This also calls
    // _applyScenegraphVisibility against the latest scenegraph signal so any
    // user-toggled or runner-declared hidden nodes are hidden from the start.
    this._applyViewStyle(this._activeStyleId);

    // Re-attach the selection highlight to the freshly rebuilt objects (the
    // selectedPath persists across re-runs, but the old BoxHelper referenced
    // disposed geometry).
    this._lastAppliedSelectedPath = this._pendingSelectedPath;
    this._applySelectionHighlight(this._pendingSelectedPath);

    // Instructables, last: re-applying a held step needs the path map, the view style and the
    // scenegraph visibility to have settled first.
    this._readInstruct(gltf);
  }

  private _loadGlbOutput(entry: ScriptOutputData)
  {
    const raw = entry.output;

    if (raw instanceof Uint8Array)
    {
      this._loadGLTFString(raw.buffer as ArrayBuffer);
    }
    else if (raw instanceof ArrayBuffer)
    {
      this._loadGLTFString(raw);
    }
    else if (typeof raw === 'object' && raw !== null && 'data' in raw)
    {
      const wrapper = raw as { encoding?: string; data: ArrayBuffer | string };

      if (wrapper.encoding === 'base64' && typeof wrapper.data === 'string')
      {
        const binary = atob(wrapper.data);
        const buf = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
        this._loadGLTFString(buf.buffer);
      }
      else
      {
        this._loadGLTFString(wrapper.data as string | ArrayBuffer);
      }
    }
    else if (typeof raw === 'string')
    {
      this._loadGLTFString(raw);
    }
    else
    {
      console.error('Unsupported GLB output format:', raw);
    }
  }

  private _disposeModel()
  {
    if (!this._currentModel) return;

    // The path → object map is rebuilt on the next GLB load. We don't clear
    // the scenegraph signal here — `setExecutionResult` already reconciled it
    // before this dispose runs.
    this._pathToObject.clear();

    // Restore style overrides first so we dispose originals (not override mats) below
    this._restoreStyleOverrides();
    this._userHiddenObjects = [];

    this._scene.remove(this._currentModel);
    this._currentModel.traverse((n) =>
    {
      const obj = n as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material)
      {
        const mats: THREE.Material[] = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((mat) => mat.dispose());
      }
    });
    // Clear HTML overlay labels (dimension text + shape labels)
    this._htmlLabels = [];
    this._annotationLabels = [];
    this._instructLabels = [];
    const overlay = this.renderRoot.querySelector('viewer-labels-overlay') as ViewerLabelsOverlay | null;
    if (overlay) overlay.labels = [];

    // Handles are NOT cleared here — they persist across reloads and are
    // reconciled via managedHandles ops. Only the range helper (drag guide) is removed.
    // Handles are removed when the script emits 'delete' ops or on page reload.
    if (this._rangeHelper) { this._scene.remove(this._rangeHelper); this._rangeHelper = undefined; }
    // Selection box references model geometry — drop it; _applyGLTF re-attaches
    // it to the rebuilt objects (selectedPath persists).
    if (this._selectionBox)
    {
      this._scene.remove(this._selectionBox);
      this._selectionBox.geometry.dispose();
      (this._selectionBox.material as THREE.Material).dispose();
      this._selectionBox = undefined;
      this._lastAppliedSelectedPath = undefined;
    }
    // If a drag was in progress, cancel it cleanly
    if (this._activeHandle) { this._activeHandle = null; this._controls.enabled = true; }

    this._currentModel = undefined;
    this._updateSpotlightForModel();
    this._updateGroundPlane();
    this._mixer = undefined;
    this._animationClips = [];
    this._activeAnimationName = null;
  }

  /** Reconcile the viewer's handle list from the op stream produced by
   *  Interactor.getManagedHandlesData(). Only re-renders the HTML overlay when the
   *  set of handle ids changes — a quiet param re-exec emits [] and leaves
   *  all handles (including their dragged positions) completely untouched. */
  private _reconcileHandles(ops: ManagedHandlesData): void
  {
    let idsChanged = false;
    for (const op of ops)
    {
      if (op._operation === 'add')
      {
        const def = handleDefFromData(op.data as any);
        const idx = this._htmlHandles.findIndex(h => h.id === op.id);
        if (idx >= 0)
        {
          const existing = this._htmlHandles[idx];
          // Definition update (function, range, icon changed) — replace the def
          // but always preserve the user's dragged position and plane.origin.
          // plane.origin is the fixed drag-zone anchor (center for relative ranges,
          // perp-axis reference for absolute) and must only move via explicit
          // at()/position() mutator update ops — never from a definition re-add.
          def.anchorLocal.copy(existing.anchorLocal);
          def.plane.origin.copy(existing.plane.origin);
          // Icon and minimized style live in the overlay's Lit template — re-render for them.
          if (def.icon !== existing.icon
            || JSON.stringify(def.minimized) !== JSON.stringify(existing.minimized)) idsChanged = true;
          this._htmlHandles[idx] = def;
        }
        else { this._htmlHandles.push(def); idsChanged = true; }
      }
      else if (op._operation === 'update')
      {
        const h = this._htmlHandles.find(h => h.id === op.id);
        if (h)
        {
          if (op.position)
          {
            h.anchorLocal.set(op.position[0], op.position[1], op.position[2]);
            // For relative ranges plane.origin is the drag-zone center.
            // at()/position() mutators explicitly command a new center, so update it.
            // For absolute ranges plane.origin is just a reference point — also update.
            h.plane.origin.set(op.position[0], op.position[1], op.position[2]);
          }
          if (op.visible !== undefined) h.visible = op.visible;
        }
      }
      else if (op._operation === 'delete')
      {
        const idx = this._htmlHandles.findIndex(h => h.id === op.id);
        if (idx >= 0)
        {
          if (this._activeHandle?.id === op.id)
          {
            this._activeHandle = null;
            this._controls.enabled = true;
            if (this._rangeHelper) { this._scene.remove(this._rangeHelper); this._rangeHelper = undefined; }
          }
          this._htmlHandles.splice(idx, 1);
          idsChanged = true;
        }
      }
    }
    if (idsChanged) this._syncOverlayHandles();
    this._dirty = true;
  }

  /** Push the current _htmlHandles id-set to the HTML overlay (Lit re-render).
   *  Only call when handles are added or removed — not on every param re-exec. */
  private _syncOverlayHandles(): void
  {
    const overlay = this.renderRoot.querySelector('viewer-handles-overlay') as ViewerHandlesOverlay | null;
    if (!overlay) return;
    overlay.handles = this._htmlHandles.map((h): HandleOverlay => ({
      id:          h.id,
      icon:        h.icon,
      minimized:   h.minimized,
      visible:     h.visible,
      param:       h.param,
      paramFnSrc:  h.paramFnSrc,
      paramsFnSrc: h.paramsFnSrc,
    }));
    // _reconcileHandles mutates _htmlHandles imperatively, so no Lit render re-evaluates
    // the template's .activeId binding — set it here or a handle added for an
    // already-active entry would come up unhighlighted.
    overlay.activeId = this._activeHandleIdFor(this._pendingActiveEntry);
  }

  /** A parameter change can make a model dramatically bigger than the one the
   *  camera was framed for — enough that the viewer ends up inside the geometry
   *  and the user sees a flat wall of colour. Re-frame when the model has both
   *  outgrown its last framing *and* swallowed the camera; a model that merely
   *  grew but is still comfortably in view keeps the user's chosen viewpoint. */
  private _refitIfOutgrown(obj: THREE.Object3D)
  {
    if (!this._hasFramedCamera || this._framedRadius <= 0) return;

    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;

    const sphere = box.getBoundingSphere(new THREE.Sphere());
    if (sphere.radius <= 0) return;

    const outgrown = sphere.radius > this._framedRadius * ModelViewer._REFRAME_GROWTH_FACTOR;
    if (!outgrown) return;

    // "Too close": the camera sits inside (or barely outside) the model's
    // bounding sphere, so most of the view is filled by near geometry.
    const activeCamera = this._isOrtho ? (this._orthoCamera ?? this._camera) : this._camera;
    const camDistance = activeCamera.position.distanceTo(sphere.center);
    if (camDistance > sphere.radius * ModelViewer._REFRAME_PROXIMITY_FACTOR) return;

    this._frameCamera(obj);
  }

  /** How much bigger a reloaded model must be before an auto re-frame is even
   *  considered (bounding-sphere radius ratio). */
  private static readonly _REFRAME_GROWTH_FACTOR = 2.5;
  /** Camera counts as "too close" within this multiple of the bounding radius. */
  private static readonly _REFRAME_PROXIMITY_FACTOR = 1.25;

  private _frameCamera(obj: THREE.Object3D)
  {
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this._framedRadius = sphere.radius;
    const activeCamera = this._isOrtho ? (this._orthoCamera ?? this._camera) : this._camera;
    const currentViewVector = activeCamera.position.clone().sub(this._controls.target);
    const viewDirection = currentViewVector.lengthSq() > 0
      ? currentViewVector.normalize()
      : new THREE.Vector3(1, 1, 1).normalize();

    const verticalFov = THREE.MathUtils.degToRad(this._camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this._camera.aspect);
    const limitingHalfFov = Math.max(Math.min(verticalFov, horizontalFov) / 2, THREE.MathUtils.degToRad(1));
    const dist = (sphere.radius / Math.sin(limitingHalfFov)) * 1.1;

    this._controls.target.copy(center);
    this._camera.position.copy(center.clone().add(viewDirection.multiplyScalar(dist)));
    this._updateCameraRangesForObject(obj, dist);
    this._controls.update();
    if (this._isOrtho)
    {
      this._buildOrthoFromPersp();
    }
  }

  private _resize()
  {
    const w = this.clientWidth;
    const h = this.clientHeight;
    if (!w || !h) return;
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    if (this._orthoCamera)
    {
      const frustumH = this._orthoCamera.top - this._orthoCamera.bottom;
      const aspect = w / h;
      this._orthoCamera.left   = -(frustumH * aspect) / 2;
      this._orthoCamera.right  =  (frustumH * aspect) / 2;
      this._orthoCamera.updateProjectionMatrix();
    }
    this._renderer.setSize(w, h, false);
    // Keep pixel-accurate line width for LineMaterial edge overlays
    this._currentModel?.traverse((n) =>
    {
      const mat = (n as any).material; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (mat?.isLineMaterial)
      {
        (mat as import('three/examples/jsm/lines/LineMaterial.js').LineMaterial)
          .resolution.set(w, h);
      }
    });
    this._dirty = true;
  }

  private _loop = () =>
  {
    this._frameId = requestAnimationFrame(this._loop);
    const dt = this._clock.getDelta();

    if (this._mixer)
    {
      this._mixer.update(dt);
      this._selectionBox?.update(); // keep the highlight box on the animated node
      this._dirty = true;
    }

    // Camera axis-snap tween
    if (this._instructApplied?.move)
    {
      if (!advanceInstructMove(this._instructApplied.move, dt))
      {
        this._instructApplied.move = undefined;
      }
      this._dirty = true;
    }

    if (this._cameraTween)
    {
      const tw = this._cameraTween;
      tw.t = Math.min(tw.t + dt / tw.duration, 1);
      // smooth-step ease-out
      const k = tw.t * tw.t * (3 - 2 * tw.t);
      this._camera.position.lerpVectors(tw.from, tw.to, k);
      this._camera.up.lerp(tw.upTarget, k);
      this._controls.update();
      if (this._isOrtho) this._buildOrthoFromPersp();
      this._dirty = true;
      if (tw.t >= 1)
      {
        this._camera.position.copy(tw.to);
        this._camera.up.copy(tw.upTarget);
        this._controls.update();
        if (this._isOrtho) this._buildOrthoFromPersp();
        this._cameraTween = undefined;
      }
    }

    if (this._controls.update()) this._dirty = true;

    // Keep the orthographic camera mirrored to the perspective camera that
    // OrbitControls actually drives, so orbit/pan/zoom stay in sync in ortho.
    if (this._isOrtho) this._buildOrthoFromPersp();

    if (this._dirty)
    {
      this._renderer.render(this._scene, this._isOrtho ? this._orthoCamera! : this._camera);

      // Project HTML overlay labels to screen
      if (this._htmlLabels.length) this._updateLabelOverlay();
      // Project interaction handles to screen
      if (this._htmlHandles.length) this._updateHandleOverlay();

      this._dirty = false;
    }
  };

  /** Project each HTML label's world anchor to screen px and push to the overlay */
  /** Re-format dimension label text from cached raw data when the unit system
   *  changes, and push the new text into the overlay (positions unchanged). */
  private _refreshDimLabelText()
  {
    if (!this._htmlLabels.length) return;
    let changed = false;
    for (const l of this._htmlLabels)
    {
      if (l.variant !== 'dimension' || !l.dim) continue;
      const next = formatDimensionValue(l.dim);
      if (next !== l.text) { l.text = next; changed = true; }
    }
    if (!changed) return;

    this._pushLabelsToOverlay();
  }

  /** Render the labels that apply right now, and put them where they belong on screen.
   *
   *  Two sets, never both: the model's own annotations, and — while an instructable is being
   *  stepped through — that step's. A step is a claim about four parts out of forty, and the
   *  whole model's dimension lines over the top of it are noise.
   */
  private _pushLabelsToOverlay()
  {
    this._htmlLabels = this._instructLabels.length ? this._instructLabels : this._annotationLabels;

    const overlay = this.renderRoot.querySelector('viewer-labels-overlay') as ViewerLabelsOverlay | null;
    if (!overlay) return;

    overlay.labels = this._htmlLabels.map((l): OverlayLabel => ({
      id: l.id,
      text: l.text,
      variant: l.variant,
      class: l.class,
      shape: l.shape,
      target: l.target,
      labelOnly: l.labelOnly,
      line: l.line,
      length: l.length,
      offset: l.offset,
      angle: l.angle,
      circle: l.circle,
      param: l.param,
      paramRemapSrc: l.paramRemapSrc,
      paramRemapVars: l.paramRemapVars,
      interactive: l.interactive,
      rawValue: l.rawValue,
    }));

    this._updateLabelOverlay();
    this._dirty = true;
  }

  private _updateLabelOverlay()
  {
    const overlay = this.renderRoot.querySelector('viewer-labels-overlay') as ViewerLabelsOverlay | null;
    if (!overlay || !this._currentModel) return;

    const cam = this._isOrtho ? this._orthoCamera! : this._camera;
    const w = this.clientWidth;
    const h = this.clientHeight;
    if (!w || !h) return;

    const positions: Record<string, OverlayLabelPos> = {};
    for (const l of this._htmlLabels)
    {
      // anchor is in modelGroup-local coords → world → NDC → screen px
      this._projV.copy(l.anchorLocal).applyMatrix4(this._currentModel.matrixWorld).project(cam);
      const visible = this._projV.z < 1 &&
        this._projV.x >= -1 && this._projV.x <= 1 &&
        this._projV.y >= -1 && this._projV.y <= 1;
      positions[l.id] = {
        x: (this._projV.x * 0.5 + 0.5) * w,
        y: (-this._projV.y * 0.5 + 0.5) * h,
        visible,
      };
    }
    overlay.setPositions(positions);
  }

  // ── 10. Interaction handles ──

  /** Project each handle's world anchor to screen px and push to the overlay. */
  private _updateHandleOverlay()
  {
    const overlay = this.renderRoot.querySelector('viewer-handles-overlay') as ViewerHandlesOverlay | null;
    if (!overlay || !this._currentModel) return;

    const cam = this._isOrtho ? this._orthoCamera! : this._camera;
    const w = this.clientWidth;
    const height = this.clientHeight;
    if (!w || !height) return;

    const positions: Record<string, HandleOverlayPos> = {};
    for (const hd of this._htmlHandles)
    {
      if (!hd.visible) { positions[hd.id] = { x: 0, y: 0, visible: false }; continue; }
      this._projV.copy(hd.anchorLocal).applyMatrix4(this._currentModel.matrixWorld).project(cam);
      const visible = this._projV.z < 1 &&
        this._projV.x >= -1 && this._projV.x <= 1 &&
        this._projV.y >= -1 && this._projV.y <= 1;
      positions[hd.id] = {
        x: (this._projV.x * 0.5 + 0.5) * w,
        y: (-this._projV.y * 0.5 + 0.5) * height,
        visible,
      };
    }
    overlay.setPositions(positions);
  }

  private _getNDC(e: PointerEvent): THREE.Vector2
  {
    const canvas = this.renderRoot.querySelector('canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  *  2 - 1,
      -((e.clientY - rect.top)  / rect.height) *  2 + 1,
    );
  }

  private _onHandleDragStart = (e: Event) =>
  {
    const detail = (e as CustomEvent<HandleDragEventDetail>).detail;
    const handle = this._htmlHandles.find(h => h.id === detail.id);
    if (!handle) return;

    this._activeHandle = handle;
    this._dragStartAnchor = handle.anchorLocal.clone();

    // Build the hit-plane from handle's boundary plane (normal = uAxis × vAxis)
    const n = new THREE.Vector3().crossVectors(handle.plane.uAxis, handle.plane.vAxis).normalize();
    this._handleHitPlane.setFromNormalAndCoplanarPoint(n, handle.plane.origin);

    // Build visible range geometry and add to scene
    if (this._rangeHelper) this._scene.remove(this._rangeHelper);
    this._rangeHelper = this._buildRangeHelper(handle);
    if (this._rangeHelper) this._scene.add(this._rangeHelper);

    this._controls.enabled = false;
    this._dirty = true;
  };

  private _onHandleDragMove = (e: Event) =>
  {
    const detail = (e as CustomEvent<HandleDragEventDetail>).detail;
    if (!this._activeHandle || this._activeHandle.id !== detail.id) return;

    const ndc = this._getNDC(detail.pointerEvent);
    const cam = this._isOrtho ? this._orthoCamera! : this._camera;
    this._handleRaycaster.setFromCamera(ndc, cam);

    const hit = new THREE.Vector3();
    if (!this._handleRaycaster.ray.intersectPlane(this._handleHitPlane, hit)) return;

    const h = this._activeHandle;
    const { uScalar, vScalar } = _resolveHandleScalars(h, hit);
    const [uClamped, vClamped] = _clampHandleScalars(h, uScalar, vScalar);
    const base = _handleBase(h);

    h.anchorLocal.copy(base).addScaledVector(h.plane.uAxis, uClamped);
    if (h.rangeType === '2d') h.anchorLocal.addScaledVector(h.plane.vAxis, vClamped);

    this._dirty = true;
  };

  private _onHandleDragEnd = async (e: Event) =>
  {
    const detail = (e as CustomEvent<HandleDragEventDetail>).detail;
    const handle = this._activeHandle;
    const startAnchor = this._dragStartAnchor;
    this._activeHandle = null;
    this._dragStartAnchor = null;
    this._controls.enabled = true;

    if (this._rangeHelper) { this._scene.remove(this._rangeHelper); this._rangeHelper = undefined; }
    this._dirty = true;

    if (!handle || handle.id !== detail.id) return;

    // A click, not a drag: put the handle back where it was (drag-move has already nudged
    // it within the slop) and, when it stands for a list entry, open that entry's form.
    if (detail.click)
    {
      if (startAnchor) handle.anchorLocal.copy(startAnchor);
      const ref = handle.param ? parseParamRef(handle.param) : null;
      if (ref?.index !== null && ref !== null) setActiveParamEntry({ param: ref.name, index: ref.index });
      return;
    }

    // Compute the final u/v scalar values for this drag position (in the range's own terms,
    // which is what autoMap and the fraction through the range need)
    const { uScalar, vScalar } = _resolveHandleScalars(handle, handle.anchorLocal);
    const [uClamped, vClamped] = _clampHandleScalars(handle, uScalar, vScalar);

    // What a map or map function gets, the same for either kind of range (see HandleDrag)
    const is2D = handle.rangeType === '2d';
    const moved = startAnchor ? handle.anchorLocal.clone().sub(startAnchor) : new THREE.Vector3();
    const [minU, minV] = is2D ? handle.rangeMin as [number, number] : [handle.rangeMin as number, 0];
    const [maxU, maxV] = is2D ? handle.rangeMax as [number, number] : [handle.rangeMax as number, 0];
    const fraction = (value: number, min: number, max: number) => (max === min) ? 0 : (value - min) / (max - min);
    const position: [number, number, number] = [handle.anchorLocal.x, handle.anchorLocal.y, handle.anchorLocal.z];
    const handleObj: HandleDrag = {
      u:        handle.anchorLocal.dot(handle.plane.uAxis),
      v:        handle.anchorLocal.dot(handle.plane.vAxis),
      du:       moved.dot(handle.plane.uAxis),
      dv:       is2D ? moved.dot(handle.plane.vAxis) : 0,
      tu:       fraction(uClamped, minU, maxU),
      tv:       is2D ? fraction(vClamped, minV, maxV) : 0,
      range:    [handle.rangeMin, handle.rangeMax],
      position: () => [...position],
    };

    const { paramValue, paramMin, paramMax } = await import('@archiyou/editor/src/state/types')
      .catch(() => ({ paramValue: (p: any) => p._value ?? p.default, paramMin: () => 0, paramMax: () => 100 }));

    // ── Multi-param path (.params(fn)) ────────────────────────────────────────
    if (handle.paramsFnSrc)
    {
      let fn: ((params: Record<string, any>, handle: HandleDrag) => void) | null = null;
      try
      {
        fn = rebuildFunction(handle.paramsFnSrc, handle.fnVars);
      }
      catch (err)
      {
        console.error(`Handle params function could not be reconstructed:`, err);
        return;
      }

      // Build snapshot of all current param values: { PARAM_NAME: value, ... }
      const allParams = scriptParams.get();
      const before: Record<string, any> = {};
      for (const p of allParams) before[p.name] = paramValue(p);
      const paramsObj = structuredClone(before);

      try { fn!(paramsObj, handleObj); }
      catch (err) { console.error(`Handle params function threw:`, err); return; }

      // Apply each key that was mutated
      let anyChanged = false;
      for (const p of allParams)
      {
        if (paramsObj[p.name] === undefined) continue;
        // Deep-equal check via JSON (params are plain scalars/arrays/objects)
        if (JSON.stringify(paramsObj[p.name]) === JSON.stringify(before[p.name])) continue;
        // Apply schema prechecks (e.g. round to multipleOf step) before validating
        let newVal = paramsObj[p.name];
        for (const { check, fix } of PARAM_MAP_PRECHECKS)
        {
          if (check(p)) newVal = fix(newVal, p);
        }
        if (!p.validateValue(newVal)) { console.warn(`Handle params fn: invalid value for "${p.name}":`, newVal); continue; }
        console.info('Handle updated param', p.name, '→', newVal);
        updateParam(p.name, { value: newVal });
        anyChanged = true;
      }
      if (anyChanged) scheduleExecution();
      return;
    }

    // ── Single-param path (.param(ref, map | fn?) or autoMap) ────────────────
    if (!handle.param) return;

    const ref = parseParamRef(handle.param);
    const param = scriptParams.get().find(p => p.name === ref.name);
    if (!param)
    {
      console.warn(`Handle bound to unknown param "${ref.name}"`);
      return;
    }

    // An indexed ref (OPENINGS[2]) or an `object` param: the target is an OBJECT, and objects
    // are written property-by-property against their own sub-schema.
    if (ref.index !== null || param.type === 'object')
    {
      this._applyHandleObjectParam(handle, ref, param, handleObj, paramValue);
      return;
    }

    let next: any;

    if (handle.paramFnSrc)
    {
      // Explicit map function
      let fn: ((param: any, handle: HandleDrag) => any) | null = null;
      try
      {
        fn = rebuildFunction(handle.paramFnSrc, handle.fnVars);
      }
      catch (err)
      {
        console.error(`Handle map function could not be reconstructed:`, err);
        return;
      }

      const currentVal = paramValue(param);
      const copy = structuredClone(currentVal);
      try
      {
        next = mapFunctionResult(copy, fn!(copy, handleObj));
      }
      catch (err)
      {
        console.error(`Handle map function threw:`, err);
        return;
      }
    }
    else
    {
      // autoMap: linear remap of handle range → param schema min/max.
      // Requires 1D, non-relative, number param.
      if (handle.rangeType !== '1d')
      {
        console.warn(`Handle autoMap only supports 1D handles (handle "${handle.id}")`);
        return;
      }
      if (handle.rangeRelative)
      {
        console.warn(`Handle autoMap does not support relative ranges (handle "${handle.id}"). Provide an explicit map fn.`);
        return;
      }
      if ((param as any).type !== 'number')
      {
        console.warn(`Handle autoMap requires a number param (handle "${handle.id}" → param "${handle.param}")`);
        return;
      }
      const rMin = handle.rangeMin as number;
      const rMax = handle.rangeMax as number;
      const t = rMax === rMin ? 0 : (uClamped - rMin) / (rMax - rMin);
      next = paramMin(param) + t * (paramMax(param) - paramMin(param));
    }

    await this._applyHandleParam(param, next);
  };

  /** Id of the handle standing for `ref`, or null. Resolved by (param, index) because a
   *  handle's own id is script-settable and need not encode the binding. */
  private _activeHandleIdFor(ref: ParamEntryRef | null): string | null
  {
    if (!ref) return null;
    return this._htmlHandles.find((h) =>
    {
      if (!h.param) return false;
      const r = parseParamRef(h.param);
      return r.name === ref.param && r.index === ref.index;
    })?.id ?? null;
  }

  /** Write one finished drag into a param whose value is an OBJECT — either a whole
   *  `object` param, or one element of a list param addressed as `OPENINGS[2]`.
   *
   *  Either way the whole param value is replaced (that is what a param value is), but only
   *  the mapped properties change, each snapped and clamped against its own sub-schema
   *  first. ScriptParam.validateValue() checks the value as a whole, so an unsnapped `left`
   *  would fail the write and the drag would look broken. */
  private _applyHandleObjectParam(
    handle: HandleDef,
    ref: { name: string; index: number | null },
    param: any,
    handleObj: HandleDrag,
    paramValue: (p: any) => any,
  ): void
  {
    const indexed = ref.index !== null;

    if (indexed && !isObjectListParam(param))
    {
      console.warn(`Handle "${handle.id}": "${ref.name}[${ref.index}]" needs a list of objects, but "${ref.name}" is not one`);
      return;
    }

    // Where the object lives, and the schema that governs it.
    const current = paramValue(param);
    const objectSchema = indexed ? paramItemSchema(param) : (param.schema ?? {});
    const container = indexed ? (Array.isArray(current) ? structuredClone(current) : null) : null;
    const target = indexed ? container?.[ref.index as number] : current;

    if (!target || typeof target !== 'object')
    {
      console.warn(`Handle "${handle.id}": "${handle.param}" has no object to write to`);
      return;
    }

    const before = indexed ? target : structuredClone(target);

    // An object has no range to map onto, so it needs a function saying which property moves
    if (!handle.paramFnSrc)
    {
      console.warn(`Handle "${handle.id}": "${handle.param}" is an object — give param() a function, `
        + `like (param, handle) => { param.left += handle.du }`);
      return;
    }

    // Run like the scalar paramFnSrc path: the function changes the copy it is given or
    // returns a new object (see mapFunctionResult)
    const fn = this._reconstructParamFn(handle.paramFnSrc, handle.fnVars, handle.id);
    if (!fn) return;
    const copy = structuredClone(before);
    let next: Record<string, any>;
    try
    {
      next = snapClampChanged(before, mapFunctionResult(copy, fn(copy, handleObj)), objectSchema);
    }
    catch (err)
    {
      console.error(`Handle "${handle.id}": map function threw:`, err);
      return;
    }

    const value = indexed ? Object.assign(container as any[], { [ref.index as number]: next }) : next;

    const { success, errors } = param.validateValueVerbose(value);
    if (!success)
    {
      console.warn(`Handle "${handle.id}" produced an invalid ${param.name}:`, errors);
      return;
    }

    console.info('Handle updated param', handle.param, '→', next);
    updateParam(param.name, { value });
    scheduleExecution();

    // Re-base the drag zone on the position just reached. Execution is async (50ms debounce
    // plus a full CAD run), so a second drag started before the re-run lands would otherwise
    // measure its delta from the stale origin and add it on top of the value already written.
    handle.plane.origin.copy(handle.anchorLocal);
  }

  /** Rebuild a map function from its serialized source, as the scalar paramFnSrc path does.
   *  Script-derived code on the main thread — see CONTRIBUTING.md. */
  private _reconstructParamFn(src: string, vars: Record<string, any> | null | undefined, handleId: string): ((param: any, handle: HandleDrag) => any) | null
  {
    try
    {
      return rebuildFunction(src, vars);
    }
    catch (err)
    {
      console.error(`Handle "${handleId}": map function could not be reconstructed:`, err);
      return null;
    }
  }

  /** Shared tail for single-param path: prechecks → validate → updateParam → scheduleExecution. */
  private async _applyHandleParam(param: any, next: any): Promise<void>
  {
    for (const { check, fix } of PARAM_MAP_PRECHECKS)
    {
      if (check(param)) next = fix(next, param);
    }
    if (!param.validateValue(next))
    {
      console.warn(`Handle map function returned invalid value:`, next);
      return;
    }
    console.info('Handle updated param', param.name, '→', next);
    updateParam(param.name, { value: next });
    scheduleExecution();
  };

  /** Build a visible line (1D) or rect (2D) showing the handle's drag range. */
  private _buildRangeHelper(handle: HandleDef): THREE.Object3D | undefined
  {
    const mat = new THREE.LineBasicMaterial({
      color: VIEWER_HANDLE_RANGE_LINE_COLOR,
      linewidth: VIEWER_HANDLE_RANGE_LINE_WIDTH,
      toneMapped: false,
      depthTest: false,
    });

    const base = _handleBase(handle);

    if (handle.rangeType === '1d')
    {
      const min = handle.rangeMin as number;
      const max = handle.rangeMax as number;
      const start = base.clone().addScaledVector(handle.plane.uAxis, min);
      const end   = base.clone().addScaledVector(handle.plane.uAxis, max);
      const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
      return new THREE.Line(geo, mat);
    }
    else
    {
      const [minU, minV] = handle.rangeMin as [number, number];
      const [maxU, maxV] = handle.rangeMax as [number, number];
      const u = handle.plane.uAxis;
      const v = handle.plane.vAxis;
      const p00 = base.clone().addScaledVector(u, minU).addScaledVector(v, minV);
      const p10 = base.clone().addScaledVector(u, maxU).addScaledVector(v, minV);
      const p11 = base.clone().addScaledVector(u, maxU).addScaledVector(v, maxV);
      const p01 = base.clone().addScaledVector(u, minU).addScaledVector(v, maxV);
      const geo = new THREE.BufferGeometry().setFromPoints([p00, p10, p11, p01, p00]);
      return new THREE.Line(geo, mat);
    }
  }

  // ── 11. Styles ──
  static override styles = css`
    :host {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
      touch-action: none; /* prevent browser from capturing scroll/gesture events away from OrbitControls */
    }

    viewer-menu {
      position: absolute;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10;
    }
  `;
}

declare global
{
  interface HTMLElementTagNameMap
  {
    'model-viewer': ModelViewer;
  }
}

//// THUMBNAIL RENDER ////

/** Pixel size of a rendered script thumbnail — square, so it serves a 32px list icon and a
 *  ~300px card alike; larger only costs bytes nobody sees. */
export const THUMBNAIL_PNG_SIZE = 512;

/** The fixed viewpoint every thumbnail is taken from: a true isometric — equal angles to
 *  all three axes, from above-left-front in Z-up CAD space (the SVG exporter's default
 *  iso camera too) — so previews all read the same way and parallel edges stay parallel. */
const THUMBNAIL_VIEW_DIRECTION = new THREE.Vector3(-1, -1, 1).normalize();

export interface ModelThumbnailOptions
{
  /** Square size in pixels. Default THUMBNAIL_PNG_SIZE. */
  size?: number;
  /** A VIEW_STYLES id. Default 'techdraw' — and a style's mesh override is drawn UNLIT
   *  here (a plain fill of its colour), so tech draw gives clean white faces with black
   *  edges rather than the viewer's lightly shaded ones. */
  styleId?: string;
  /** Background colour, or null (default) for transparent — a shaded model on nothing sits
   *  on any card, in either theme. */
  background?: number | null;
  /** What colours the edges and silhouettes of a flat-fill style: each shape's own colour
   *  from the model (default — a little colour on white faces), or the style's ink. */
  edges?: 'shape' | 'ink';
  /** Edge and silhouette width in pixels of the rendered image. Default 2: the picture is
   *  shown well below its 512px, and a hairline would vanish when it is scaled down. */
  lineWidth?: number;
  /** The scenegraph to take visibility from: a run's `result.state.scenegraph`, or in the
   *  editor the reconciled `scenegraph` signal, which also carries the eye toggles in the
   *  scene tree. Visibility is not in the GLB: a hidden shape is only known from here, and
   *  is left out of the picture and its framing, as the viewer leaves it out of the scene. */
  scenegraph?: SceneNodeData | null;
}

/** Hide every object whose scenegraph node says `visible: false`, walking the GLB's
 *  semantic children and the graph's children side by side — the same alignment the
 *  viewer's path map uses (_buildPathMap). */
function hideByScenegraph(root: THREE.Object3D, graph: SceneNodeData): void
{
  const semanticChildrenOf = (obj: THREE.Object3D) =>
    obj.children.filter((c) => !c.userData.isViewerHelper && !GEO_TYPES.has(c.type));
  const recur = (obj: THREE.Object3D, node: SceneNodeData) =>
  {
    if (node.style?.visible === false) obj.visible = false;
    const objectChildren = semanticChildrenOf(obj);
    const count = Math.min(objectChildren.length, node.children?.length ?? 0);
    for (let i = 0; i < count; i++) recur(objectChildren[i], node.children[i]);
  };
  recur(root, graph);
}

/** The bounding box of what is actually VISIBLE under `root` — Box3.setFromObject() takes
 *  hidden subtrees along, and a hidden shape must not leave air in the frame either. */
function visibleBox(root: THREE.Object3D): THREE.Box3
{
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  const walk = (o: THREE.Object3D) =>
  {
    if (!o.visible) return;
    const geometry = (o as THREE.Mesh).geometry;
    if (geometry)
    {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (geometry.boundingBox) box.union(geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    }
    o.children.forEach(walk);
  };
  walk(root);
  return box;
}

/**
 * Render a model GLB to a square PNG, off screen, with one fixed recipe: the given view
 * style (tech draw by default: white faces, black edges), an isometric (orthographic)
 * camera, the model fitted to the frame, and no grid, gizmo, handles or annotations.
 *
 * This is what a script's thumbnail is (services/thumbnails.ts in the editor). It renders
 * rather than drawing a hidden-line projection because a GPU frame costs the same few
 * milliseconds whatever the assembly density, where hidden-line removal on a detailed
 * house takes tens of seconds and blocks every run queued behind it.
 *
 * Self-contained on purpose: its own renderer, scene and lights, created for the call and
 * disposed after it (a WebGL context is not something to keep around per page), and no
 * connection to the live <model-viewer>, so what the user has selected, hidden or
 * toggled never leaks into the picture. The GLB is parsed a second time for that; a few
 * hundred milliseconds on the main thread for a big model, spent off the run path.
 *
 * Resolves to the PNG bytes, or null when there is nothing to show (an empty model) or
 * WebGL is unavailable.
 */
export async function renderModelThumbnail(glb: ArrayBuffer, options: ModelThumbnailOptions = {}): Promise<ArrayBuffer | null>
{
  const size = options.size ?? THUMBNAIL_PNG_SIZE;
  const style = VIEW_STYLES.find(s => s.id === (options.styleId ?? 'techdraw')) ?? VIEW_STYLES[0];
  const background = options.background ?? null;
  const edgesFromShape = (options.edges ?? 'shape') === 'shape';
  const lineWidth = options.lineWidth ?? 2;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  let renderer: THREE.WebGLRenderer;
  try
  {
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: background === null, preserveDrawingBuffer: true, powerPreference: 'low-power',
    });
  }
  catch (err)
  {
    console.warn('renderModelThumbnail(): no WebGL renderer:', err);
    return null;
  }

  const scene = new THREE.Scene();
  const disposables: Array<{ dispose(): void }> = [];
  try
  {
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.toneMapping = (style.toneMapping ?? THREE.NeutralToneMapping) as THREE.ToneMapping;
    renderer.toneMappingExposure = style.toneMappingExposure ?? 1;
    const shadows = style.shadows ?? true;
    renderer.shadowMap.enabled = shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (background === null) renderer.setClearColor(0x000000, 0);
    else
    {
      renderer.setClearColor(background);
      scene.background = new THREE.Color(background);
    }

    // Lighting, as the viewer sets it up for this style.
    if (style.environment === 'room')
    {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new RoomEnvironment();
      const envTexture = pmrem.fromScene(envScene, 0.04).texture;
      envScene.dispose();
      pmrem.dispose();
      disposables.push(envTexture);
      scene.environment = envTexture;
      scene.environmentIntensity = style.environmentIntensity ?? 1;
    }
    if (style.ambientLight?.enabled !== false)
    {
      scene.add(new THREE.AmbientLight(style.ambientLight?.color ?? 0xffffff, style.ambientLight?.intensity ?? 0.3));
    }
    if (style.hemiLight?.enabled)
    {
      scene.add(new THREE.HemisphereLight(style.hemiLight.color ?? 0xffffff, 0x888888, style.hemiLight.intensity ?? 1));
    }
    const keyLight = new THREE.DirectionalLight(style.spotlight?.color ?? 0xffffff, style.spotlight?.intensity ?? 3);
    keyLight.visible = style.spotlight?.enabled !== false;
    keyLight.castShadow = shadows && (style.spotlight?.castShadow ?? true);
    scene.add(keyLight);
    scene.add(keyLight.target);

    // The model itself: hard edges from the GLB's own extensions, no annotations.
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(draco);
    disposables.push(draco);
    const gltf = await new Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTF>(
      (resolve, reject) => loader.parse(glb, '', resolve, reject),
    );
    const model = gltf.scene;
    await applyEdgeExtensions(gltf, model);
    applyPointStyles(model);
    if (options.scenegraph)
    {
      // As the viewer does: skip the gltf.scene wrapper, start from the content root.
      const contentRoot = model.children.find(c => !c.userData.isViewerHelper) ?? model;
      hideByScenegraph(contentRoot, options.scenegraph);
    }

    // Framing first: the silhouette width below is a fraction of the frame.
    const box = visibleBox(model);
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    const extent = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(extent.x, extent.y, extent.z, 1e-6);
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius;

    // Camera: isometric, so orthographic, placed well outside the model along the view
    // direction. The frame is fitted to the model's bounding box as it PROJECTS — its eight
    // corners in view space — rather than to the bounding sphere, which for anything box-
    // like is far bigger than its outline and left the picture small in the middle.
    const dist = radius * 4;
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, dist * 0.01, dist * 3);
    camera.up.set(0, 0, VIEWER_MODEL_COORDSYSTEM.up === 'z' ? 1 : 0);
    camera.position.copy(center).addScaledVector(THUMBNAIL_VIEW_DIRECTION, dist);
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
    const toView = camera.matrixWorld.clone().invert();
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const sx of [box.min.x, box.max.x]) for (const sy of [box.min.y, box.max.y]) for (const sz of [box.min.z, box.max.z])
    {
      const p = new THREE.Vector3(sx, sy, sz).applyMatrix4(toView);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    // Square frame around the projected extent, with a little air (4%) and room for the
    // silhouette at the very edge.
    const half = (Math.max(maxX - minX, maxY - minY) / 2) * 1.04 + (radius * 0.004);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    camera.left = cx - half;
    camera.right = cx + half;
    camera.top = cy + half;
    camera.bottom = cy - half;
    camera.updateProjectionMatrix();

    // A flat-fill style (tech draw) draws with lines, and the GLB's edge lines only cover
    // HARD edges: a white cylinder on a white ground would have no outline at all. So every
    // mesh also gets a silhouette — the classic inverted hull: its back faces, pushed out
    // along the normals by about a pixel and painted in the line colour, peek out around
    // the front faces exactly where the surface turns away from the camera.
    const inkColor = style.lines?.color;
    const drawSilhouettes = !!style.mesh && inkColor !== undefined;
    const silhouettes = new Map<number, THREE.MeshBasicMaterial>(); // one material per colour
    const silhouetteFor = (color: number) =>
    {
      let mat = silhouettes.get(color);
      if (mat) return mat;
      mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
      const width = (2 * half / size) * lineWidth; // pixels → world units
      mat.onBeforeCompile = (shader) =>
      {
        shader.uniforms.uSilhouette = { value: width };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uSilhouette;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uSilhouette;');
      };
      silhouettes.set(color, mat);
      return mat;
    };
    /** The line colour for a node: its nearest ancestor shape's own colour, else the ink. */
    const lineColorFor = (n: THREE.Object3D): number | undefined =>
    {
      if (!edgesFromShape) return inkColor;
      for (let p: THREE.Object3D | null = n; p; p = p.parent)
      {
        if (typeof p.userData.thumbnailShapeColor === 'number') return p.userData.thumbnailShapeColor;
      }
      return inkColor;
    };

    const hulls: Array<[THREE.Mesh, THREE.Mesh]> = [];
    model.traverse((n) =>
    {
      const mesh = n as THREE.Mesh;
      const isLine = n.type === 'LineSegments2' || n instanceof THREE.LineSegments || n instanceof THREE.Line;
      if (mesh.isMesh && !isLine)
      {
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        if (style.mesh === null)
        {
          mesh.material = new THREE.MeshBasicMaterial({ visible: false });
        }
        else if (style.mesh)
        {
          // The style's fill, unlit: every face the same clean colour, edges do the drawing.
          const existing = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          // Remember the shape's own colour before it goes: its edges are drawn in it.
          const own = (existing as THREE.MeshStandardMaterial | undefined)?.color;
          if (own) mesh.userData.thumbnailShapeColor = own.getHex();
          const opacity = style.mesh.opacity ?? 1;
          mesh.material = new THREE.MeshBasicMaterial({
            color: style.mesh.color ?? 0xffffff,
            opacity,
            transparent: style.mesh.transparent ?? opacity < 1,
            side: existing?.side ?? THREE.FrontSide,
            wireframe: style.mesh.wireframe ?? false,
          });
        }
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => { m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1; });
        if (drawSilhouettes && mesh.geometry?.attributes?.normal && style.mesh !== null)
        {
          const hull = new THREE.Mesh(mesh.geometry, silhouetteFor(lineColorFor(mesh) ?? inkColor!));
          hull.userData.isSilhouette = true;
          hulls.push([mesh, hull]);
        }
      }
      const mat = (n as any).material; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (isLine && mat?.color)
      {
        if (style.lines === null) n.visible = false;
        // A line with its own vertex gradient keeps it, as the viewer does (see
        // _applyLineStyleOverride); a plain one takes its shape's colour, or the ink.
        else if (n.userData.hasVertexGradient !== true)
        {
          const color = lineColorFor(n);
          if (color !== undefined) mat.color.setHex(color);
        }
      }
      if (mat?.isLineMaterial)
      {
        mat.resolution.set(size, size);
        mat.linewidth = lineWidth;
      }
    });
    // Added after the walk, not during it: a hull is a child of its mesh, and the traverse
    // would otherwise visit it too. The geometry is shared and disposed once, below.
    for (const [mesh, hull] of hulls) mesh.add(hull);
    scene.add(model);


    // Key light framed on the model, as _updateSpotlightForModel() does.
    const lightVec = new THREE.Vector3(...VIEWER_LIGHT_POSITION);
    const lightDistance = lightVec.length();
    const sceneRadius = Math.max(maxDim * 0.5, 1);
    keyLight.position.copy(center).addScaledVector(lightVec.normalize(), lightDistance);
    keyLight.target.position.copy(center);
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = Math.max(lightDistance - sceneRadius * 6, 1);
    keyLight.shadow.camera.far = lightDistance + sceneRadius * 6;
    const halfExtent = sceneRadius * 1.5;
    keyLight.shadow.camera.left = -halfExtent;
    keyLight.shadow.camera.right = halfExtent;
    keyLight.shadow.camera.top = halfExtent;
    keyLight.shadow.camera.bottom = -halfExtent;
    keyLight.shadow.normalBias = 0.02;
    keyLight.shadow.radius = 6;
    keyLight.shadow.camera.updateProjectionMatrix();
    keyLight.target.updateMatrixWorld();

    // A shadow catcher under the model — the only ground there is; no grid.
    if (shadows && (style.groundPlane ?? false))
    {
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(maxDim * 6, maxDim * 6),
        new THREE.ShadowMaterial({ opacity: 0.16 }),
      );
      ground.receiveShadow = true;
      ground.position.set(center.x, center.y, box.min.z - maxDim * 0.001);
      scene.add(ground);
    }

    renderer.render(scene, camera);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    return blob ? await blob.arrayBuffer() : null;
  }
  catch (err)
  {
    console.warn('renderModelThumbnail(): failed:', err);
    return null;
  }
  finally
  {
    scene.traverse((n) =>
    {
      const obj = n as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      obj.geometry?.dispose?.();
      const mats: THREE.Material[] = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
      mats.forEach((m) => m.dispose());
    });
    disposables.forEach(d => d.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
