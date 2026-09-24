import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';

import { archiyouCompletions, registerComponentNames } from '../src/editor/completions';

/** Completions at the end of `doc`. */
function complete(doc: string)
{
  const state = EditorState.create({ doc });
  return archiyouCompletions(new CompletionContext(state, doc.length, false));
}

const applied = (doc: string) =>
{
  const r = complete(doc)!;
  return r.options.map(o => `${doc.slice(0, r.from)}${o.apply ?? o.label}`);
};

describe('$component completions', () =>
{
  beforeEach(() => registerComponentNames(() => [
    { label: '@mark/wall', own: true },
    { label: '@mark/door', own: true },
    { label: '@archiyou/timberwall', own: false },
    { label: '@mark/wall', own: true },
  ]));

  it('offers the references, quoted, right after $component(', () =>
  {
    expect(applied(`w = $component(`)).toEqual([
      `w = $component('@mark/wall'`, `w = $component('@mark/door'`, `w = $component('@archiyou/timberwall'`,
    ]);
  });

  it('puts own scripts first, in their own section', () =>
  {
    const r = complete(`$component('`)!;
    const own = r.options.filter(o => (o.section as any)?.rank === 0).map(o => o.label);
    expect(own).toEqual(['@mark/wall', '@mark/door']);
    expect(r.options.every(o => o.boost === ((o.section as any)?.rank === 0 ? 1 : 0))).toBe(true);
  });

  it('completes inside a quote, including the @author/ part', () =>
  {
    expect(applied(`$component('@mark/wa`)).toContain(`$component('@mark/wall`);
    expect(applied(`$component("@arch`)).toContain(`$component("@archiyou/timberwall`);
  });

  it('keeps completing past the version separator', () =>
  {
    registerComponentNames(() => [
      { label: '@mark/wall:dev', own: true },
      { label: '@mark/wall', own: false },
    ]);
    expect(applied(`$component('@mark/wall:`)).toEqual([`$component('@mark/wall:dev`, `$component('@mark/wall`]);
  });

  it('offers nothing when there are no components', () =>
  {
    registerComponentNames(() => []);
    const r = complete(`$component('`);
    expect(r?.options.some(o => String(o.detail).includes('version'))).toBeFalsy();
  });

  it('offers the importer methods on $component(...) and its chainable methods', () =>
  {
    const labels = (doc: string) => complete(doc)!.options.map(o => o.label);
    expect(labels(`$component('@mark/wall').`)).toContain('params');
    expect(labels(`$component('wall').params({ w: 100 }).`)).toContain('model');
    expect(labels(`$component().`)).toContain('list');
    expect(labels(`$component('wall').model().`)).not.toContain('noCache');
  });
});

describe('fab completions', () =>
{
  it('offers the fabrication methods on fab. and fab as a global', () =>
  {
    const labels = (doc: string) => complete(doc)!.options.map(o => o.label);
    expect(labels(`ops = fab.`)).toEqual(['operations', 'estimate', 'fasten', 'contact', 'connections', 'configure', 'normBook', 'config']);
    expect(labels(`fa`)).toContain('fab');
  });
});

describe('$handle completions', () =>
{
  it('offers $handle for a word starting with $, without doubling the $', () =>
  {
    expect(applied(`$ha`)).toContain(`$handle`);
    expect(applied(`h = $`)).toContain(`h = $handle`);
  });

  it('offers the Handle methods after $handle() and on a variable holding one', () =>
  {
    const labels = (doc: string) => complete(doc)!.options.map(o => o.label);
    for (const doc of [`$handle().`, `$handle().param('WIDTH').at([0,0,0]).`, `h = $handle();\nh.`])
    {
      expect(labels(doc)).toEqual(expect.arrayContaining(['param', 'at', 'along', 'range', 'minimized']));
      expect(labels(doc)).not.toContain('extrude');
    }
  });

  it('keeps Handle out of shape completions', () =>
  {
    const labels = (doc: string) => complete(doc)!.options.map(o => o.label);
    expect(labels(`unknown.`)).not.toContain('minimized'); // the fallback for an unknown type
    expect(labels(`new `)).not.toContain('Handle');
  });
});
