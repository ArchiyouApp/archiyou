/** Library.ts
 *   Manages Scripts on disk (and memory), including caching
 * 
 *   - We save scripts in directory structure
 *      {env.LIBRARY_PATH}/{author}/{scriptname}/{version}/script.js
 *      NOTE: We save script data as a module for easy access to code within 
 *      (JSON does not do multiline). 
 * 
 *   - We cache results in
 *      {env.LIBRARY_PATH}/{author}/{scriptname}/{version}/cache/{variantId}/{pipeline}/{category:model|metrics|tables|docs}/?{entityname}/result{?formatoptions
 * 
 *   
 */

import * as fs from 'fs';
import * as path from 'path';

import semver from 'semver'; // for version validation
import { config as dotEnvConfig } from 'dotenv';

import { LibraryConnector } from '@archiyou/core/src/runner/LibraryConnector';
import { Script } from '@archiyou/core/src/Script';
import { ScriptOutputPath } from '@archiyou/core/src/execution/ScriptOutputPath';

import type { RunnerScriptExecutionResult,
    RunnerScriptExecutionRequest } from '@archiyou/core/src/runner/types';
import type { ScriptPublished } from '@archiyou/core/src/modeler/brep/types';
import type { ModelFormat,
    ScriptData,
    ScriptParamData,
    ScriptOutputData,
    ScriptOutputDataWrapper,
    ScriptOutputFormat,
} from '@archiyou/core/src/execution/types';

import { convertBinaryToBase64, restoreBinaryFromBase64,
    recordToUrlParams, urlParamsToRecord
 } from '@archiyou/core/src/utils'; // utils

import type  { CacheResult } from './types';
import { isJsonString } from './utils';


export class Library
{
    //// ATTRIBUTES ////
    private scriptsRoot: string;
    public url: string;

    /** Create Library instance
     *  @param libPath Optional path to scripts root folder. 
     *  If relative, it is resolved against the directory of main script.
     */
    constructor(libPath?:string)
    {
        // Load environment variables from .env file
        dotEnvConfig();
        this.url = process.env.LIBRARY_URL || 'http://localhost:4100';

        // Resolve relative paths to absolute paths based on current script directory
        this.scriptsRoot = (typeof libPath === 'string' && libPath.length > 0) ? libPath : process.env.LIBRARY_PATH;

        if (this.scriptsRoot && !path.isAbsolute(this.scriptsRoot))
        {
            const entryDir = process.cwd();
            this.scriptsRoot = path.resolve(entryDir, this.scriptsRoot);
        }
        
        if (!this.scriptsRoot)
        {
            throw new Error('Library root path is not defined in .env file. Please set LIBRARY_PATH.');
        }
        console.info(`🕮 Library initialized with scripts root: ${this.scriptsRoot}`);
    }

    //// MANAGING FROM DISK ////

    /**
     * Reads all scripts from the library directory structure
     * Directory structure: {author}/{script name}/{script version}/script.json
     * @returns Array of Script objects
     */
    async getAllScripts(): Promise<Script[]> 
    {
        const scripts: Script[] = [];
        
        try 
        {
            // Check if scripts root exists
            if (!fs.existsSync(this.scriptsRoot)) 
            {
                console.warn(`Scripts root directory does not exist: ${this.scriptsRoot}`);
                return scripts;
            }

            // Read author directories
            const authorDirs = fs.readdirSync(this.scriptsRoot, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            for (const author of authorDirs) 
            {
                const authorPath = path.join(this.scriptsRoot, author);
                
                // Read script name directories
                const scriptDirs = fs.readdirSync(authorPath, { withFileTypes: true })
                    .filter(dirent => dirent.isDirectory())
                    .map(dirent => dirent.name);

                for (const scriptName of scriptDirs) 
                {
                    const scriptPath = path.join(authorPath, scriptName);
                    
                    // Read version directories
                    const versionDirs = fs.readdirSync(scriptPath, { withFileTypes: true })
                        .filter(dirent => dirent.isDirectory())
                        .map(dirent => dirent.name);

                    if (versionDirs.length === 0)
                    {
                        console.warn(`Library::getAllScripts(): No versions found for script "${author}/${scriptName}" . Please add one!`);
                    }

                    for (const version of versionDirs) 
                    {
                        const versionPath = path.join(scriptPath, version);
                        const scriptJsPath = path.join(versionPath, 'script.js');

                        // Check if script.js exists
                        if (fs.existsSync(scriptJsPath)) 
                        {
                            try 
                            {
                                const scriptData = await this.loadScriptFromFile(scriptJsPath);
                                const script = Script.fromData(scriptData).setPublishedUrl(this.url); // ensure url is set
                                scripts.push(script);
                            } 
                            catch (error) 
                            {
                                console.error(`Failed to load script from ${scriptJsPath}:`, error);
                            }
                        } 
                        else 
                        {
                            console.warn(`script.js not found in ${versionPath}`);
                        }
                    }
                }
            }
        } 
        catch (error) 
        {
            console.error(`Error reading scripts from ${this.scriptsRoot}:`, error);
        }

        if (scripts.length === 0) { console.warn(`Library::getAllScripts(): No scripts found in Library with path "${this.scriptsRoot}"`); }

        return scripts;
    }

    /**
     * Loads script data from a script.js file
     * @param filePath Path to the script.js file
     * @returns ScriptData object
     */
    async loadScriptFromFile(filePath: string): Promise<ScriptData> 
    {
        if(filePath && fs.existsSync(filePath))
        {
            const scriptModule = await import(filePath);
            const scriptData: ScriptData = scriptModule.default;
            
            // Restore escaped ${...} in code
            scriptData.code = scriptData.code.replace(/\\\$\{/g, '${');
            // Restore escaped backticks in code
            scriptData.code = scriptData.code.replace(/\\`/g, '`');

            return scriptData;
        }
        else {
            throw new Error(`Library::loadScriptFromFile: Script file not found at path: ${filePath}`);
        }
    }

    /**
     * Gets all scripts for a specific author
     * @param author Author name
     * @returns Array of Script objects for the author
     */
    async getScriptsByAuthor(author: string): Promise<Script[]> 
    {
        const allScripts = await this.getAllScripts();
        return allScripts.filter(script => script.author === author.toLowerCase());
    }

    /**
     * Gets all versions of a specific script
     * @param author Author name
     * @param scriptName Script name
     * @returns Array of Script objects for all versions
     */
    async getScriptVersions(author: string, scriptName: string): Promise<Script[]> 
    {
        const allScripts = await this.getAllScripts();
        return allScripts.filter(script => 
            script.author === author.toLowerCase() && 
            script.name === scriptName.toLowerCase()
        ).sort((a, b) => semver.rcompare(a.version, b.version)); // sort, latest is first
    }

    /**
     * Gets a specific script version
     * @param author Author name
     * @param scriptName Script name
     * @param version Version string
     * @returns Script object or null if not found
     */
    async getScript(author: string, scriptName: string, version: string): Promise<Script | null> 
    {
        console.log('🔍 getScript called with:', { author, scriptName, version });
        const scriptPathDir = this._getScriptPath(author, scriptName, version);
        
        if (!scriptPathDir) 
        {
            console.log(`❌ Script file not found at path: "${author}/${scriptName}"`);
            return null;
        }

        try 
        {
            const scriptPath = path.join(scriptPathDir, 'script.js');
            const scriptData = await this.loadScriptFromFile(scriptPath);
            const script = Script.fromData(scriptData).setPublishedUrl(this.url); // ensure url is set
            return script;
        } 
        catch (error) 
        {
            console.error(`Failed to load script ${author}/${scriptName}@${version}:`, error);
            return null;
        }
    }

    /** Get script by external path {author}/{scriptName}:{version} */
    async getScriptByPath(path:string): Promise<Script | null>
    {
        const match = path.match(/^([^\/]+)\/([^:]+):(.+)$/);
        if (!match) {
            console.error(`Invalid script path format: "${path}"`);
            return null;
        }
        const [, author, scriptName, version] = match;
        return this.getScript(author, scriptName, version);
    }

    //// MORE ADVANCED SCRIPT MANAGEMENT ////

    async getLatestScriptVersion(author: string, scriptName: string): Promise<Script | null>
    {
        const scripts = await this.getScriptVersions(author, scriptName);
        if (scripts.length === 0) { console.warn(`No versions found for script ${author}/${scriptName}`); return null;}
        return scripts.sort((a, b) => semver.rcompare(a.version, b.version))[0]; // Latest version first (reverse compare)
    }

    //// WRITING SCRIPTS TO DISK ////


    

    /** Save script data to disk as JS data module for easy editing */
    async saveScript(script: Script): Promise<Script>
    {
        try 
        {
            // Save script to disk as JS module
            const scriptPath = path.join(this.scriptsRoot, script.author.toLowerCase(), script.name.toLowerCase(), script.version, 'script.js');
            const dir = path.dirname(scriptPath);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(scriptPath, script.toModuleString());
            console.info(`Library::saveScript(): 🗎 Script "${script.author}/${script.name}@${script.version}" saved to ${scriptPath}`);
            return script;
        }
        catch (error) 
        {
            console.error(`Failed to save script ${script.author}/${script.name}@${script.version}:`, error);
        }
    }
    
    /**
     * Saves script data to disk
     * @param scriptData ScriptData object to save
     */
    async saveScriptData(scriptData: ScriptData): Promise<void>
    {
        const script = Script.fromData(scriptData).setPublishedUrl(this.url);
        if (!script.isValid()){ throw new Error(`Invalid script data: ${JSON.stringify(scriptData)}`); }
        await this.saveScript(script);
    }

    //// RESULT CACHING ////
    /*  
        The library manages both scripts as results in the filestructure 
        
        The main structure is {env.LIBRARY_PATH}/{author}/{scriptname}/{version}/script.json

        Caching uses this base path and adds a directory ./cache
        which uses the output paths (and format parameters):

        .../cache/{variantId}/{pipeline}/{category:model|metrics|tables|docs}/?{entityname}/result{?formatoptions}.{format}

        For example:
        default/model/glb?data=true ==> .../cache/XXXX/default/model/result?data=true.glb
    */
    //  default/tables/*/xls ==>  .../cache/XXXX/default/tables/spec/result.xls
    /*                            .../cache/XXXX/default/tables/parts/result.xls

        It is actually quite easy to use the result objects 
        QueueTaskResult
            ↳ .result:RunnerScriptExecutionResult
                    ↳ .outputs:Array<ScriptOutputData>

        to output to cache, because everything is organized by output result        
    
    */

    async _getScriptVariantId(req:RunnerScriptExecutionRequest):Promise<string|null>
    {
        // Get Script variant id
        const script = Script.fromData(req.script);
        const scriptVariantId = await script.getVariantId(req.params);
        if(!scriptVariantId){ return scriptVariantId }

        /*  The kernel is part of the cache identity: the same script and params built by the
            mesh and BREP kernels are different geometry (different tessellation, different
            output bytes). Without this they would overwrite each other in the result cache.
            'mesh' is left unsuffixed so every already-cached result stays valid. */
        const kernel = req.kernel ?? 'mesh';
        return (kernel === 'mesh') ? scriptVariantId : `${scriptVariantId}-${kernel}`;
    }

    /**
     * Writes the result cache for a given RunnerScriptExecutionResult
     * @param r The RunnerScriptExecutionResult to cache
     */
    async writeResultCache(r:RunnerScriptExecutionResult):Promise<boolean>
    {
        const pathElems = [r?.request?.script?.author, 
                           r?.request?.script?.name, 
                           r?.request?.script?.version];
        const scriptDir = this._getScriptPath(pathElems[0], pathElems[1], pathElems[2], true);

        if (!scriptDir)
        { 
            console.error(`Library::writeResultCache(): Script directory not found for result cache write: ${(pathElems).join('/')}`); 
            return false; 
        }
        
        // Setup cache path
        const cacheDir = path.join(scriptDir, 'cache');
        fs.mkdirSync(cacheDir, { recursive: true });

        const scriptVariantId = await this._getScriptVariantId(r.request);

        if(!scriptVariantId){ console.error(`Library::writeResultCache: Could not get variant id!`);return false; }

        // Save per pipeline
        r.outputs.forEach((o) => 
        {
            /* output o - ScriptOutputData 
                has {
                    path: ScriptOutputPathData;
                    output: ScriptOutputDataWrapper
                }
            */
            const curOutput = o as ScriptOutputData;
           

            console.info(`Library::writeResultCache(): Caching result for output: ${curOutput.path.resolvedPath} and variant id "${scriptVariantId}"`);
            
            const curOutputPath = new ScriptOutputPath().fromData(o.path);
                    
            // directory without the file - {cacheDir}/{scriptVariantId}/{pipeline}/{category}/?{entityName}/
            const dir = path.join(cacheDir, scriptVariantId, curOutputPath.toCacheFilePath('dir')); 

            // Prepare directorylibPath
            console.log(`Library::writeResultCache(): Writing pipeline result to cache directory: "${dir}"`);
            fs.mkdirSync(dir, { recursive: true });
            
            // Formulate filename from output path instance
            // example: result?data=true.glb
            const fileName = curOutputPath.toCacheFilePath('filename');
            const filePath = path.join(dir, fileName)
            const dataWrapped = curOutput.output as ScriptOutputDataWrapper; 
                    
            // First check base64 encoding
            if (dataWrapped.encoding === 'base64')
            {
                console.info(`Library::writeResultCache(): Writing binary data (${dataWrapped?.type}) to cache from base64 at "${filePath}"`);
                const binaryData = restoreBinaryFromBase64(dataWrapped);
                fs.writeFileSync(filePath,
                    (binaryData instanceof Buffer) ? binaryData : Buffer.from(binaryData as any)); // Avoid TS error
            }
            else if (typeof dataWrapped.data === 'string') // text data
            {
                fs.writeFileSync(filePath, dataWrapped.data);
            } 
            else if(typeof dataWrapped.data === 'object') // a raw object
            {
                fs.writeFileSync(filePath, JSON.stringify(dataWrapped.data));
            }
            else 
            {
                console.error(`Library::writeResultCache(): Unsupported data type for caching: ${typeof dataWrapped.data}: ${JSON.stringify(dataWrapped.data)}`);
            }

        });
    }

    /** Check if there are cached results for the given request 
     *  For ease of use return a CacheResult with:
     *  - outputsInCache: The outputs that are in cache - easy to remove from request
     *  - cachedResults: The cached results per pipeline
    */
    async checkRequestInCache(request: RunnerScriptExecutionRequest):Promise<CacheResult|null>
    {
        const scriptDir = this._getScriptPath(request?.script?.author, 
                                            request?.script?.name, 
                                            request?.script?.version);
        if (!scriptDir) {
            console.warn(`Library::checkRequestInCache(): Script directory not found for request: ${JSON.stringify(request)}`);
            return null;
        }

        const scriptVariantId = await this._getScriptVariantId(request);

        if(!scriptVariantId){ console.error(`Library::checkRequestInCache: Could not get variant id!`);return null; }

        // Check for cached results on disk.
        const cacheDir = path.join(scriptDir, 'cache', scriptVariantId);

        console.info(`Library::checkRequestInCache(): Checking cache directory: "${cacheDir}"`);

        if (!fs.existsSync(cacheDir)) { fs.mkdirSync(cacheDir, { recursive: true });}
        const filePathsInCache = this.getAllFiles(cacheDir)
                                    .map(fp => fp.replace(cacheDir + '/', '')) // Remove scriptDir from path

        const scriptOutputPathsInCache = filePathsInCache.map((fp) => new ScriptOutputPath().fromCacheFilePath(fp));

        // NO CACHING WITH WILDCARDS: 
        //    like: ['default/metrics/*/json'] we don't use caching. A wildcard signifies "anything comes out of it"
        //    so to let the arbitrary cache entries determine this outcome is probably not what we want here
        const requestedOutputPathsCached = scriptOutputPathsInCache.filter(co => request.outputs.includes(co.resolvedPath)) as Array<ScriptOutputPath>;

        if (requestedOutputPathsCached.length === 0) 
        {
            console.info(`Library::checkRequestInCache(): No requested outputs found in cache for request with script: ${request.script.name} [variant id "${scriptVariantId}"`);
            return null;
        }
        else 
        {
            // We got the full cached output paths - no set data
            console.info(`Library::checkRequestInCache(): Found ${requestedOutputPathsCached.length} requested outputs in cache: "${requestedOutputPathsCached.map(p => p.resolvedPath).join(', ')}"`); 

            const cachedOutputs = requestedOutputPathsCached.map((outputPath) => 
            {
                // outputPath (instance of ScriptOutputPath) has already all info to get data
                
                // Convert data to base64 
                const filePath = path.join(cacheDir, outputPath.toCacheFilePath('full'));
                const data = fs.readFileSync(filePath); // load data file
                const start = performance.now();
                const dataOutput = (typeof data === 'string') 
                                        ? (isJsonString(data) ? JSON.parse(data) : data)
                                        : convertBinaryToBase64(data);
                                        
                console.info(`Library::checkRequestInCache(): Getting data from data at path "${filePath}": Took ${performance.now() - start}ms`);
                return {
                    path: outputPath.toData(),
                    output: dataOutput,
                } as ScriptOutputData;

            })

            return {
                outputsInCache: requestedOutputPathsCached.map(o => o.resolvedPath),
                cachedResults: cachedOutputs.filter(o => o !== null)
            };
        }
    }


    ///// MIGRATION FROM OTHER LIBRARIES ////
    /*
        We got two versions of the Archiyou publish library
    
        1. The Python version
        2. This new one in JS/TS

        The below methods can migrate scripts from both to the current

    */

    async connectToOtherLibrary(url?:string):Promise<LibraryConnector>
    {
        if(!url){ throw new Error(`Library::connectToOtherLibrary(): Please supply url!`); }
        console.info(`Library::connectToOtherLibrary(): 🕮 Connecting to other library at "${url}"`);
        const lib = new LibraryConnector(url);
        if(!(await lib.connect()))
        {
            throw new Error(`Library::connectToOtherLibrary(): Failed to connect to other library at "${url}"`);
        }

        return lib;
    }

    async _handleMigrateScriptFromOtherLibrary(otherLib:LibraryConnector, incomingScriptObj: Record<string, any>, overwrite:boolean=false):Promise<Script|null>
    {
        
        // some sanity checks
        if(!incomingScriptObj || typeof incomingScriptObj !== 'object')
        {
            console.warn(`Library::migrateFromOtherLibrary(): Invalid incoming script: ${JSON.stringify(incomingScriptObj)}`);
            return null;
        }

        // Check if script already exists in current library
        const incomingVersion = incomingScriptObj.version ?? incomingScriptObj.published?.version; // new format: version is top-level; fall back to legacy published.version
        const existingScript = await this.getScript(incomingScriptObj.author, incomingScriptObj.name, incomingVersion);
        if(!overwrite && existingScript)
        {
            console.info(`Library::migrateFromOtherLibrary(): Script "${incomingScriptObj.name}" [v${incomingVersion}] already exists in current library. Set flag overwrite=true to force.`);
            return null;
        }
        else 
        {
            if(existingScript){ console.warn(`Library::migrateFromOtherLibrary(): Overwriting Script "${incomingScriptObj.name}" [v${incomingVersion}]. Set overwrite=false to avoid.`); }
            // Migrate (old)script to current library
            try 
            { 
                const migratedScript = (otherLib.version === 'v2') 
                                ? Script.fromData(incomingScriptObj as ScriptData).setPublishedUrl(this.url)
                                : this._transformOldScript(incomingScriptObj);

                // Set url of current library
                migratedScript.setPublishedUrl(this.url);

                console.info(`Library::migrateFromOtherLibrary(): Migrating Script "${migratedScript.author}/${migratedScript.name}" [v${migratedScript.version}]...`);
                return await this.saveScript(migratedScript);
            }
            catch (error)
            {
                console.error(`Library::migrateFromOtherLibrary(): Failed to migrate script "${incomingScriptObj.name}" [v${incomingVersion}]: ${error.message}`);
                return null;
            }
        }
    }

    async migrateScriptFromOtherLibrary(otherLib:LibraryConnector, author:string, scriptName:string, version?:string, overwrite:boolean=false):Promise<Script|null>
    {
        let incomingScriptObj: Record<string,any>|null = null;

        if(version) // specific version
        {
            incomingScriptObj = await otherLib.getScript(author, scriptName, version) as Record<string,any>;
            if(!incomingScriptObj)
            {
                console.warn(`Library::migrateFromOtherLibrary(): Script "${author}/${scriptName}" [v${version}] not found in other library.`);
                return null;
            }
        }
        else // latest version
        {
            incomingScriptObj = await otherLib.getLatestScript(author, scriptName) as Record<string,any>;
            if(!incomingScriptObj)
            {
                console.warn(`Library::migrateFromOtherLibrary(): No versions found for script "${author}/${scriptName}" in other library.`);
                return null;
            }
        }

        return await this._handleMigrateScriptFromOtherLibrary(otherLib, incomingScriptObj, overwrite);
    }

    async migrateScriptsFromOtherLibrary(otherLib:LibraryConnector, author?:string, latestVersion:boolean=false, overwrite:boolean=false):Promise<Array<Script>>
    {
        let incomingScripts = ((await otherLib.getAllScripts())
                                    .filter(s => !author || s.author.toLowerCase() === author.toLowerCase())
                                ) as Array<Record<string,any>>; // use abstract classed here because we don't really know what we get

        // Only do latest version
        if(latestVersion)
        {
            const latestScripts = (await otherLib.getLatestScripts());
            incomingScripts = incomingScripts
                .filter(s => latestScripts.find(ls => ls.author === s.author 
                    && ls.name === s.name && ls.version === (s.version ?? s.published?.version)));
        }

        const migratedScripts = [];
        for(let s = 0; s < incomingScripts.length; s++)
        {
            const incomingScriptObj = incomingScripts[s];
            console.info(`Library::migrateFromOtherLibrary(): 🗎 Found script "${incomingScriptObj.author}/${incomingScriptObj.name}" [v${incomingScriptObj.version}] in other library.`);

            const handledScript = await this._handleMigrateScriptFromOtherLibrary(otherLib, incomingScriptObj, overwrite);
            if(handledScript){ migratedScripts.push(handledScript); }
        }

        return migratedScripts; // filter out null results
    }

    /** Transform older format script 
     * 
     *  Older script, called PublishScript structure:
     *  { id, name, title, author, org, url, description, created_at, updated_at,
     *      version, prev_version, safe, published, units, params<Record<string, PublishParam>>,
     *      param_presets, public_code, public_code_url, code, 
     *      cad_engine, cad_engine_version, cad_engine_config, meta
     *   }
     *  
     *   new structure of Script see Script.ts/ScriptData
     *  
    */
    _transformOldScript(script: Record<string,any>):Script
    {
        // PublishScript is seperate from Script, now its together
        const newScript = Script.fromData({
            id: script.id,
            author: script?.author,
            name: script.name,
            // title is part of published
            code: script.code,
            params: (typeof script.params === 'object') 
                    ? Object.entries(script.params).reduce((acc, [key, value]) => 
                    {
                            acc[key] = this._transformOldParam(value);
                            return acc;
                    }, {} as Record<string, ScriptParamData>) : {},
            description: script.description,
            created: script.created_at,
            updated: script.updated_at,
            version: script.version, // version is now top-level (shared by published + shared)

            published: (!script.published) ? null : // check if published
            {
                url: script.public_code_url,
                title: script.title,
                public: script.public_code,
                published: script.created_at,
                description: script.description,
                params: script.params,
                presets: script.param_presets,
            } as ScriptPublished,
        })

        // For now, make override params in published.params the same as original ones.
        // Serialize them: Script.fromData() hydrates `params` into ScriptParam
        // *instances*, whereas published.params is plain ScriptParamData. Assigning
        // the instances directly put internal fields (_value, _behaviours,
        // _definedProgrammatically) into the published payload, which toData()
        // exists to strip.
        if (newScript.published)
        {
            newScript.published.params = Object.fromEntries(
                Object.entries(newScript.params ?? {}).map(([key, param]) => [key, param.toData()]),
            );
        }
        return newScript;
    }

    /** Transform from old param structure */
    _transformOldParam(param: Record<string, any>): ScriptParamData
    {
        return {
            id: param.id,
            type: param.type,
            name: param.name,
            enabled: param.enabled,
            visible: param.visible,
            label: param.label,
            default: param.default,
            min: param.start, // changed
            max: param.end, // changed
            step: param.step,
            options: param.options,
            length: param.length,
            listElem: param.listElem,
            schema: param.schema,
            units: param.units,
            order: param.order,
            iterable: param.iterable,
            description: param.description,
        } as ScriptParamData; // cast: transforms legacy param shape (extra fields like id/min/max dropped by validation)
    }

    //// UTILS ////


    /** Get path to script (including version), being robust to casing issues
     *  Returns false if not found
     *
     *  `create` makes the author/script directories when they are absent, instead of
     *  reporting "not found". Only writeResultCache passes it, and it has to: this
     *  tree used to be created as a side effect of the library storing scripts on
     *  disk, but scripts live in the database now, so for a script that has never been
     *  run on this box nothing here exists yet. Without it the first run of every script
     *  fails to cache, and — before the existsSync guard below — the first run failed
     *  outright with ENOENT from readdirSync.
     */
    _getScriptPath(author: string, scriptName: string, version: string, create = false):string|false
    {
        const scriptNameDir = path.join(this.scriptsRoot, author.toLowerCase());

        if (!fs.existsSync(scriptNameDir))
        {
            // A script nobody has executed on this instance yet. That is a cache MISS,
            // not an error — the callers all treat `false` that way.
            if (!create) return false;
            fs.mkdirSync(scriptNameDir, { recursive: true });
        }

        const scriptDir = fs.readdirSync(scriptNameDir).find(dir => dir.toLowerCase() === scriptName.toLowerCase());
        if (!scriptDir)
        {
            if (!create) return false;
            // First write for this script: take the name as given. Later reads match
            // case-insensitively, so the casing chosen here does not have to be exact.
            fs.mkdirSync(path.join(scriptNameDir, scriptName), { recursive: true });
            return path.join(scriptNameDir, scriptName, version);
        }
        return path.join(scriptNameDir, scriptDir, version);
    }


    /** Recursively get all files in a directory */                            
    getAllFiles(dir: string): string[] 
    {
        return fs.readdirSync(dir, { withFileTypes: true })
        .flatMap(entry => 
        {
            const fullPath = path.join(dir, entry.name);
            return entry.isDirectory() ? this.getAllFiles(fullPath) : [fullPath];
        });
    }

    /**
     * Detects if a string is valid JSON
     * @param str The string to test
     * @returns true if the string is valid JSON, false otherwise
     */
    isJsonString(str: string): boolean {
        if (typeof str !== 'string') {
            return false;
        }
        
        // Quick check for obviously non-JSON strings
        const trimmed = str.trim();
        if (!trimmed || (
            !trimmed.startsWith('{') && 
            !trimmed.startsWith('[') && 
            !trimmed.startsWith('"') &&
            trimmed !== 'true' &&
            trimmed !== 'false' &&
            trimmed !== 'null' &&
            !(/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed))
        )) {
            return false;
        }

        try {
            JSON.parse(str);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Safely parses a JSON string, returns null if invalid
     * @param str The string to parse
     * @returns Parsed object or null if invalid JSON
     */
    safeJsonParse(str: string): any | null {
        if (!this.isJsonString(str)) {
            return null;
        }
        
        try {
            return JSON.parse(str);
        } catch {
            return null;
        }
    }

    

}

