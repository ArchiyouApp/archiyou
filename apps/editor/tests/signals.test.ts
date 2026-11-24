/**
 * tests/signals.test.ts — what the browser reports about a failed run (services/signals): the
 * error itself, never the lines of the script around it.
 */

import { describe, it, expect } from 'vitest';

import { errorOnly, scriptRef } from '../src/services/signals.js';

const RUNNER_ERROR = `
**** EXECUTION ERROR ****
- error: 'Width 2500 is wider than the shed can be'
- line: 1, column: 52
- context:
> 1 | if ($WIDTH > 2000) { throw new Error('Width ' + $WIDTH + ' is wider than the shed can be'); }
  2 | box($WIDTH, 500, 750);

**** END ERROR ****`;

describe('errorOnly', () =>
{
  it('keeps the error of a Runner message and drops the script around it', () =>
  {
    expect(errorOnly(RUNNER_ERROR)).toBe('Width 2500 is wider than the shed can be');
  });

  it('reads the per-statement format too', () =>
  {
    expect(errorOnly("\n**** EXECUTION ERROR ****\n- error: 'x is not defined'\n- line: 4\n- context:\n> 4 | x + 1\n**** END ERROR ****"))
      .toBe('x is not defined');
  });

  it('keeps quotes inside the error', () =>
  {
    expect(errorOnly("**** EXECUTION ERROR ****\n- error: 'Cannot read 'width' of undefined'\n- context:\n> 1 | a.width"))
      .toBe("Cannot read 'width' of undefined");
  });

  it('leaves other messages alone', () =>
  {
    expect(errorOnly('The model could not be made.')).toBe('The model could not be made.');
    expect(errorOnly(undefined)).toBeUndefined();
  });
});

describe('scriptRef', () =>
{
  it('is author/name:version, or nothing without author and name', () =>
  {
    expect(scriptRef({ author: 'alice', name: 'shed', version: '1.0.0' })).toBe('alice/shed:1.0.0');
    expect(scriptRef({ author: 'alice', name: 'shed', version: null })).toBe('alice/shed');
    expect(scriptRef({ author: null, name: 'shed' })).toBeUndefined();
    expect(scriptRef(null)).toBeUndefined();
  });
});
