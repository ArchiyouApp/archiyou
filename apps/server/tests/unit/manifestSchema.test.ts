/**
 * manifestSchema.test.ts — what an installed module's manifest.json may declare.
 *
 * A fictional 'sheets' module: real modules live outside this repository.
 */
import { describe, it, expect } from 'vitest';

import { ModuleManifestSchema } from '../../src/modules/manifestSchema';
import { parse } from '../../src/validate';

const MANIFEST = {
  id: 'sheets',
  global: 'sheets',
  name: 'Sheets',
  version: '1.0.0',
  engine: '^0.9.0',
  runtime: 'client',
  completions: [{ label: 'open', detail: '(url) => Book', type: 'method', returnsType: 'Book' }],
  types: {
    Book: [{
      label: 'copyIt',
      detail: '({ title? }) => void',
      type: 'method',
      info: 'Copies the book.',
      params: [{ name: 'options.title', info: 'Name of the copy.' }],
      returns: 'nothing',
      example: "book.copyIt({ title: 'x' })",
    }],
  },
};

describe('module manifest schema', () =>
{
  it('takes completions for the objects a module returns, with their docs', () =>
  {
    expect(parse(ModuleManifestSchema, MANIFEST)).toEqual(MANIFEST);
  });

  it('refuses a type name or returnsType that is not an identifier', () =>
  {
    expect(() => parse(ModuleManifestSchema, { ...MANIFEST, types: { 'Book Two': [] } })).toThrow();
    expect(() => parse(ModuleManifestSchema, { ...MANIFEST, completions: [{ label: 'open', returnsType: '<script>' }] })).toThrow();
  });
});
