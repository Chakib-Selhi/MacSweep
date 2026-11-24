import { CATEGORY_IDS, isCategoryId, type CategoryId } from '../shared/categories';
import type { InvokeArgs, InvokeChannel, ScanRequest } from '../shared/types';

export type ArgsParser<C extends InvokeChannel> = (raw: readonly unknown[]) => InvokeArgs<C>;

export class IpcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpcValidationError';
  }
}

function fail(message: string): never {
  throw new IpcValidationError(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function expectNoArgs(raw: readonly unknown[]): [] {
  if (raw.length !== 0) fail('Ce canal ne prend aucun argument');
  return [];
}

/** The path itself is checked by the guard; here only the shape of the call. */
export function expectSingleString(raw: readonly unknown[]): [string] {
  const [value] = raw;
  if (raw.length !== 1 || typeof value !== 'string') fail('Une seule chaîne est attendue');
  return [value];
}

const SCAN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function expectScanId(raw: readonly unknown[]): [string] {
  const [scanId] = expectSingleString(raw);
  if (!SCAN_ID.test(scanId)) fail('Identifiant de scan invalide');
  return [scanId];
}

const ALL_CATEGORIES = (): CategoryId[] => [...CATEGORY_IDS];

/** Normalizes a scan request: every category when the request does not list them. */
export function parseScanArgs(raw: readonly unknown[]): [Required<ScanRequest>] {
  if (raw.length > 1) fail('scan:start prend au plus un argument');
  return [{ categories: parseCategories(raw[0]) }];
}

function parseCategories(request: unknown): CategoryId[] {
  if (request === undefined) return ALL_CATEGORIES();
  if (!isPlainObject(request)) fail('La requête de scan doit être un objet');

  const unknownKeys = Object.keys(request).filter((k) => k !== 'categories');
  if (unknownKeys.length > 0) fail(`Champ inconnu : ${unknownKeys.join(', ')}`);

  const { categories } = request;
  if (categories === undefined) return ALL_CATEGORIES();
  if (!Array.isArray(categories) || categories.length > CATEGORY_IDS.length) {
    fail('categories doit être une liste de catégories');
  }
  if (!categories.every(isCategoryId)) fail('Catégorie inconnue');
  return [...new Set(categories)];
}
