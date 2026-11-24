import { CATEGORY_META, type CategoryId } from '../../shared/categories';
import type { CategoryResult, ScanDone, ScanItem } from '../../shared/types';

export type SortKey = 'size' | 'date';

export type Row =
  | { kind: 'category'; category: CategoryResult; matches: number }
  | { kind: 'item'; categoryId: CategoryId; item: ScanItem };

export interface SelectionSummary {
  count: number;
  bytes: number;
}

export interface CategorySelection extends SelectionSummary {
  state: 'all' | 'some' | 'none';
}

/** The Trash is emptied as a whole (M4), and items of a running app are left alone (rule 6). */
export function isSelectable(categoryId: CategoryId, item: ScanItem): boolean {
  return !CATEGORY_META[categoryId].permanent && item.openApp === undefined;
}

export function defaultSelection(result: ScanDone): Set<string> {
  const selected = new Set<string>();
  for (const category of result.categories) {
    if (!CATEGORY_META[category.id].defaultChecked) continue;
    for (const item of category.items) {
      if (isSelectable(category.id, item)) selected.add(item.path);
    }
  }
  return selected;
}

export function selectionSummary(
  result: ScanDone,
  selected: ReadonlySet<string>,
): SelectionSummary {
  let count = 0;
  let bytes = 0;
  for (const category of result.categories) {
    for (const item of category.items) {
      if (selected.has(item.path)) {
        count += 1;
        bytes += item.sizeBytes;
      }
    }
  }
  return { count, bytes };
}

export function categorySelection(
  category: CategoryResult,
  selected: ReadonlySet<string>,
): CategorySelection {
  let selectable = 0;
  let count = 0;
  let bytes = 0;
  for (const item of category.items) {
    if (!isSelectable(category.id, item)) continue;
    selectable += 1;
    if (selected.has(item.path)) {
      count += 1;
      bytes += item.sizeBytes;
    }
  }
  const state = count === 0 ? 'none' : count === selectable ? 'all' : 'some';
  return { state, count, bytes };
}

export function setMany(
  selected: ReadonlySet<string>,
  paths: Iterable<string>,
  checked: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const p of paths) {
    if (checked) next.add(p);
    else next.delete(p);
  }
  return next;
}

export function visibleItems(category: CategoryResult, query: string, sort: SortKey): ScanItem[] {
  const needle = query.trim().toLowerCase();
  const items = needle
    ? category.items.filter((item) => item.path.toLowerCase().includes(needle))
    : [...category.items];
  return sort === 'size'
    ? items.sort((a, b) => b.sizeBytes - a.sizeBytes)
    : items.sort((a, b) => b.modifiedMs - a.modifiedMs);
}

/**
 * Flattens categories into the rows of one virtualized list. During a search every category
 * with a match is opened and the others are hidden.
 */
export function buildRows(
  categories: readonly CategoryResult[],
  expanded: ReadonlySet<CategoryId>,
  query: string,
  sort: SortKey,
): Row[] {
  const searching = query.trim() !== '';
  const rows: Row[] = [];
  for (const category of categories) {
    const items = visibleItems(category, query, sort);
    if (searching && items.length === 0) continue;
    rows.push({ kind: 'category', category, matches: items.length });
    if (searching || expanded.has(category.id)) {
      for (const item of items) rows.push({ kind: 'item', categoryId: category.id, item });
    }
  }
  return rows;
}

/** The scan result once some items have left the disk: they disappear from every total. */
export function withoutItems(result: ScanDone, removed: ReadonlySet<string>): ScanDone {
  if (removed.size === 0) return result;
  const categories = result.categories
    .map((category) => {
      const items = category.items.filter((item) => !removed.has(item.path));
      const totalBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0);
      return { ...category, items, totalBytes };
    })
    .filter((category) => category.items.length > 0)
    .sort((a, b) => b.totalBytes - a.totalBytes);
  return { ...result, categories };
}

export function withoutCategory(result: ScanDone, id: CategoryId): ScanDone {
  return { ...result, categories: result.categories.filter((category) => category.id !== id) };
}
