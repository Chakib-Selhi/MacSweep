import { statfs } from 'node:fs/promises';
import type { DiskInfo } from '../shared/types';

export async function readDiskInfo(path: string): Promise<DiskInfo> {
  const stats = await statfs(path);
  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bavail * stats.bsize;
  return { totalBytes, freeBytes, usedBytes: totalBytes - freeBytes };
}
