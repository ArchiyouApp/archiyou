# @archiyou/module-sdk

The contract for **Archiyou script modules** — optional units that add a global to the scope an
Archiyou script runs in.

This package is types plus two identity helpers. It has no runtime dependencies and knows nothing
about the engine, so a module repository can compile against it without pulling in
`@archiyou/core`.

```ts
import { defineModule } from '@archiyou/module-sdk';

export default defineModule(() => ({
  setArchiyou(ay) { this._ay = ay; },
  reset() { /* per-run state */ },

  doSomething(x) { return x * 2; },
}));
```

See [`modules/README.md`](../../modules/README.md) in the Archiyou repository for the manifest format,
the client/server runtimes, entitlement, and how to develop a module against a local checkout.

## Internal, not published

This package is `private: true` and is **never published to npm**. It is consumed through the
workspace — `"@archiyou/module-sdk": "workspace:*"` — which covers every consumer that exists: the
engine, the editor, the backend, and module repositories, since those are cloned into the
gitignored `modules/` overlay and become workspace packages themselves. It has no build: `exports`
points straight at `src/index.ts`, and the bundlers compile the TypeScript.

Two consequences worth knowing:

- **A module repository cannot be built outside the overlay.** `workspace:*` only resolves inside
  this monorepo. Develop modules in `modules/<repo>/<id>/` (see `modules/README.md`); that is also
  what gives them the same TypeScript version and the same contract revision as the engine they
  will run in.
- **`@archiyou/core` owns a mirror of the contract.** Core is published and its public types
  speak in these ones, so an `import … from '@archiyou/module-sdk'` in core would dangle in
  everything it ships — the emitted declarations *and* the TypeScript sources it publishes for
  Node users — and every module type would silently become `any`. So `src/types.ts` here is
  copied verbatim to `packages/core/src/modules/sdkTypes.ts`, which is what core imports and
  re-exports.

  **After editing `src/types.ts`, run `pnpm --filter @archiyou/core sync:sdk-types`.** A unit
  test, a CI step and `check:pack` each fail while the copy is stale, and `check:pack` also
  fails if any published file names this package again. The direction is deliberate: the
  contract is authored here, because a module repository must be able to typecheck against it
  without pulling in the engine.
