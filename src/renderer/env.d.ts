import type { MacSweepApi } from '../shared/types';

declare global {
  interface Window {
    readonly macsweep: MacSweepApi;
  }
}
