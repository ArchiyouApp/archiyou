/**
 *  Styler — how drawings look, in one place
 *
 *  A drawing (a view in a document, an SVG export of a section or an elevation) writes CSS
 *  classes on its line work: what the line is in the drawing (`line`, `cut`, `visible`,
 *  `outline`, `hidden`, `dashed`) and what its shape is (`wall`, `insulation`, `wood`: the
 *  classes given with `addClass()`, and those of a material). The Styler holds the rules that
 *  draw those classes, in paper units:
 *
 *      styler.set('cut', { weight: 0.5 })                  // every cut line 0.5mm on paper
 *      styler.set('cut.insulation', { fill: '#eee' })       // cut insulation filled grey
 *      styler.set('hidden', { visible: false })             // no hidden lines at all
 *
 *  A selector is one or more classes: 'cut', or 'cut.insulation' for a line that has both.
 *  The dot of CSS ('.cut') may be written, and is how the rules come back (see rules()).
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
    /** A pattern over the fill of a closed shape: a name ('diagonal', 'cross', 'insulation', …,
     *  see STYLER_HATCHES), your own lines, or a bitmap. The fill shows between its lines. */
    hatch?: StylerHatch|string
}

/** A hatch of lines, or a bitmap, over the fill of a shape */
export interface StylerHatch
{
    /** 'lines' (one direction), 'cross' (two), 'dots' or 'zigzag' */
    pattern?: 'lines'|'cross'|'dots'|'zigzag'
    /** Degrees, counterclockwise; 0 is horizontal */
    angle?: number
    /** Distance between the lines: mm on paper, or model units with anchor 'model' */
    spacing?: number
    /** Line weight, mm on paper */
    weight?: number
    color?: string
    /** 'paper' [default for lines]: the same on paper at any scale. 'model': it scales with the
     *  drawing, like a material [default for an image] */
    anchor?: 'paper'|'model'
    /** A bitmap instead of lines: a material ('osb', its section texture), a web address or a data URI */
    image?: string
    /** The size of one tile of the bitmap, in model units: [width, height] or one for both.
     *  Default: the size the material says its texture covers */
    size?: number|[number, number]
}

/** Hatches by name, after the usual drawing conventions (ISO 128-50). Lengths in mm on paper. */
export const STYLER_HATCHES:Readonly<Record<string, StylerHatch>> = Object.freeze({
    'diagonal':      { pattern: 'lines', angle: 45, spacing: 1.5 },
    'diagonal-back': { pattern: 'lines', angle: -45, spacing: 1.5 },
    'horizontal':    { pattern: 'lines', angle: 0, spacing: 1.5 },
    'vertical':      { pattern: 'lines', angle: 90, spacing: 1.5 },
    'cross':         { pattern: 'cross', angle: 45, spacing: 2 },
    'grid':          { pattern: 'cross', angle: 0, spacing: 2 },
    'dots':          { pattern: 'dots', spacing: 1.5 },
    'insulation':    { pattern: 'zigzag', angle: 0, spacing: 3 },
    'metal':         { pattern: 'lines', angle: 45, spacing: 0.8 },
    'masonry':       { pattern: 'lines', angle: 45, spacing: 1 },
    'concrete':      { pattern: 'cross', angle: 45, spacing: 3 },
});

const HATCH_DEFAULTS = { pattern: 'lines', angle: 45, spacing: 1.5, weight: 0.13, color: '#000000' } as const;

/** A hatch as a full spec: a name looked up, the defaults filled in. Null for no hatch. */
export function stylerHatch(hatch:StylerHatch|string|undefined|null):Required<Omit<StylerHatch, 'image'|'size'>> & Pick<StylerHatch, 'image'|'size'> | null
{
    if(!hatch || hatch === 'none'){ return null }
    const given = (typeof hatch === 'string') ? STYLER_HATCHES[hatch] : hatch;
    if(!given){ return null }
    return {
        ...HATCH_DEFAULTS,
        anchor: given.image ? 'model' : 'paper',
        ...given,
    } as any;
}

/** The bitmaps of the hatches, as data, by what the hatch names (a material, an address). A
 *  drawing is written in one go and cannot wait for a file, so a document loads them before it
 *  draws (see Docs and loadStylerHatchImages). */
const HATCH_IMAGES = new Map<string, { data:string, size?:[number, number] }>();

/** Load the bitmaps the rules hatch with, for a drawing to use (see HATCH_IMAGES) */
export async function loadStylerHatchImages(rules:ReadonlyArray<StylerRuleEntry>, materials?:any):Promise<void>
{
    const images = rules.map(r => stylerHatch(r.hatch)?.image).filter((i):i is string => !!i && !HATCH_IMAGES.has(i));
    await Promise.all([...new Set(images)].map(async image =>
    {
        if(image.startsWith('data:')){ HATCH_IMAGES.set(image, { data: image }); return }
        const material = materials?.get?.(image);
        const texture = material?.viz?.textures?.section ?? material?.viz?.textures?.sides;
        if(texture?.image)
        {
            const data = await materials.loadTextureDataURI?.(texture.image);
            if(data){ HATCH_IMAGES.set(image, { data, size: [texture.realWidth ?? 500, texture.realHeight ?? texture.realWidth ?? 500] }) }
            else { console.warn(`styler: could not load the texture of material '${image}' to hatch with`) }
            return
        }
        if(/^https?:\/\//.test(image)){ HATCH_IMAGES.set(image, { data: image }); return } // referenced as it is
        console.warn(`styler: a hatch image '${image}' is no material, web address or data URI`);
    }));
}

/** The id of the pattern of rule `i` in a drawing with this scope */
function hatchId(scope:string, i:number):string
{
    return `${scope.trim().replace(/^\./, '') || 'ay'}-hatch-${i}`;
}

/** The `<pattern>`s of the hatches in the rules, for the `<defs>` of one drawing.
 *  The fill a hatch lies on is drawn in its tile: an element has one fill, and a hatch on
 *  nothing would let what is beyond a cut show between its lines. */
export function stylerHatchDefs(rules:ReadonlyArray<StylerRuleEntry>, scope:string, unitsPerMm:number,
    drawn?:Array<Array<string>>):string
{
    const f = (n:number) => +n.toFixed(4);
    return rules.map((rule, i) =>
    {
        const hatch = stylerHatch(rule.hatch);
        if(!hatch){ return '' }
        // only what this drawing uses: a bitmap is big, and every view would carry it
        if(drawn && unmatchedSelectors([rule.selector], drawn).length){ return '' }
        const background = resolveStylerRule(rules, stylerSelector(rule.selector).split('.').filter(Boolean)).fill;
        const bg = (typeof background === 'string' && background !== 'none' && background !== 'model') ? background : null;
        const id = hatchId(scope, i);

        if(hatch.image)
        {
            const image = HATCH_IMAGES.get(hatch.image);
            if(!image){ return '' } // not loaded: the fill alone (see compileStylerRules)
            const given = hatch.size ?? image.size ?? 500;
            const [w, h] = (Array.isArray(given) ? given : [given, given]).map(n => (hatch.anchor === 'paper') ? n * unitsPerMm : n);
            return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${f(w)}" height="${f(h)}">`
                + `<image href="${image.data}" x="0" y="0" width="${f(w)}" height="${f(h)}" preserveAspectRatio="none"/>`
                + '</pattern>';
        }

        const s = (hatch.anchor === 'model') ? hatch.spacing : hatch.spacing * unitsPerMm;
        const lw = hatch.weight * unitsPerMm;
        const stroke = `stroke="${hatch.color}" stroke-width="${f(lw)}" fill="none"`;
        const content =
            (hatch.pattern === 'dots') ? `<circle cx="${f(s / 2)}" cy="${f(s / 2)}" r="${f(lw * 1.5)}" fill="${hatch.color}"/>`
            : (hatch.pattern === 'zigzag') ? `<polyline points="0,${f(s)} ${f(s / 2)},0 ${f(s)},${f(s)}" ${stroke}/>`
            : `<line x1="0" y1="${f(s / 2)}" x2="${f(s)}" y2="${f(s / 2)}" ${stroke}/>`
              + ((hatch.pattern === 'cross') ? `<line x1="${f(s / 2)}" y1="0" x2="${f(s / 2)}" y2="${f(s)}" ${stroke}/>` : '');
        // SVG's y axis points down: a counterclockwise angle on paper is a negative rotation here
        return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${f(s)}" height="${f(s)}"`
            + (hatch.angle ? ` patternTransform="rotate(${f(-hatch.angle)})"` : '') + '>'
            + (bg ? `<rect x="0" y="0" width="${f(s)}" height="${f(s)}" fill="${bg}"/>` : '')
            + content
            + '</pattern>';
    }).join('');
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
    { selector: '.outline', weight: 0.35 },
    { selector: '.hidden', weight: 0.18, color: '#888888', dash: [3, 2] },
    { selector: '.dashed', dash: [2, 1] },
    // the thin lines that join the views of a fold-out view (make.foldoutView)
    { selector: '.projection', weight: 0.13, color: '#888888' },
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

/** The rules of an export of its own (see STYLER_EXPORT_RULES), with what the run's styler sets */
export function stylerExportRules(styler?:Styler|null):ReadonlyArray<StylerRuleEntry>
{
    if(!styler){ return STYLER_EXPORT_RULES }
    const rules = styler.rules();
    const at = rules.findIndex(r => r.selector === '.line');
    return [...rules.slice(0, at + 1), { selector: '.line', color: 'model' }, ...rules.slice(at + 1)];
}

/** The styler of the run a shape (or collection) was made in, if the script has one */
export function stylerOf(shapeOrCollection:any):Styler|null
{
    const first = shapeOrCollection?.first?.() ?? shapeOrCollection?.toArray?.()?.[0] ?? shapeOrCollection;
    return (shapeOrCollection?._modeler ?? first?._modeler)?.modules?.styler ?? null;
}

/** A selector the Styler takes: one or more classes, nothing else (see the header) */
const SELECTOR_RE = /^(\.-?[_a-zA-Z][_a-zA-Z0-9-]*)+$/;

/** A selector as CSS writes it: 'cut.wood' and '.cut.wood' are both '.cut.wood' */
export function stylerSelector(selector:string):string
{
    const s = String(selector ?? '').trim();
    return s.startsWith('.') ? s : `.${s}`;
}

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
        const hatch = stylerHatch(rule.hatch);
        if(hatch && (!hatch.image || HATCH_IMAGES.has(hatch.image))){ declarations.push(`fill:url(#${hatchId(scope, rules.indexOf(rule))})`) }

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
    if(typeof selector !== 'string' || !SELECTOR_RE.test(stylerSelector(selector)))
    {
        throw new Error(`${where}: "${selector}" is not a selector the styler takes. Use classes, like 'cut', or 'cut.wood' for a line that has both`);
    }
    if(!rule || typeof rule !== 'object' || Array.isArray(rule))
    {
        throw new Error(`${where}: the style of "${selector}" should be an object, like { weight: 0.5 }`);
    }
    const known = ['weight', 'color', 'fill', 'dash', 'opacity', 'visible', 'cap', 'join', 'hatch'];
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
    if(typeof rule.hatch === 'string' && rule.hatch !== 'none' && !STYLER_HATCHES[rule.hatch])
    {
        throw new Error(`${where}: there is no hatch '${rule.hatch}' for "${selector}". Use ${Object.keys(STYLER_HATCHES).join(', ')}, or { pattern, angle, spacing } or { image }`);
    }
    if(rule.hatch && typeof rule.hatch === 'object' && rule.hatch.pattern && !['lines', 'cross', 'dots', 'zigzag'].includes(rule.hatch.pattern))
    {
        throw new Error(`${where}: the hatch pattern of "${selector}" is 'lines', 'cross', 'dots' or 'zigzag'`);
    }
}

/** Rules given as { selector: rule } or as a list of { selector, ...rule }, checked */
export function toStylerRuleEntries(rules:Record<string,StylerRule>|Array<StylerRuleEntry>, where:string):Array<StylerRuleEntry>
{
    const entries = Array.isArray(rules)
        ? rules.map(r => ({ ...r }))
        : Object.entries(rules ?? {}).map(([selector, rule]) => ({ selector, ...rule }));
    entries.forEach(({ selector, ...rule }) => checkRule(selector, rule, where));
    return entries.map(e => ({ ...e, selector: stylerSelector(e.selector) }));
}

/** How an element with these classes is drawn, by the rules: the rules whose classes it all
 *  has, the one with fewer classes first and between equals the earlier, each over the one
 *  before. CSS's own cascade, worked out here for what the stylesheet cannot do itself. */
export function resolveStylerRule(rules:ReadonlyArray<StylerRuleEntry>, classes:Array<string>):StylerRule
{
    return rules
        .map((rule, i) => ({ rule, i, own: stylerSelector(rule.selector).split('.').filter(Boolean) }))
        .filter(r => r.own.every(c => classes.includes(c)))
        .sort((a, b) => (a.own.length - b.own.length) || (a.i - b.i))
        .reduce((style, { rule }) =>
        {
            const { selector: _selector, ...declared } = rule;
            return { ...style, ...declared };
        }, {} as StylerRule);
}

/** The elements of a drawing in the order to paint them.
 *
 *  A line is drawn centred on its path, so where two shapes meet each one's line lies half over
 *  the other, and what is painted later wins: a cut stud painted before the insulation next to
 *  it lost the inner half of its heavier line to the insulation's fill. So, keeping the order
 *  drawn where it does not matter:
 *    1. lines first, filled shapes after: a fill covers what lies beyond it (a section's cut
 *       covers the lines under it), so the lines go under the fills
 *    2. within each, thin before heavy: the heavier line ends on top, whole
 */
export function stylerPaintOrder(elements:Array<string>, rules:ReadonlyArray<StylerRuleEntry>):Array<string>
{
    const byClasses = new Map<string, [number, number]>();
    const key = (element:string):[number, number] =>
    {
        const classAttr = element.match(/\sclass="([^"]*)"/)?.[1] ?? '';
        if(!byClasses.has(classAttr))
        {
            const style = resolveStylerRule(rules, classAttr.split(/\s+/).filter(Boolean));
            const filled = (typeof style.fill === 'string' && style.fill !== 'none') || !!stylerHatch(style.hatch);
            byClasses.set(classAttr, [filled ? 1 : 0, style.visible === false ? 0 : (style.weight ?? 0)]);
        }
        return byClasses.get(classAttr)!;
    };
    return elements
        .map((element, i) => ({ element, i, k: key(element) }))
        .sort((a, b) => (a.k[0] - b.k[0]) || (a.k[1] - b.k[1]) || (a.i - b.i))
        .map(e => e.element);
}

/** The class lists of the line work in a drawing, as `line cut timber stud`; the class of a
 *  model colour is left out, it is nothing a script names */
export function drawnClassLists(svg:string):Array<Array<string>>
{
    return [...String(svg ?? '').matchAll(/\sclass="(line\b[^"]*)"/g)]
        .map(m => m[1].split(/\s+/).filter(c => c && !c.startsWith('ay-c-')));
}

/** The selectors no line of a drawing matches: a rule on a class that is not there draws nothing,
 *  which is easy to miss (`section` where the class is `cut`) */
export function unmatchedSelectors(selectors:Array<string>, drawn:Array<Array<string>>):Array<string>
{
    return selectors.filter(selector =>
    {
        const classes = stylerSelector(selector).split('.').filter(Boolean);
        return !drawn.some(list => classes.every(c => list.includes(c)));
    });
}

/** What to say about a rule that matches nothing, with the classes there are to choose from */
export function unmatchedMessage(where:string, selector:string, drawn:Array<Array<string>>):string
{
    const classes = stylerSelector(selector).split('.').filter(Boolean);
    const known = [...new Set(drawn.flat())].sort();
    const what = classes.length > 1
        ? `the classes ${classes.map(c => `'${c}'`).join(' and ')} together`
        : `the class '${classes[0]}'`;
    return `${where}('${selector.replace(/^\./, '')}'): no line in the drawings has ${what}, so it draws nothing.`
        + ` The classes there are: ${known.join(', ')}`;
}

/** The rules of a run: the defaults, then what the script sets. Made on first use (see Runner). */
export class Styler
{
    _rules:Array<StylerRuleEntry> = STYLER_DEFAULT_RULES.map(r => ({ ...r }));
    /** The selectors the script set, to say so when one matches nothing (see _warnUnmatched) */
    _setByScript = new Set<string>();
    /** The class lists of every line drawn this run, by the documents */
    _drawn:Array<Array<string>> = [];
    _warned = new Set<string>();

    /** Set how a class is drawn, or several at once:
     *  `styler.set('cut', { weight: 0.5 })`, `styler.set({ cut: { weight: 0.5 }, hidden: { visible: false } })`.
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
            this._setByScript.add(entry.selector);
        });
        return this;
    }

    /** A document drew this: remember the classes of its lines (see _warnUnmatched) */
    _noteDrawing(svg:string):void
    {
        const seen = new Set(this._drawn.map(l => l.join(' ')));
        drawnClassLists(svg).forEach(list =>
        {
            if(!seen.has(list.join(' '))){ this._drawn.push(list); seen.add(list.join(' ')) }
        });
    }

    /** Say which rules of the script no line in the drawings matches, once each. Only when
     *  something was drawn: without a document no rule has had its chance. */
    _warnUnmatched():void
    {
        if(this._drawn.length === 0){ return }
        unmatchedSelectors([...this._setByScript].filter(s => !this._warned.has(s)), this._drawn).forEach(selector =>
        {
            this._warned.add(selector);
            console.warn(unmatchedMessage('styler.set', selector, this._drawn));
        });
    }

    /** How a class is drawn by its own rule, or null when it has none */
    get(selector:string):StylerRuleEntry|null
    {
        const found = this._rules.find(r => r.selector === stylerSelector(selector));
        return found ? { ...found } : null;
    }

    /** Drop the rule of a class: it is drawn by the others again */
    remove(selector:string):this
    {
        this._rules = this._rules.filter(r => r.selector !== stylerSelector(selector));
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
