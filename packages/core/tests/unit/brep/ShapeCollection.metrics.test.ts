import { beforeAll, describe, expect, it, vi } from 'vitest';

import { init } from '@archiyou/meshup';
import { Curve } from '@archiyou/meshup';
import { Mesh } from '@archiyou/meshup';
import { ShapeCollection } from '@archiyou/meshup';

describe('ShapeCollection metrics', () =>
{
    beforeAll(async () =>
    {
        await init();
    });

    it('sums surface area and volume for mesh collections', () =>
    {
        const collection = new ShapeCollection(
            Mesh.Box(2, 3, 4),
            Mesh.Box(1, 1, 1),
        );

        expect(collection.area()).toBeCloseTo(58);
        expect(collection.volume()).toBeCloseTo(25);
    });

    it('sums enclosed area for closed curves and returns undefined for volume', () =>
    {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const collection = new ShapeCollection(
            Curve.Rect(2, 3),
            Curve.Rect(1, 1).move(5, 0, 0),
        );

        expect(collection.area()).toBeCloseTo(7);
        expect(collection.volume()).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith('ShapeCollection.volume(): no shapes in the collection provide volume.');

        warnSpy.mockRestore();
    });

    it('returns undefined when no member shape provides the requested metric', () =>
    {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const collection = new ShapeCollection(
            Curve.Line([0, 0, 0], [10, 0, 0]),
            Curve.Line([0, 1, 0], [10, 1, 0]),
        );

        expect(collection.area()).toBeUndefined();
        expect(collection.volume()).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith('ShapeCollection.area(): no shapes in the collection provide area.');
        expect(warnSpy).toHaveBeenCalledWith('ShapeCollection.volume(): no shapes in the collection provide volume.');

        warnSpy.mockRestore();
    });
});