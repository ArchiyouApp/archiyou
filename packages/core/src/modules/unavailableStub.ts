/**
 * unavailableStub.ts — the placeholder injected for a module the current run
 * cannot use (not entitled, failed to load, or refused by validation).
 *
 * This exists because of how the script scope resolves names. The Runner's scope
 * Proxy uses `has: () => true` (Runner.createScope) so users can write
 * `x = box(10)` without a declaration — which also means an absent global
 * silently resolves to `undefined` instead of raising a ReferenceError. A script
 * calling a module it does not have would therefore fail with
 * "undefined is not a function", pointing nowhere near the real cause.
 *
 * So instead of leaving the name absent, we bind an object that explains itself
 * the moment it is touched.
 */

/** Keys that must NOT throw, because they are read by the language or by
 *  tooling rather than by the script author.
 *
 *  `then` is the critical one: if an unavailable module ends up in an awaited
 *  expression, the runtime probes `.then` to decide whether it is a thenable.
 *  Throwing there would surface at the `await` rather than at the actual member
 *  access, and returning a *function* would be worse still — the runtime would
 *  call it and the run would hang. The rest keep logging and inspection working. */
const PASSTHROUGH_KEYS: Set<PropertyKey> = new Set<PropertyKey>([
    'then', 'catch', 'finally',
    'toJSON', 'constructor', 'prototype',
    Symbol.toPrimitive,
    Symbol.toStringTag,
    Symbol.iterator,
    Symbol.asyncIterator,
    // console.log(module) in Node
    Symbol.for('nodejs.util.inspect.custom'),
]);

/** Error thrown when a script touches a module it cannot use. Named so callers
 *  and tests can distinguish it from an error raised *inside* a working module. */
export class ModuleUnavailableError extends Error
{
    readonly moduleId: string;

    constructor(moduleId: string, message: string)
    {
        super(message);
        this.name = 'ModuleUnavailableError';
        this.moduleId = moduleId;
    }
}

/** Build the stand-in for an unusable module.
 *
 *  @param globalName  the name the script uses, e.g. 'example'
 *  @param moduleId    the module's id (may differ from globalName)
 *  @param reason      why it is unavailable — shown to the user, so phrase it
 *                     for a script author, not a developer
 */
export function unavailableStub(globalName: string, moduleId: string, reason: string): any
{
    // Reasons are noun phrases ("not available on your account", "could not be
    // loaded: …"), so a colon reads correctly for all of them — "is not
    // available: not available on your account" did not.
    const message = `Module '${globalName}': ${reason}`;

    const fail = () => { throw new ModuleUnavailableError(moduleId, message); };

    return new Proxy({}, {
        get: (_target, key) =>
        {
            if(PASSTHROUGH_KEYS.has(key)) return undefined;
            // A plain toString() keeps error messages and template literals readable
            // instead of throwing a second, more confusing error on top of the first.
            if(key === 'toString') return () => `[unavailable module '${globalName}']`;
            return fail();
        },
        set: fail,
        has: () => true,
    });
}
