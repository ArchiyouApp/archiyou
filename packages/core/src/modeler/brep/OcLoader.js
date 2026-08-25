/** OcLoader.js
 * 
 *  This helper class contains some black magic to have a custom build from OC.js 
 *   working accross environments and modes:
 * 
 *    - Synchronous (with callback) or as async function: load(), loadAsync()
 *    - In a browser or node - The context is detected automatically
 *  
 *    NOTES: 
 *      - Please make sure you enable modern ES versions (es2017+) to enable dynamic imports
 *      - We have this as JS, not TS to avoid any issues with the dynamic imports
 *      - If using relative path in dynamic imports we need to make resolve them to absolute paths (otherwise they are resolved relative to the file that imports this module)
 *  
 *    TESTED RUNTIMES:
 *      - Browser: in main or web worker
 *      - Node v18+
 *     
 *    TESTED BUILD TOOLS:
 *      - Vite / Vitest (Nuxt3+)
 *      - Webpack 4 (Nuxt2)
 * 
 *   
*/


/** IMPORTANT: 
 *  
 *  Statically importing WASM related modules gives errors while building archiyou as a module 
 *  Vite creates base64 versions of the archiyou-opencascade.js which is not what we want
 *  Underneath are all dynamically imported modules
*/

export class OcLoader
{
  //// SETTINGS ////
  SHAPE_TOLERANCE = 0.001;
  RUN_TEST = false;

  //// IMPORTANT PATHS ////
  /*
     The OC glue + wasm live in ./wasm, next to this file. Everything is resolved relative
     to THIS module (import.meta.url), never relative to the page or the bundle root, so
     the loader keeps working in the main thread, in a module Web Worker and in Node alike.

     Only the Node glue path stays a variable: it must not be seen by a browser bundler
     (it imports 'path'/'url'). The browser paths are written out as literals at their
     use site so Vite/Rollup can emit the wasm as an asset and the glue as a lazy chunk.
  */

  ocJsNodeModulePath = `./wasm/node.js`;

  //// PROPERTIES ////

  _oc;
  loaded;
  startLoadAt;

  constructor()
  {
    this.loaded = false;
    this._oc = null; // will be set by _onOcInit
    // use load or loadSync to start loading Opencascade
  }

  //// PUBLIC METHODS ////


  /** Load synchronous */
  load(onLoaded)
  {
    console.log(`OcLoader::load(): ******** [context: ${this._getContext()}]: Loading Opencascade WASM module ********`);
      
    this.startLoadAt = performance.now();
    
    if(this._getContext() === 'browser' || this._getContext() === 'webworker')
    {
      this._loadOcBrowser(onLoaded);
    }
    else {
      this._loadOcNode(onLoaded);
    }
  }

  /** Load async */
  async loadAsync()
  {
    console.log(`OcLoader::loadAsync()[context: ${this._getContext()}]: Loading Opencascade WASM module`);
    this.startLoadAt = performance.now();

    if(this._getContext() === 'browser' || this._getContext() === 'webworker')
    {
      return await this._loadOcBrowserAsync();
    }
    else {
      return await this._loadOcNodeAsync();
    }
  }

  //// PRIVATE

  _getContext()
  {
    const isBrowser = (typeof globalThis.window !== "undefined");
    const isWebWorker = (typeof self !== 'undefined' && typeof window === 'undefined');
    return isBrowser ? 'browser' : isWebWorker ? 'webworker' : 'node';
  }
  

  /** Load OpenCascade module synchronous and run function when loading is done */
  _loadOcBrowser(onLoaded)
  {
    this.startLoadAt = performance.now();
    this._loadOcBrowserAsync().then(oc => { if(onLoaded){ onLoaded(oc, this); } });
  }


  /** Load OpenCascade module async in a browser main thread or a module Web Worker
   *
   *  Both the glue and the wasm are addressed relative to THIS module:
   *    - the wasm through `new URL(..., import.meta.url)`: a bundler-recognised form that
   *      Vite rewrites to the emitted asset URL on build, and that resolves to the real
   *      file URL when no bundler is involved. Never fetched by us - we only hand the URL
   *      to Emscripten's locateFile().
   *    - the glue through a dynamic import with a literal specifier, so Vite/Rollup put it
   *      in a lazy chunk instead of leaving a runtime URL that nothing emitted.
  */
  async _loadOcBrowserAsync()
  {
    console.log(`OcLoader::_loadOcBrowserAsync(): Loading OpenCascade WASM module [context: ${this._getContext()}]`);

    const ocWasmUrl = new URL('./wasm/archiyou-opencascade.wasm', import.meta.url).href;
    const ocJs = (await import('./wasm/archiyou-opencascade.js')).default;

    console.log(`OcLoader::_loadOcBrowserAsync(): wasm at "${ocWasmUrl}"`);

    // https://emscripten.org/docs/api_reference/module.html#Module.locateFile
    const oc = await ocJs({
        locateFile(path)
        {
          if (path.endsWith('.wasm')) { return ocWasmUrl; }
          return path;
        }
    });
    return this._onOcLoaded(oc);
  }


  /** Load OpenCascade in Node context */
  async _loadOcNodeAsync()
  {
      const modulePath = await this._getAbsPath(this.ocJsNodeModulePath);

      console.info(`OcLoader::_loadOcNodeAsync(): Loading OpenCascade module at: ${modulePath}}`);
      const ocInit = (await import(/* webpackIgnore: true */ /* @vite-ignore */ modulePath)).default;
      const oc = await ocInit();

      return this._onOcLoaded(oc);
  }

  _loadOcNode(onLoaded)
  {
      this._loadOcNodeAsync().then(oc => onLoaded(oc));
  }
  
  /** When OC is loaded, we set a couple of things */
  _onOcLoaded(oc, onLoaded)
  {
    console.log(`**** OC: BREP CAD library loaded with ${Object.keys(oc).length} functions! Took: ${ Math.round((performance.now() - this.startLoadAt) )} ms ****`);

    this._oc = oc;
    this._oc.SHAPE_TOLERANCE = this.SHAPE_TOLERANCE; // set tolerance

    console.geom = console.info; // If we don't use the Archiyou console, this avoids any errors

    if (this.RUN_TEST){ this.runTest();}

    // callback function
    if (onLoaded)
    {
      onLoaded(oc, this); // oc and current runner instance as arguments to callback
    }
    
    return this._oc;
  }



  //// UTILS 

  /** Resolve a path relative to this module to something Node can import.
   *  Browser/worker contexts don't use this - they resolve against import.meta.url inline
   *  so that bundlers can see (and emit) what is being referenced.
  */
  async _getAbsPath(filepath)
  {
    // Node.js environment
    // NOTE: webpackIgnore only works in Webpack 5 to avoid processing imports on buildtime
    const { fileURLToPath } = await import(/* webpackIgnore: true */ 'url');
    const path = await import('path');

    const fileURL = import.meta.url;
    let curDir = path.dirname(fileURLToPath(fileURL)); // directory of this file

    // The '/' is actually needed in windows for normal ES imports
    // But does not work with wasm files
    if(filepath.includes('.wasm') && curDir[0] === '/')
    {
      curDir = curDir.slice(1);
    }

    let absPath = path.join(curDir, filepath);

    // We need to add file:// to get this working on windows
    const processObj = globalThis.process;
    if(typeof processObj !== 'undefined' && processObj.platform === 'win32')
    {
      absPath = 'file://' + absPath; // Add file:// to the path
    }

    return absPath;
  }

  runTest()
  {
    console.log('---- OC Loader Test ----')
    console.log(new this._oc.gp_Vec_4(10,10,10));
  }

  searchMethod(s)
  {
    return Object.keys(this._oc).filter(k => k.indexOf(s) != -1);
  }


}
  
  

  
