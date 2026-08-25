/**
 * validate.ts — request-body validation via typebox v1 (same runtime as core).
 * We deliberately avoid @fastify/type-provider-typebox, which is pinned to the
 * incompatible @sinclair/typebox 0.34.
 */

import type { TSchema, Static } from 'typebox';
import { Check, Errors } from 'typebox/value';

export class ValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Validation failed: ${issues.join('; ')}`);
  }
}

/** Return validated data (typed) or throw ValidationError with readable issues. */
export function parse<T extends TSchema>(schema: T, data: unknown): Static<T> {
  if (Check(schema, data)) return data as Static<T>;
  const issues = [...Errors(schema, data)].map((e) => `${e.instancePath || '/'}: ${e.message}`);
  throw new ValidationError(issues.length ? issues : ['invalid payload']);
}
