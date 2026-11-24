import type { InvokeArgs, InvokeChannel } from '../shared/types';

export type ArgsParser<C extends InvokeChannel> = (raw: readonly unknown[]) => InvokeArgs<C>;

export class IpcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpcValidationError';
  }
}

export function expectNoArgs(raw: readonly unknown[]): [] {
  if (raw.length !== 0) throw new IpcValidationError('Ce canal ne prend aucun argument');
  return [];
}
