import { describe, it, expect } from 'vitest';
import { rcOfBoxes, type ThermalBox } from '../../../src/materials/rc';

/** A layer over a face of 1000 x 1000 (x, z), from y0 to y1 */
const layer = (y0: number, y1: number, lambda: number, x0 = 0, x1 = 1000): ThermalBox =>
    ({ min: [x0, y0, 0], max: [x1, y1, 1000], lambda });

describe('rcOfBoxes: ISO 6946', () =>
{
    it('homogeneous layers add up: R = Σ d/λ', () =>
    {
        const r = rcOfBoxes([layer(0, 100, 0.036), layer(100, 112.5, 0.25)]);
        expect(r.rc).toBeCloseTo(0.1 / 0.036 + 0.0125 / 0.25, 6);
        expect(r.upper).toBeCloseTo(r.lower, 6);
        expect(r.u).toBeCloseTo(1 / (r.rc + 0.17), 6);
    });

    it('a stud in the insulation: between the upper and lower limit, as worked by hand', () =>
    {
        // 100 mm insulation with a 50 mm stud in it (5% of the face), a 12.5 mm board on each side
        const boxes = [
            layer(0, 12.5, 0.25),
            layer(12.5, 112.5, 0.036, 0, 475), layer(12.5, 112.5, 0.13, 475, 525), layer(12.5, 112.5, 0.036, 525, 1000),
            layer(112.5, 125, 0.25),
        ];
        const r = rcOfBoxes(boxes);
        const [rsi, rse, board] = [0.13, 0.04, 0.0125 / 0.25];
        const pathIns = rsi + rse + 2 * board + 0.1 / 0.036;
        const pathStud = rsi + rse + 2 * board + 0.1 / 0.13;
        const upper = 1 / (0.95 / pathIns + 0.05 / pathStud);
        const lower = rsi + rse + 2 * board + 0.1 / (0.95 * 0.036 + 0.05 * 0.13);
        expect(r.upper).toBeCloseTo(upper, 3);
        expect(r.lower).toBeCloseTo(lower, 3);
        expect(r.rc).toBeCloseTo((upper + lower) / 2 - rsi - rse, 3);
        expect(r.rc).toBeLessThan(0.1 / 0.036 + 2 * board);
    });

    it('takes the thinnest axis as the direction of the heat, and counts a gap as still air', () =>
    {
        const r = rcOfBoxes([layer(0, 100, 0.036), layer(150, 162.5, 0.25)]);
        expect(r.layers.length).toBe(3);
        expect(r.rc).toBeCloseTo(0.1 / 0.036 + 0.18 + 0.05, 6);   // 50 mm air: 0.18
    });
});
