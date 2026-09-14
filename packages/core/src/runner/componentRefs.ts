/**
 * componentRefs — parse the `$component(...)` references out of script source.
 *
 * Lives outside Runner because two very different callers need the same answer:
 *
 *   - the Runner, to prefetch every referenced component before execution;
 *   - the editor, to work out which of the author's workspace scripts a script
 *     depends on when publishing it as a configurator (those get auto-shared, so a
 *     visitor's Runner can read them — see Runner._getSharedComponentScript).
 *
 * The editor cannot ask a Runner: constructing one loads the WASM kernel, and the
 * publish menu runs on the main thread. So the parsing is plain string work here,
 * with Runner delegating to it — one implementation, one behaviour.
 *
 * Parsing is deliberately lexical (quote/paren aware, not a JS parser): a
 * `$component()` whose first argument is not a string literal cannot be resolved
 * ahead of execution by any means, and is reported as a cache miss at call time.
 */

/** A `$component(...)` call found in source: the whole call text, and its first
 *  argument with any surrounding quotes stripped (a path, a name, or inline code). */
export interface ComponentCall
{
    full: string;
    content: string;
}

/** Every TOP-LEVEL `$component(...)` call in the code. Calls nested inside another
 *  call are skipped — they belong to the component being defined there, and are
 *  found later by recursing into that component's own source. */
export function extractTopLevelComponentCalls(code: string): Array<ComponentCall>
{
    const results: Array<ComponentCall> = [];
    const pattern = /\$component\s*\(/g;
    let match;

    while ((match = pattern.exec(code)) !== null)
    {
        const startIndex = match.index;
        const contentStart = match.index + match[0].length;

        // Check if this $component is nested inside another one
        // by counting unbalanced parentheses before this match
        let isNested = false;
        let depth = 0;
        let inString: string | null = null;
        let escaped = false;

        for (let i = 0; i < startIndex; i++)
        {
            const char = code[i];

            if (escaped) { escaped = false; continue; }
            if (char === '\\') { escaped = true; continue; }

            // Track string boundaries
            if ((char === '"' || char === "'" || char === '`') && !inString) {
                inString = char;
            } else if (char === inString) {
                inString = null;
            }

            // Count parentheses outside strings
            if (!inString) {
                if (char === '(') depth++;
                if (char === ')') depth--;
            }
        }

        // If depth > 0, we're inside another function call (nested)
        if (depth > 0) {
            isNested = true;
        }

        // Skip nested $component calls
        if (isNested) {
            continue;
        }

        // Now find the matching closing parenthesis for this top-level $component
        depth = 1;
        let i = contentStart;
        inString = null;
        escaped = false;

        while (i < code.length && depth > 0)
        {
            const char = code[i];

            if (escaped) { escaped = false; i++; continue; }
            if (char === '\\') { escaped = true; i++; continue; }

            // Track string boundaries
            if ((char === '"' || char === "'" || char === '`') && !inString) {
                inString = char;
            } else if (char === inString) {
                inString = null;
            }

            // Count parentheses outside strings
            if (!inString) {
                if (char === '(') depth++;
                if (char === ')') depth--;
            }

            i++;
        }

        if (depth === 0)
        {
            const fullMatch = code.slice(startIndex, i);
            const argsText = code.slice(contentStart, i - 1); // raw, between ( and )
            let content = extractFirstArg(argsText).trim();

            // Remove surrounding quotes if present
            if ((content.startsWith('"') && content.endsWith('"')) ||
                (content.startsWith("'") && content.endsWith("'")) ||
                (content.startsWith('`') && content.endsWith('`')))
            {
                content = content.slice(1, -1);
            }

            results.push({ full: fullMatch, content: content });
        }
    }

    return results;
}

/** Return text up to the first top-level comma, ignoring commas inside
 *  strings, parens, brackets and braces. Used to isolate the path arg
 *  of $component('./name', { opts }, …). */
export function extractFirstArg(argsText: string): string
{
    let depth = 0;
    let inString: string | null = null;
    let escaped = false;

    for (let i = 0; i < argsText.length; i++)
    {
        const char = argsText[i];

        if (escaped) { escaped = false; continue; }
        if (char === '\\') { escaped = true; continue; }

        if ((char === '"' || char === "'" || char === '`') && !inString) {
            inString = char;
        } else if (char === inString) {
            inString = null;
        }

        if (inString) continue;

        if (char === '(' || char === '[' || char === '{') depth++;
        else if (char === ')' || char === ']' || char === '}') depth--;
        else if (char === ',' && depth === 0) return argsText.slice(0, i);
    }
    return argsText;
}

/** The workspace-local script name a reference points at, lowercased, or null when
 *  the reference is not local — inline code, a `.js` file path, or a library path
 *  like 'archiyou/wall:1.0'. Mirrors the './name' and bare-name branches of
 *  Runner._prepareComponentScript(); keep the two in step.
 *
 *  Script names are lowercased by Script.fromData(), so callers can compare directly. */
export function localComponentName(ref: string): string | null
{
    const path = (ref ?? '').trim();
    if (!path) return null;
    if (path.includes('.js')) return null;                 // local file path (node only)

    if (path.startsWith('./'))
    {
        const name = path.slice(2).toLowerCase();
        return name.length ? name : null;
    }
    // Bare name like 'timberwall'. Anything with a separator is a library path or URL.
    if (!path.includes('/') && !path.includes('.') && !path.includes('://'))
    {
        // Inline code is passed as the first argument too ($component('box(10)')),
        // so exclude anything that cannot be a script name.
        return /^[a-z0-9 _-]+$/i.test(path) ? path.toLowerCase() : null;
    }
    return null;
}

/** Every workspace-local component name referenced in the code, deduplicated and
 *  lowercased. Non-local references (inline code, library paths) are ignored. */
export function localComponentNames(code: string): Array<string>
{
    const names = new Set<string>();
    for (const call of extractTopLevelComponentCalls(code ?? ''))
    {
        const name = localComponentName(call.content);
        if (name) names.add(name);
    }
    return Array.from(names);
}

/** The minimum a script must expose to take part in the dependency walk. Kept
 *  structural (not `Script`) so callers can pass ScriptData, a Script, or a stub. */
export interface NamedScriptSource
{
    name?: string;
    code?: string;
}

/** How deep the dependency walk follows nested components. Matches
 *  Runner._prefetchComponentScripts' MAX_RECURSE_LEVEL — no point collecting a level
 *  the Runner will refuse to resolve. */
export const MAX_COMPONENT_DEPTH = 10;

/** Every script in `workspace` that `root` depends on through `$component()`, directly
 *  or transitively, plus the referenced names that match nothing there.
 *
 *  Used when publishing: those dependencies must be shared, or the published
 *  configurator cannot resolve them for a visitor (see the editor's
 *  component-sharing service and Runner._getSharedComponentScript).
 *
 *  `root` itself is never returned, cycles terminate on the seen-set, and matching is
 *  by lowercased name — the same key Script.fromData() and the Runner use.
 *
 *  `aliases` maps extra (lowercased) names to workspace scripts — old names of renamed
 *  scripts that references may still use. Current names always win. */
export function collectComponentDependencies<T extends NamedScriptSource>(
    root: NamedScriptSource,
    workspace: Array<T>,
    aliases: Record<string, T> = {},
): { found: Array<T>; missing: Array<string> }
{
    const byName = new Map<string, T>(Object.entries(aliases));
    for (const s of workspace)
    {
        if (s?.name) byName.set(s.name.toLowerCase(), s);
    }

    const found: Array<T> = [];
    const missing = new Set<string>();
    const seen = new Set<string>();

    const rootName = root.name?.toLowerCase();
    if (rootName) seen.add(rootName);

    let frontier = localComponentNames(root.code ?? '');
    for (let depth = 0; depth < MAX_COMPONENT_DEPTH && frontier.length; depth++)
    {
        const next: Array<string> = [];
        for (const name of frontier)
        {
            if (seen.has(name)) continue;
            seen.add(name);

            const script = byName.get(name);
            if (!script) { missing.add(name); continue; }
            if (found.includes(script) || script === root) continue; // reached by an old and a new name

            found.push(script);
            next.push(...localComponentNames(script.code ?? ''));
        }
        frontier = next;
    }

    return { found, missing: Array.from(missing) };
}
