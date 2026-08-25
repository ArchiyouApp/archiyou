/* @ts-self-types="./gdrr2bp_wasm.d.ts" */
import * as wasm from "./gdrr2bp_wasm_bg.wasm";
import { __wbg_set_wasm } from "./gdrr2bp_wasm_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    solve
} from "./gdrr2bp_wasm_bg.js";
