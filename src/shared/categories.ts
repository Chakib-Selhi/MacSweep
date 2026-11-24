export const CATEGORY_IDS = [
  'user-caches',
  'user-logs',
  'xcode-derived-data',
  'xcode-archives',
  'ios-simulators',
  'ios-device-support',
  'js-package-caches',
  'homebrew-cache',
  'jvm-caches',
  'node-modules',
  'downloaded-installers',
  'trash',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export type RiskLevel = 'low' | 'medium' | 'high';

export interface CategoryMeta {
  risk: RiskLevel;
  defaultChecked: boolean;
  /** Emptying the Trash is permanent: it never goes through shell.trashItem. */
  permanent?: boolean;
}

export const CATEGORY_META: Record<CategoryId, CategoryMeta> = {
  'user-caches': { risk: 'low', defaultChecked: true },
  'user-logs': { risk: 'low', defaultChecked: true },
  'xcode-derived-data': { risk: 'low', defaultChecked: true },
  'xcode-archives': { risk: 'medium', defaultChecked: false },
  'ios-simulators': { risk: 'low', defaultChecked: true },
  'ios-device-support': { risk: 'medium', defaultChecked: false },
  'js-package-caches': { risk: 'low', defaultChecked: true },
  'homebrew-cache': { risk: 'low', defaultChecked: true },
  'jvm-caches': { risk: 'medium', defaultChecked: false },
  'node-modules': { risk: 'medium', defaultChecked: false },
  'downloaded-installers': { risk: 'medium', defaultChecked: false },
  trash: { risk: 'low', defaultChecked: false, permanent: true },
};

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && (CATEGORY_IDS as readonly string[]).includes(value);
}
