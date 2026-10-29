/**
 *  Declarations for the wasm-bindgen glue in pack3d_wasm_bg.js.
 *
 *  HAND-WRITTEN, and the only file in pkg/ that is: wasm-pack generates declarations for the
 *  public entry (pack3d_wasm.d.ts) and for the wasm module, but not for the `_bg` glue, which
 *  it treats as internal. ts/Packer3D.ts uses that glue directly (it instantiates the module
 *  itself from the inlined base64 and hands the exports back with `__wbg_set_wasm`), so the
 *  glue is part of this package's typed surface whether wasm-pack thinks so or not.
 *
 *  Keep it in step with what Packer3D.init() calls and with the #[wasm_bindgen] exports of src/lib.rs.
 */

/** Hand the instantiated module's exports to the glue. Called once, after instantiation. */
export function __wbg_set_wasm(wasm: unknown): void;

/** An instance and a config as JSON in, a solution as JSON out. A rejected input is thrown as a string.
 *
 *  Declared as functions rather than `unknown` on purpose: Packer3D passes this whole module namespace
 *  as a WebAssembly import object, and every member has to be an ImportValue for that cast to hold. */
export function solve(instanceJson: string, configJson: string): string;

/** The rules that a solution breaks, as a JSON array of sentences (`[]` when it breaks none). */
export function validate(instanceJson: string, configJson: string, solutionJson: string): string;
