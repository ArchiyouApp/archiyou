/**
 * CodeParser: 
 *      Parses code and uses information to give the user increasingly refined feedback on his code     
 *      !!!! Copy from App - TODO: clean up app part and use this one !!!!
 */

import type { ScriptStatement } from './types'
// import { BREP_METHODS_INTO_GLOBAL } from './internal' // TODO AFTER REFACTOR
import { Parser, Options, Node } from 'acorn'
import findGlobals from 'acorn-globals'
import { ScriptData, ScriptImportStatement } from './types'

// import { IO } from './IO'


interface PreStats
{
    numStatements: number;
}

interface ScriptStatementFilter
{
    pattern:string; // just a simple str
}


export class CodeParser
{   
    //// SETTINGS ////
    ACORN_OPTIONS:Options = {
        ecmaVersion: 'latest',
        locations: true,
        sourceType: 'script',
        allowAwaitOutsideFunction: true, // scripts use top-level await
    }
    
    IMPORT_RE = /\$import\((\'|\")([^\'\"]+)\'[\s]*,[\s]*(\{[^\}]+\})/ 
    LOAD_RE = /\$load\((\'|\")([^\'\"]+)(\"|\')\)/;
    DOC_RE = /docs\s*\./;


    /* NOTES ON REGEX (TODO): 
        - will break in objects as param values { param: { x:1, y:2}}
        - will break with strings in params
    */

    //// PROPERTIES ////
    config:any = {}; // { endpoint_shared_scripts : url }
    code:string = null;
    io:any = null; // TODO: AFTER REFACTOR 
    tree:any; // TODO: acorn typing
    statements:Array<ScriptStatement> = []; // seperated ScriptStatements
    importStatements:Array<ScriptImportStatement> = []; // reference to ScriptStatements that are importStatements
    prestats:PreStats = null;
    importedScriptCache:{[key:string]:ScriptData} = {}; // { file_name : ScriptVersion }
    importedScriptQueue:Array<ScriptImportStatement> = []; // queue when loading import scripts

    constructor(code:string, config: any, io:any) // TODO: TS typing - AFTER REFACTOR
    {
        this.code = code;
        this.config = config;
        this.io = io;
        this.parse();
    }

    update(code:string, config:any = null)
    {
        this.code = code;
        this.config = (!config) ? this.config : config;
        this.parse();
    }

    /** Split as best as possible into seperate ScriptStatements to be executed */
    parse()
    {
        try {
            this.tree = Parser.parse(this.code, this.ACORN_OPTIONS)
            this.makeStatements();
            this.filterStatements();
        }
        catch(e)
        {
            // move Error up to GeomWorker
            throw new Error(`${e}`);
        }

    }

    /** Create ScriptStatements from AST tree.
     *
     *  Statements execute one-by-one inside the Runner's `with(scope)` Proxy, which lets us
     *  omit var/let/const so assignments land as scope variables. So we AST-rewrite each
     *  top-level statement:
     *   - VariableDeclaration: strip the leading let/var/const keyword. Only the *leading*
     *     keyword of a top-level node is removed, so string literals and nested declarations
     *     (inside function/arrow bodies) are untouched — unlike the old regex pass.
     *   - Function/ClassDeclaration: rewrite to a named assignment (`foo = function foo(){…}`)
     *     so it becomes a scope variable. The name is kept for readable stack traces.
     *
     *  Because those declarations become plain assignments they no longer hoist, so a helper
     *  called before its definition would break in statement mode while working whole-script.
     *  To keep the two modes equivalent we emit the rewritten function/class statements first
     *  (in source order), then the rest (in source order).
     */
    makeStatements():Array<ScriptStatement>
    {
        const EXCLUDE_NODE_TYPES = ['EmptyStatement'];

        const hoisted:Array<ScriptStatement> = []; // function/class declarations, emitted first
        const rest:Array<ScriptStatement> = [];

        this.tree.body.forEach(
            node =>
            {
                // We have a valid ScriptStatement Node
                if(!EXCLUDE_NODE_TYPES.includes(node.type))
                {
                    const isHoisted = (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration');
                    const statement:ScriptStatement = {
                        startIndex: node.start,
                        endIndex: node.end,
                        lineStart: node.loc.start.line,
                        lineEnd: node.loc.end.line,
                        columnStartIndex: node.loc.start.column,
                        columnEndIndex: node.loc.end.column,
                        code: this._rewriteTopLevelNode(node)
                       }
                    ;(isHoisted ? hoisted : rest).push(statement)
                }
            }
        )

        this.statements = [...hoisted, ...rest];

        return this.statements;
    }

    /** Rewrite a top-level AST node into scope-friendly code (see makeStatements). */
    _rewriteTopLevelNode(node:Node):string
    {
        const raw = this.getCodeOfNode(node);

        if(node.type === 'VariableDeclaration')
        {
            // Strip only the leading keyword by cutting at the first declarator.
            const decl = (node as any).declarations?.[0];
            if(!decl){ return raw; }
            const inner = this.code.substring(decl.start, node.end); // e.g. 'x = 5;' or '{a,b} = obj;'
            // A bare destructuring assignment (`{a,b} = obj`) parses as a block at statement
            // start, so wrap it in parentheses. Trailing ';' is moved outside the parens.
            const idType = decl.id?.type;
            if(idType === 'ObjectPattern' || idType === 'ArrayPattern')
            {
                const body = inner.replace(/;\s*$/, '');
                return `(${body});`;
            }
            return inner;
        }
        else if(node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration')
        {
            const name = (node as any).id?.name;
            if(!name){ return raw; } // anonymous default export etc — leave as-is
            // `function foo(){…}` -> `foo = function foo(){…}` (named expr keeps stack-trace name)
            return `${name} = ${raw}`;
        }

        return raw;
    }
    
    
    getGlobalVars():Array<string>
    {
        // NOTE: the acorn-globals if a bit weird, correct some things
        const SKIP_GLOBALS = ['Array', 'Math']
        const ARCHIYOU_MODULES = ['doc', 'geom', 'calc', 'make', 'beams']
        
        const globalFuncsLowerCase = []; // BREP_METHODS_INTO_GLOBAL.map(f => f.toLowerCase())

        return findGlobals(this.code).map(r => r.name)
                    .filter(g => !globalFuncsLowerCase.includes(g.toLowerCase()))
                    .filter(g => g.charAt(0) !== '$') // don't do params
                    .filter(g => !ARCHIYOU_MODULES.includes(g) && !SKIP_GLOBALS.includes(g))
    }
    

    getCodeOfNode(node:Node):string
    {
        if (node)
        {
            return this.code.substring(node.start, node.end);
        }
    }
    
    /** Filter ScriptStatement on a given filters */
    filterStatements()
    {
        const FILTERS:Array<ScriptStatementFilter> = [
            // { pattern: '\n', operation: (statement) => ScriptStatement.trim().replace('\n', '') }, // clean new lines and spaces
        ];

        this.statements = this.statements.filter( s => !FILTERS.some(f => s.code.includes(f.pattern) ) )
    }

    addComponentCodeDeclarations(componentCode:string):string
    {
        // Parse code to AST tree using acorn
        // We are looking for Expression ScriptStatement on Variables that are not declared on local scope, thus probably overriding global variables 
        const NODE_TYPES = ['VariableDeclaration', 'ExpressionStatement'];

        let componentTree = Parser.parse(componentCode, this.ACORN_OPTIONS);
        let localVariables:Array<string> = [];
        let codeMutations:Array<any> = [];
        
        // ANY TO AVOID TS ERRORS
        (componentTree as any).body.forEach(
            node => {
                if(NODE_TYPES.includes(node.type))
                {
                    if(node.type === 'VariableDeclaration')
                    {
                        // keep track of local variable declarations
                        localVariables = localVariables.concat(node.declarations.map( n => n.id.name));
                    }
                    else if(node.type === 'ExpressionStatement')
                    {
                        // check if expression is on variable not defined locally
                        let variableName = node.expression.left?.name;
                        if (variableName && !localVariables.includes(variableName))
                        {
                            // We got a assignment to a non-local variable
                            // Add let to variable
                            let origStatement = componentCode.substring(node.start, node.end);
                            let newStatement = `let ${origStatement}`;
                            codeMutations.push({ start: node.start, end: node.end, content: newStatement  })        
                        }
                    }
                    
                }
            });

        // now execute mutations on the code (and keep track of increase in indices)
        let charIndexInc = 0;
        const origComponentCode = componentCode;
        codeMutations.forEach(mutation =>
        {   
            componentCode = componentCode.substring(0,mutation.start+charIndexInc) + mutation.content + componentCode.substring(mutation.end+charIndexInc);
            charIndexInc = componentCode.length - origComponentCode.length;
        });

        return componentCode;
    }

    /** Preload special ScriptStatements like $import and $load which need to fetch data */
    async preloadSpecialStatements()
    {
        // For reasons of async we create a queue system
        for (let s = 0; s < this.statements.length; s++)
        {
            let curStatement = this.statements[s];


            if(this.isImportStatement(curStatement))
            {
                let importStatement = this.parseImportStatement(curStatement);

                if(importStatement)
                {
                    this.importStatements.push(importStatement); // save references to import ScriptStatements
                    let importedScript = await this.fetchImportScript(importStatement);
                    this.transformImportStatement(importStatement, importedScript);
                }
                else {
                    console.error(`CodeParser::transformImports: Could not parse import ScriptStatement: "${curStatement}"`)
                }
            }
            else if (this.isLoadStatement(curStatement))
            {
                // load the source with io
                let loadStatement = curStatement.code.match(this.LOAD_RE);

                if (loadStatement)
                {
                    let source = loadStatement[2];
                    if (source)
                    {
                        await this.io.load(source); // put in cache
                    }
                }
            }
        }

        return this.statements; // return all ScriptStatements
    }

    transformImportStatement(importStatement:ScriptImportStatement, importedScript:ScriptData)
    {
        // ImportStatement contains: code, name, versionTag, paramValues and the original ScriptStatement
        // We need to alter that original ScriptStatement and replace its code with the real code from imported script
      
        if (!importedScript)
        {
            // !!!! TODO ERROR MESSAGE !!!!
            console.error(`CodeParser::transformImportStatement: Cannot find import script "${importStatement.name}"`)
        }
        else 
        {
            // transform import ScriptStatement into real code
            let code = this._generateImportedScriptRealCode(importedScript, importStatement);
            importStatement.statement.code = code; // replace code
        }
    }


    parseImportStatement(statement:ScriptStatement):ScriptImportStatement
    {
        let m = statement.code.match(this.IMPORT_RE);
        
        if (!m)
        {
            console.error('CodeParser::parseImportStatement: Error in import ScriptStatement!')
            // !!!! TODO ERROR MESSAGE !!!!
            return null;
        }

        try
        {
            let n = m[2].split(':')[0];
            let userName = n.split('/')[0];
            let name = n.split('/')[1];
            let tag = m[2].split(':')[1];
            // TODO: String parameters
            let jsonParams = (m[3]) ? m[3].replace('{', '{"').replace(/}/g,'"}').replace(/\:/g, '":"').replace(/,/g, '","') : ''; 
            
            let params = {};
            if (jsonParams)
            {
                try {
                    params = JSON.parse(jsonParams) as any; 
                }
                catch(e)
                {
                    console.error('parseImportStatement: Cannot parse params');
                    params = {};
                }
            }
            
            let importStatement:ScriptImportStatement = {
                code: statement.code,
                userName: userName,
                name: name,
                versionTag: tag,
                paramValues: params,
                statement: statement, // reference to original ScriptStatement
            }

            return importStatement;
        }
        catch(e)
        {
            // !!!! TODO: show failed import component 
            console.error(e);
            return null;
        }

    }

    /** Fetch component from cache or from servers */
    async fetchImportScript(importStatement:ScriptImportStatement):Promise<ScriptData> // TODO: TS promise of ScriptVersion
    {
        // place in queue
        this.importedScriptQueue.push(importStatement);

        // script is already in cache
        if (await this.getImportScriptFromCache(importStatement.name) != null)
        {
            let script = await this.getImportScriptFromCache(importStatement.name);
            await this.handleFetchedImportScript(script);

            return script;
        }
        else
        { // script is not in cache
            // NOTE: config is currently unwired (see Runner.ts `new CodeParser(code, {}, …)`), so this
            // shared-import fetch is dormant. When wired, set API_URL_SHARED_SCRIPT_NAME_AND_TAG to
            // 'scripts/shared' to match the server route GET /scripts/shared/{user}/{name}:{version}.
            let url = `${this.config.API_URL}/${this.config.API_URL_SHARED_SCRIPT_NAME_AND_TAG}/${importStatement.userName}/${importStatement.name}:${importStatement.versionTag || 'latest'}`

            try
            {
                let r = await fetch(url, { 
                    method : 'GET',
                    headers: {
                        'Content-type': 'application/json',
                    },
                })

                let script = await this.handleFetchedImportScript(r);
                return script
            }
            catch(e)
            {
                this.handleFetchedImportScriptError(importStatement)
                return null;
            }
            
        }
            
    }

    async handleFetchedImportScript(response:any):Promise<ScriptData> // can be ScriptData or fetch response
    {
        let script:ScriptData = (response.json) ? (await response.json()).data as ScriptData : response as ScriptData; // NOTE: json() return another promise
        
        this.placeImportScriptInCache(script);
        this.manageImportScriptQueue();

        return script;
    }

    handleFetchedImportScriptError(importStatement:ScriptImportStatement)
    {
        console.error(`CodeParser::handleFetchedImportScriptError: Import "${importStatement}" failed`);
        this.manageImportScriptQueue();
    }

    manageImportScriptQueue()
    {
        // pop one of the queue
        this.importedScriptQueue.pop();

        if (this.importedScriptQueue.length == 0)
        {
            console.info('CodeParser::checkImportScriptQueueDone: All import components loaded!')
        }
    }

    placeImportScriptInCache(script:ScriptData)
    {
        console.info(`CodeParser::placeImportScriptInCache: Succesfully places imported script in cache: "${script.name}"`);
        this.importedScriptCache[script.name] = script; // place in cache
    }

    /** Get import script from cache */
    async getImportScriptFromCache(name:string):Promise<ScriptData>
    {
        console.info(`CodeParser::getImportScriptFromCache: Fetching import script from cache: "${name}"`)
        // to have it consistent with fetch we return a promise
        let promise = new Promise((resolve, reject) => {
            resolve(this.importedScriptCache[name]);
        });

        return promise as any; // avoid TS error
    }

    /** Test is a given ScriptStatement is a import ScriptStatement */
    isImportStatement(statement:ScriptStatement):boolean
    {
        return statement.code.match(this.IMPORT_RE) !== null
    }

    isLoadStatement(statement:ScriptStatement):boolean
    {
        return statement.code.match(this.LOAD_RE) !== null;
    }
    
    isDocStatement(statement:ScriptStatement):boolean
    {
        return statement.code.match(this.DOC_RE) !== null
    }

    /** Output ScriptStatements */
    async getStatements():Promise<Array<ScriptStatement>>
    {
        let statements = await this.preloadSpecialStatements(); // this takes a bit of time because of loading of components
        let promise = new Promise((resolve, reject) => 
        {
            resolve(statements);
        });

        return promise as Promise<Array<ScriptStatement>>;

    }

    /** Synchronous call to get ScriptStatement without importing components */
    getStatementsWithoutImports():Array<ScriptStatement>
    {
        return this.statements;
    }

    _generateImportedScriptRealCode(importedScript:ScriptData, importStatement:ScriptImportStatement)
    {
        let code = importedScript.code;

        code = this.addComponentCodeDeclarations(code); // make sure we have local assignments

        // clean geom references
        code = code.replace(/^[^g]+geom[\s]*=[\s]*new Geom()[^\n]+\n/, '') // replace creation of geom (if any)
        
        let codeParamsStr = '';
        if (importStatement.paramValues)
        {
            for (const [key,value] of Object.entries(importStatement.paramValues))
            {
                codeParamsStr += `let $${key} = ${value};\n`;
            }
        }

        let componentCode = `
        function $import(name, params)
        {
            // We use a layergroup to collect all incoming layers inside a parent layer
            let layerGroup = geom.layerGroup('${importStatement.name}');
            ${codeParamsStr}
            ${code}
            geom.endLayerGroup();
            // TODO: Fix objects that stay in scenegraph in layerGroup (even if they are hidden)
            let importedShapes = layerGroup.allShapesCollection(); 
            return importedShapes;
        }
        ${importStatement.code} // we can actually keep original import ScriptStatement`

        return componentCode;
    }


}