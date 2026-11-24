import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, percentOf, splitPath } from '../../src/renderer/format';

const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('formatBytes', () => {
  it.each([
    [0, '0 o'],
    [999, '999 o'],
    [1_500, '1,5 Ko'],
    [245_000_000_000, '245 Go'],
    [1_000_000_000_000, '1,0 To'],
  ])('%d → %s', (bytes, expected) => {
    expect(nbsp(formatBytes(bytes))).toBe(expected);
  });

  it('gère les valeurs invalides', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('percentOf', () => {
  it('arrondit et évite la division par zéro', () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(5, 0)).toBe(0);
  });
});

describe('splitPath', () => {
  it('sépare le nom et le dossier, la racine affichée comme ~', () => {
    expect(splitPath('/Users/x/Library/Caches/com.a', '/Users/x')).toEqual({
      name: 'com.a',
      folder: '~/Library/Caches',
    });
    expect(splitPath('/Users/x/Downloads', '/Users/x')).toEqual({ name: 'Downloads', folder: '~' });
    expect(splitPath('/Users/xy/a', '/Users/x')).toEqual({ name: 'a', folder: '/Users/xy' });
  });
});

describe('formatDuration', () => {
  it('affiche les millisecondes sous une seconde, puis des secondes', () => {
    expect(formatDuration(30)).toBe('30 ms');
    expect(formatDuration(0)).toBe('1 ms');
    expect(nbsp(formatDuration(2345))).toBe('2,3 s');
    expect(nbsp(formatDuration(42_000))).toBe('42 s');
  });
});
