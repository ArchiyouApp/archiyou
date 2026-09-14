/**
 * manifestSchema.ts — validation for an installed module's manifest.json.
 *
 * Manifests are written outside this repository and installed by a deployment,
 * so they are untrusted input in the same way a request body is: a typo must produce a clear startup warning and a
 * skipped module, never a half-registered one that fails mysteriously later.
 *
 * Mirrors AyModuleManifest in @archiyou/module-sdk. Validated with typebox v1,
 * like every other wire shape here (see validate.ts).
 */

import { Type, type Static } from 'typebox';

export const ModuleCompletionSchema = Type.Object({
  label: Type.String({ minLength: 1 }),
  detail: Type.Optional(Type.String()),
  info: Type.Optional(Type.String()),
  type: Type.Optional(
    Type.Union([
      Type.Literal('method'),
      Type.Literal('property'),
      Type.Literal('function'),
      Type.Literal('class'),
    ]),
  ),
});

export const ModuleManifestSchema = Type.Object({
  // Ids and versions land in URL paths, so they are constrained to characters
  // that survive a path segment without escaping surprises.
  id: Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z0-9][a-z0-9-]*$' }),
  global: Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z][A-Za-z0-9_]*$' }),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  version: Type.String({ minLength: 1, maxLength: 32, pattern: '^[0-9A-Za-z.\\-+]+$' }),
  engine: Type.String({ minLength: 1, maxLength: 64 }),
  runtime: Type.Union([Type.Literal('client'), Type.Literal('server')]),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  docsUrl: Type.Optional(Type.String({ maxLength: 500 })),
  completions: Type.Optional(Type.Array(ModuleCompletionSchema, { maxItems: 500 })),
  /** Available without an entitlement. See AyModuleManifest.public. */
  public: Type.Optional(Type.Boolean()),
  /** A server module that also ships a client wrapper bundle. See AyModuleManifest.client. */
  client: Type.Optional(Type.Boolean()),
});

export type ModuleManifest = Static<typeof ModuleManifestSchema>;

/** Body of POST /modules/:id/call. `args` is deliberately unconstrained — only
 *  the module knows its own argument shape. `method` is constrained because it
 *  is used to index the module's method map. */
export const ModuleCallSchema = Type.Object({
  method: Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }),
  args: Type.Optional(Type.Unknown()),
});

export type ModuleCall = Static<typeof ModuleCallSchema>;
