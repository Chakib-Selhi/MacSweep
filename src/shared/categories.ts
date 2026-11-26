export const CATEGORY_IDS = [
  'user-caches',
  'browser-caches',
  'user-logs',
  'xcode-derived-data',
  'xcode-caches',
  'xcode-archives',
  'ios-simulators',
  'ios-device-support',
  'ios-updates',
  'ios-backups',
  'js-package-caches',
  'homebrew-cache',
  'jvm-caches',
  'dev-caches',
  'node-modules',
  'mail-downloads',
  'downloaded-installers',
  'docker-data',
  'large-files',
  'duplicates',
  'trash',
  'explorer',
  'uninstaller',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export type RiskLevel = 'low' | 'medium' | 'high';

/** Categories with a screen of their own instead of a section of the review list. */
export type CategoryPage = 'large-files' | 'duplicates';

export interface CategoryMeta {
  risk: RiskLevel;
  defaultChecked: boolean;
  /** Emptying the Trash is permanent: it never goes through shell.trashItem. */
  permanent?: boolean;
  /** Shown to explain where space goes, never offered for cleaning. */
  infoOnly?: boolean;
  page?: CategoryPage;
}

export const CATEGORY_META: Record<CategoryId, CategoryMeta> = {
  'user-caches': { risk: 'low', defaultChecked: true },
  'browser-caches': { risk: 'low', defaultChecked: true },
  'user-logs': { risk: 'low', defaultChecked: true },
  'xcode-derived-data': { risk: 'low', defaultChecked: true },
  'xcode-caches': { risk: 'low', defaultChecked: true },
  'xcode-archives': { risk: 'medium', defaultChecked: false },
  'ios-simulators': { risk: 'low', defaultChecked: true },
  'ios-device-support': { risk: 'medium', defaultChecked: false },
  'ios-updates': { risk: 'low', defaultChecked: true },
  'ios-backups': { risk: 'high', defaultChecked: false },
  'js-package-caches': { risk: 'low', defaultChecked: true },
  'homebrew-cache': { risk: 'low', defaultChecked: true },
  'jvm-caches': { risk: 'medium', defaultChecked: false },
  'dev-caches': { risk: 'medium', defaultChecked: false },
  'node-modules': { risk: 'medium', defaultChecked: false },
  'mail-downloads': { risk: 'medium', defaultChecked: false },
  'downloaded-installers': { risk: 'medium', defaultChecked: false },
  'docker-data': { risk: 'high', defaultChecked: false, infoOnly: true },
  'large-files': { risk: 'high', defaultChecked: false, page: 'large-files' },
  duplicates: { risk: 'high', defaultChecked: false, page: 'duplicates' },
  trash: { risk: 'low', defaultChecked: false, permanent: true },
  /** Items sent to the Trash from the disk map (D45), never part of a scan. */
  explorer: { risk: 'high', defaultChecked: false },
  /** Apps and their leftovers sent to the Trash by the uninstaller (D29, D47). */
  uninstaller: { risk: 'high', defaultChecked: false },
};

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && (CATEGORY_IDS as readonly string[]).includes(value);
}
