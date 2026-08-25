/** Abstraction over native console
 *  To create extra categories and capture messages in WebWorker or Compute Worker
 */

// import JSONfn from 'json-fn'; // TODO: AFTER REFACTOR

import type { ConsoleMessage, ConsoleMessageType } from './types'
import { stringifyArgs, stringifyValue } from './stringify'

/** The real environment console, captured at import time - before any execution scope
 *  swaps globalThis.console for an Archiyou Console. Every Console echoes debug output
 *  here directly, so instances never reference each other through globalThis. */
export const NATIVE_CONSOLE = globalThis.console;

export class Console
{
    //// SETTINGS ////
    USE_COLORS = true; // use colors in console output
    ENDING_COLOR = '\x1b[0m'; // reset color code
    TYPE_TO_COLOR_CODE = { 
        info: '\x1b[32m', // green
        exec: '\x1b[34m', // blue
        geom: '\x1b[36m', // cyan
        warn: '\x1b[38;5;214m', // yellow
        error: '\x1b[33m', // red
        user: '\x1b[35m', // magenta
        debug: '\x1b[90m', // gray
    } as Record<ConsoleMessageType, string>;
    
    //// END SETTINGS ////

    output = null; // Vuex store, console, webworker instance or a local array [ null ]
    buffer:Array<ConsoleMessage> = []; // If we cannot output somewhere put in buffer
    _originalConsole = null // avoid circular references
    _parent:Console = null; // console of the enclosing scope, if any (see setParent)

    constructor(output:any)
    {
        this.connect(output);
        this.info(`**** INIT AY CONSOLE - MODE: ${this._getOutputType()} ****`);
        // this.component = curScope.prototype.name;
    }

    /** Binds either to Vuex store, WebWorker, direct console or an internal array */
    connect(output:any = null)
    {
        // IMPORTANT: bind the native console, never globalThis.console - a running scope has
        // replaced that with its own Console, which would make instances chain into each other.
        this._originalConsole = NATIVE_CONSOLE;
        this.output = output;
    }

    /** Aggregate this scope's messages into the enclosing scope's Console.
     *  Lets a component's output surface in the parent script's console, since the
     *  component's own buffer is never read out. */
    setParent(parent:Console = null)
    {
        this._parent = (parent !== this) ? parent : null;
    }

    /** Reset the Console, removing all previous messages */
    reset()
    {
        switch(this._getOutputType())
        {
            case 'store':
                this.output.commit('clearConsoleMessages');
                break;
            case 'buffer':
                this.buffer = [];
                break;
        }
    }

    _getOutputType():string
    {
        if( this.output.hasOwnProperty('commit'))
        {
            return 'store';
        }
        else if (this.output.hasOwnProperty('assert'))
        {
            return 'console';
        }
        else if (this.output.hasOwnProperty('postMessage'))
        {
            return 'webworker'
        }
        else
        {
            // internal storage of messages
            return 'buffer';
        }
    }

    /** pass the message allong */
    sendMessage(message:ConsoleMessage)
    {
        this._deliver(message);
        this._parent?.forward(message);
    }

    /** Take on a message from a nested scope's Console. The originating Console already
     *  echoed it to the native console, so only record it here. */
    forward(message:ConsoleMessage)
    {
        this._deliver(message, false);
        this._parent?.forward(message);
    }

    _deliver(message:ConsoleMessage, echoToNative:boolean=true)
    {
        // directly output to console
        const MESSAGE_TO_CONSOLE_TYPE = {
            info : 'info',
            geom : 'info',
            user : 'warn',
            warn : 'warn',
            error : 'error',
            exec : 'info',
        }

        switch(this._getOutputType())
        {
            case 'store':
                this.output.commit('pushConsoleMessage', message);
                break;

            case 'console':
                if(!echoToNative) break; // this output *is* the native echo
                let origConsoleFunc = MESSAGE_TO_CONSOLE_TYPE[message.type] || 'log';
                try {
                    this._originalConsole[origConsoleFunc](this._wrapMessageStringWithColor(message)); // IMPORTANT: don't use output here, because it can lead to unending loops
                }
                catch(e)
                {
                    NATIVE_CONSOLE.error(`Console::sendMessage: Could not output data: ${message.message}: ${e}`);
                }
                break;

            case 'webworker':
                this.output.postMessage({ type : 'console', payload : {  message : message }});
                break;

            default: // put in buffer
                this.buffer.push(message);
                if(echoToNative)
                {
                    this._originalConsole[MESSAGE_TO_CONSOLE_TYPE[message.type] || 'log'](this._wrapMessageStringWithColor(message)); // also put into normal console for debug
                }
        }
    }

    _wrapMessageStringWithColor(message:ConsoleMessage):string
    {
        if (!this.USE_COLORS) return message.message; // no colors
        const colorCode = this.TYPE_TO_COLOR_CODE[message.type] || '\x1b[0m'; // default color code
        return `${colorCode}${message.message}${this.ENDING_COLOR}`; // wrap with color codes
    }

    /** Turn the arguments into one message string and send it on.
     *  A ConsoleMessage always carries a string: every output target (store, webworker
     *  postMessage, colored native echo) either serializes or interpolates it anyway,
     *  which is where objects used to degrade into '[object Object]'. */
    newMessage(type:ConsoleMessageType, ...messages:Array<any>)
    {
        const msgStr = (messages.length === 1 && typeof messages[0] === 'string')
                            ? messages[0]
                            : stringifyArgs(messages);

        let newMessage:ConsoleMessage = { type: type, time : this._currentTime() , from: null, message : msgStr  };
        this.sendMessage(newMessage);
    }

    /** Readable string for any value: `{ width: 10, height: 100 }`, a Shape's own
     *  toString(), `[Circular]`, `[Function: f]`, ... - see console/stringify.ts */
    stringifyMessage(message:any):string
    {
        return stringifyValue(message);
    }

    info(...messages:Array<any>)
    {
        this.newMessage('info', ...messages);
    }

    log(...messages:Array<any>)
    {
        this.newMessage('info', ...messages);
    }

    /** Make a user message */
    user(...messages:Array<any>)
    {
        this.newMessage('user', ...messages);
    }

    /** log an error */
    error(...messages:Array<any>)
    {
        this.newMessage('error', ...messages);
    }

    warn(...messages:Array<any>)
    {
        this.newMessage('warn', ...messages);
    }

    /** Creation of geometry */
    geom(...messages:Array<any>)
    {
        this.newMessage('geom', ...messages);
    }

    /** Messages about statement execution */
    exec(...messages:Array<any>)
    {
        this.newMessage('exec', ...messages);
    }

    _currentTime()
    {
        let t = new Date();
        return `${t.toLocaleTimeString()}.${t.getMilliseconds()}`;
    }

    getBufferedMessages(types:Array<ConsoleMessageType>=undefined):Array<ConsoleMessage>
    {
        types = (Array.isArray(types) ? 
                    (types.length > 0) ? types : undefined 
                    : undefined)
        return (!types) ? this.buffer
                    : this.buffer.filter(m => types.includes(m.type))
    }

    getErrors():Array<ConsoleMessage>
    {
        return this?.buffer?.filter(m => m.type === 'error') || [];
    }
}