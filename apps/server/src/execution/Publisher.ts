/**
 *  Publisher.ts
 *     Handles publishing of scripts to the library
 *     This involves:
 *          - validation of basic script attributes
 *          - checking if script already exists in the Library 
 *          - test running the script to get information and ensure it works
 *          - writing the script to disk in the correct structure using the Library class
 *          - [optional] pre-computing ranges of the script parameters
 * 
 */

import { Library } from './Library';
import { Script } from '@archiyou/core/src/Script';

import type { ScriptData } from '@archiyou/core/src/execution/types';

export class Publisher
{
    library:Library

    constructor()
    {
        this.library = new Library();
    }

    /**
     * Publishes a script to the library
     * @param scriptData The script data to publish
     * @returns Promise resolving to the published script data once it is finally put in the library
     * 
     */
    async publish(scriptData?: ScriptData): Promise<Script>
    {
        if(!scriptData) throw new Error("Publisher.publish(): No script data provided");

        // 1. Validate the script data
        const script = Script.fromData(scriptData);
        if (!script || !script.isValid())
        {
            throw new Error("Publisher.publish(): Script validation failed");
        }

        // 2. Check if script already exists in Library, possibly manage versions
        const latestScriptInLibrary = await this.library.getLatestScriptVersion(scriptData.author, scriptData.name);
        if (latestScriptInLibrary)
        {
           console.log(`Publisher.publish(): Script ${scriptData.author}/${scriptData.name} already exists in the library with version ${latestScriptInLibrary.version}`);
        }

        // TODO: original archiyou-server left publish() incomplete here (no return).
        return script;
    }

}