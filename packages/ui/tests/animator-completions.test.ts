import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';

import { archiyouCompletions, resolveAnimatorType } from '../src/editor/completions';

/** Completion labels at the end of `doc`. */
function labels(doc: string): Array<string>
{
  const state = EditorState.create({ doc });
  return archiyouCompletions(new CompletionContext(state, doc.length, false))?.options.map(o => o.label) ?? [];
}

describe('animator completions', () =>
{
  it('offers the animator global at the top level', () =>
  {
    expect(labels('anim')).toContain('animator');
  });

  it('offers the Animator after `animator.`', () =>
  {
    expect(labels('animator.')).toEqual(expect.arrayContaining(['create', 'preset', 'get', 'names']));
  });

  it('offers the Animation down a chain and on a variable holding one', () =>
  {
    expect(labels("animator.create('swing').duration(2).")).toEqual(expect.arrayContaining(['key', 'hide', 'fade', 'highlight', 'turntable']));
    expect(labels("a = animator.preset('flyin');\na.")).toEqual(expect.arrayContaining(['stagger', 'order', 'from']));
    expect(resolveAnimatorType("animator\n  .create('x')\n  .key(0, 'A', {})", '')).toBe('Animation');
  });

  it('leaves other chains alone', () =>
  {
    expect(resolveAnimatorType('animator.names()', '')).toBeNull();
    expect(resolveAnimatorType('box(10)', '')).toBeNull();
  });
});
