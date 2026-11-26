import { strings } from '../strings';

export type PageId =
  'dashboard' | 'explorer' | 'apps' | 'largeFiles' | 'duplicates' | 'history' | 'settings';

const PAGES: readonly PageId[] = [
  'dashboard',
  'explorer',
  'apps',
  'largeFiles',
  'duplicates',
  'history',
  'settings',
];

interface SidebarProps {
  current: PageId;
  onSelect: (page: PageId) => void;
}

export function Sidebar({ current, onSelect }: SidebarProps) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-neutral-100/80 dark:border-neutral-800 dark:bg-neutral-950/60">
      <div className="h-13 [-webkit-app-region:drag]" />
      <nav aria-label={strings.nav.label} className="flex flex-col gap-0.5 px-3">
        {PAGES.map((page) => {
          const active = page === current;
          return (
            <button
              key={page}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelect(page)}
              className={`rounded-md px-3 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                active
                  ? 'bg-neutral-300/70 font-medium dark:bg-neutral-700/70'
                  : 'hover:bg-neutral-200 dark:hover:bg-neutral-800'
              }`}
            >
              {strings.nav[page]}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
