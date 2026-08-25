import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Post-process a Three.js GLTF scene to render CAD edges stored in:
 *   - EXT_mesh_primitive_edge_visibility  (2-bit-per-edge hard/soft bitfield)
 *   - BENTLEY_materials_line_style        (width in px, 16-bit dash pattern)
 *
 * Three.js GLTFLoader forwards unknown extensions into userData.gltfExtensions,
 * so no custom loader plugin is needed.
 */
export async function applyEdgeExtensions(gltf: GLTF, root: THREE.Object3D): Promise<void>
{
    const tasks: Promise<void>[] = [];
    let meshCount = 0;
    let extCount = 0;

    root.traverse((node) =>
    {
        if (!(node as THREE.Mesh).isMesh) return;
        meshCount++;
        const mesh = node as THREE.Mesh;
        const ext = mesh.userData?.gltfExtensions?.['EXT_mesh_primitive_edge_visibility'];
        if (!ext) return;
        extCount++;
        tasks.push(_attachEdgeLines(mesh, ext, gltf.parser));
    });

    await Promise.all(tasks);
    _applyNativeLineStyles(root);
}

/**
 * Post-process a Three.js GLTF scene to style CAD points stored in native GLTF
 * POINTS primitives carrying the AY_materials_point_style material extension
 * (size in px, circle/square shape).
 *
 * Three.js GLTFLoader creates a THREE.Points with a THREE.PointsMaterial for POINTS
 * primitives and forwards unknown material extensions to material.userData.gltfExtensions.
 */
export function applyPointStyles(root: THREE.Object3D): void
{
    root.traverse((node) =>
    {
        if (!(node as THREE.Points).isPoints) return;
        const points = node as THREE.Points;

        const material = Array.isArray(points.material) ? points.material[0] : points.material;
        if (!(material instanceof THREE.PointsMaterial)) return;

        const ext = material.userData?.gltfExtensions?.['AY_materials_point_style'] as
            { size?: number; shape?: 'circle' | 'square' } | undefined;

        const size: number = ext?.size ?? 5;
        const shape: 'circle' | 'square' = ext?.shape ?? 'circle';

        // Constant screen-space pixel size (do not shrink/grow with distance).
        material.size = size;
        material.sizeAttenuation = false;

        if (shape === 'circle')
        {
            material.map = _circlePointTexture();
            material.alphaTest = 0.5;
            material.transparent = material.transparent || (material.opacity ?? 1) < 1;
        }
        material.needsUpdate = true;
    });
}

let _circleTex: THREE.CanvasTexture | null = null;

/** Cached circular sprite so POINTS render round instead of the default square splat. */
function _circlePointTexture(): THREE.CanvasTexture
{
    if (_circleTex) return _circleTex;
    const S = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext('2d')!;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    _circleTex = new THREE.CanvasTexture(canvas);
    _circleTex.needsUpdate = true;
    return _circleTex;
}

async function _attachEdgeLines(
    mesh: THREE.Mesh,
    ext: { visibility: number; material?: number },
    parser: GLTF['parser'],
): Promise<void>
{
    // Only render edges when an explicit stroke material was set by the user.
    // Unstyled meshes (no strokeWidth / strokeDash) carry no material index
    // and should not show any edge overlay.
    if (ext.material === undefined) return;

    const indexAttr = mesh.geometry.index;
    if (!indexAttr) return;

    const indices  = indexAttr.array;
    // IMPORTANT: use getX/getY/getZ — not .array — because gltf-transform may write
    // position + normal in a single interleaved buffer view (stride = 6).
    // Three.js creates an InterleavedBufferAttribute in that case, and .array gives the
    // full interleaved buffer, so positions[v*3] lands on the normal for odd v indices.
    const posAttr  = mesh.geometry.attributes.position;

    // Fetch the 2-bit-per-edge visibility bitfield accessor
    const accDef = (parser.json as any).accessors?.[ext.visibility];
    
    // getDependency returns a THREE.BufferAttribute — extract the raw typed array.
    // The accessor is SCALAR UNSIGNED_BYTE (componentType 5121), so .array should be Uint8Array.
    // If Three.js returns a different type (e.g. normalized Float32), re-interpret raw bytes.
    const visAttr = await parser.getDependency('accessor', ext.visibility) as THREE.BufferAttribute;
    const rawArr = visAttr.array;
    const visData: Uint8Array = rawArr instanceof Uint8Array
        ? rawArr
        : new Uint8Array(rawArr.buffer, rawArr.byteOffset, (accDef?.count ?? rawArr.length));


    const lineVerts: number[] = [];
    const triCount = indices.length / 3;
    let hardSlots = 0, smoothSlots = 0;

    for (let tri = 0; tri < triCount; tri++)
    {
        for (let slot = 0; slot < 3; slot++)
        {
            const edgeIdx = tri * 3 + slot;
            const byteIdx = Math.floor(edgeIdx * 2 / 8);
            const bitOff  = (edgeIdx * 2) % 8;
            const val = (visData[byteIdx] >> bitOff) & 0x3;
            if (val !== 2) { smoothSlots++; continue; } // only hard/crease edges
            hardSlots++;

            const a = indices[tri * 3 + slot];
            const b = indices[tri * 3 + (slot + 1) % 3];
            lineVerts.push(
                posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a),
                posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b),
            );
        }
    }

    // Deduplicate: each hard edge is referenced from both adjacent triangles,
    // keep only the first occurrence per unique vertex pair.
    const seen = new Set<string>();
    const dedupedVerts: number[] = [];
    for (let i = 0; i < lineVerts.length; i += 6)
    {
        const ax = lineVerts[i],   ay = lineVerts[i+1], az = lineVerts[i+2];
        const bx = lineVerts[i+3], by = lineVerts[i+4], bz = lineVerts[i+5];
        const key = ax < bx || (ax === bx && ay < by) || (ax === bx && ay === by && az < bz)
            ? `${ax},${ay},${az}|${bx},${by},${bz}`
            : `${bx},${by},${bz}|${ax},${ay},${az}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dedupedVerts.push(ax, ay, az, bx, by, bz);
    }

    if (!dedupedVerts.length) return;

    // Push mesh faces slightly back so lines win the depth test (no z-fighting)
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => { m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1; });

    const mat = _resolveLineMaterial(ext.material, parser);

    // Mark the source mesh so the scene explorer skips it (container node is shown instead)
    mesh.userData.isEdgeSurface = true;

    if (mat instanceof THREE.LineBasicMaterial)
    {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(dedupedVerts, 3));
        const lines = new THREE.LineSegments(geo, mat);
        lines.userData.cannotReceiveAO = true;
        lines.userData.isEdgeOverlay = true;
        mesh.add(lines);
    }
    else
    {
        const geo2 = new LineSegmentsGeometry().setPositions(dedupedVerts);
        const lines2 = new LineSegments2(geo2, mat as LineMaterial);
        lines2.userData.cannotReceiveAO = true;
        lines2.userData.isEdgeOverlay = true;
        mesh.add(lines2);
    }
}

function _resolveLineMaterial(
    materialIndex: number | undefined,
    parser: GLTF['parser'],
): THREE.LineBasicMaterial | LineMaterial
{
    const gltfMat = (parser.json as any).materials?.[materialIndex ?? -1];
    const bentley = gltfMat?.extensions?.['BENTLEY_materials_line_style'];
    
    const baseColor: [number, number, number, number] =
        gltfMat?.pbrMetallicRoughness?.baseColorFactor ?? [0, 0, 0, 1];

    const color   = new THREE.Color(baseColor[0], baseColor[1], baseColor[2]);
    // Alpha carries the line opacity (materials draw their outline at <1 by default).
    const opacity: number = baseColor[3] ?? 1;
    const transparent     = opacity < 1;
    const width: number   = bentley?.width   ?? 1;
    const pattern: number = bentley?.pattern ?? 0xFFFF;

    if (width <= 1 && pattern === 0xFFFF)
    {
        return new THREE.LineBasicMaterial({ color, opacity, transparent });
    }

    const mat = new LineMaterial({ color: color.getHex(), linewidth: width, opacity, transparent });
    if (pattern !== 0xFFFF) _applyDashPattern(mat, pattern);
    return mat;
}

function _applyDashPattern(mat: LineMaterial, pattern: number): void
{
    mat.onBeforeCompile = (shader) =>
    {
        shader.uniforms['uDashPattern'] = { value: pattern };
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <clipping_planes_fragment>',
            `#include <clipping_planes_fragment>
             uniform uint uDashPattern;
             {
               int bit = int(mod(vLineDistance, 16.0));
               if (((uDashPattern >> uint(bit)) & 1u) == 0u) discard;
             }`,
        );
    };
    mat.needsUpdate = true;
}

/**
 * Style the native GLTF line primitives (a Curve exports as one LINE_STRIP), which
 * three loads as THREE.Line with a LineBasicMaterial.
 *
 * WebGL ignores LineBasicMaterial.linewidth on every desktop driver, so a stroke wider
 * than a hairline can only be drawn with the fat-line pipeline: strokeWidth > 1 swaps the
 * object for a LineSegments2 + LineMaterial (the same pipeline the mesh edge overlays
 * above already use). Hairlines stay native — cheaper, and pixel-identical.
 */
function _applyNativeLineStyles(root: THREE.Object3D): void
{
    // Collect first: upgrading a line replaces it in its parent's child list, which would
    // otherwise mutate the tree that traverse() is walking.
    const lines: THREE.Line[] = [];
    root.traverse((node) =>
    {
        // LineSegments and LineLoop both extend Line.
        if (!(node instanceof THREE.Line)) return;
        if (node.userData.isEdgeOverlay) return; // already styled by _attachEdgeLines
        lines.push(node);
    });

    for (const node of lines)
    {
        const material = Array.isArray(node.material) ? node.material[0] : node.material;
        const bentley = material?.userData?.gltfExtensions?.['BENTLEY_materials_line_style'] as
            { width?: number; pattern?: number } | undefined;

        // A curve exported with a colour gradient carries a COLOR_0 accessor, which GLTFLoader
        // has already turned into a `color` attribute. Such a curve needs handling even when it
        // has NO line-style extension — a plain hairline gradient would otherwise be skipped by
        // the `continue` below and never get its tone-mapping opt-out or its marker.
        const hasGradient = !!node.geometry?.attributes?.color;
        if (hasGradient) { _markVertexGradient(node, material); }

        if (!bentley) continue;

        const width   = bentley.width ?? 1;
        const pattern = bentley.pattern ?? 0xFFFF;

        if (width > 1)
        {
            _upgradeToFatLine(node, material, width, pattern);
        }
        else if (pattern !== 0xFFFF)
        {
            const dashedMaterial = _createDashedNativeMaterial(material, pattern);
            node.material = dashedMaterial;
            node.computeLineDistances();
        }
    }
}

/**
 * Prepare a natively-loaded line that carries per-vertex colour.
 *
 * GLTFLoader already sets `vertexColors` from a COLOR_0 accessor, so the colours render on their
 * own. Two things still have to happen:
 *
 *  - **Opt out of tone mapping.** The renderer uses AgX, which would shift every stop away from
 *    the colour the script actually asked for. The grid helper does the same for the same reason.
 *  - **Mark the object.** `_applyLineStyleOverride` in model-viewer overwrites `material.color`
 *    on every line whenever the active view style declares one — and because glTF vertex colour
 *    is MULTIPLIED by the material colour, that would tint or black out the whole gradient. The
 *    flag is what tells it to leave this line alone.
 */
function _markVertexGradient(line: THREE.Line, material: THREE.Material | undefined): void
{
    line.userData.hasVertexGradient = true;
    if (!material) return;
    material.toneMapped = false;
    (material as THREE.LineBasicMaterial).vertexColors = true;
    // White, so the per-vertex colours come through unmultiplied.
    (material as THREE.LineBasicMaterial).color?.setHex(0xffffff);
    material.needsUpdate = true;
}

/** Replace a native THREE.Line with a screen-space-width LineSegments2 in the same slot. */
function _upgradeToFatLine(
    line: THREE.Line,
    source: THREE.Material,
    width: number,
    pattern: number,
): void
{
    const parent = line.parent;
    if (!parent) return;

    const positions = _segmentPositions(line);
    if (!positions.length) return;

    const color = source instanceof THREE.LineBasicMaterial
        ? source.color
        : new THREE.Color(0x000000);
    const opacity = source.opacity ?? 1;
    const dashed = pattern !== 0xFFFF;

    // Read the colours BEFORE the geometry is disposed at the end of this function — that
    // disposal is what silently dropped vertex colours on every thick line.
    const colors = _segmentColors(line);
    const hasGradient = !!colors && colors.length === positions.length;

    const material = new LineMaterial({
        // White when the colours come per-vertex: LineMaterial's fragment shader MULTIPLIES
        // material.color by the interpolated vertex colour, so carrying the source colour over
        // (usually near-black) would multiply the whole gradient away.
        color: hasGradient ? 0xffffff : color.getHex(),
        linewidth: width, // px — LineMaterial.resolution is kept in sync on resize
        opacity,
        transparent: source.transparent || opacity < 1,
        dashed,
        vertexColors: hasGradient,
    });
    if (hasGradient)
    {
        // AgX tone mapping would shift every stop off the authored colour.
        material.toneMapped = false;
    }
    if (dashed)
    {
        const { dashSize, gapSize } = _dashSizesFromPattern(pattern);
        material.dashSize = dashSize;
        material.gapSize  = gapSize;
    }

    const geometry = new LineSegmentsGeometry().setPositions(positions);
    if (hasGradient) { geometry.setColors(colors!); }
    const fat = new LineSegments2(geometry, material);
    if (dashed) fat.computeLineDistances();

    // Carry over everything the rest of the viewer keys off: the scene-path map, the
    // scene explorer and click-selection all read name / userData from this object.
    fat.name        = line.name;
    fat.userData    = { ...line.userData };
    // The view-style override keys off this; it must survive the swap even if the source line
    // was reached without going through _markVertexGradient.
    if (hasGradient) { fat.userData.hasVertexGradient = true; }
    fat.visible     = line.visible;
    fat.renderOrder = line.renderOrder;
    fat.frustumCulled = line.frustumCulled;
    fat.position.copy(line.position);
    fat.quaternion.copy(line.quaternion);
    fat.scale.copy(line.scale);
    fat.matrixAutoUpdate = line.matrixAutoUpdate;
    if (!line.matrixAutoUpdate) fat.matrix.copy(line.matrix);
    while (line.children.length) fat.add(line.children[0]);

    // Swap in place so sibling ORDER survives — _buildPathMap pairs scenegraph nodes
    // with object children positionally.
    parent.children[parent.children.indexOf(line)] = fat;
    fat.parent = parent;
    line.parent = null;

    line.geometry.dispose();
    source.dispose();
}

/**
 * Walk a line primitive's topology, calling `fn` with the two vertex indices of each segment.
 *
 * Positions and per-vertex colours MUST be expanded by the same walk: LineSegmentsGeometry
 * pairs them by position in the array, so a colour list built from a slightly different
 * traversal — one that forgot LineLoop's closing segment, say — would silently colour every
 * segment with its neighbour's value. Sharing one walker makes that class of bug impossible
 * rather than merely unlikely.
 */
function _forEachSegment(line: THREE.Line, fn: (a: number, b: number) => void): void
{
    const geometry = line.geometry;
    const pos = geometry.attributes.position;
    if (!pos) return;

    const index = geometry.index;
    const count = index ? index.count : pos.count;
    const vertexAt = (i: number) => (index ? index.getX(i) : i);

    if ((line as THREE.LineSegments).isLineSegments)
    {
        for (let i = 0; i + 1 < count; i += 2) fn(vertexAt(i), vertexAt(i + 1));
    }
    else
    {
        // LINE_STRIP (and LineLoop, which additionally closes back to the first vertex)
        for (let i = 0; i + 1 < count; i++) fn(vertexAt(i), vertexAt(i + 1));
        if ((line as THREE.LineLoop).isLineLoop && count > 2) fn(vertexAt(count - 1), vertexAt(0));
    }
}

/** Flatten a line primitive's vertices to the [x1,y1,z1, x2,y2,z2, ...] pairs LineSegmentsGeometry wants. */
function _segmentPositions(line: THREE.Line): number[]
{
    const pos = line.geometry.attributes.position;
    if (!pos) return [];

    const out: number[] = [];
    _forEachSegment(line, (a, b) =>
    {
        out.push(
            pos.getX(a), pos.getY(a), pos.getZ(a),
            pos.getX(b), pos.getY(b), pos.getZ(b),
        );
    });
    return out;
}

/**
 * The same expansion for per-vertex colour, for `LineSegmentsGeometry.setColors()`.
 *
 * Returns null when the geometry has no colour attribute, which is the normal case.
 *
 * Note `setColors` wants **rgb per segment endpoint** — it does not expand a strip the way
 * LineGeometry does — so this mirrors `_segmentPositions` exactly, six floats per segment.
 */
function _segmentColors(line: THREE.Line): number[] | null
{
    const col = line.geometry.attributes.color;
    if (!col) return null;

    const out: number[] = [];
    _forEachSegment(line, (a, b) =>
    {
        out.push(
            col.getX(a), col.getY(a), col.getZ(a),
            col.getX(b), col.getY(b), col.getZ(b),
        );
    });
    return out;
}

function _createDashedNativeMaterial(
    source: THREE.Material,
    pattern: number,
): THREE.LineDashedMaterial
{
    const color = source instanceof THREE.LineBasicMaterial
        ? source.color
        : new THREE.Color(0x000000);
    const opacity = source.opacity ?? 1;
    const { dashSize, gapSize } = _dashSizesFromPattern(pattern);

    return new THREE.LineDashedMaterial({
        color,
        opacity,
        transparent: source.transparent || opacity < 1,
        dashSize,
        gapSize,
        depthTest: source.depthTest,
        depthWrite: source.depthWrite,
        toneMapped: source.toneMapped,
        // Without this a HAIRLINE DASHED curve silently loses its gradient: this builds a fresh
        // material from scratch, and every property not named here is dropped.
        vertexColors: (source as THREE.LineBasicMaterial).vertexColors === true,
    });
}

function _dashSizesFromPattern(pattern: number): { dashSize: number; gapSize: number }
{
    const bits = Array.from({ length: 16 }, (_, index) => (pattern >> index) & 1);
    const firstLit = bits.findIndex(bit => bit === 1);
    if (firstLit === -1) return { dashSize: 20, gapSize: 20 };

    const runLength = (start: number, value: number): number =>
    {
        const count = bits
            .slice(start)
            .findIndex(bit => bit !== value);
        return count === -1 ? bits.length - start : count;
    };

    const dashBits = Math.max(1, runLength(firstLit, 1));
    const firstGap = bits.findIndex((bit, index) => index > firstLit && bit === 0);
    const gapBits = Math.max(1, firstGap === -1 ? dashBits : runLength(firstGap, 0));

    const unit = 12;
    return { dashSize: dashBits * unit, gapSize: gapBits * unit };
}
