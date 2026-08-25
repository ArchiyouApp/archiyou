import type { HandleData } from './types';

/**
 * HandleRegistry — cross-run store of handle definitions owned by the Interactor.
 *
 * Tracks the last definition emitted to the viewer per handle id, plus the
 * current script identity so that a script-switch can be detected. When the
 * script changes, all previously-known ids are effectively "not touched" and
 * will produce 'delete' ops, while the new script's handles will produce 'add'.
 */
export class HandleRegistry
{
    private _scriptKey: string | null = null;
    private _defs = new Map<string, HandleData>();
    private _scriptChanged = false;

    /** Set the script identity for the upcoming run.
     *  Returns true when the script changed since the last call. */
    setScript(key: string): boolean
    {
        if (this._scriptKey === key)
        {
            this._scriptChanged = false;
            return false;
        }
        this._scriptKey = key;
        this._scriptChanged = true;
        return true;
    }

    /** Whether the script changed at the last setScript() call. */
    get scriptChanged(): boolean { return this._scriptChanged; }

    has(id: string): boolean { return this._defs.has(id); }
    get(id: string): HandleData | undefined { return this._defs.get(id); }
    put(id: string, data: HandleData): void { this._defs.set(id, data); }
    delete(id: string): void { this._defs.delete(id); }
    clear(): void { this._defs.clear(); }

    knownIds(): IterableIterator<string> { return this._defs.keys(); }
}
