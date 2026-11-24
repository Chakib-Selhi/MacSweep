import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { readDiskInfo } from '../../src/main/disk';

describe('readDiskInfo', () => {
  it('renvoie des tailles cohérentes', async () => {
    const info = await readDiskInfo(os.tmpdir());
    expect(info.totalBytes).toBeGreaterThan(0);
    expect(info.freeBytes).toBeGreaterThanOrEqual(0);
    expect(info.usedBytes + info.freeBytes).toBe(info.totalBytes);
  });

  it('échoue sur un chemin inexistant', async () => {
    await expect(readDiskInfo('/chemin/inexistant/macsweep')).rejects.toThrow();
  });
});
