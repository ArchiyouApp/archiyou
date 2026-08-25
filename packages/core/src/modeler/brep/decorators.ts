/**
 *  decorators.ts — input handling for the brep (OpenCascade) kernel API.
 *
 *  The brep API is deliberately forgiving: `move([10,0,0])`, `move(10)`, `move('+10')` and
 *  `move(someVector)` all work, and most arguments are optional. That flexibility is not
 *  implemented in the ~600 methods themselves — it lives here, in `@checkInput`, which:
 *
 *    1. applies default values for arguments the caller omitted,
 *    2. validates what did come in, with an error message aimed at the script author,
 *    3. coerces (“uniformizes”) each argument to the single type the method body expects,
 *    4. then — and only then — runs the method.
 *
 *  So a method decorated `@checkInput([['PointLike',[0,0,0]]], ['Point'])` can open with
 *  `point = point as Point // auto converted` and trust it. Without the decorator the body
 *  receives the raw argument (or `undefined`) and fails deep inside OpenCascade with an
 *  unhelpful `Cannot read properties of undefined (reading '_toOcPoint')`.
 *
 *  The type table this reads lives in ./inputSchemas.ts.
 *
 *  Compatible with `experimentalDecorators` (the legacy TypeScript decorator standard) —
 *  see tsconfig.json. This is a different mechanism from the TypeBox `@validate` in
 *  ../../decorators.ts used by Modeler/Annotator; brep stays on `@checkInput` because its
 *  coercion behaviour (PointLike → Point/Vector/Vertex, flat-argument gathering) is what the
 *  whole kernel API is written against.
 */

import { getInputType, type InputTypeInfo } from './inputSchemas'
import { isNumeric } from './utils'

//// HELPERS ////

/** Parameter names of a function, for error messages. Best-effort: reads them off the
 *  source text, so minified builds degrade to positional indices rather than names. */
function getFuncParamNames(func: any): Array<string>
{
    // see: https://stackoverflow.com/questions/1007981/how-to-get-function-parameter-names-values-dynamically
    const STRIP_COMMENTS = /(\/\/.*$)|(\/\*[\s\S]*?\*\/)|(\s*=[^,)]*(('(?:\\'|[^'\r\n])*')|("(?:\\"|[^"\r\n])*"))|(\s*=[^,)]*))/mg
    const ARGUMENT_NAMES = /([^\s,]+)/g

    const fnStr = String(func).replace(STRIP_COMMENTS, '')
    const result = fnStr.slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')')).match(ARGUMENT_NAMES)
    return result ?? []
}

/** `value instanceof ctor`, but never throws. Arrow functions and other non-constructors
 *  have no `.prototype`, and `instanceof` against them is a TypeError — the check table
 *  holds a mix of Classes and plain predicates, so this has to tolerate both. */
function isInstanceOf(value: any, ctor: any): boolean
{
    if (typeof ctor !== 'function' || typeof ctor.prototype !== 'object') return false
    try { return value instanceof ctor }
    catch { return false }
}

/** Describe the offending argument(s) for an error message. */
function describeArgs(args: any): string
{
    const arr = Array.isArray(args) ? args : [args]
    return arr
        .map(inp =>
        {
            const t = (typeof inp === 'object' && inp !== null) ? inp.constructor?.name : typeof inp
            return Array.isArray(inp) ? `["${inp}" (type: ${t})]` : `"${inp}" (type: ${t})`
        })
        .join(',')
}

/** Throw the script-author-facing input error. Shown verbatim in the editor console. */
function throwCheckError(
    className: string,
    wrappedMethod: Function,
    wrappedMethodName: string,
    decoratorTarget: any,
    checkArgs: any,
    inputCheckIndex: number): void
{
    const typeInfo = getInputType(decoratorTarget)
    if (!typeInfo) return // unknown target: already warned in getInputType

    const params = getFuncParamNames(wrappedMethod)
    const errorAtParam = params[inputCheckIndex] ?? `argument ${inputCheckIndex}`
    const msg = typeInfo.errorMessage

    const m = `INPUT ERROR
    at ${className}.${wrappedMethodName}(${params.join(', ')})
    wrong input for argument: "${errorAtParam}"
    need type "${typeInfo.name}"
    but got ${describeArgs(checkArgs)}
    valid inputs are:
        - ${msg.possible.join('\n\t- ')}
        ${msg.hint ?? ''}`

    console.error(m) // also surface it in the console
    throw new Error(m)
}

/** Coerce `value` into `toType`.
 *  `toType` may be a Class, a registered type name, or `'auto'` / null / undefined to mean
 *  "leave it alone". Returns the original value when no conversion is defined, so an
 *  incomplete decorator config degrades rather than nulls out the argument. */
function uniformize(value: any, toType: any, fromType: any): any
{
    // A string target that is not 'auto' names a registry entry — resolve it to the real obj
    if (typeof toType === 'string' && toType !== 'auto')
    {
        const target = getInputType(toType)
        if (!target)
        {
            console.warn(`uniformize(): unknown target type "${toType}". Configure @checkInput with a Class or a registered name.`)
            return null
        }
        toType = target.obj
    }

    if (value === null || value === undefined) return null

    if (!toType)
    {
        console.warn(`uniformize(): cannot convert "${value}" without a target type`)
        return value
    }

    // Nothing to do
    if (toType === 'auto' || toType === fromType) return value
    if (isInstanceOf(value, toType)) return value

    const targetTypeInfo: InputTypeInfo | null = getInputType(toType)
    if (!targetTypeInfo)
    {
        console.warn(`uniformize(): no registry entry for target (${toType}); returned the original value`)
        return value
    }

    const transform = targetTypeInfo.transformInput
    if (typeof transform !== 'function')
    {
        console.warn(`uniformize(): "${targetTypeInfo.name}" is not a conversion target (no transformInput). Check the @checkInput config.`)
        return value
    }

    return transform(value)
}

//// MAIN DECORATOR ////

/**
 *  `@checkInput(inputChecks, uniformizeToTypes)`
 *
 *  Both arguments are positional and index-aligned with the method's parameters. A single
 *  non-array value is treated as a one-element list.
 *
 *  `inputChecks` entries are either:
 *    - a registered type name (`'PointLike'`), a Class (`Vector`) or a typeguard, or
 *    - `[check, defaultValue]` to also supply a default when the argument is omitted.
 *      A default of `null`/`undefined` marks the argument as legitimately nullable — it is
 *      then neither checked nor converted.
 *
 *  `uniformizeToTypes` entries name the type to convert INTO, or `'auto'` to pass through.
 *
 *  Examples:
 *      @checkInput('PointLike', 'Vector')
 *      @checkInput(['PointLike', 'PointLike'], ['Vector', 'Vector'])
 *      @checkInput([['PointLike',[0,0,0]], ['PointLike',[0,0,1]]], ['Vector', 'Vector'])
 *      @checkInput([[Number, 100], ['PointLike', null]], [Number, 'Point'])
 *
 *  Flat arguments: when the method declares ONE check but the caller passes several values,
 *  they are gathered and converted as one — this is what makes `move(10,20,30)` and
 *  `makeSpline(p1,p2,p3,p4)` equivalent to their array forms.
 *
 *  Prefer STRING type names over direct Class references: the brep classes import each other
 *  through the `.` barrel, so a Class referenced at decoration time may not be initialised
 *  yet. Strings are resolved lazily, on call.
 */
export function checkInput(inputChecks: any | Array<any>, uniformizeToTypes: any | Array<any>): MethodDecorator
{
    const checks: Array<any> = Array.isArray(inputChecks) ? inputChecks : [inputChecks]
    const targets: Array<any> = Array.isArray(uniformizeToTypes) ? uniformizeToTypes : [uniformizeToTypes]

    return function (_targetPrototype: any, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor
    {
        const wrappedMethod = descriptor.value
        const wrappedMethodName = propertyKey

        descriptor.value = function (this: any, ...args: any[])
        {
            /*  Trailing `undefined`s are not "supplied" arguments.
                This matters for the flat-argument rule below. Methods here are often written
                `subtracted(vector, y?, z?) { return this.copy().subtract(vector, y, z) }`, so a
                one-argument call forwards as `subtract(vec, undefined, undefined)` — three
                arguments. Counting those would make a single-check method think the caller used
                the flat form `move(x,y,z)` and gather `[vec, undefined, undefined]` into one
                bogus point. (The pre-monorepo sources sidestepped this with `...args` rest
                params, which simply collapse when nothing is passed.) */
            let supplied = args.length
            while (supplied > 0 && args[supplied - 1] === undefined) { supplied-- }
            const inputValues = args

            if (checks.length !== targets.length)
            {
                console.warn(`${wrappedMethodName}::@checkInput: ${checks.length} inputChecks but ${targets.length} uniformizeToTypes. Check the decorator config!`)
            }

            const className = this?.constructor?.name ?? 'unknown'

            /*  IMPORTANT: we iterate the CHECKS, not the incoming values, so arguments the
                caller omitted still get their defaults. Arguments beyond the last check are
                passed through untouched. */
            let allCorrect = true
            let checkedInputValues: Array<any> = inputValues

            /*  One check but several supplied values → the caller used the flat form, e.g.
                `move(x,y,z)` or `makeSpline(p1,p2,p3,p4)`. Gather them all into that one check. */
            const flatInputs = checks.length === 1 && supplied > 1

            checks.some((inputCheckType: any, inputCheckIndex: number) =>
            {
                let curValue = inputValues[inputCheckIndex] // undefined when not supplied
                let decoratorTargetType = inputCheckType
                let allowedNullValue = false

                // [ type, defaultValue ] form
                if (Array.isArray(inputCheckType))
                {
                    const defaultValue = inputCheckType[1]
                    curValue = (curValue === null || curValue === undefined) ? defaultValue : curValue

                    // A null/undefined default means "this argument may legitimately be absent"
                    allowedNullValue = (curValue === null || curValue === undefined)
                        && (defaultValue === null || defaultValue === undefined)

                    decoratorTargetType = inputCheckType[0]
                }

                const targetTypeInfo = getInputType(decoratorTargetType)
                const check = targetTypeInfo ? targetTypeInfo.check : null

                if (!check)
                {
                    console.warn(`@checkInput(${className}.${wrappedMethodName}): no check function for target "${decoratorTargetType}". Check the decorator config! All checks: ${checks}`)
                    allCorrect = false
                }
                else if (allowedNullValue)
                {
                    // legitimately absent — skip both check and conversion
                }
                else if (typeof check === 'function')
                {
                    // check may be a Class (instanceof) or a typeguard (call it)
                    const checkArgs = flatInputs ? inputValues.slice(0, supplied) : [curValue]
                    let isCheckError = false

                    try
                    {
                        isCheckError = !isInstanceOf(curValue, check) && check(...checkArgs) === false
                    }
                    catch (e: any)
                    {
                        // Calling an OpenCascade-bound Class as a plain function raises this.
                        // It means the value simply isn't of that type — not a config error.
                        if (e?.name === 'BindingError')
                        {
                            console.error(`@checkInput at ${className}.${wrappedMethodName}(): BindingError ignored. Error: ${e}. Input: ${inputValues}`)
                        }
                        else
                        {
                            console.error(`@checkInput at ${className}.${wrappedMethodName}() failed with inputs: ${inputValues}. Error: ${e}`)
                            allCorrect = false
                        }
                    }

                    if (isCheckError)
                    {
                        allCorrect = false
                        throwCheckError(className, wrappedMethod, wrappedMethodName, decoratorTargetType, checkArgs, inputCheckIndex)
                    }
                }
                else if (typeof check === 'string')
                {
                    // a `typeof` string, e.g. 'string'
                    if (typeof curValue !== check)
                    {
                        allCorrect = false
                        throwCheckError(className, wrappedMethod, wrappedMethodName, decoratorTargetType, curValue, inputCheckIndex)
                    }
                }
                else
                {
                    console.warn(`@checkInput(${className}.${wrappedMethodName}): unusable check "${check}". Check the decorator config!`)
                    allCorrect = false
                }

                if (!allCorrect) { curValue = null }
                if (curValue === undefined) { curValue = null }

                // Convert to the target type. NOTE: `!= null` rather than a truthiness test —
                // 0 is a perfectly good coordinate.
                if (allowedNullValue || curValue != null)
                {
                    if (flatInputs)
                    {
                        curValue = inputValues.slice(0, supplied) // convert all the gathered arguments as one
                    }

                    curValue = allowedNullValue ? null : uniformize(curValue, targets[inputCheckIndex], inputCheckType)

                    if (!flatInputs)
                    {
                        checkedInputValues[inputCheckIndex] = curValue
                    }
                    else
                    {
                        // the flat arguments collapsed into a single value — done
                        checkedInputValues = [curValue]
                        return true // break out of .some()
                    }
                }

                return false
            })

            if (!allCorrect)
            {
                console.error(`Failed to execute "${className}.${wrappedMethodName}": one or more inputs could not be checked or converted. Check the @checkInput config.`)
                return null
            }

            return wrappedMethod.apply(this, checkedInputValues)
        }

        return descriptor
    }
}

//// PROTECT AGAINST OC CRASHES ////

/**
 *  `@protectOC(hints?)`
 *
 *  OpenCascade signals failure by throwing a raw exception pointer (a number), which
 *  surfaces to the user as `ERROR: undefined`. This turns that into a readable message,
 *  including OC's own failure string and any hints the method wants to offer.
 */
export function protectOC(hints?: string | Array<string>): MethodDecorator
{
    const hintsArr: Array<string> = (hints === undefined) ? [] : (Array.isArray(hints) ? hints : [hints])

    return function (_targetPrototype: any, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor
    {
        const wrappedMethod = descriptor.value
        const wrappedMethodName = propertyKey

        descriptor.value = function (this: any, ...args: any[])
        {
            try
            {
                return wrappedMethod.apply(this, args)
            }
            catch (e: any)
            {
                // A non-numeric error is already a real JS Error — pass its message through.
                if (!isNumeric(`${e}`))
                {
                    throw new Error(`${e}`)
                }

                const className = this?.constructor?.name ?? 'unknown'
                const ocMessage = (typeof e === 'number')
                    ? (this._oc?.OCJS?.getStandard_FailureData(e)?.GetMessageString() ?? '')
                    : ''
                const params = getFuncParamNames(wrappedMethod)
                const hintsMessage = hintsArr.map(h => `\t\t* ${h}`).join('\n')

                throw new Error(`GEOMETRY ERROR
    at ${className}.${wrappedMethodName}(${params.join(', ')})
    OC kernel failed to generate Shape
    OC message: ${ocMessage}
    Hints:
${hintsMessage}
    [original error: "${e}"]`)
            }
        }

        return descriptor
    }
}
