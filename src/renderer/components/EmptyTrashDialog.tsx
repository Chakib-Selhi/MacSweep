import { useId, useState } from 'react';
import type { TrashReport } from '../../shared/types';
import { formatBytes } from '../format';
import { useScan } from '../scan/ScanContext';
import { strings } from '../strings';
import { Dialog } from './Dialog';
import { buttonStyles } from './ui';

const CONFIRMATION = 'VIDER';
const numberFormat = new Intl.NumberFormat('fr-FR');

type Step =
  | { kind: 'confirm' }
  | { kind: 'running' }
  | { kind: 'done'; report: TrashReport }
  | { kind: 'error' };

/** Emptying the Trash is the only permanent action: the user has to type « VIDER ». */
/** Mounted only while open, so the typed word is always empty when it appears. */
export function EmptyTrashDialog({ onClose }: { onClose: () => void }) {
  const { dryRun, applyTrashReport } = useScan();
  const [step, setStep] = useState<Step>({ kind: 'confirm' });
  const [typed, setTyped] = useState('');
  const inputId = useId();

  async function run() {
    setStep({ kind: 'running' });
    try {
      const report = await window.macsweep.trash.empty(typed);
      applyTrashReport(report);
      setStep({ kind: 'done', report });
    } catch {
      setStep({ kind: 'error' });
    }
  }

  return (
    <Dialog
      open
      testId="empty-trash-dialog"
      title={strings.trash.title}
      canCancel={step.kind !== 'running'}
      onCancel={onClose}
    >
      {step.kind === 'confirm' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (typed === CONFIRMATION) void run();
          }}
        >
          <p className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
            {strings.trash.warning}
          </p>
          {dryRun && <p className="mb-3 text-sm">{strings.trash.dryNote}</p>}
          <label htmlFor={inputId} className="mb-1 block text-sm font-medium">
            {strings.trash.confirmLabel}
          </label>
          <input
            id={inputId}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="mb-5 w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-mono outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-neutral-700 dark:bg-neutral-950"
          />
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className={buttonStyles.secondary}>
              {strings.clean.cancel}
            </button>
            <button
              type="submit"
              disabled={typed !== CONFIRMATION}
              className={`${buttonStyles.primary} bg-red-600 hover:bg-red-700 disabled:hover:bg-red-600`}
            >
              {dryRun ? strings.trash.confirmDry : strings.trash.confirm}
            </button>
          </div>
        </form>
      )}

      {step.kind === 'running' && (
        <p role="status" aria-live="polite">
          {strings.clean.running}
        </p>
      )}

      {step.kind === 'done' && (
        <>
          <p role="status" className="mb-3 font-medium" data-testid="trash-report">
            {(step.report.dryRun ? strings.trash.reportDry : strings.trash.reportReal)(
              formatBytes(step.report.bytesFreed),
              numberFormat.format(step.report.deletedCount),
            )}
          </p>
          {step.report.failed.length > 0 && (
            <ul className="mb-4 max-h-40 overflow-y-auto text-sm text-red-700 dark:text-red-400">
              {step.report.failed.map((failure) => (
                <li key={failure.path}>{failure.message}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className={buttonStyles.primary}>
              {strings.clean.close}
            </button>
          </div>
        </>
      )}

      {step.kind === 'error' && (
        <>
          <p role="alert" className="mb-4 text-red-700 dark:text-red-400">
            {strings.clean.error}
          </p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className={buttonStyles.secondary}>
              {strings.clean.close}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
