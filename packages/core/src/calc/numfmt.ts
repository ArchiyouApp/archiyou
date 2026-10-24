/**
 *  numfmt.ts
 *      Show a number the way a spreadsheet number format says: '#,##0.00', '0%',
 *      '"€ "#,##0', '[$€-413] #,##0.00;[Red]-#,##0.00', 'dd-mm-yyyy'. Covers the formats
 *      sheets use for money, quantities, percentages and dates; anything else
 *      (fractions, scientific, text '@') returns null so the caller shows the raw value.
 */

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30); // serial 0; Excel's 1900 leap year bug is in the serials already
const MS_PER_DAY = 86400000;
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

/** Format a value with an Excel number format. Returns null when the format doesn't apply or isn't understood.
 *  @param locale Sets the decimal and thousands separators, like the sheet would show them (default: runtime locale)
 */
export function formatNumber(value:any, format:string, locale?:string):string|null
{
    if(typeof value !== 'number' || !Number.isFinite(value)){ return null; }
    if(!format || /^general$/i.test(format) || format === '@'){ return null; }

    const sections = splitSections(format);
    // [pos];[neg];[zero]: the negative section shows the absolute value with its own signs or brackets
    const useNeg = value < 0 && sections.length > 1;
    const section = (value === 0 && sections.length > 2) ? sections[2]
        : useNeg ? sections[1] : sections[0];
    const v = useNeg ? Math.abs(value) : value;

    const tokens = tokenize(section);
    if(tokens === null){ return null; }

    const code = tokens.filter(t => t.kind === 'code').map(t => t.text).join('');
    if(/[ymdhs]/i.test(code) && !/[0#?]/.test(code))
    {
        return formatDate(v, tokens);
    }
    return formatPlainNumber(v, tokens, locale);
}

//// PARSING ////

type Token = { kind:'code'|'literal', text:string };

/** Split on ';' outside quotes */
function splitSections(format:string):Array<string>
{
    const out = [''];
    let quoted = false;
    [...format].forEach((ch, i) =>
    {
        if(ch === '"'){ quoted = !quoted; }
        if(ch === ';' && !quoted && format[i - 1] !== '\\'){ out.push(''); return; }
        out[out.length - 1] += ch;
    });
    return out;
}

/** Split a section in format code and literal text. Null for what isn't supported (fractions, scientific). */
function tokenize(section:string):Array<Token>|null
{
    const tokens:Array<Token> = [];
    const push = (kind:Token['kind'], text:string) =>
    {
        const last = tokens[tokens.length - 1];
        if(last && last.kind === kind){ last.text += text; }
        else { tokens.push({ kind, text }); }
    };

    let i = 0;
    while(i < section.length)
    {
        const ch = section[i];
        if(ch === '"')
        {
            const end = section.indexOf('"', i + 1);
            push('literal', section.slice(i + 1, end < 0 ? undefined : end));
            i = (end < 0) ? section.length : end + 1;
        }
        else if(ch === '\\'){ push('literal', section[i + 1] ?? ''); i += 2; }
        else if(ch === '_'){ push('literal', ' '); i += 2; }      // padding the width of the next char
        else if(ch === '*'){ i += 2; }                              // repeat-fill: nothing in a table cell
        else if(ch === '[')
        {
            const end = section.indexOf(']', i);
            const inner = section.slice(i + 1, end < 0 ? undefined : end);
            const currency = inner.match(/^\$([^-]*)/);               // [$€-413] → €
            if(currency){ push('literal', currency[1]); }
            // colours ([Red]) and conditions ([>=100]) are left out
            i = (end < 0) ? section.length : end + 1;
        }
        else if(/[eE]/.test(ch) && /[+-]/.test(section[i + 1] ?? '')){ return null; } // scientific
        else if(ch === '/' && /[0#?]/.test(section[i - 1] ?? '') ){ return null; }   // fractions
        else if(/[0#?.,%ymdhsAP:\/]/i.test(ch) && !(/[AP]/i.test(ch) && !/^(AM\/PM|A\/P)/i.test(section.slice(i))))
        {
            const ampm = section.slice(i).match(/^(AM\/PM|A\/P)/i);
            if(ampm){ push('code', ampm[0]); i += ampm[0].length; }
            else { push('code', ch); i++; }
        }
        else { push('literal', ch); i++; }
    }
    return tokens;
}

//// NUMBERS ////

function formatPlainNumber(value:number, tokens:Array<Token>, locale?:string):string
{
    // the number placeholders run from the first to the last digit code; the rest is text around it
    const codes = tokens.map(t => t.kind === 'code' ? t.text : '').join('');
    const percent = (codes.match(/%/g) ?? []).length;
    const num = codes.replace(/%/g, '');
    const [intPart, fracPart = ''] = num.split('.');
    const scale = (intPart.match(/,+$/)?.[0].length ?? 0);    // '#,##0,' shows thousands
    const digits = intPart.replace(/,+$/, '');

    const shown = value * Math.pow(100, percent) / Math.pow(1000, scale);
    const nf = new Intl.NumberFormat(locale, {
        minimumIntegerDigits: Math.max(1, (digits.match(/0/g) ?? []).length),
        minimumFractionDigits: (fracPart.match(/0/g) ?? []).length,
        maximumFractionDigits: (fracPart.match(/[0#?]/g) ?? []).length,
        useGrouping: digits.includes(','),
    });
    const text = nf.format(shown);

    // put the number where the first digit code was; % signs and literals stay in place
    let placed = false;
    return tokens.map(t =>
    {
        if(t.kind === 'literal'){ return t.text; }
        const pct = t.text.replace(/[^%]/g, '');
        if(/[0#?.,]/.test(t.text) && !placed){ placed = true; return text + pct; }
        return pct;
    }).join('');
}

//// DATES ////

function formatDate(serial:number, tokens:Array<Token>):string
{
    const d = new Date(EXCEL_EPOCH_MS + Math.round(serial * MS_PER_DAY));
    const pad = (n:number, len = 2) => String(n).padStart(len, '0');
    const hasAmPm = tokens.some(t => t.kind === 'code' && /AM\/PM|A\/P/i.test(t.text));
    const hours = d.getUTCHours();

    return tokens.map(t =>
    {
        if(t.kind === 'literal'){ return t.text; }
        // 'm' after an hour or before a second is minutes, else month
        return t.text.replace(/AM\/PM|A\/P|y+|m+|d+|h+|s+/gi, (m, offset:number, all:string) =>
        {
            const lower = m.toLowerCase();
            if(lower === 'am/pm'){ return hours < 12 ? 'AM' : 'PM'; }
            if(lower === 'a/p'){ return hours < 12 ? 'A' : 'P'; }
            switch(lower[0])
            {
                case 'y': return lower.length <= 2 ? pad(d.getUTCFullYear() % 100) : String(d.getUTCFullYear());
                case 'd':
                    if(lower.length >= 4){ return DAYS[d.getUTCDay()]; }
                    if(lower.length === 3){ return DAYS[d.getUTCDay()].slice(0, 3); }
                    return lower.length === 2 ? pad(d.getUTCDate()) : String(d.getUTCDate());
                case 'h':
                {
                    const h = hasAmPm ? ((hours % 12) || 12) : hours;
                    return lower.length >= 2 ? pad(h) : String(h);
                }
                case 's': return lower.length >= 2 ? pad(d.getUTCSeconds()) : String(d.getUTCSeconds());
                case 'm':
                {
                    const before = all.slice(0, offset);
                    const after = all.slice(offset + m.length);
                    const isMinute = lower.length <= 2 && (/h+[^a-z]*$/i.test(before) || /^[^a-z]*s/i.test(after));
                    if(isMinute){ return lower.length === 2 ? pad(d.getUTCMinutes()) : String(d.getUTCMinutes()); }
                    if(lower.length >= 4){ return MONTHS[d.getUTCMonth()]; }
                    if(lower.length === 3){ return MONTHS[d.getUTCMonth()].slice(0, 3); }
                    return lower.length === 2 ? pad(d.getUTCMonth() + 1) : String(d.getUTCMonth() + 1);
                }
            }
            return m;
        });
    }).join('');
}
