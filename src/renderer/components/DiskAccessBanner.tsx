import { useEffect, useState } from 'react';
import type { DiskAccess } from '../../shared/types';
import { strings } from '../strings';
import { buttonStyles } from './ui';

/** Shown only when macOS refuses MacSweep a protected folder; checked again on window focus. */
export function DiskAccessBanner() {
  const [access, setAccess] = useState<DiskAccess | null>(null);

  useEffect(() => {
    let live = true;
    const check = () => {
      void window.macsweep.access
        .status()
        .then((status) => live && setAccess(status))
        .catch(() => undefined);
    };
    check();
    window.addEventListener('focus', check);
    return () => {
      live = false;
      window.removeEventListener('focus', check);
    };
  }, []);

  if (access !== 'denied') return null;
  return (
    <section
      data-testid="disk-access-banner"
      aria-labelledby="disk-access-title"
      className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <h2 id="disk-access-title" className="mb-1 font-semibold">
        {strings.access.title}
      </h2>
      <p className="mb-3">{strings.access.body}</p>
      <details className="mb-3">
        <summary className="cursor-pointer font-medium">{strings.access.howTo}</summary>
        <ol className="mt-2 list-decimal pl-5">
          {strings.access.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </details>
      <button
        type="button"
        onClick={() => void window.macsweep.access.openSettings().catch(() => undefined)}
        className={buttonStyles.primary}
      >
        {strings.access.open}
      </button>
    </section>
  );
}
