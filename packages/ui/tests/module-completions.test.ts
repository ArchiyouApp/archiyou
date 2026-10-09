import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';

import { archiyouCompletions, registerModuleCompletions, resolveModuleType } from '../src/editor/completions';

/** Completions at the end of `doc`. */
function complete(doc: string)
{
  const state = EditorState.create({ doc });
  return archiyouCompletions(new CompletionContext(state, doc.length, false));
}

const labels = (doc: string) => complete(doc)?.options.map(o => o.label) ?? [];

/** A fictional module with object types, like a spreadsheet module's workbooks. */
const SHEETS = {
  global: 'sheets',
  entitled: true,
  completions: [
    { label: 'open', detail: '(url) => Book', type: 'method', returnsType: 'Book' },
    { label: 'clear', detail: '() => void', type: 'method' },
  ],
  types: {
    Book: [
      { label: 'compute', detail: '(input) => object', type: 'method' },
      { label: 'tab', detail: '(name) => Tab', type: 'method', returnsType: 'Tab' },
      { label: 'copyIt', detail: '(options?) => void', type: 'method', info: 'Copies the book.',
        params: [{ name: 'options.title', info: 'Name of the copy.' }], example: "book.copyIt({ title: 'x' })" },
      { label: 'title', detail: 'string', type: 'property' },
    ],
    Tab: [{ label: 'rows', detail: '() => object[]', type: 'method' }],
  },
};

describe('module object completions', () =>
{
  beforeEach(() => registerModuleCompletions([SHEETS]));

  it('lists the members of the type a module method returns', () =>
  {
    expect(labels(`sheets.open('https://example.com/a').`)).toEqual(['compute', 'tab', 'copyIt', 'title']);
    expect(labels(`sheets.`)).toEqual(['open', 'clear']);
  });

  it('follows a variable assigned from the module, also across lines and down a chain', () =>
  {
    const code = `
      $module('sheets')
      book = sheets.open('https://docs.example.com/d/abc/edit') // the price list
      const t = book.tab('Calc')
      out = book.compute({ a: 1 })
    `;
    expect(labels(`${code}book.`)).toContain('copyIt');
    expect(labels(`${code}t.`)).toEqual(['rows']);
    expect(labels(`${code}book.tab('x').`)).toEqual(['rows']);
    expect(resolveModuleType(`${code}out`, `${code}out.`)).toBeNull();
  });

  it('forgets a variable reassigned to something else', () =>
  {
    const code = `book = sheets.open('u')\nbook = box(10, 10, 10)\n`;
    expect(resolveModuleType(`${code}book`, `${code}book.`)).toBeNull();
  });

  it('gives a documented member the info box of the core API, a plain one its text', () =>
  {
    const options = complete(`sheets.open('u').`)!.options;
    // A function: the box with parameters and example (completionInfo) is built when shown
    expect(typeof options.find(o => o.label === 'copyIt')!.info).toBe('function');
    expect(options.find(o => o.label === 'title')).toMatchObject({ type: 'property', detail: 'string' });
  });

  it('offers nothing of a module the user may not use', () =>
  {
    registerModuleCompletions([{ ...SHEETS, entitled: false }]);
    expect(labels(`book = sheets.open('u')\nbook.`)).not.toContain('copyIt');
  });
});
