/**
 *  Styler — how drawings look, in one place
 *
 *  A drawing (a view in a document, an SVG export of a section or an elevation) writes CSS
 *  classes on its line work: what the line is in the drawing (`line`, `cut`, `visible`,
 *  `silhouette`, `hidden`, `dashed`) and what its shape is (`wall`, `insulation`, `wood`: the
 *  classes given with `addClass()`, and those of a material). The Styler holds the rules that
 *  draw those classes, in paper units:
 *
 *      styler.set('.cut', { weight: 0.5 })                 // every cut line 0.5mm on paper
 *      styler.set('.cut.insulation', { fill: '#eee' })      // cut insulation filled grey
 *      styler.set('.hidden', { visible: false })            // no hidden lines at all
 *
 *  The rules are data. A drawing compiles them to a stylesheet of its own, with the weights
 *  and dashes turned into model units at the drawing's scale, so a 0.5mm line is 0.5mm on
 *  paper at 1:20 and at 1:100 alike. SVG and PDF both read that stylesheet.
 *
 *  Which rule wins is CSS's own cascade: the rule with more classes wins (`.cut.wood` over
 *  `.cut`), and between two with as many classes the later one. Setting a rule that is
 *  already there changes it IN PLACE, so `styler.set('.line', ...)` does not jump ahead of
 *  `.cut` and overrule the cut lines.
 */

/** How one class (or combination of classes) is drawn. Lengths are millimeters on paper. */
export interface StylerRule
{
    /** Line weight, mm on paper */
    weight?: number
    /** Line colour (CSS colour), 'none' for no line, or 'model' for the colour of the shape in the model */
    color?: string
    /** Fill of a closed shape: a CSS colour, 'none', or 'model' */
    fill?: string
    /** Dash pattern, mm on paper ([3, 2]: 3mm dash, 2mm gap), or 'none' for an unbroken line */
    dash?: Array<number>|'none'
    opacity?: number
    /** false: not drawn at all */
    visible?: boolean
    cap?: 'butt'|'round'|'square'
    join?: 'bevel'|'round'|'miter'
}

/** A rule with the selector it applies to: one or more classes, like `.cut` or `.cut.wood` */
export interface StylerRuleEntry extends StylerRule
{
    selector: string
}

/** The drawing standard: weights after ISO 128 (0.18, 0.25, 0.35, 0.5), cut lines heaviest.
 *  `line` is every line of a drawing, so it comes first and the others refine it. */
export const STYLER_DEFAULT_RULES:ReadonlyArray<StylerRuleEntry> = Object.freeze([
    { selector: '.line', weight: 0.25, color: '#000000', fill: 'none', cap: 'round', join: 'round' },
    { selector: '.silhouette', weight: 0.35 },
    { selector: '.hidden', weight: 0.18, color: '#888888', dash: [3, 2] },
    { selector: '.dashed', dash: [2, 1] },
    // what a section cuts through: heavy, and filled so nothing beyond shows through it
    { selector: '.cut', weight: 0.5, fill: '#ffffff' },
    // the opaque faces of the 'painter' projection: they cover what is behind, they draw nothing
    { selector: '.fill', fill: '#ffffff', color: 'none' },
] as Array<StylerRuleEntry>);

/** The rules of a drawing exported on its own (`shape.toSVG()`, an svg output) rather than in a
 *  document: the same, but a line keeps the colour it has in the model, where it has one. An
 *  export can be meant for a machine (a laser cutter reads its colours). A document draws by
 *  the styler alone. */
export const STYLER_EXPORT_RULES:ReadonlyArray<StylerRuleEntry> = Object.freeze([
    STYLER_DEFAULT_RULES[0],
    { selector: '.line', color: 'model' }, // a second entry: black where the shape has no colour
    ...STYLER_DEFAULT_RULES.slice(1),
] as Array<StylerRuleEntry>);

/** A selector the Styler takes: one or more classes, nothing else (see the header) */
const SELECTOR_RE = /^(\.-?[_a-zA-Z][_a-zA-Z0-9-]*)+$/;

/** The class a drawing writes on a line that has a colour in the model, so a rule with
 *  `color: 'model'` can draw it in that colour (see compileStylerRules) */
export function modelColorClass(hex:string):string
{
    return `ay-c-${hex.replace('#', '').toLowerCase()}`;
}

const MODEL_COLOR_CLASS_RE = /\bay-c-([0-9a-f]{6})\b/g;

/** Every model colour the elements of a drawing carry (see modelColorClass) */
export function modelColorsIn(elements:Array<string>):Array<string>
{
    const found = new Set<string>();
    elements.forEach(e => [...e.matchAll(MODEL_COLOR_CLASS_RE)].forEach(m => found.add(m[1])));
    return [...found];
}

/** The rules as CSS for one drawing.
 *  @param scope  prefix of every selector: the drawing's own scope ('.ay-main-front '), or ''
 *  @param unitsPerMm  model units per millimeter on paper, at the drawing's scale
 *  @param modelColors  the model colours in the drawing (see modelColorsIn), as hex without '#'
 */
export function compileStylerRules(rules:ReadonlyArray<StylerRuleEntry>, scope:string, unitsPerMm:number,
    modelColors:Array<string> = []):string
{
    const len = (mm:number) => +(mm * unitsPerMm).toFixed(4);

    return rules.map(rule =>
    {
        const declarations:Array<string> = [];
        if(typeof rule.color === 'string' && rule.color !== 'model'){ declarations.push(`stroke:${rule.color}`) }
        if(typeof rule.fill === 'string' && rule.fill !== 'model'){ declarations.push(`fill:${rule.fill}`) }
        if(typeof rule.weight === 'number'){ declarations.push(`stroke-width:${len(rule.weight)}`) }
        if(rule.dash === 'none'){ declarations.push('stroke-dasharray:none') }
        else if(Array.isArray(rule.dash)){ declarations.push(`stroke-dasharray:${rule.dash.map(len).join(' ')}`) }
        if(typeof rule.opacity === 'number'){ declarations.push(`opacity:${rule.opacity}`) }
        if(rule.cap){ declarations.push(`stroke-linecap:${rule.cap}`) }
        if(rule.join){ declarations.push(`stroke-linejoin:${rule.join}`) }
        if(rule.visible === false){ declarations.push('display:none') }

        const own = declarations.length ? `${scope}${rule.selector}{${declarations.join(';')}}` : '';

        // CSS cannot read a colour off an element, so 'model' is one rule per colour in the drawing
        const fromModel = modelColors.map(hex =>
        {
            const d = [
                ...(rule.color === 'model' ? [`stroke:#${hex}`] : []),
                ...(rule.fill === 'model' ? [`fill:#${hex}`] : []),
            ];
            return d.length ? `${scope}${rule.selector}.${modelColorClass(hex)}{${d.join(';')}}` : '';
        }).join('');

        return own + fromModel;
    }).join('');
}

/** The rules with the weight of every line (`.line`) set to `weightMm`: what a view's
 *  `lineWeight` option does. In place, so the other rules still refine it. */
export function withLineWeight(rules:ReadonlyArray<StylerRuleEntry>, weightMm?:number):ReadonlyArray<StylerRuleEntry>
{
    if(typeof weightMm !== 'number'){ return rules }
    return rules.map(r => r.selector === '.line' ? { ...r, weight: weightMm } : r);
}

/** Check a rule from a script, with a message that says what is wrong */
function checkRule(selector:string, rule:StylerRule, where:string):void
{
    if(typeof selector !== 'string' || !SELECTOR_RE.test(selector.trim()))
    {
        throw new Error(`${where}: "${selector}" is not a selector the styler takes. Use classes, like '.cut' or '.cut.wood'`);
    }
    if(!rule || typeof rule !== 'object' || Array.isArray(rule))
    {
        throw new Error(`${where}: the style of "${selector}" should be an object, like { weight: 0.5 }`);
    }
    const known = ['weight', 'color', 'fill', 'dash', 'opacity', 'visible', 'cap', 'join'];
    const unknown = Object.keys(rule).filter(k => !known.includes(k));
    if(unknown.length)
    {
        throw new Error(`${where}: unknown ${unknown.map(k => `"${k}"`).join(', ')} for "${selector}". Use ${known.join(', ')}`);
    }
    if(rule.weight !== undefined && !(typeof rule.weight === 'number' && rule.weight >= 0))
    {
        throw new Error(`${where}: the weight of "${selector}" is in millimeters on paper, a number like 0.25`);
    }
    if(rule.dash !== undefined && rule.dash !== 'none'
        && !(Array.isArray(rule.dash) && rule.dash.every(d => typeof d === 'number' && d >= 0)))
    {
        throw new Error(`${where}: the dash of "${selector}" is a list of millimeters on paper, like [3, 2], or 'none'`);
    }
}

/** Rules given as { selector: rule } or as a list of { selector, ...rule }, checked */
export function toStylerRuleEntries(rules:Record<string,StylerRule>|Array<StylerRuleEntry>, where:string):Array<StylerRuleEntry>
{
    const entries = Array.isArray(rules)
        ? rules.map(r => ({ ...r }))
        : Object.entries(rules ?? {}).map(([selector, rule]) => ({ selector, ...rule }));
    entries.forEach(({ selector, ...rule }) => checkRule(selector, rule, where));
    return entries.map(e => ({ ...e, selector: e.selector.trim() }));
}

/** The rules of a run: the defaults, then what the script sets. Made on first use (see Runner). */
export class Styler
{
    _rules:Array<StylerRuleEntry> = STYLER_DEFAULT_RULES.map(r => ({ ...r }));

    /** Set how a class is drawn, or several at once:
     *  `styler.set('.cut', { weight: 0.5 })`, `styler.set({ '.cut': { weight: 0.5 }, '.hidden': { visible: false } })`.
     *  What you leave out stays as it was. */
    set(selectorOrRules:string|Record<string,StylerRule>, rule?:StylerRule):this
    {
        const entries = (typeof selectorOrRules === 'string')
            ? toStylerRuleEntries({ [selectorOrRules]: rule }, 'styler.set()')
            : toStylerRuleEntries(selectorOrRules, 'styler.set()');

        entries.forEach(entry =>
        {
            const at = this._rules.findIndex(r => r.selector === entry.selector);
            if(at >= 0){ this._rules[at] = { ...this._rules[at], ...entry } }
            else { this._rules.push(entry) }
        });
        return this;
    }

    /** How a class is drawn by its own rule, or null when it has none */
    get(selector:string):StylerRuleEntry|null
    {
        const found = this._rules.find(r => r.selector === selector?.trim());
        return found ? { ...found } : null;
    }

    /** Drop the rule of a class: it is drawn by the others again */
    remove(selector:string):this
    {
        this._rules = this._rules.filter(r => r.selector !== selector?.trim());
        return this;
    }

    /** Back to the default rules */
    reset():this
    {
        this._rules = STYLER_DEFAULT_RULES.map(r => ({ ...r }));
        return this;
    }

    /** Every rule, in the order they apply */
    rules():Array<StylerRuleEntry>
    {
        return this._rules.map(r => ({ ...r }));
    }
}
