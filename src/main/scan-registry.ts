import type { CategoryId } from '../shared/categories';
import type { ScanDone } from '../shared/types';

export interface RegisteredItem {
  categoryId: CategoryId;
  sizeBytes: number;
}

/**
 * What the latest scan reported, kept in the main process. Only these paths can be cleaned:
 * a forged request can never reach a file MacSweep did not find itself.
 */
export class ScanRegistry {
  private items = new Map<string, RegisteredItem>();

  replace(done: ScanDone): void {
    this.items = new Map();
    for (const category of done.categories) {
      for (const item of category.items) {
        this.items.set(item.path, { categoryId: category.id, sizeBytes: item.sizeBytes });
      }
    }
  }

  get(path: string): RegisteredItem | undefined {
    return this.items.get(path);
  }

  forget(path: string): void {
    this.items.delete(path);
  }
}
