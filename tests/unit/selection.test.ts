import { describe, expect, it } from 'vitest';
import type { CategoryResult, ScanDone, ScanItem } from '../../src/shared/types';
import {
  buildRows,
  categorySelection,
  defaultSelection,
  isReviewCategory,
  isSelectable,
  selectionSummary,
  setMany,
  summarizeSelection,
  visibleItems,
  withoutCategory,
  withoutItems,
} from '../../src/renderer/scan/selection';

const item = (path: string, sizeBytes: number, modifiedMs = 0, openApp?: string): ScanItem => ({
  path,
  sizeBytes,
  modifiedMs,
  isDirectory: true,
  ...(openApp ? { openApp } : {}),
});

const caches: CategoryResult = {
  id: 'user-caches',
  totalBytes: 600,
  filesVisited: 3,
  items: [
    item('/h/Library/Caches/a', 300, 3),
    item('/h/Library/Caches/Chrome', 200, 1, 'Google Chrome'),
    item('/h/Library/Caches/b', 100, 2),
  ],
};
const archives: CategoryResult = {
  id: 'xcode-archives',
  totalBytes: 50,
  filesVisited: 1,
  items: [item('/h/Library/Developer/Xcode/Archives/2026', 50)],
};
const trash: CategoryResult = {
  id: 'trash',
  totalBytes: 10,
  filesVisited: 1,
  items: [item('/h/.Trash/x', 10)],
};
const result: ScanDone = {
  scanId: 's',
  status: 'completed',
  root: '/h',
  duplicateGroups: [],
  categories: [caches, archives, trash],
  deniedCount: 0,
  deniedDirs: [],
  durationMs: 1,
};

describe('isSelectable', () => {
  it('refuse les éléments d’une app ouverte et la Corbeille (vidage à part)', () => {
    expect(isSelectable('user-caches', item('/a', 1))).toBe(true);
    expect(isSelectable('user-caches', item('/a', 1, 0, 'Safari'))).toBe(false);
    expect(isSelectable('trash', item('/h/.Trash/x', 1))).toBe(false);
  });
});

describe('defaultSelection', () => {
  it('coche les catégories à faible risque, sans les apps ouvertes', () => {
    expect([...defaultSelection(result)].sort()).toEqual([
      '/h/Library/Caches/a',
      '/h/Library/Caches/b',
    ]);
  });
});

describe('selectionSummary et categorySelection', () => {
  const selected = defaultSelection(result);

  it('additionne le nombre et la taille des éléments cochés', () => {
    expect(selectionSummary(result, selected)).toEqual({ count: 2, bytes: 400 });
  });

  it('donne l’état de chaque catégorie, en ignorant ce qui n’est pas cochable', () => {
    expect(categorySelection(caches, selected)).toEqual({ state: 'all', bytes: 400, count: 2 });
    expect(categorySelection(archives, selected)).toEqual({ state: 'none', bytes: 0, count: 0 });
    expect(categorySelection(caches, new Set(['/h/Library/Caches/a']))).toMatchObject({
      state: 'some',
    });
    expect(categorySelection(trash, selected).state).toBe('none');
  });
});

describe('setMany', () => {
  it('coche et décoche sans modifier l’ensemble d’origine', () => {
    const original = new Set(['/x']);
    const added = setMany(original, ['/y', '/z'], true);
    expect([...added].sort()).toEqual(['/x', '/y', '/z']);
    expect([...setMany(added, ['/x', '/y'], false)]).toEqual(['/z']);
    expect([...original]).toEqual(['/x']);
  });
});

describe('visibleItems', () => {
  it('filtre sans tenir compte de la casse et trie par taille ou par date', () => {
    expect(visibleItems(caches, '', 'size').map((i) => i.sizeBytes)).toEqual([300, 200, 100]);
    expect(visibleItems(caches, '', 'date').map((i) => i.modifiedMs)).toEqual([3, 2, 1]);
    expect(visibleItems(caches, 'CHROME', 'size').map((i) => i.path)).toEqual([
      '/h/Library/Caches/Chrome',
    ]);
  });
});

describe('buildRows', () => {
  it('liste les en-têtes et les éléments des catégories ouvertes', () => {
    const rows = buildRows(result.categories, new Set(['xcode-archives']), '', 'size');
    expect(rows.map((r) => (r.kind === 'category' ? r.category.id : r.item.path))).toEqual([
      'user-caches',
      'xcode-archives',
      '/h/Library/Developer/Xcode/Archives/2026',
      'trash',
    ]);
  });

  it('pendant une recherche, ouvre et ne garde que les catégories qui ont un résultat', () => {
    const rows = buildRows(result.categories, new Set(), 'chrome', 'size');
    expect(rows.map((r) => (r.kind === 'category' ? r.category.id : r.item.path))).toEqual([
      'user-caches',
      '/h/Library/Caches/Chrome',
    ]);
  });

  it('reste rapide avec 100 000 éléments', () => {
    const big: CategoryResult = {
      id: 'user-caches',
      totalBytes: 0,
      filesVisited: 0,
      items: Array.from({ length: 100_000 }, (_, i) => item(`/h/Library/Caches/f${i}`, i, i)),
    };
    const started = performance.now();
    const rows = buildRows([big], new Set(['user-caches']), 'f9', 'date');
    expect(rows.length).toBeGreaterThan(1);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe('withoutItems et withoutCategory', () => {
  it('retire les éléments nettoyés, recalcule les totaux et masque les catégories vides', () => {
    const next = withoutItems(
      result,
      new Set(['/h/Library/Caches/a', '/h/Library/Developer/Xcode/Archives/2026']),
    );
    expect(next.categories.map((c) => c.id)).toEqual(['user-caches', 'trash']);
    expect(next.categories[0]?.totalBytes).toBe(300);
    expect(result.categories).toHaveLength(3);
  });

  it('retire une catégorie entière', () => {
    expect(withoutCategory(result, 'trash').categories.map((c) => c.id)).toEqual([
      'user-caches',
      'xcode-archives',
    ]);
  });
});

describe('M5 : information seule, pages dédiées et résumé de sélection', () => {
  const docker: CategoryResult = {
    id: 'docker-data',
    totalBytes: 9,
    filesVisited: 1,
    items: [item('/h/Library/Containers/com.docker.docker/Data/vms', 9)],
  };
  const large: CategoryResult = {
    id: 'large-files',
    totalBytes: 500,
    filesVisited: 2,
    items: [
      { ...item('/h/Documents/film.mov', 400), protected: true },
      item('/h/Downloads/image.dmg', 100),
    ],
  };

  it('ne rend jamais cochable une catégorie d’information', () => {
    expect(isSelectable('docker-data', docker.items[0] as ScanItem)).toBe(false);
  });

  it('sépare les catégories de la revue de celles qui ont leur écran', () => {
    expect(isReviewCategory(caches)).toBe(true);
    expect(isReviewCategory(large)).toBe(false);
  });

  it('résume chemins, totaux, éléments protégés et risque élevé', () => {
    const selected = new Set(['/h/Documents/film.mov', '/h/Library/Caches/a']);
    expect(summarizeSelection([caches, large], selected)).toEqual({
      paths: ['/h/Library/Caches/a', '/h/Documents/film.mov'],
      totalBytes: 700,
      shares: [
        { id: 'user-caches', count: 1, bytes: 300 },
        { id: 'large-files', count: 1, bytes: 400 },
      ],
      protectedCount: 1,
      highRisk: true,
    });
  });

  it('ne compte qu’une fois un chemin présent dans deux catégories', () => {
    const again: CategoryResult = { ...large, id: 'duplicates' };
    expect(summarizeSelection([large, again], new Set(['/h/Downloads/image.dmg'])).paths).toEqual([
      '/h/Downloads/image.dmg',
    ]);
  });
});
