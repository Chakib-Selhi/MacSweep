import type { PageId } from '../components/Sidebar';
import { strings } from '../strings';

interface PlaceholderProps {
  page: Exclude<PageId, 'dashboard'>;
  milestone: string;
}

export function Placeholder({ page, milestone }: PlaceholderProps) {
  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">{strings.nav[page]}</h1>
      <p className="text-neutral-600 dark:text-neutral-400">{strings.placeholder(milestone)}</p>
    </section>
  );
}
