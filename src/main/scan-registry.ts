import type { CategoryId } from '../shared/categories';
import type { ScanDone } from '../shared/types';

export interface RegisteredItem {
  categoryId: CategoryId;
  sizeBytes: number;
  /** Duplicates: the group of identical files this one belongs to. */
  groupId?: string;
}

/**
 * What the latest scan reported, kept in the main process. Only these paths can be cleaned:
 * a forged request can never reach a file MacSweep did not find itself.
 */
export class ScanRegistry {
  private items = new Map<string, RegisteredItem>();
  private groups = new Map<string, number>();

  replace(done: ScanDone): void {
    this.items = new Map();
    this.groups = new Map();
    for (const category of done.categories) {
      for (const item of category.items) {
        // A file can be both a large file and a duplicate: the duplicate group must not be lost.
        const known = this.items.get(item.path);
        if (known?.groupId) continue;
        const groupId = item.groupId ?? known?.groupId;
        this.items.set(item.path, {
          categoryId: category.id,
          sizeBytes: item.sizeBytes,
          ...(groupId ? { groupId } : {}),
        });
        if (item.groupId) this.groups.set(item.groupId, (this.groups.get(item.groupId) ?? 0) + 1);
      }
    }
  }

  get(path: string): RegisteredItem | undefined {
    return this.items.get(path);
  }

  /** How many files of a duplicate group are still on disk, as far as MacSweep knows. */
  groupSize(groupId: string): number {
    return this.groups.get(groupId) ?? 0;
  }

  forget(path: string): void {
    const item = this.items.get(path);
    if (!item) return;
    this.items.delete(path);
    if (item.groupId) this.groups.set(item.groupId, this.groupSize(item.groupId) - 1);
  }
}
