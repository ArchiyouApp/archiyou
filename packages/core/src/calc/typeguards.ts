
import type { DataRowColumnValue, DataRowValues, 
    DataRowsColumnValue, DataRowsValues, MetricName, DataRows, TableStyle } from './types'

export function isDataRowColumnValue(o:any): o is DataRowColumnValue
{
    return typeof o === 'object'
        && Object.keys(o).every(k => typeof k === 'string')
        && Object.values(o).every(v => !v || (typeof v === 'string') || typeof v === 'number' || typeof v === 'boolean')
}

export function isDataRowValues(o:any): o is DataRowValues
{
    return (Array.isArray(o)) && o.every(v => (typeof v === 'string') || (typeof v === 'number') || (typeof v === 'boolean'))
}

export function isDataRowsColumnValue(o:any): o is DataRowsColumnValue
{
    return Array.isArray(o) 
        && o.every(rcv => isDataRowColumnValue(rcv))
}

export function isDataRowsValues(o:any): o is DataRowsValues
{
    return Array.isArray(o) 
        && o.every(rcv => isDataRowValues(rcv))
}

/*
export function isMetricName(o:any): o is MetricName
{
    return METRICS.includes(o);
}
*/

export function isDataRows(o:any): o is DataRows
{
    return Array.isArray(o) && o.every(r => typeof r === 'object')
}

export function isTableStyle(o:any): o is TableStyle
{
    return !!o && typeof o === 'object' && !Array.isArray(o)
        && Object.keys(o).every(k => ['header','columns','cells','locale'].includes(k))
        && (o.header === undefined || typeof o.header === 'object')
        && (o.columns === undefined || typeof o.columns === 'object')
        && (o.cells === undefined || Array.isArray(o.cells))
        && (o.locale === undefined || typeof o.locale === 'string')
}
