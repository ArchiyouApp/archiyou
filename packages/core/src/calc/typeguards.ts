
import type { DataRowColumnValue, DataRowValues, 
    DataRowsColumnValue, DataRowsValues, MetricName, DataRows } from './types'

export function isDataRowColumnValue(o:any): o is DataRowColumnValue
{
    return typeof o === 'object'
        && Object.keys(o).every(k => typeof k === 'string')
        && Object.values(o).every(v => !v || (typeof v === 'string') || typeof v === 'number')
}

export function isDataRowValues(o:any): o is DataRowValues
{
    return (Array.isArray(o)) && o.every(v => (typeof v === 'string') || (typeof v === 'number'))
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
