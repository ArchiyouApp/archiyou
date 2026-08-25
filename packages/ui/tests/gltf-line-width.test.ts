import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { applyEdgeExtensions } from '../src/viewer/gltf-edge-extensions.js';

/**
 * A Curve (circle, rect, line) exports as a native GLTF LINE_STRIP whose material
 * carries BENTLEY_materials_line_style. WebGL ignores LineBasicMaterial.linewidth,
 * so anything wider than a hairline has to be swapped for the fat-line pipeline.
 */

/** Build a THREE.Line the way GLTFLoader does for a LINE_STRIP primitive. */
function nativeLine(points: number[][], lineStyle?: { width?: number; pattern?: number }): THREE.Line
{
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    const material = new THREE.LineBasicMaterial({ color: 0xffff00 });
    if (lineStyle)
    {
        material.userData.gltfExtensions = { BENTLEY_materials_line_style: lineStyle };
    }
    return new THREE.Line(geometry, material);
}

const SQUARE = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 0]];

async function applyTo(root: THREE.Object3D): Promise<void>
{
    // No meshes carry EXT_mesh_primitive_edge_visibility here, so the parser is never touched.
    await applyEdgeExtensions({ parser: { json: {} } } as never, root);
}

describe('native line styling', () =>
{
    it('upgrades a strokeWidth > 1 curve to a fat line of that pixel width', async () =>
    {
        const root = new THREE.Group();
        const line = nativeLine(SQUARE, { width: 10, pattern: 0xFFFF });
        line.name = 'circle';
        line.userData.shapeId = 'abc';
        line.position.set(1, 2, 3);
        root.add(new THREE.Group()); // sibling before, so index preservation is observable
        root.add(line);
        root.add(new THREE.Group());

        await applyTo(root);

        const fat = root.children[1];
        expect(fat).toBeInstanceOf(LineSegments2);
        expect(fat.parent).toBe(root);
        expect(fat.name).toBe('circle');
        expect(fat.userData.shapeId).toBe('abc');
        expect(fat.position.toArray()).toEqual([1, 2, 3]);

        const material = (fat as LineSegments2).material as LineMaterial;
        expect(material.linewidth).toBe(10);
        expect(material.color.getHex()).toBe(0xffff00);
        expect(material.dashed).toBe(false);

        // 5 strip vertices -> 4 segments -> 8 endpoints
        expect((fat as LineSegments2).geometry.attributes.instanceStart.count).toBe(4);
    });

    it('leaves a hairline curve as a native line', async () =>
    {
        const root = new THREE.Group();
        const line = nativeLine(SQUARE, { width: 1, pattern: 0xFFFF });
        root.add(line);

        await applyTo(root);

        expect(root.children[0]).toBe(line);
        expect(line.material).toBeInstanceOf(THREE.LineBasicMaterial);
    });

    it('leaves an unstyled curve (no extension) untouched', async () =>
    {
        const root = new THREE.Group();
        const line = nativeLine(SQUARE);
        root.add(line);

        await applyTo(root);

        expect(root.children[0]).toBe(line);
    });

    it('keeps dashing a hairline via LineDashedMaterial', async () =>
    {
        const root = new THREE.Group();
        const line = nativeLine(SQUARE, { width: 1, pattern: 0x00FF });
        root.add(line);

        await applyTo(root);

        expect(root.children[0]).toBe(line);
        expect(line.material).toBeInstanceOf(THREE.LineDashedMaterial);
    });

    it('dashes a wide curve on the fat-line material', async () =>
    {
        const root = new THREE.Group();
        root.add(nativeLine(SQUARE, { width: 4, pattern: 0x00FF }));

        await applyTo(root);

        const fat = root.children[0] as LineSegments2;
        expect(fat).toBeInstanceOf(LineSegments2);
        const material = fat.material as LineMaterial;
        expect(material.linewidth).toBe(4);
        expect(material.dashed).toBe(true);
        expect(material.dashSize).toBeGreaterThan(0);
        expect(material.gapSize).toBeGreaterThan(0);
    });
});

/**
 * Per-vertex colour gradients.
 *
 * A Curve with a gradient exports a COLOR_0 accessor, which GLTFLoader turns into a `color`
 * attribute on the geometry. The hairline path then renders it for free; the fat-line path has
 * to carry it across by hand, and used to drop it silently because _upgradeToFatLine read only
 * the position attribute and then disposed the geometry.
 */

/** Build a THREE.Line with a colour attribute, the way GLTFLoader does for COLOR_0. */
function gradientLine(
    points: number[][],
    colors: number[][],
    lineStyle?: { width?: number; pattern?: number },
): THREE.Line
{
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors.flat(), 3));
    // GLTFLoader sets this itself when a primitive has COLOR_0.
    const material = new THREE.LineBasicMaterial({ color: 0x000000, vertexColors: true });
    if (lineStyle)
    {
        material.userData.gltfExtensions = { BENTLEY_materials_line_style: lineStyle };
    }
    return new THREE.Line(geometry, material);
}

const STRIP = [[0, 0, 0], [1, 0, 0], [2, 0, 0]];
const RED_TO_BLUE = [[1, 0, 0], [0.5, 0, 0.5], [0, 0, 1]];

describe('vertex colour gradients', () =>
{
    it('carries vertex colours onto a fat line', async () =>
    {
        const root = new THREE.Group();
        root.add(gradientLine(STRIP, RED_TO_BLUE, { width: 6, pattern: 0xFFFF }));

        await applyTo(root);

        const fat = root.children[0] as LineSegments2;
        expect(fat).toBeInstanceOf(LineSegments2);

        // setColors() writes interleaved start/end attributes, one pair per segment.
        const start = fat.geometry.attributes.instanceColorStart;
        const end = fat.geometry.attributes.instanceColorEnd;
        expect(start).toBeDefined();
        expect(end).toBeDefined();
        expect(start.count).toBe(2); // 3 strip vertices -> 2 segments
        expect(start.itemSize).toBe(3);

        // Segment 0 runs red -> mid, segment 1 mid -> blue.
        expect([start.getX(0), start.getY(0), start.getZ(0)]).toEqual([1, 0, 0]);
        expect([end.getX(1), end.getY(1), end.getZ(1)]).toEqual([0, 0, 1]);
    });

    it('turns on vertexColors and whitens the fat material', async () =>
    {
        // The shader MULTIPLIES material.color by the vertex colour, so carrying the source
        // material's near-black colour across would multiply the gradient to nothing.
        const root = new THREE.Group();
        root.add(gradientLine(STRIP, RED_TO_BLUE, { width: 6, pattern: 0xFFFF }));

        await applyTo(root);

        const material = (root.children[0] as LineSegments2).material as LineMaterial;
        expect(material.vertexColors).toBe(true);
        expect(material.color.getHex()).toBe(0xffffff);
        // AgX tone mapping would shift every stop off the authored colour.
        expect(material.toneMapped).toBe(false);
    });

    it('marks the object so the view style leaves its colour alone', async () =>
    {
        const root = new THREE.Group();
        root.add(gradientLine(STRIP, RED_TO_BLUE, { width: 6, pattern: 0xFFFF }));

        await applyTo(root);

        expect(root.children[0].userData.hasVertexGradient).toBe(true);
    });

    it('marks a HAIRLINE gradient too, even with no line-style extension', async () =>
    {
        // The native path needs no geometry work — GLTFLoader already wired the colours up —
        // but it still has to opt out of tone mapping and be marked, and a curve with no
        // BENTLEY extension used to be skipped entirely.
        const root = new THREE.Group();
        const line = gradientLine(STRIP, RED_TO_BLUE);
        root.add(line);

        await applyTo(root);

        expect(root.children[0]).toBe(line);
        expect(line.userData.hasVertexGradient).toBe(true);
        expect((line.material as THREE.LineBasicMaterial).vertexColors).toBe(true);
        expect((line.material as THREE.LineBasicMaterial).toneMapped).toBe(false);
        expect((line.material as THREE.LineBasicMaterial).color.getHex()).toBe(0xffffff);
    });

    it('keeps vertex colours when a hairline gradient is also dashed', async () =>
    {
        // _createDashedNativeMaterial builds a fresh material and drops anything it does not
        // name explicitly — this is the one-line omission that used to lose the gradient here.
        const root = new THREE.Group();
        const line = gradientLine(STRIP, RED_TO_BLUE, { width: 1, pattern: 0x00FF });
        root.add(line);

        await applyTo(root);

        const material = line.material as THREE.LineDashedMaterial;
        expect(material).toBeInstanceOf(THREE.LineDashedMaterial);
        expect(material.vertexColors).toBe(true);
    });

    it('expands colours in lockstep with positions', async () =>
    {
        const root = new THREE.Group();
        root.add(gradientLine(STRIP, RED_TO_BLUE, { width: 6, pattern: 0xFFFF }));

        await applyTo(root);

        const geo = (root.children[0] as LineSegments2).geometry;
        // One colour pair per position pair, or LineSegmentsGeometry pairs them up shifted and
        // every segment silently takes its neighbour's colour.
        expect(geo.attributes.instanceColorStart.count).toBe(geo.attributes.instanceStart.count);
    });

    it('leaves a plain fat line without colour attributes', async () =>
    {
        const root = new THREE.Group();
        root.add(nativeLine(SQUARE, { width: 10, pattern: 0xFFFF }));

        await applyTo(root);

        const fat = root.children[0] as LineSegments2;
        expect(fat.geometry.attributes.instanceColorStart).toBeUndefined();
        expect((fat.material as LineMaterial).vertexColors).toBe(false);
        // …and it still gets the source colour, not white.
        expect((fat.material as LineMaterial).color.getHex()).toBe(0xffff00);
    });

    it('closes a LineLoop gradient with a matching colour pair', async () =>
    {
        // The closing segment is easy to forget in a colour expansion but not in a position
        // one, which is exactly the drift the shared walker exists to prevent.
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(STRIP.flat(), 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(RED_TO_BLUE.flat(), 3));
        const material = new THREE.LineBasicMaterial({ color: 0x000000, vertexColors: true });
        material.userData.gltfExtensions = { BENTLEY_materials_line_style: { width: 5, pattern: 0xFFFF } };

        const root = new THREE.Group();
        root.add(new THREE.LineLoop(geometry, material));

        await applyTo(root);

        const geo = (root.children[0] as LineSegments2).geometry;
        expect(geo.attributes.instanceStart.count).toBe(3); // 2 strip segments + the closing one
        expect(geo.attributes.instanceColorStart.count).toBe(3);
    });
});
