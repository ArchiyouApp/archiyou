
export type ConsoleMessageType = 'info'|'geom'|'user'|'warn'|'error'|'exec'

/** A console Message */
export interface ConsoleMessage
{
    type: ConsoleMessageType,
    time: string,
    from: string, // component
    message: string,
}