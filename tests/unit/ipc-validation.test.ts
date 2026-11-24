import { describe, expect, it } from 'vitest';
import { expectNoArgs, IpcValidationError } from '../../src/main/ipc-validation';

describe('expectNoArgs', () => {
  it('accepte un appel sans argument', () => {
    expect(expectNoArgs([])).toEqual([]);
  });

  it('refuse un appel forgé avec des arguments', () => {
    expect(() => expectNoArgs(['/System'])).toThrow(IpcValidationError);
    expect(() => expectNoArgs([undefined])).toThrow(IpcValidationError);
  });
});
