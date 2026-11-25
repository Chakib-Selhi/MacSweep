import type { ExploreEntry } from '../../shared/types';
import type { SelectionDetails } from '../scan/selection';

export interface Crumb {
  label: string;
  path: string;
}

const DISK_LABEL = 'Macintosh HD';

/** The path from the explored folder down to `current`, the home folder shown as `~`. */
export function crumbs(rootPath: string, homePath: string, current: string): Crumb[] {
  const label = (p: string) => {
    if (p === homePath) return '~';
    if (p === '/') return DISK_LABEL;
    return p.slice(p.lastIndexOf('/') + 1);
  };
  const result: Crumb[] = [{ label: label(rootPath), path: rootPath }];
  const rest =
    current === rootPath ? '' : current.slice(rootPath === '/' ? 1 : rootPath.length + 1);
  let at = rootPath;
  for (const segment of rest.split('/').filter(Boolean)) {
    at = at === '/' ? `/${segment}` : `${at}/${segment}`;
    result.push({ label: label(at), path: at });
  }
  return result;
}

export function parentOf(rootPath: string, current: string): string | null {
  if (current === rootPath) return null;
  const cut = current.lastIndexOf('/');
  return cut <= 0 ? '/' : current.slice(0, cut);
}

/** What the clean dialog needs; anything sent from the map counts as high risk (D45). */
export function exploreSelection(entries: readonly ExploreEntry[]): SelectionDetails {
  const chosen = entries.filter((entry) => entry.trashable && entry.kind !== 'others');
  const totalBytes = chosen.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  return {
    paths: chosen.map((entry) => entry.path),
    totalBytes,
    shares: chosen.length > 0 ? [{ id: 'explorer', count: chosen.length, bytes: totalBytes }] : [],
    protectedCount: chosen.filter((entry) => entry.protected).length,
    highRisk: chosen.length > 0,
  };
}
