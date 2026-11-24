import { useState } from 'react';
import { formatBytes } from '../format';
import { useScan } from '../scan/ScanContext';
import type { SelectionDetails } from '../scan/selection';
import { strings } from '../strings';
import { CleanDialog } from './CleanDialog';
import { buttonStyles } from './ui';

const numberFormat = new Intl.NumberFormat('fr-FR');

/** Selected total, simulation switch and clean button, shared by every screen that cleans. */
export function SelectionFooter({ details }: { details: SelectionDetails }) {
  const { dryRun, setDryRun } = useScan();
  const [open, setOpen] = useState(false);

  return (
    <footer
      data-testid="selection-bar"
      className="flex items-center justify-between gap-4 bg-neutral-50 px-8 py-3 dark:bg-neutral-950"
    >
      <p role="status" aria-live="polite" className="font-medium tabular-nums">
        {strings.review.selectedTotal(
          numberFormat.format(details.paths.length),
          formatBytes(details.totalBytes),
        )}
      </p>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(event) => void setDryRun(event.target.checked)}
            className="size-4 accent-blue-600"
          />
          <span>
            {strings.dryRun.toggle}
            <span className="ml-1 text-xs text-neutral-500">({strings.dryRun.hint})</span>
          </span>
        </label>
        <button
          type="button"
          disabled={details.paths.length === 0}
          onClick={() => setOpen(true)}
          className={buttonStyles.primary}
        >
          {strings.review.clean}
        </button>
      </div>
      {open && <CleanDialog details={details} onClose={() => setOpen(false)} />}
    </footer>
  );
}
