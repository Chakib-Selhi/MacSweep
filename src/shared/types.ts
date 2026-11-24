export interface DiskInfo {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
}

export interface InvokeContract {
  'disk:info': { args: []; result: DiskInfo };
}

export type InvokeChannel = keyof InvokeContract;
export type InvokeArgs<C extends InvokeChannel> = InvokeContract[C]['args'];
export type InvokeResult<C extends InvokeChannel> = InvokeContract[C]['result'];

export interface MacSweepApi {
  disk: {
    info(): Promise<DiskInfo>;
  };
}
