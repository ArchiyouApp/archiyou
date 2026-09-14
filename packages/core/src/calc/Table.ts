/**
 *  Table.ts
 *     A table object holds data and enables easy adding, modifiying of data
 * 
*/

import type { JSONSchema7 } from 'json-schema';
import { Type, type TSchema } from 'typebox'
import { Check, Errors } from 'typebox/value'

import { Db } from './Db';
import { STANDARD_SCHEMAS } from './schemas';
import type { DataRowColumnValue, DataRows, DataRowsColumnValue,
    FooterSpec, FooterOptions, FooterColumnSpec, FooterAggKeyword, ComputedFooterRow } from './types'
import { isDataRowsValues, isDataRowsColumnValue } from './typeguards';

import writeXlsxFile from 'write-excel-file/universal' // see: https://www.npmjs.com/package/write-excel-file

export class Table
{
    //// SETTINGS ////
    DEFAULT_COL_NAME = 'col';
    //// END SETTINGS

    _name:string;
    _db:Db; // reference to database parent
    _dataRows: DataRowsColumnValue; // raw data fallback: [{ col1: v1, col2: v2}, { col1: v3, col2: v4 }]}
    _schema:TSchema; // optional row schema (TypeBox) that every row is validated against
    _idColumn:string; // name of the column used as identity/default group key (see id())
    _component:string; // component name if this table came from a component
    _footers:Array<{ spec:FooterSpec, options:FooterOptions }> = []; // footer aggregation blocks, kept separate from row data
    _xlsx:ArrayBuffer = null; // a ready-made workbook that replaces the generated one in toExcel() — see xlsx()

    KNOWN_AGG_KEYWORDS:Array<FooterAggKeyword> = ['sum','average','avg','mean'];

    /** Make Table from rows with Objects or values */
    constructor(data:DataRows, columns:Array<string>=null)
    {
        if(Array.isArray(data) && data.length === 0)
        {
            // An empty table is legitimate: rows come later with addRow(), or the
            // table only carries a file (see xlsx()). The typeguards below would
            // read data[0] and throw.
            this._dataRows = [];
        }
        else if(isDataRowsValues(data)) 
        {
            // only rows with values [[r1v1,r1v2],[r2v1,r2v2]], make up column names
            // Set the columns later with setColumns()
            console.info(`Table::constructor(): Creating table with ${data.length} rows and ${data[0].length} columns`);
            this._dataRows = data.map((row,rowIndex) => row.reduce((acc,val,valIndex) => 
            {
                // accumulator is the new row
                acc[`${this.DEFAULT_COL_NAME}${valIndex}`] = val;
                return acc
            }, {}))
            console.info(`Table::constructor(): Created table with data ${JSON.stringify(this._dataRows)}`);
        }
        else if(isDataRowsColumnValue(data))
        {
            this._dataRows = data;
        }
        else {
            console.info(`Table: Can't create table. Unknown data format. Please supply [{ col1:v1, col2:v2 }, ...] or [[r1v1,r1v2],...]`);
        }
    
    }
    
    /** Pretty-print the table (header, rows and any footers) as an aligned grid to the console. */
    print():this
    {
        console.log(this._asciiTable());
        return this;
    }

    /** Render the table as an aligned unicode-box grid string (used by print()). */
    _asciiTable():string
    {
        const cols = this.columns();
        if(cols.length === 0){ return `${this._name ? this._name + ': ' : ''}(empty table)`; }

        const fmt = (v:any) => (v === null || v === undefined) ? '' : String(v);
        const bodyRows = this._dataRows.map(row => cols.map(c => fmt(row[c])));
        const footerRows = this.computeFooterRows().map(f => cols.map(c => fmt(f.values[c])));

        // column widths: widest of header and all body/footer cells
        const widths = cols.map((c, i) =>
            Math.max(c.length, ...bodyRows.map(r => r[i].length), ...footerRows.map(r => r[i].length)));

        // right-align a column when every data cell in it is numeric, else left-align
        const rightAlign = cols.map(c => this._dataRows.length > 0 && this._dataRows.every(row => this._isNumeric(row[c])));

        const pad  = (s:string, i:number) => rightAlign[i] ? s.padStart(widths[i]) : s.padEnd(widths[i]);
        const line = (cells:Array<string>) => `│ ${cells.map((s,i) => pad(s,i)).join(' │ ')} │`;
        const rule = (l:string, m:string, r:string) => l + widths.map(w => '─'.repeat(w + 2)).join(m) + r;

        const out:Array<string> = [];
        if(this._name){ out.push(this._name); }
        out.push(rule('┌','┬','┐'));
        out.push(line(cols));
        out.push(rule('├','┼','┤'));
        bodyRows.forEach(r => out.push(line(r)));
        if(footerRows.length)
        {
            out.push(rule('├','┼','┤'));
            footerRows.forEach(r => out.push(line(r)));
        }
        out.push(rule('└','┴','┘'));
        return out.join('\n');
    }

    /** Get/set name */
    name(newName?:string):string|Table
    {
        if(!newName)
        { 
            return this._name;
        }
        this._db.renameTable(this, newName);
        return this;
    }

    /** Set the row schema for this table.
     *  Pass the name of a standard schema (e.g. schema('parts')) or a raw JSON Schema
     *  object. Every row is validated against it; existing rows are checked immediately.
     */
    schema(schema?:string|JSONSchema7):this
    {
        if(typeof schema === 'string')
        {
            const std = STANDARD_SCHEMAS[schema];
            if(!std)
            {
                throw new Error(`Table::schema(): Unknown standard schema '${schema}'. Known schemas: ${Object.keys(STANDARD_SCHEMAS).join(', ')}`);
            }
            this._schema = std;
        }
        else if(schema && typeof schema === 'object')
        {
            this._schema = Type.Unsafe(schema);
        }
        else {
            throw new Error(`Table::schema(schema): Please supply a standard schema name (e.g. 'parts') or a JSON Schema object`);
        }

        this.validate(); // check current rows against the new schema
        return this;
    }

    /** Validate every row against this table's schema. Throws on the first failing rows. */
    validate():this
    {
        if(!this._schema){ return this; }

        const failures:Array<string> = [];
        this._dataRows.forEach((row, i) =>
        {
            if(!Check(this._schema, row))
            {
                failures.push(`row ${i}: ${this._schemaErrors(row).join('; ')}`);
            }
        });

        if(failures.length)
        {
            throw new Error(`Table::validate(): ${failures.length} row(s) failed schema validation: ${failures.join(' | ')}`);
        }
        return this;
    }

    /** Validate a single row against the schema (no-op when no schema). Throws on failure. */
    _validateRow(row:DataRowColumnValue):void
    {
        if(!this._schema){ return; }
        if(!Check(this._schema, row))
        {
            throw new Error(`Table::validate(): row failed schema validation: ${this._schemaErrors(row).join('; ')}`);
        }
    }

    /** Human-readable validation messages for a row against the current schema */
    _schemaErrors(row:DataRowColumnValue):Array<string>
    {
        // @ts-ignore TS2589: TypeBox Errors can trigger excessively deep type instantiation
        return Errors(this._schema, row).map(e => e.message);
    }

    /** Save this Table in the database*/
    save(name?:string):Table
    {
        if(!this._db)
        {
            console.error(`Table::save: Table cannot register to the database. None given!`);
        }
        else {
            this._db.saveTable(this, name || this._name);
            this._name = name;
        }

        return this;
    }

    //// BASIC PROPERTIES ////

    firstRow():DataRowColumnValue
    {
        return this._dataRows[0] || {}
    }

    /** Get size of table in rows and columns */
    shape():Array<number> // [rows,columns]
    {
        return [this._dataRows.length, this._dataRows[0] ? Object.keys(this._dataRows[0]).length : 0];
    }
    
    size():Array<number>
    {
        return this.shape();
    }

    numRows():number
    {
        return this.shape()[0];
    }

    numColumns():number
    {
        return this.shape()[1];
    }

    /** Set name of columns */
    setColumns(names:Array<string>):Table
    {
        if(!Array.isArray(names))
        {
            throw new Error(`Table::setColumns(columns): Please names of columns in an Array!`)    
        }

        this._dataRows = this._dataRows.map( row => {
            const newRow = {};
            for (const [colName,val] of Object.entries(row))
            {
                const i = Object.keys(row).indexOf(colName);
                newRow[names[i] || colName] = val;
            } 
            return newRow;
        })
        return this;
    }

    /** Get column names */
    columns():Array<string>
    {
        return this._dataRows.reduce( (agg, row) => 
        {
            Object.keys(row).forEach( (col) => 
            {
                if(!agg.includes(col))
                {
                    agg.push(col);
                }
            });
            return agg
        },
            []
        ) as Array<string>
    }


    /** Return index labels. By default serial integers */
    index():Array<string|number>
    {
        return Array.from(Array(this._dataRows.length).keys());
    }

    //// SIMPLE OPS ////

    /** Add a row, either as an array of values (zipped to the columns) or a column-value object */
    addRow(row:Array<string|number> | DataRowColumnValue):this
    {
        if(Array.isArray(row))
        {
            const newRow = this._zip(this.columns(), row);
            this._validateRow(newRow);
            this._dataRows.push(newRow)
        }
        else if(typeof row === 'object'){
            const fullRow = { ...this._zip(this.columns(), []), ...(row as Object) };
            this._validateRow(fullRow);
            this._dataRows.push(fullRow); // can directly push the key:value pair
        }

        return this;
    }

    //// FOOTERS ////

    /** Declare a footer block: per-column aggregations rendered as summary row(s) below the table.
     *  The spec maps column name to an aggregation keyword ('sum'|'average'|...), a custom
     *  function (values, rows) => value, or a literal label string.
     *  With options.groupBy the footer expands into one subtotal row per unique group value(s).
     *  Multiple footer() calls stack. Footers are stored separately from the row data.
     */
    footer(spec:FooterSpec, options:FooterOptions = {}):this
    {
        if(!spec || typeof spec !== 'object')
        {
            throw new Error(`Table::footer(spec, options): Please supply a footer spec like { length: 'sum', subpart: 'Total' }`);
        }
        this._footers.push({ spec, options });
        return this;
    }

    /** Remove all declared footer blocks */
    clearFooters():this
    {
        this._footers = [];
        return this;
    }

    /** Expand all declared footer blocks into concrete rendered rows */
    computeFooterRows():Array<ComputedFooterRow>
    {
        const result:Array<ComputedFooterRow> = [];

        this._footers.forEach(({ spec, options }) =>
        {
            const line = options.line !== false; // default true
            const bold = options.bold !== false; // default true
            const fill = options.fill;

            const groupByCols = (options.groupBy === undefined) ? []
                : (Array.isArray(options.groupBy) ? options.groupBy : [options.groupBy]);

            if(groupByCols.length === 0)
            {
                // single summary row over the whole table
                result.push({ values: this._computeFooterValues(spec, this._dataRows), line, bold, fill });
            }
            else
            {
                // one subtotal row per unique combination of groupBy column value(s), in first-seen order
                const groupKey = (row:DataRowColumnValue) => groupByCols.map(c => row[c]).join(' ');
                const seen = new Set<string>();
                const groupOrder:Array<string> = [];
                this._dataRows.forEach(row =>
                {
                    const k = groupKey(row);
                    if(!seen.has(k)){ seen.add(k); groupOrder.push(k); }
                });

                groupOrder.forEach((k, i) =>
                {
                    const groupRows = this._dataRows.filter(row => groupKey(row) === k);
                    const values = this._computeFooterValues(spec, groupRows);
                    // fill in the groupBy column(s) with this group's value(s)
                    groupByCols.forEach(c => { values[c] = groupRows[0]?.[c] ?? ''; });
                    result.push({ values, line: line && i === 0, bold, fill }); // only first row of block carries the line
                });
            }
        });

        return result;
    }

    /** Resolve every column in a footer spec over the given rows into a single values object */
    _computeFooterValues(spec:FooterSpec, rows:DataRowsColumnValue):DataRowColumnValue
    {
        const values:DataRowColumnValue = {};
        // start blank for all known columns so missing cells render empty
        this.columns().forEach(col => { values[col] = ''; });

        for (const [col, colSpec] of Object.entries(spec))
        {
            values[col] = this._resolveFooterCell(colSpec, rows.map(r => r[col]), rows);
        }
        return values;
    }

    /** Resolve a single footer cell spec into a value */
    _resolveFooterCell(colSpec:FooterColumnSpec, values:Array<any>, rows:DataRowsColumnValue):any
    {
        if(typeof colSpec === 'function')
        {
            return colSpec(values, rows);
        }
        if(typeof colSpec === 'string' && this.KNOWN_AGG_KEYWORDS.includes(colSpec as FooterAggKeyword))
        {
            return this._aggregate(colSpec as FooterAggKeyword, values);
        }
        // any other string is a literal label
        return colSpec;
    }

    /** Built-in numeric aggregations. Single switch is the extension point for min/max/count etc. */
    _aggregate(keyword:FooterAggKeyword, values:Array<any>):number
    {
        const nums = values.filter(v => this._isNumeric(v)).map(v => parseFloat(v));
        switch(keyword)
        {
            case 'sum':
                return nums.reduce((s,v) => s + v, 0);
            case 'average':
            case 'avg':
            case 'mean':
                return nums.length ? nums.reduce((s,v) => s + v, 0) / nums.length : 0;
            default:
                return NaN;
        }
    }

    //// SLICING AND DICING ////

    // TODO filtering, joins, merges, etc

    /** Get/set the id column: the column used as row identity and default group key */
    id():string;
    id(columnName:string):this;
    id(columnName?:string):string|this
    {
        if(columnName === undefined)
        {
            return this._idColumn;
        }
        if(!this._checkColumn(columnName))
        {
            throw new Error(`Table::id(columnName): No column '${columnName}'. Columns: ${this.columns().join(', ')}`);
        }
        this._idColumn = columnName;
        return this;
    }

    /** Sort rows in place. `by` is a column name or a compare fn(row1,row2); order 'asc'|'desc'. */
    sort(by:string|((a:DataRowColumnValue, b:DataRowColumnValue) => number), order:'asc'|'desc'='asc'):this
    {
        const dir = (order === 'desc') ? -1 : 1;

        if(typeof by === 'function')
        {
            this._dataRows.sort((a,b) => by(a,b) * dir);
            return this;
        }

        if(!this._checkColumn(by))
        {
            throw new Error(`Table::sort(by): No column '${by}'. Columns: ${this.columns().join(', ')}`);
        }
        this._dataRows.sort((a,b) =>
        {
            const va = a[by];
            const vb = b[by];
            const cmp = (this._isNumeric(va) && this._isNumeric(vb))
                ? parseFloat(va) - parseFloat(vb)
                : String(va ?? '').localeCompare(String(vb ?? ''));
            return cmp * dir;
        });
        return this;
    }

    /** Group rows by a column (defaults to the id column). Within each group numeric columns
     *  are summed and string columns collapsed to their unique values, comma-joined. */
    group(by?:string):this
    {
        const col = by ?? this._idColumn;
        if(!col)
        {
            throw new Error(`Table::group(by): No column given and no id() column set`);
        }
        if(!this._checkColumn(col))
        {
            throw new Error(`Table::group(by): No column '${col}'. Columns: ${this.columns().join(', ')}`);
        }

        const cols = this.columns();
        // bucket rows by group value, keeping first-seen order (as computeFooterRows does)
        const groups = new Map<any, DataRowsColumnValue>();
        const order:Array<any> = [];
        this._dataRows.forEach(row =>
        {
            const k = row[col];
            if(!groups.has(k)){ groups.set(k, []); order.push(k); }
            groups.get(k).push(row);
        });

        this._dataRows = order.map(k =>
        {
            const groupRows = groups.get(k);
            const out:DataRowColumnValue = {};
            cols.forEach(c =>
            {
                if(c === col){ out[c] = k; return; } // the group key stays as-is
                const values = groupRows.map(r => r[c]);
                if(values.every(v => this._isNumeric(v)))
                {
                    out[c] = values.reduce((s,v) => s + parseFloat(v), 0); // sum numbers
                }
                else {
                    // unique non-empty values, comma-joined
                    out[c] = [...new Set(values.filter(v => v != null && v !== ''))].join(', ');
                }
            });
            return out;
        });
        return this;
    }

    /** Append the rows of another Table to this one (validated against this table's schema). */
    append(other:Table):this
    {
        other.toDataRows().forEach(row =>
        {
            const copy = { ...row };
            this._validateRow(copy);
            this._dataRows.push(copy);
        });
        return this;
    }

    //// OUTPUT ////

    /** Output raw data in rows 
     * in format { [col1: row1val, col2: row1val2], [col1: row2val, ..] ... }
    * */
    toData():DataRows
    {
        return this._dataRows
    }

    /**
     * Attach a ready-made .xlsx to this table. toExcel() — and with it the
     * `<pipeline>/tables/<name>/xlsx` output — then delivers these bytes instead
     * of a workbook generated from the rows.
     *
     * This is how a module hands the script a spreadsheet it produced (the
     * cloudcalc module's `wb.fill(input).export(name)`, for instance) without
     * the output machinery having to know about it. Accepts the bytes, or a
     * base64 string as they arrive over a JSON hop.
     */
    xlsx(data:ArrayBuffer|Uint8Array|string):this
    {
        if(typeof data === 'string')
        {
            this._xlsx = base64ToArrayBuffer(data);
        }
        else if(data instanceof Uint8Array)
        {
            this._xlsx = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        }
        else if(data instanceof ArrayBuffer)
        {
            this._xlsx = data;
        }
        else {
            throw new Error(`Table::xlsx(): expected an ArrayBuffer, Uint8Array or base64 string, got ${typeof data}`);
        }
        return this;
    }

    /** Export this Table to Excel format in ArrayBuffer 
     * We use write-excel-file (https://www.npmjs.com/package/write-excel-file)
     *  And use automatic value type detection.
     *  A workbook attached with xlsx() is returned as-is.
    */
    async toExcel():Promise<ArrayBuffer>
    {
        if(this._xlsx){ return this._xlsx; }

        // header row
        const headerRow = this.columns().map( colName => ({ value: colName, fontWeight: 'bold' }) );
        const dataRows = this._dataRows.map( row => 
            this.columns().map( colName => ({ value: row[colName] }) ) // no type, automatic detection
        );

        const blob = await writeXlsxFile([headerRow, ...dataRows], {}); // see options: https://gitlab.com/catamphetamine/write-excel-file
        return blob.arrayBuffer();
    }

    /** Output to Row objects */
    toDataRows():DataRowsColumnValue // TODO: TS typing
    {
        return this._dataRows;
    }

    /** Output to raw Array of values of this column */
    toDataColumn(columnName:string):Array<number|string>
    {
        return this._dataRows.map(row => row[columnName]); 
    }

    //// UTILS ////

    _protectNullUndefined(value:any)
    {
        if(value == null){
            return NaN;
        }
        if(value == undefined)
        {
            return NaN;
        }
        return value;
    }

    _zip(keys:Array<string>,values:Array<any>)
    {
        let obj = {};
        
        keys.forEach( (key, index) =>
        {
            obj[key] = values[index] ?? null
        });

        return obj;
    }

    _checkColumn(name:string)
    {
        return this.columns().includes(name);
    }

    _checkColumns(names:Array<string>)
    {
        return names.filter( name => this._checkColumn(name));
    }

    /** Remap keys of Object to new */
    _remapObject(obj:Object, map:Object)
    {
        let newObj = {}
        for (const [key,value] of Object.entries(obj))
        {
            newObj[map[key]] = value;
        }

        return newObj;
    }

    /** We need to convert some values into their real type */
    _makeRealValue(value:string)
    {
        // null
        if(value == 'null'){ return null; };
        // booleans
        if(value == 'false'){ return false;}
        if(value == 'true'){ return true; }
        // numbers
        if (this._isNumeric(value))
        {
            return parseFloat(value);
        }
        return value;

    }

    _isNumeric(value:string)
    {
        if(typeof value == 'number'){
            return true;
        }
        else {
            return !isNaN(value as any) && !isNaN(parseFloat(value)); // avoid TS errors
        }

    }

    _checkObject(obj:Object,columns:Array<string>)
    {
        for (let i = 0; i < columns.length; i++)
        {
            if(!Object.keys(obj).includes(columns[i]))
            {
                return false;
            }
        }
        return true;
    }

    _range(startIndex:number, endIndex:number):Array<number>
    {
        return Array.from({length: (endIndex - startIndex)}, (v, k) => k + startIndex);
    }
}

/** Decode base64 into an ArrayBuffer, in the browser (atob) and in Node (Buffer). */
function base64ToArrayBuffer(b64:string):ArrayBuffer
{
    if(typeof atob === 'function')
    {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for(let i = 0; i < bin.length; i++){ out[i] = bin.charCodeAt(i); }
        return out.buffer;
    }
    const buf = Buffer.from(b64, 'base64');
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
