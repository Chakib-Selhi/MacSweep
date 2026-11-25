import { describe, expect, it } from 'vitest';
import type { ExploreEntry } from '../../src/shared/types';
import { crumbs, exploreSelection, parentOf } from '../../src/renderer/explore/model';

const entry = (over: Partial<ExploreEntry>): ExploreEntry => ({
  kind: 'file',
  name: 'a',
  path: '/Users/q/a',
  sizeBytes: 10,
  fileCount: 1,
  denied: false,
  trashable: true,
  ...over,
});

describe('crumbs', () => {
  it('montre le dossier utilisateur comme ~', () => {
    expect(crumbs('/Users/q', '/Users/q', '/Users/q/Movies/2024')).toEqual([
      { label: '~', path: '/Users/q' },
      { label: 'Movies', path: '/Users/q/Movies' },
      { label: '2024', path: '/Users/q/Movies/2024' },
    ]);
  });

  it('part de la racine du disque', () => {
    expect(crumbs('/', '/Users/q', '/Users/q/Movies')).toEqual([
      { label: 'Macintosh HD', path: '/' },
      { label: 'Users', path: '/Users' },
      { label: '~', path: '/Users/q' },
      { label: 'Movies', path: '/Users/q/Movies' },
    ]);
  });
});

describe('parentOf', () => {
  it('remonte d’un dossier sans dépasser la racine explorée', () => {
    expect(parentOf('/Users/q', '/Users/q/Movies')).toBe('/Users/q');
    expect(parentOf('/', '/Users')).toBe('/');
    expect(parentOf('/Users/q', '/Users/q')).toBeNull();
    expect(parentOf('/', '/')).toBeNull();
  });
});

describe('exploreSelection', () => {
  it('additionne la sélection et demande toujours la confirmation du risque élevé', () => {
    const details = exploreSelection([
      entry({ path: '/Users/q/a', sizeBytes: 10 }),
      entry({ path: '/Users/q/Documents/b', sizeBytes: 5, protected: true }),
    ]);
    expect(details).toEqual({
      paths: ['/Users/q/a', '/Users/q/Documents/b'],
      totalBytes: 15,
      shares: [{ id: 'explorer', count: 2, bytes: 15 }],
      protectedCount: 1,
      highRisk: true,
    });
  });

  it('ignore ce qui n’est pas proposable', () => {
    const details = exploreSelection([
      entry({ trashable: false }),
      entry({ kind: 'others', trashable: true }),
    ]);
    expect(details.paths).toEqual([]);
    expect(details.shares).toEqual([]);
    expect(details.highRisk).toBe(false);
  });
});
