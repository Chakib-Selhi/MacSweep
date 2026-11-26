import { CATEGORY_IDS, isCategoryId, type CategoryId } from '../shared/categories';
import type {
  CleanRequest,
  ExploreScope,
  UninstallRequest,
  InvokeArgs,
  InvokeChannel,
  ScanRequest,
  Settings,
} from '../shared/types';

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

export function parseExploreScope(raw: readonly unknown[]): [ExploreScope] {
  const [scope] = raw;
  if (raw.length !== 1 || (scope !== 'home' && scope !== 'disk')) {
    fail('La portée doit être « home » ou « disk »');
  }
  return [scope];
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

/**
 * clean:execute receives a list of paths and options. Only the shape is checked here: each path
 * goes through the guard in the cleaner, so the list stays `unknown[]` until then.
 */
const CLEAN_OPTIONS = new Set(['dryRun', 'confirmProtected', 'confirmHighRisk']);

export function parseCleanArgs(raw: readonly unknown[]): [string[], CleanRequest] {
  const [paths, request] = raw;
  if (raw.length !== 2 || !Array.isArray(paths)) fail('clean:execute attend une liste de chemins');
  if (!isPlainObject(request)) fail('clean:execute attend des options');
  if (Object.keys(request).some((key) => !CLEAN_OPTIONS.has(key))) fail('Option inconnue');
  const { dryRun, confirmProtected, confirmHighRisk } = request;
  if (typeof dryRun !== 'boolean') fail('dryRun doit être un booléen');
  for (const flag of [confirmProtected, confirmHighRisk]) {
    if (flag !== undefined && typeof flag !== 'boolean') fail('Confirmation invalide');
  }
  return [
    paths as string[],
    {
      dryRun,
      ...(confirmProtected === true ? { confirmProtected: true } : {}),
      ...(confirmHighRisk === true ? { confirmHighRisk: true } : {}),
    },
  ];
}

const MAX_LEFTOVERS = 1000;
const MAX_NAME_LENGTH = 255;
const UNINSTALL_KEYS = new Set(['confirmName', 'leftovers', 'dryRun']);

/** Shape only: the app goes through checkUninstallable, each leftover through the guard. */
export function parseUninstallArgs(raw: readonly unknown[]): [string, UninstallRequest] {
  const [appPath, request] = raw;
  if (raw.length !== 2 || typeof appPath !== 'string') fail('apps:uninstall attend une app');
  if (!isPlainObject(request)) fail('apps:uninstall attend des options');
  if (Object.keys(request).some((k) => !UNINSTALL_KEYS.has(k))) fail('Option inconnue');
  const { confirmName, leftovers, dryRun } = request;
  if (typeof confirmName !== 'string' || confirmName.length > MAX_NAME_LENGTH) {
    fail('confirmName doit être le nom de l’app');
  }
  if (
    !Array.isArray(leftovers) ||
    leftovers.length > MAX_LEFTOVERS ||
    !leftovers.every((item) => typeof item === 'string')
  ) {
    fail('leftovers doit être une liste de chemins');
  }
  if (typeof dryRun !== 'boolean') fail('dryRun doit être un booléen');
  return [appPath, { confirmName, leftovers, dryRun }];
}

const MAX_FOLDERS = 100;

function integerIn(value: unknown, min: number, max: number, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(`${name} doit être un entier entre ${min} et ${max}`);
  }
  return value;
}

/** Shape only: the folders themselves are checked by the guard before they are saved. */
function folderList(value: unknown, name: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_FOLDERS ||
    !value.every((item) => typeof item === 'string')
  ) {
    fail(`${name} doit être une liste de dossiers`);
  }
  return value;
}

const SETTING_PARSERS: { [K in keyof Settings]: (value: unknown) => Settings[K] } = {
  dryRun: (value) => {
    if (typeof value !== 'boolean') fail('dryRun doit être un booléen');
    return value;
  },
  exclusions: (value) => folderList(value, 'exclusions'),
  projectDirs: (value) => folderList(value, 'projectDirs'),
  duplicateDirs: (value) => folderList(value, 'duplicateDirs'),
  largeFileThresholdBytes: (value) =>
    integerIn(value, 1_000_000, 1_000_000_000_000, 'largeFileThresholdBytes'),
  duplicateMinBytes: (value) => integerIn(value, 1024, 100_000_000_000, 'duplicateMinBytes'),
  downloadsMinAgeDays: (value) => integerIn(value, 0, 3650, 'downloadsMinAgeDays'),
  nodeModulesMinAgeDays: (value) => integerIn(value, 0, 3650, 'nodeModulesMinAgeDays'),
};

function isSettingKey(key: string): key is keyof Settings {
  return Object.hasOwn(SETTING_PARSERS, key);
}

export function parseSettingsPatch(raw: readonly unknown[]): [Partial<Settings>] {
  const [patch] = raw;
  if (raw.length !== 1 || !isPlainObject(patch)) fail('settings:set attend un objet');
  const keys = Object.keys(patch);
  if (keys.length === 0) fail('Aucun réglage');
  const parsed: Record<string, unknown> = {};
  for (const key of keys) {
    if (!isSettingKey(key)) fail(`Réglage inconnu : ${key}`);
    parsed[key] = SETTING_PARSERS[key](patch[key]);
  }
  return [parsed];
}
