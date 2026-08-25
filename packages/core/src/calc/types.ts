
export type DataRowColumnValue = {[key:string]:any} // DataRow in column-value format
export type DataRowValues = Array<any> // DataRow with values only
export type DataRowsColumnValue = Array<DataRowColumnValue> // Array of DataRow as column-value
export type DataRowsValues = Array<DataRowValues> // Array of DataRow as values only
export type DataRows = DataRowsColumnValue | DataRowsValues

//// TABLE FOOTERS ////

export type FooterAggKeyword = 'sum' | 'average' | 'avg' | 'mean';
export type FooterAggFn      = (values:Array<any>, rows:DataRowsColumnValue) => any;
/** Per-column footer spec: an aggregation keyword, a custom function, or a literal label string */
export type FooterColumnSpec = FooterAggKeyword | string | FooterAggFn;
export type FooterSpec       = Record<string, FooterColumnSpec>;

export interface FooterOptions
{
    groupBy?: string | Array<string>;  // produce one subtotal row per unique group value(s)
    line?: boolean;                    // draw a separating line above the block (default true)
    bold?: boolean;                    // render footer text bold (default true)
    fill?: string;                     // optional cell background color
}

/** A concrete, rendered footer row produced by Table.computeFooterRows() */
export interface ComputedFooterRow
{
    values: DataRowColumnValue;        // column -> rendered value (missing cols render blank)
    line?: boolean;                    // draw a separating line above this row
    bold?: boolean;
    fill?: string;
}

export type MetricName = 'cost_material' | 'cost_labor' | 'production_time' | 'price_est' | 'price' | 'weight' | 'volume' | 'size' | 'r-value' | 'carbon' // TODO: more

/** Metric is a element that outputs data in some way */
export interface Metric {
    name: MetricName // standardized name of Metric
    label: string // Label to be LACE VIEW SVshown to user
    type:'text'|'bar'|'line'|'radar' // TODO: more
    data: number|string|Array<number|string> // raw data (either value, array<value> or array<object>)
    options: TextMetricOptions // some options per type of Metric
    _component:string; // name of component that created this Metric
}

export interface MetricOptionsBase
{
    label: string
}

/** Options for TextMetric */
export interface TextMetricOptions extends MetricOptionsBase {
    label:string
    icon: string // materialdesign icon name
    color: any // TODO: typing
    pre: string // string before value
    unit: string // string after value
}

export type MetricOptions = TextMetricOptions // TODO more

/** Get data from table location  */
export interface TableLocation
{
    location: string // raw table location
    table: any // TMP DISABLED: Table, // for easy access to meta data like column names later
    column?: string // name of column
    row?:number // index of row
    data: any|Array<any>, // any data - format to be defined more clear
}

export interface CalcData
{
    tables: Object // { tablename: [{col, val}] }
    metrics: Object // { name : Metric, name2: Metric }
}

