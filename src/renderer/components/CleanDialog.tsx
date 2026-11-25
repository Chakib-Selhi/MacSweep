import { useEffect, useState } from 'react';
import type { CleanProgress, CleanReport, CleanRequest } from '../../shared/types';
import { formatBytes, splitPath } from '../format';
import { useScan } from '../scan/ScanContext';
import type { SelectionDetails } from '../scan/selection';
import { strings } from '../strings';
import { Dialog } from './Dialog';
import { buttonStyles } from './ui';

type Step =
  | { kind: 'confirm' }
  | { kind: 'running'; progress?: CleanProgress }
  | { kind: 'done'; report: CleanReport }
  | { kind: 'error' };

export type CleanAction = (paths: string[], request: CleanRequest) => Promise<CleanReport>;

interface CleanDialogProps {
  details: SelectionDetails;
  onClose: () => void;
  /** The disk map cleans through its own channel; the scan screens use clean.execute. */
  execute?: CleanAction;
  onReport?: (report: CleanReport) => void;
}

const numberFormat = new Intl.NumberFormat('fr-FR');

/** Mounted only while open, so every opening starts fresh at the confirmation step. */
export function CleanDialog({ details, onClose, execute, onReport }: CleanDialogProps) {
  const { paths, totalBytes, shares, protectedCount, highRisk } = details;
  const { dryRun, applyCleanReport, result } = useScan();
  const [step, setStep] = useState<Step>({ kind: 'confirm' });
  const [protectedConfirmed, setProtectedConfirmed] = useState(false);
  const [highRiskConfirmed, setHighRiskConfirmed] = useState(false);
  const confirmed =
    (protectedCount === 0 || protectedConfirmed) && (!highRisk || highRiskConfirmed);

  useEffect(
    () =>
      window.macsweep.clean.onProgress((progress) =>
        setStep((current) =>
          current.kind === 'running' ? { kind: 'running', progress } : current,
        ),
      ),
    [],
  );

  async function run() {
    setStep({ kind: 'running' });
    try {
      const action: CleanAction =
        execute ?? ((list, request) => window.macsweep.clean.execute(list, request));
      const report = await action(paths, {
        dryRun,
        confirmProtected: protectedConfirmed,
        confirmHighRisk: highRiskConfirmed,
      });
      applyCleanReport(report);
      onReport?.(report);
      setStep({ kind: 'done', report });
    } catch {
      setStep({ kind: 'error' });
    }
  }

  const running = step.kind === 'running';
  return (
    <Dialog
      open
      testId="clean-dialog"
      title={dryRun ? strings.clean.titleDry : strings.clean.titleReal}
      canCancel={!running}
      onCancel={onClose}
    >
      {step.kind === 'confirm' && (
        <>
          <p className="text-lg font-medium tabular-nums">
            {strings.clean.summary(numberFormat.format(paths.length), formatBytes(totalBytes))}
          </p>
          <ul className="my-3 max-h-40 overflow-y-auto text-sm text-neutral-600 dark:text-neutral-400">
            {shares.map((share) => (
              <li key={share.id} className="flex justify-between gap-4">
                <span>{strings.categories[share.id]}</span>
                <span className="tabular-nums">
                  {numberFormat.format(share.count)} · {formatBytes(share.bytes)}
                </span>
              </li>
            ))}
          </ul>
          <p
            className={`mb-5 rounded-md p-3 text-sm ${
              dryRun
                ? 'bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-200'
                : 'bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
            }`}
          >
            {dryRun ? strings.clean.destinationDry : strings.clean.destinationReal}
          </p>
          {protectedCount > 0 && (
            <label className="mb-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={protectedConfirmed}
                onChange={(event) => setProtectedConfirmed(event.target.checked)}
                className="mt-0.5 size-4 accent-blue-600"
              />
              <span>{strings.clean.confirmProtected(numberFormat.format(protectedCount))}</span>
            </label>
          )}
          {highRisk && (
            <label className="mb-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={highRiskConfirmed}
                onChange={(event) => setHighRiskConfirmed(event.target.checked)}
                className="mt-0.5 size-4 accent-blue-600"
              />
              <span>{strings.clean.confirmHighRisk}</span>
            </label>
          )}
          <div className="mt-2 flex justify-end gap-3">
            <button type="button" onClick={onClose} className={buttonStyles.secondary}>
              {strings.clean.cancel}
            </button>
            <button
              type="button"
              disabled={!confirmed}
              onClick={() => void run()}
              className={buttonStyles.primary}
            >
              {dryRun ? strings.clean.confirmDry : strings.clean.confirmReal}
            </button>
          </div>
        </>
      )}

      {step.kind === 'running' && (
        <div role="status" aria-live="polite">
          <p className="mb-3">{strings.clean.running}</p>
          <progress
            className="mb-2 h-2 w-full accent-blue-600"
            max={step.progress?.total ?? paths.length}
            value={step.progress?.done ?? 0}
          />
          <p className="text-xs tabular-nums text-neutral-500">
            {strings.clean.progress(
              numberFormat.format(step.progress?.done ?? 0),
              numberFormat.format(step.progress?.total ?? paths.length),
            )}
          </p>
        </div>
      )}

      {step.kind === 'done' && (
        <>
          <p role="status" className="mb-3 font-medium" data-testid="clean-report">
            {(step.report.dryRun ? strings.clean.reportDry : strings.clean.reportReal)(
              formatBytes(step.report.bytesFreed),
              numberFormat.format(step.report.moved.length),
            )}
          </p>
          {step.report.failed.length > 0 && (
            <details open className="mb-4 text-sm" data-testid="clean-failures">
              <summary className="cursor-pointer font-medium">
                {strings.clean.failedTitle(step.report.failed.length)}
              </summary>
              <ul className="mt-2 max-h-48 overflow-y-auto">
                {step.report.failed.map((failure) => (
                  <li key={failure.path} className="flex justify-between gap-4 py-0.5">
                    <span className="truncate" title={failure.path}>
                      {splitPath(failure.path, result?.root ?? '').name}
                    </span>
                    <span className="shrink-0 text-neutral-600 dark:text-neutral-400">
                      {strings.clean.reasons[failure.reason]}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
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
