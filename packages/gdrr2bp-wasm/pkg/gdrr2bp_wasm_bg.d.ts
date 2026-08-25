/**
 *  Declarations for the wasm-bindgen glue in gdrr2bp_wasm_bg.js.
 *
 *  HAND-WRITTEN, and the only file in pkg/ that is: wasm-pack generates declarations for the
 *  public entry (gdrr2bp_wasm.d.ts) and for the wasm module, but not for the `_bg` glue, which
 *  it treats as internal. ts/BinPacker.ts uses that glue directly — it instantiates the module
 *  itself from the inlined base64 and hands the exports back with `__wbg_set_wasm` — so the
 *  glue is part of this package's typed surface whether wasm-pack thinks so or not.
 *
 *  Without this file the build has to fall back to `allowJs`, which drags the generated .js
 *  into the TypeScript program and fails the declaration build (the file lives outside
 *  rootDir). Keep it in step with what BinPacker.init() actually calls.
 */

/** Hand the instantiated module's exports to the glue. Called once, after instantiation. */
export function __wbg_set_wasm(wasm: unknown): void;

/** The solver entry point the glue re-exports once the module is wired up. Mirrors WasmSolve
 *  in ts/BinPacker.ts — synchronous, returning the solution as a JSON string.
 *
 *  Declared as a function rather than `unknown` on purpose: BinPacker passes this whole module
 *  namespace as a WebAssembly import object, and every member has to be an ImportValue for
 *  that cast to hold. */
export function solve(inputJson: string, configJson: string): string;
