import { describe, expect, it } from 'vitest';
import { CATEGORY_IDS } from '../../src/shared/categories';
import {
  expectNoArgs,
  expectScanId,
  expectSingleString,
  IpcValidationError,
  parseCleanArgs,
  parseScanArgs,
  parseSettingsPatch,
} from '../../src/main/ipc-validation';

describe('expectNoArgs', () => {
  it('accepte un appel sans argument', () => {
    expect(expectNoArgs([])).toEqual([]);
  });

  it('refuse un appel forgé avec des arguments', () => {
    expect(() => expectNoArgs(['/System'])).toThrow(IpcValidationError);
    expect(() => expectNoArgs([undefined])).toThrow(IpcValidationError);
  });
});

describe('expectSingleString', () => {
  it('accepte une chaîne', () => {
    expect(expectSingleString(['/a'])).toEqual(['/a']);
  });

  it.each([[[]], [[42]], [[null]], [['/a', '/b']], [[['/a']]]])('refuse %j', (raw) => {
    expect(() => expectSingleString(raw)).toThrow(IpcValidationError);
  });
});

describe('expectScanId', () => {
  it('accepte un UUID', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(expectScanId([id])).toEqual([id]);
  });

  it.each(['', 'abc', '../../etc', '0F8FAD5B-D9CB-469F-A165-70867728950E '])('refuse %j', (id) => {
    expect(() => expectScanId([id])).toThrow(IpcValidationError);
  });
});

describe('parseScanArgs', () => {
  it('scanne toutes les catégories par défaut', () => {
    expect(parseScanArgs([])).toEqual([{ categories: [...CATEGORY_IDS] }]);
    expect(parseScanArgs([{}])).toEqual([{ categories: [...CATEGORY_IDS] }]);
  });

  it('garde les catégories demandées, sans doublon', () => {
    expect(parseScanArgs([{ categories: ['user-logs', 'user-logs', 'trash'] }])).toEqual([
      { categories: ['user-logs', 'trash'] },
    ]);
  });

  it.each([
    ['une catégorie inconnue', [{ categories: ['system'] }]],
    ['un champ en trop', [{ categories: [], root: '/' }]],
    ['un champ racine forgé', [{ home: '/' }]],
    ['une chaîne', ['user-logs']],
    ['un tableau', [['user-logs']]],
    ['trop d’arguments', [{}, {}]],
    ['categories non tableau', [{ categories: 'user-logs' }]],
    ['une liste démesurée', [{ categories: Array(100).fill('user-logs') }]],
  ])('refuse %s', (_label, raw) => {
    expect(() => parseScanArgs(raw)).toThrow(IpcValidationError);
  });
});

describe('parseCleanArgs', () => {
  it('accepte une liste et des options valides (les chemins sont vérifiés ensuite par le guard)', () => {
    expect(parseCleanArgs([['/a', 42], { dryRun: true }])).toEqual([['/a', 42], { dryRun: true }]);
  });

  it.each([
    ['sans options', [['/a']]],
    ['une chaîne au lieu d’une liste', ['/a', { dryRun: true }]],
    ['dryRun absent', [['/a'], {}]],
    ['dryRun non booléen', [['/a'], { dryRun: 'non' }]],
    ['un champ en trop', [['/a'], { dryRun: false, force: true }]],
    ['des options non objet', [['/a'], 'dryRun']],
  ])('refuse %s', (_label, raw) => {
    expect(() => parseCleanArgs(raw)).toThrow(IpcValidationError);
  });
});

describe('parseSettingsPatch', () => {
  it('accepte dryRun', () => {
    expect(parseSettingsPatch([{ dryRun: false }])).toEqual([{ dryRun: false }]);
  });

  it.each([[[{}]], [[{ dryRun: 1 }]], [[{ root: '/' }]], [['dryRun']], [[]]])(
    'refuse %j',
    (raw) => {
      expect(() => parseSettingsPatch(raw)).toThrow(IpcValidationError);
    },
  );
});
