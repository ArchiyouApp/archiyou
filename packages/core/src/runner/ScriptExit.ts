/**
 * exit() — stop a script run on purpose (debugging aid).
 *
 * Thrown by the `exit()` global in the script scope and recognised by the
 * Runner, which treats it as a *successful* stop: the model built up to that
 * point is still collected and returned, with a warning in the console. That is
 * what makes it useful while debugging — comment out nothing, just drop an
 * exit() and look at the partial model.
 *
 * Deliberately NOT an Error subclass user code can accidentally catch by type:
 * scripts that wrap work in try/catch(e) will still swallow it, but nothing
 * catches ScriptExitSignal by name unless it means to.
 */
export class ScriptExitSignal extends Error
{
    /** Marker so the check survives bundling/instanceof across module copies. */
    readonly isScriptExit = true;

    constructor(message?:string)
    {
        super(message ?? 'exit() called');
        this.name = 'ScriptExitSignal';
    }
}

/** Is this thrown value an exit() signal? Duck-typed on purpose — the Runner may
 *  see a signal thrown by another copy of core (component scopes, bundles). */
export function isScriptExitSignal(e:any): e is ScriptExitSignal
{
    return !!e && typeof e === 'object' && (e as any).isScriptExit === true;
}

/** Message shown in the script console when a run is stopped by exit(). */
export const SCRIPT_EXIT_WARNING = 'Warning: Exit called, stopped script execution';
