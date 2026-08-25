import { describe, test, expect, beforeAll } from 'vitest'

import * as brep from '../../../src/modeler/brep'
import { checkInput } from '../../../src/modeler/brep/decorators'
import { getInputType } from '../../../src/modeler/brep/inputSchemas'

beforeAll(async () => { await brep.init() })

describe('@checkInput', () =>
{
    test('registry resolves targets by name, by key and by Class', () =>
    {
        expect(getInputType('PointLike')?.name).toEqual('PointLike')
        expect(getInputType('isPointLike')?.name).toEqual('PointLike')
        expect(getInputType('Vector')?.name).toEqual('Vector')
        expect(getInputType(brep.Vector)?.name).toEqual('Vector')
        expect(getInputType('NotAType')).toBeNull()
    })

    test('applies defaults for omitted arguments', () =>
    {
        class T {
            @checkInput([[Number, 42], ['PointLike', [1, 2, 3]]], ['auto', 'Point'])
            m(n?: number, p?: any) { return [n, p] }
        }
        const [n, p] = new T().m()
        expect(n).toEqual(42)
        expect(p).toBeInstanceOf(brep.Point)
        expect((p as brep.Point).toArray()).toEqual([1, 2, 3])
    })

    test('converts PointLike to the declared target type', () =>
    {
        class T {
            @checkInput('PointLike', 'Vector')
            m(v?: any) { return v }
        }
        expect(new T().m([1, 0, 0])).toBeInstanceOf(brep.Vector)
        expect(new T().m(new brep.Point(1, 0, 0))).toBeInstanceOf(brep.Vector)
    })

    test('gathers flat arguments into one PointLike', () =>
    {
        class T {
            @checkInput('PointLike', 'Point')
            m(_x?: any, _y?: number, _z?: number) { return _x }
        }
        const p = new T().m(10, 20, 30)
        expect(p).toBeInstanceOf(brep.Point)
        expect((p as brep.Point).toArray()).toEqual([10, 20, 30])
    })

    test('a null default marks an argument as legitimately absent', () =>
    {
        class T {
            @checkInput([[Number, 1], ['PointLike', null]], ['auto', 'Point'])
            m(n?: number, p?: any) { return [n, p] }
        }
        const [n, p] = new T().m()
        expect(n).toEqual(1)
        expect(p).toBeNull()
    })

    test('rejects a bad input with a readable error naming the argument', () =>
    {
        class T {
            @checkInput('PointLike', 'Point')
            m(origin?: any) { return origin }
        }
        expect(() => new T().m({ nope: true })).toThrow(/INPUT ERROR[\s\S]*origin[\s\S]*PointLike/)
    })

    test('accepts meshup-shaped points ({x,y,z}) — the shared kernel contract', () =>
    {
        class T {
            @checkInput('PointLike', 'Point')
            m(p?: any) { return p }
        }
        const p = new T().m({ x: 5, y: 6, z: 7 })
        expect((p as brep.Point).toArray()).toEqual([5, 6, 7])

        // z is optional in the meshup contract
        const p2 = new T().m({ x: 5, y: 6 })
        expect((p2 as brep.Point).toArray()).toEqual([5, 6, 0])
    })

    test('passes through arguments beyond the declared checks', () =>
    {
        // NOTE: two checks, so flat-argument gathering does NOT apply and trailing
        // arguments survive untouched. A method that wants a trailing non-point argument
        // must declare it — with ONE check, every argument is gathered into that check
        // (see the flat-argument test above).
        class T {
            @checkInput([['PointLike', [0, 0, 0]], [String, 'default']], ['Point', 'auto'])
            m(p?: any, extra?: string) { return [p, extra] }
        }
        const [p, extra] = new T().m([1, 1, 1], 'kept')
        expect(p).toBeInstanceOf(brep.Point)
        expect(extra).toEqual('kept')

        // and the declared default fills in when omitted
        expect(new T().m([1, 1, 1])[1]).toEqual('default')
    })
})
