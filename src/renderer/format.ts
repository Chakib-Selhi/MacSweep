const UNITS = ['o', 'Ko', 'Mo', 'Go', 'To'] as const;

// Base 1000, like the Finder, so sizes match what macOS shows.
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  const number = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  return `${number} ${UNITS[unit]}`;
}

/** Splits a path into its name and its folder, the root shown as `~`. */
export function splitPath(fullPath: string, root: string): { name: string; folder: string } {
  const cut = fullPath.lastIndexOf('/');
  const name = fullPath.slice(cut + 1);
  const folder = fullPath.slice(0, Math.max(cut, 0));
  if (folder === root) return { name, folder: '~' };
  if (folder.startsWith(`${root}/`)) return { name, folder: `~${folder.slice(root.length)}` };
  return { name, folder };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} ms`;
  const seconds = ms / 1000;
  return `${seconds.toLocaleString('fr-FR', { maximumFractionDigits: seconds < 10 ? 1 : 0 })} s`;
}

export function percentOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });

export function formatDate(ms: number): string {
  return Number.isFinite(ms) && ms > 0 ? dateFormat.format(ms) : '—';
}
