/* @ts-self-types="./pack3d_wasm.d.ts" */
import * as wasm from "./pack3d_wasm_bg.wasm";
import { __wbg_set_wasm } from "./pack3d_wasm_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    solve, validate
} from "./pack3d_wasm_bg.js";
