import { describe, it, expect, beforeAll } from 'vitest'

import { Modeler } from '../../../src/modeler/Modeler'
import { Curve as SmartMeshCurve, Mesh as SmartMesh, Polygon as SmartMeshPolygon, Vertex as SmartMeshVertex } from '@archiyou/meshup';
import { ShapeCollection as SmartShapeCollection } from '@archiyou/meshup';
import { ShapeCollection } from '@archiyou/meshup';
import { Mesh } from '@archiyou/meshup';

import { save } from '@archiyou/meshup/src/utils';


describe('Modeler', async () =>
{
    let modeler:Modeler;

    it('inits successfully', () =>
    {
        modeler = new Modeler();
        expect(modeler).toBeInstanceOf(Modeler);
    })

    it('should load primary shape kernels', async () =>
    {
        modeler = new Modeler();
        await modeler.load();
        expect(modeler.kernel()).toBeDefined();
    }
    );

    it('should make a basic 2D shapes with primary kernel', async () =>
    {
        const line = modeler.line([0,0], [10,0]);
        expect(line).toBeDefined();
        expect(line).toBeInstanceOf(SmartMeshCurve);
        expect(line.type).toBe('Curve'); // main native type
        expect(line.subtype()).toBe('Line');
        expect(line.length()).toBe(10);
    });

    it('SmartMeshCurve.vertices() returns smart vertices with SmartShape methods', async () =>
    {
        const line = modeler.line([0,0], [10,0]);
        const vs = line.vertices();
        expect(vs.length).toBe(2);
        // wrapped as smart vertices → SmartShape API (label, dim, material) is available
        expect(typeof (vs.first() as any).label).toBe('function');
        expect(typeof (vs.first() as any).material).toBe('function');
    });


    it('should make a basic 3D shape with primary kernel', async () =>
    {
        const box = modeler.box(10,20,30) as SmartMesh;
        expect(box).toBeDefined();
        expect(box).toBeInstanceOf(SmartMesh);
        expect(box.mode).toBe('mesh');
        expect(box.bbox().width()).toBe(10);
        expect(box.bbox().depth()).toBe(20);
        expect(box.bbox().height()).toBe(30);
        expect(await box.toGLB()).toBeInstanceOf(Uint8Array);
    });

    it('brep mode needs the brep kernel loaded before it can build anything', async () =>
    {
        // The brep branch is wired, but the OpenCascade WASM is loaded lazily — asking for a
        // brep primitive before load() says so plainly rather than failing deep in the kernel.
        const fresh = new Modeler('brep');
        expect(() => fresh.box(10, 20, 30)).toThrow(/BREP kernel is not loaded/);
    });

    it('should set up a scene and output to GLB', async () =>
    {
        modeler = new Modeler();
        await modeler.load();

        const box = modeler.box(10,10,10); // added to scene automatically

        modeler.layer('boxes')
            .color('blue')
            .add(box); // already in scene, moved to layer
        
        // check if copy works - should be added to active layer automatically
        box.copy().move(15,0,0);

        expect(modeler.layer('boxes').children().length).toBe(2); 

        modeler.layer('sphere')
            .color('yellow')
            .add(modeler.sphere(10).move(0,0,15));

        expect(modeler.scene().shapes().length).toBe(3); 

        // graph
        const graph = modeler.toGraph();
        expect(graph).toBeDefined();
        expect(graph.name).toBe('root');
        expect(graph.children.length).toBe(2); // two layers


        // copy shapes to another layer
        modeler.layer('copy').color('red').opacity(0.3);
        modeler.layer('boxes').shapes().copy().move(-30);

        console.log(graph.children);
        expect(modeler.scene().shapes().length).toBe(5); // original 3 + 2 copies
        expect(modeler.toGraph().children.length).toBe(3); // two+one layers
        
        const gltf = await modeler.scene().toGLTF();
        expect(typeof gltf).toBe('string');
        save('./tests/outputs/modeler/test.modeler.scene.gltf', gltf);

    });

    it('should add collection iso results to the iso scene layer', async () =>
    {
        modeler = new Modeler();
        await modeler.load();

        const parts = modeler.collection(
            modeler.box(10, 10, 10),
            modeler.box(5, 5, 5).move(15, 0, 0),
        );

        const iso = parts.iso([1, -1, 1]);
        const isoLayer = modeler.layer('iso');

        expect(iso).toBeInstanceOf(SmartShapeCollection);
        expect(iso.length).toBeGreaterThan(0);
        expect(isoLayer.shapes().length).toBe(iso.length);
    });

    it('should exclude hidden scene-backed collections from iso and hide their layer', async () =>
    {
        modeler = new Modeler();
        await modeler.load();

        const hidden = modeler.group(   // group(): scene-backed, so it HAS a layer to hide
            modeler.box(10, 10, 10),
            modeler.box(5, 5, 5).move(15, 0, 0),
        ).name('expl').hide();

        const hiddenLayer = modeler.scene().find('expl');
        const iso = hidden.iso([1, -1, 1]);

        expect(hiddenLayer?.style.visible).toBe(false);
        expect(iso).toBeInstanceOf(SmartShapeCollection);
        expect(iso.length).toBe(0);
    });

    it('should optionally include hidden shapes in collection iso projection', async () =>
    {
        modeler = new Modeler();
        await modeler.load();

        const hidden = modeler.collection(
            modeler.box(10, 10, 10),
            modeler.box(5, 5, 5).move(15, 0, 0),
        ).hide();

        const iso = hidden.iso([1, -1, 1], false, true);

        expect(iso).toBeInstanceOf(SmartShapeCollection);
        expect(iso.length).toBeGreaterThan(0);
    });

    it('should serialize shape-hidden scene nodes as hidden in scene state', async () =>
    {
        modeler = new Modeler();
        await modeler.load();

        modeler.box(10, 20, 30).color('blue').hide().area();

        const state = modeler.toArchiyouState();
        const firstShapeNode = state.scenegraph?.children[0] ?? null;

        expect(firstShapeNode).not.toBeNull();
        expect(firstShapeNode?.style.visible).toBe(false);
    });

    it('should keep replicated mesh stacks smart so iso auto-adds to scene', async () =>
    {
        modeler = new Modeler();
        await modeler.load();

        const stack = (modeler.box(100, 100, 10) as SmartMesh)
            .replicate(10, (shape, index) => shape.move(0, 0, 10 * index) as SmartMesh);

        const iso = stack.iso().move(100);
        const isoLayer = modeler.layer('iso');

        expect(stack).toBeInstanceOf(SmartShapeCollection);
        expect(iso).toBeInstanceOf(SmartShapeCollection);
        expect(iso.length).toBeGreaterThan(0);
        expect(isoLayer.shapes().length).toBe(iso.length);
    });

    it('should translate collection iso results in both x and y', async () =>
    {
        modeler = new Modeler();
        await modeler.load();

        const bigbox = modeler.box(400, 200, 10).move(0, -300);
        const small = modeler.box(5, 200, 5).align(bigbox as any, 'leftfrontbottom', 'leftfronttop');
        const stack = modeler.collection(bigbox, small);

        const iso = stack.iso();
        const before = iso.bbox()?.center();
        iso.move(500, -400);
        const after = iso.bbox()?.center();

        expect(before).toBeDefined();
        expect(after).toBeDefined();
        expect(after!.x - before!.x).toBeCloseTo(500, 5);
        expect(after!.y - before!.y).toBeCloseTo(-400, 5);
    });


    it('DIAGNOSTIC: merge() polygon count equals sum of individual polygon counts', async () =>
    {
        modeler = new Modeler();
        await modeler.load();

        const bigbox = modeler.box(400, 200, 10).move(0, -300) as SmartMesh;
        const sm = modeler.box(5, 200, 5).align(bigbox as any, 'leftfrontbottom', 'leftfronttop') as SmartMesh;

        // Access underlying meshup Mesh objects
        const bigMesh = bigbox.toMesh() as Mesh;
        const smMesh = sm.toMesh() as Mesh;

        const bigPolyCount = bigMesh.polygons().length;
        const smPolyCount = smMesh.polygons().length;
        const sumPolyCount = bigPolyCount + smPolyCount;

        // merge() via ShapeCollection (base class polygon-concatenation merge, not CSG boolean)
        const coll = new ShapeCollection<Mesh>(bigMesh, smMesh);
        const merged = coll.merge() as Mesh;
        const mergedPolyCount = merged.polygons().length;

        console.log(`bigbox polygons: ${bigPolyCount}, sm polygons: ${smPolyCount} → merged: ${mergedPolyCount} (expected ${sumPolyCount})`);

        // Validate user hypothesis: merge just concatenates polygons (no boolean)
        expect(mergedPolyCount).toBe(sumPolyCount);
    });

    it('should preserve separating edges when projecting a mis-sized touching mesh collection', async () =>
    {
        modeler = new Modeler();
        await modeler.load();

        const bigbox = modeler.box(400, 200, 10).move(0, -300) as SmartMesh;
        const sm = modeler.box(5, 200, 5).align(bigbox as any, 'leftfrontbottom', 'leftfronttop') as SmartMesh;

        const bigMesh = bigbox.toMesh() as Mesh;
        const smMesh = sm.toMesh() as Mesh;

        // Old merge-first path (the buggy behavior): concatenate polygons, project as one mesh
        const mergedMesh = new ShapeCollection<Mesh>(bigMesh, smMesh).merge() as Mesh;
        const mergeFirstVisible = mergedMesh.isometry([1, 1, 1], false).length;

        // New per-mesh path: ShapeCollection.isometry() projects each mesh with siblings as occluders
        const coll = new ShapeCollection<Mesh>(bigMesh, smMesh);
        const collVisible = coll.isometry([1, 1, 1], false).length;

        console.log(`Merge-first visible: ${mergeFirstVisible}`);
        console.log(`Per-mesh collection visible: ${collVisible}`);

        // The per-mesh approach should preserve more visible edges than the merge-first path,
        // specifically recovering the separating edge at the contact boundary.
        expect(collVisible).toBeGreaterThan(mergeFirstVisible);
    });

    it('should not throw null pointer for scene-backed SmartMesh collection iso', async () =>
    {
        modeler = new Modeler();
        await modeler.load();

        const bigbox = modeler.box(400, 200, 10).move(0, -300) as SmartMesh;
        const sm = modeler.box(5, 200, 5).align(bigbox as any, 'leftfrontbottom', 'leftfronttop') as SmartMesh;

        // Exact browser path: modeler.collection() → SmartShapeCollection, then .iso() on it
        const c2 = modeler.collection(bigbox, sm);
        expect(c2).toBeDefined();

        let isoResult: SmartShapeCollection | null = null;
        expect(() =>
        {
            isoResult = c2.iso([1, 1, 1] as any, false, false) as unknown as SmartShapeCollection;
        }).not.toThrow();

        expect(isoResult).toBeInstanceOf(SmartShapeCollection);
        expect((isoResult as SmartShapeCollection).length).toBeGreaterThan(0);
    });

    it('per-mesh iso should produce at least as many lines as merge-first for a stacked-box collection', async () =>
    {
        modeler = new Modeler();
        await modeler.load();

        const b1 = modeler.box(100, 100, 10) as SmartMesh;
        const c = (b1 as any).replicate(10, (s: any, i: number) => (s as SmartMesh).move(0, 0, 10 * i));
        const stackIso = c.iso() as unknown as SmartShapeCollection;

        // Compare with merge-first for same geometry
        const b1m = b1.toMesh() as Mesh;
        const boxes: Mesh[] = [b1m];
        for (let i = 1; i < 10; i++) { boxes.push(b1m.copy().translate(0, 0, 10 * i) as Mesh); }
        const mergedIso = (new ShapeCollection<Mesh>(...boxes).merge() as Mesh).isometry([-1, -1, 1], false);

        console.log(`Stack iso lines: per-mesh=${stackIso.length} merge-first=${mergedIso.length}`);

        expect(stackIso.length).toBeGreaterThan(0);
        // Per-mesh with correct occluder handling preserves more edges than merge-first
        // (merge-first loses edges at coplanar contact boundaries due to 0° dihedral detection)
        expect(stackIso.length).toBeGreaterThanOrEqual(mergedIso.length);
    });

    // TODO: switching kernels based on methods

});


describe('Modeler — mesh mode methods', () =>
{
    let m: Modeler;

    beforeAll(async () =>
    {
        m = new Modeler();
        await m.load();
    });

    it('mode() and units()', () =>
    {
        expect(m.mode()).toBe('mesh');
        expect(m.units()).toBe('mm');
        expect(m.units('cm')).toBe('cm');
        m.units('mm');
    });

    it('arc()', () =>
    {
        const arc = m.arc([0, 0], [5, 5], [10, 0]);
        expect(arc).toBeInstanceOf(SmartMeshCurve);
        expect(arc.type).toBe('Curve');
        expect(arc.subtype()).toBe('Arc');
    });

    it('spline()', () =>
    {
        const spline = m.spline([0, 0], [5, 5], [10, 0], [15, -5]);
        expect(spline).toBeInstanceOf(SmartMeshCurve);
        expect(spline.type).toBe('Curve');
        expect(spline.subtype()).toBe('Spline');
    });

    it('polyline()', () =>
    {
        const poly = m.polyline([0, 0], [5, 0], [10, 5]);
        expect(poly).toBeInstanceOf(SmartMeshCurve);
        expect(poly.type).toBe('Curve');
        expect(poly.subtype()).toBe('Polyline');
    });

    it('SmartMeshCurve.segments() returns a SmartShapeCollection of SmartMeshCurve', async () =>
    {
        const poly = m.polyline([0, 0], [10, 0], [10, 10]);
        const segs = poly.segments();
        expect(segs).toBeInstanceOf(SmartShapeCollection);
        expect(segs.length).toBe(2);
        segs.forEach((s: any) => expect(s).toBeInstanceOf(SmartMeshCurve));
        // edges() is an alias — same smart wrapping
        expect(poly.edges().first()).toBeInstanceOf(SmartMeshCurve);
    });

    it('polygon() accepts an array of points', () =>
    {
        const p = m.polygon([[0, 0], [10, 0], [10, 10]]);
        expect(p).toBeInstanceOf(SmartMeshPolygon);
        expect(p.type).toBe('Polygon');
    });

    it('polygon() accepts flat args like polyline()', () =>
    {
        const p = m.polygon([0, 0], [10, 0], [10, 10]);
        expect(p).toBeInstanceOf(SmartMeshPolygon);
        expect(p.type).toBe('Polygon');
    });

    it('rect()', () =>
    {
        const r = m.rect(10, 20);
        expect(r).toBeInstanceOf(SmartMeshCurve);
        expect(r.type).toBe('Curve');
        expect(r.subtype()).toBe('Rect');
    });

    it('rectBetween()', () =>
    {
        const r = m.rectBetween([0, 0], [20, 10]);
        expect(r).toBeInstanceOf(SmartMeshCurve);
        expect(r.type).toBe('Curve');
        expect(r.subtype()).toBe('Rect');
    });

    it('circle()', () =>
    {
        const c = m.circle(5);
        expect(c).toBeInstanceOf(SmartMeshCurve);
        expect(c.type).toBe('Curve');
        expect(c.subtype()).toBe('Circle');
    });

    it('cube() — alias for box()', () =>
    {
        const cube = m.cube(10, 10, 10);
        expect(cube).toBeInstanceOf(SmartMesh);
        expect(cube.mode).toBe('mesh');
        expect(cube.bbox().width()).toBe(10);
    });

    it('boxBetween()', () =>
    {
        const box = m.boxBetween([0, 0, 0], [10, 20, 30]);
        expect(box).toBeInstanceOf(SmartMesh);
        expect(box.mode).toBe('mesh');
        expect(box.bbox().width()).toBe(10);
        expect(box.bbox().depth()).toBe(20);
        expect(box.bbox().height()).toBe(30);
    });

    it('sphere()', () =>
    {
        const s = m.sphere(10);
        expect(s).toBeInstanceOf(SmartMesh);
        expect(s.mode).toBe('mesh');
        expect(s.type).toBe('Mesh');
    });

    it('cylinder()', () =>
    {
        const cyl = m.cylinder(5, 10);
        expect(cyl).toBeInstanceOf(SmartMesh);
        expect(cyl.mode).toBe('mesh');
        expect(cyl.type).toBe('Mesh');
    });

    it('point()', () =>
    {
        const p = m.point(1, 2, 3);
        expect(p).toBeDefined();
        expect((p as any).x).toBe(1);
        expect((p as any).y).toBe(2);
        expect((p as any).z).toBe(3);
    });

    it('vector()', () =>
    {
        const v = m.vector(1, 2, 3);
        expect(v).toBeDefined();
        expect((v as any).x).toBe(1);
    });

    it('vertex()', () =>
    {
        const v = m.vertex(1, 2, 3);
        expect(v).toBeDefined();
    });

    it('all()', () =>
    {
        expect(m.all()).toBeInstanceOf(SmartShapeCollection);
        expect(m.all().length).toBeGreaterThan(0);
    });

    it('collection()', () =>
    {
        const box = m.box(5, 5, 5);
        const col = m.collection(box);
        expect(col).toBeInstanceOf(SmartShapeCollection);
        expect(col.length).toBe(1);
    });

    it('group().removeFromScene() detaches child shapes and clears the backing layer', () =>
    {
        const left = m.box(5, 5, 5);
        const right = m.box(5, 5, 5).moveX(10);
        const col = m.group(left, right);   // collection() has no layer to clear

        expect(col._layer).not.toBeNull();
        expect((left as any)._node).not.toBeNull();
        expect((right as any)._node).not.toBeNull();

        col.removeFromScene();

        expect(col._layer).toBeNull();
        expect((left as any)._node).toBeNull();
        expect((right as any)._node).toBeNull();

        left.addToScene();
        expect((left as any)._node).not.toBeNull();
    });

    it('layer()', () =>
    {
        m.layer('test-layer');
        expect(m.layer()).toBeDefined();
    });

    it('side selector on a rotated box returns its own front polygon, not a bbox face', () =>
    {
        const box = m.box(10, 10, 100).rotateX(-10).rotateY(10);
        const front = box.select('F||front') as any;

        expect(front).toBeInstanceOf(SmartMeshPolygon);
        expect(front.area()).toBeCloseTo(1000); // the box own 10 x 100 side face
        // it really faces the front (a bbox face would be axis-aligned at -y)
        expect(front.normal().y).toBeLessThan(-0.9);
        expect(front.normal().y).toBeGreaterThan(-1);
    });

    //// TODO: sketch
    //// TODO: test in brep
});
