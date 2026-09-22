/**
 * The API reference: search, and "what is the word at the cursor" (F1 in the editor).
 * Runs against the real api.generated.json, so a regenerated reference that loses a
 * class or a return type the lookup depends on fails here.
 */

import { describe, it, expect } from 'vitest';

import api from '../src/editor/help/api.generated.json';
import { indexApi, searchApi, lookupAt, type ApiEntry } from '../src/editor/help/help-reference.js';

const index = indexApi((api as { entries: ApiEntry[] }).entries);

/** Look up with the cursor at the `|` in `code` */
function lookup(code: string)
{
  const pos = code.indexOf('|');
  const result = lookupAt(index, code.replace('|', ''), pos);
  return { ...result, ids: result.entries.map(e => e.id) };
}

describe('the generated reference', () =>
{
  it('has the globals, the $ functions and the shape classes', () =>
  {
    ['box', 'sphere', 'sketch', '$component', '$PARAMS', 'doc', 'calc', 'print', 'Mesh', 'Mesh.move', 'Mesh.subtract', 'ShapeCollection', 'Curve.fillet']
      .forEach(id => expect(index.byId.has(id), id).toBe(true));
  });

  it('merges the methods shapeAnnotations adds to the meshup classes', () =>
  {
    expect(index.byId.has('Mesh.dimension')).toBe(true);
    expect(index.byId.has('Mesh.label')).toBe(true);
  });

  it('leaves out what is private or engine-only', () =>
  {
    expect(index.entries.some(e => e.name.startsWith('_'))).toBe(false);
    expect(index.byId.has('Calc.setArchiyou')).toBe(false);
  });
});

describe('searchApi', () =>
{
  it('puts the exact global first', () =>
  {
    expect(searchApi(index, 'box')[0].id).toBe('box');
  });

  it('finds members by class and prefix', () =>
  {
    expect(searchApi(index, 'Mesh.mo').map(e => e.id)).toContain('Mesh.move');
  });

  it('returns nothing for an empty query', () =>
  {
    expect(searchApi(index, '  ')).toEqual([]);
  });
});

describe('lookupAt', () =>
{
  it('finds a global function, also inside its parentheses', () =>
  {
    expect(lookup('bo|x(10, 20, 30)').ids).toEqual(['box']);
    expect(lookup('box(|').ids).toEqual(['box']);
  });

  it('completes a partly typed global: $comp → $component', () =>
  {
    expect(lookup('$comp|').ids[0]).toBe('$component');
  });

  it('walks a chain to the class of the receiver', () =>
  {
    const result = lookup("box(10).move(5).col|or('red')");
    expect(result.receiver).toBe('Mesh');
    expect(result.ids).toEqual(['Mesh.color']);
  });

  it('types a variable from its assignment', () =>
  {
    expect(lookup('top = box(1200, 700, 30)\ntop.move|Z(735)').ids).toEqual(['Mesh.moveZ']);
  });

  it('types a $component importer', () =>
  {
    expect(lookup("c = $component('./table')\nc.para|ms({ WIDTH: 10 })").ids).toEqual(['RunnerComponentImporter.params']);
  });

  it('follows a module through a chain split over lines', () =>
  {
    expect(lookup("doc.create('d')\n   .page('a')\n   .vie|w('front')").ids).toEqual(['Document.view']);
  });

  it('offers every class with the member when the receiver is unknown', () =>
  {
    const result = lookup('unknownThing.subtr|act(x)');
    expect(result.receiver).toBeNull();
    expect(result.ids).toEqual(expect.arrayContaining(['Mesh.subtract', 'ShapeCollection.subtract']));
  });

  it('explains a script parameter through $PARAMS', () =>
  {
    const result = lookup('box($WID|TH, 10, 10)');
    expect(result.param).toBe('WIDTH');
    expect(result.ids).toEqual(['$PARAMS']);
  });

  it('finds nothing in empty space', () =>
  {
    expect(lookup('a = 1\n|\n').ids).toEqual([]);
  });
});
