# Server modules: warm workers per user, Server-Timing, entitlement cache

| | |
|---|---|
| Dates | 2026-10-08 → 2026-10-08 |
| Model | Claude Opus 5.5 (claude-opus-5-5), Claude Code agent |
| Tool | Claude Code as agent (no plan mode: a performance question that turned into a design proposal, built after the human said so) |
| Human | Mark van der Net: reported the slow cloudcalc example, asked why workers are not kept per session, approved building it, profiled in the browser, chose the entitlement cache |
| Branch | `agent` |
| Session transcript | kept locally; the prompts are reproduced in full below |

The same session also changed the cloudcalc module (title cache, in-memory sheet TTL, `keepAlive` in
its manifest). That module lives in `modules/` (the private `archiyou-modules` repo), is out of NLnet
scope and was committed there as ordinary work (e700d4b). This record covers the engine and server side.

## Prompts (verbatim, local time)
```
2026-10-08 11:14 +0200  Im trying out the example for cloudcalc. 
                        
                        <pasted_content id="7951">
                        $module('cloudcalc')
                        
                        wb = cloudcalc.open('https://docs.google.com/spreadsheets/d/1sJap6ofjQUu9yDw8y5rM-gZnuf8MNEtKvqTvCko3Slk/edit')
                        
                        out = wb.compute({ a: 2, b: 3, c: 4, d: 5 })     // { sum: 14 }
                        
                        print(out);
                        </pasted_content id="7951">
                        
                         But it is really slow. Ok, loading the sheet might take a long time, but calculation is also slow, and the cache doesnt seem to be working too?
2026-10-08 11:19 +0200  Now i get this error "ERROR at line 1: "$module('cloudcalc'): no such module — check the name, or it is not installed on this server""
2026-10-08 11:20 +0200  ok works. I think it could still be faster. Whats wrong of keeping the worker around for each session to avoid loading the wasm etc?
2026-10-08 11:23 +0200  just build it.
2026-10-08 11:35 +0200  Nice, its already way faster. Im checking in the profiler. Open is still 63ms, that is weird because its cached right? Compute 64ms - can we bring that down more?
2026-10-08 11:41 +0200  Can you flatten this? Avoid submitting the key to your servers please
2026-10-08 11:55 +0200  yes build 1
```
The 11:41 prompt is about putting a service-account key into `.env`: no code came from it. The key
itself is not reproduced here.

## What was built (agent summary)

- **Warm workers, opt-in per module.** A manifest flag `keepAlive: true` (documented in
  `packages/module-sdk/src/types.ts` and its mirror `packages/core/src/modules/sdkTypes.ts`) makes
  `ModuleWorkerPool` keep one worker thread per (module, user) instead of a fresh thread per call. Calls
  of one user run one after another on it. A warm worker is retired after `SERVER_MODULES_WARM_IDLE_MS`
  (120 s) idle, on a timeout (the thread is still terminated), on a crash, when the module's `server.js`
  changes on disk, or as least recently used beyond `SERVER_MODULES_WARM_MAX` (8). With all warm
  workers busy, a call runs in a fresh thread. Other modules keep the fresh thread per call.
  The route passes the username to the pool, so state is never shared between users.
- **`Server-Timing`** on `POST /modules/:id/call` (`pre`, `entitle`, `module`), to see where a call's
  time goes in the browser.
- **Entitlement cache.** `UserService.hasModule()` answers from memory for
  `SERVER_MODULES_ENTITLEMENT_TTL_MS` (30 s; 0 disables, capped at 10 000 users); grants and revokes in
  the API process clear the entry at once, `pnpm admin:modules` changes take effect within the TTL.
  `getModules()` stays uncached. The admin CLI's messages say so.

Measured through the real pool, same user in a row: `compute` 118 ms → 10 ms, with other inputs
121 ms → 1 ms; a warm call through the whole route in-process 4–5 ms.

## Review and decisions by the human

- Asked why workers are not kept per session; approved the proposal (opt-in per module, per user, idle
  timeout and cap) with "just build it".
- Profiled in Chrome and found ~60 ms left per call; the agent traced it to the entitlement query over
  the SSH tunnel to the production database. Chose option 1, the 30 s in-memory cache, accepting that a
  revoke from the admin CLI takes up to 30 s to apply.
- Had the work committed after `toTables()` and the core Table fix (2026-10-08); server unit suite: 280 passed.

## Commits
| Commit | Subject | Prompt it answers |
|---|---|---|
| (this commit) | see git log | 11:20, 11:23, 11:35, 11:55 |
