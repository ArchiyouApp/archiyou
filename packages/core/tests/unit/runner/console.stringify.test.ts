import { describe, it, expect } from 'vitest'

import { Console } from '../../../src/console/Console'
import { stringifyValue, stringifyArgs } from '../../../src/console/stringify'

/**
 * print({ width: 10, height: 100 }) used to end up as '[object Object]': Console
 * called message.toString() first, which returns that truthy string for any plain
 * object, so the JSON fallback was never reached.
 */

function printed(value:any):string
{
    const c = new Console([] as any); // no commit/assert/postMessage -> buffer mode
    c.buffer = [];
    c.USE_COLORS = false;
    c.user(value);
    return c.buffer[c.buffer.length - 1].message;
}

describe('console stringify', () =>
{
    it('prints a plain object as data, not [object Object]', () =>
    {
        expect(stringifyValue({ width: 10, height: 100 })).toBe('{ width: 10, height: 100 }');
    });

    it('does the same through Console.user() (what print() calls)', () =>
    {
        expect(printed({ width: 10, height: 100 })).toBe('{ width: 10, height: 100 }');
        expect(printed({ width: 10, height: 100 })).not.toContain('[object Object]');
    });

    it('passes strings through untouched and joins multiple arguments', () =>
    {
        expect(stringifyValue('hello')).toBe('hello');
        expect(stringifyArgs(['size:', { w: 1 }])).toBe('size: { w: 1 }');
    });

    it('formats primitives readably', () =>
    {
        expect(stringifyValue(null)).toBe('null');
        expect(stringifyValue(undefined)).toBe('undefined');
        expect(stringifyValue(NaN)).toBe('NaN');
        expect(stringifyValue(Infinity)).toBe('Infinity');
        expect(stringifyValue(10n)).toBe('10n'); // JSON.stringify throws on BigInt
        expect(stringifyValue(0.1 + 0.2)).toBe('0.3');
        expect(stringifyValue([1, 'a', true])).toBe('[ 1, "a", true ]');
    });

    it('quotes only keys that need it', () =>
    {
        expect(stringifyValue({ a: 1, 'my key': 2 })).toBe('{ a: 1, "my key": 2 }');
    });

    it('names the class of an instance', () =>
    {
        class Params { constructor(public width = 10){} }
        expect(stringifyValue(new Params())).toBe('Params { width: 10 }');
    });

    //// non-data members ////

    it('tags functions instead of dumping their source', () =>
    {
        const out = stringifyValue({ w: 1, calc: function area(){ return 1; }, C: class Thing {} });
        expect(out).toContain('calc: [Function: area]');
        expect(out).toContain('C: [class Thing]');
    });

    it('never invokes getters', () =>
    {
        let called = false;
        const obj = { w: 10, get boom(){ called = true; throw new Error('nope'); } };
        expect(stringifyValue(obj)).toBe('{ w: 10, boom: [Getter] }');
        expect(called).toBe(false);
    });

    it('survives circular references', () =>
    {
        const a:any = { name: 'a' };
        a.self = a;
        expect(stringifyValue(a)).toBe('{ name: "a", self: [Circular] }');
    });

    it('shows the same object twice when it is not an ancestor', () =>
    {
        const shared = { x: 1 };
        expect(stringifyValue({ a: shared, b: shared })).toBe('{ a: { x: 1 }, b: { x: 1 } }');
    });

    it('tags host/native objects rather than walking into them', () =>
    {
        const promise = Promise.resolve(1);
        expect(stringifyValue({ p: promise })).toBe('{ p: [Promise] }');
        expect(stringifyValue({ el: { nodeType: 1, nodeName: 'DIV' } })).toBe('{ el: [DIV] }');
        expect(stringifyValue({ buf: new Uint8Array(4) })).toBe('{ buf: [Uint8Array(4)] }');
    });

    it('handles Map, Set, Date, RegExp and Error', () =>
    {
        expect(stringifyValue(new Map([['a', 1]]))).toBe('Map(1) { "a" => 1 }');
        expect(stringifyValue(new Set([1, 2]))).toBe('Set(2) { 1, 2 }');
        expect(stringifyValue(new Date('2020-01-02T03:04:05.000Z'))).toBe('2020-01-02T03:04:05.000Z');
        expect(stringifyValue(/ab+/g)).toBe('/ab+/g');
        expect(stringifyValue(new Error('broken'))).toBe('Error: broken');
    });

    it('uses a value own toString() - how Shapes print themselves', () =>
    {
        class Vector { toString(){ return '<Vector x="1" y="2" z="3">'; } }
        expect(stringifyValue({ dir: new Vector() })).toBe('{ dir: <Vector x="1" y="2" z="3"> }');
    });

    it('ignores a toString() that only gives back the default', () =>
    {
        const obj = { w: 1, toString(){ return '[object Object]'; } };
        expect(stringifyValue(obj)).toContain('w: 1');
    });

    it('survives a toString() that throws', () =>
    {
        class Broken { toString():string { throw new Error('boom'); } }
        expect(stringifyValue({ w: 1, nested: new Broken() })).toBe('{ w: 1, nested: Broken {} }');
    });

    it('survives a null-prototype object', () =>
    {
        const obj = Object.create(null);
        obj.w = 1;
        expect(stringifyValue(obj)).toBe('[Object: null prototype] { w: 1 }');
    });

    //// bounds ////

    it('cuts off deep nesting', () =>
    {
        expect(stringifyValue({ a: { b: { c: { d: { e: 1 } } } } }, { maxDepth: 3 }))
            .toBe('{ a: { b: { c: [Object] } } }');
    });

    it('caps the number of items shown', () =>
    {
        const out = stringifyValue([1,2,3,4,5], { maxItems: 2 });
        expect(out).toContain('… 3 more');
    });

    it('caps a long string and the total output', () =>
    {
        expect(stringifyValue({ s: 'x'.repeat(50) }, { maxStringLength: 10 })).toContain('xxxxxxxxxx…');
        expect(stringifyValue({ s: 'x'.repeat(5000) }, { maxTotalLength: 100 }).length).toBeLessThan(130);
    });

    it('stays bounded on a wide, deep structure', () =>
    {
        const wide = (depth:number):any => (depth === 0)
                        ? Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]))
                        : Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`k${i}`, wide(depth - 1)]));

        const out = stringifyValue(wide(3));
        expect(out.length).toBeLessThanOrEqual(10000 + 20);
    });

    it('breaks a wide object over multiple lines', () =>
    {
        const out = stringifyValue({ name: 'a rather long value here', description: 'and another long one', n: 1 });
        expect(out).toContain('\n');
        expect(out.startsWith('{\n')).toBe(true);
    });
});
