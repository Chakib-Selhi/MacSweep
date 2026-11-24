import { useEffect, useState } from 'react';
import type { DiskInfo } from '../../shared/types';
import { ScanPanel } from '../components/ScanPanel';
import { formatBytes, percentOf } from '../format';
import { strings } from '../strings';

type DiskState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; info: DiskInfo };

export function Dashboard() {
  const [disk, setDisk] = useState<DiskState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    window.macsweep.disk
      .info()
      .then((info) => !cancelled && setDisk({ status: 'ready', info }))
      .catch(() => !cancelled && setDisk({ status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <h1 className="mb-6 text-2xl font-semibold">{strings.nav.dashboard}</h1>
      <div className="max-w-xl rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
        <h2 className="mb-3 text-sm font-medium text-neutral-600 dark:text-neutral-400">
          {strings.dashboard.diskTitle}
        </h2>
        {disk.status === 'loading' && <p>{strings.dashboard.loading}</p>}
        {disk.status === 'error' && (
          <p role="alert" className="text-red-700 dark:text-red-400">
            {strings.dashboard.error}
          </p>
        )}
        {disk.status === 'ready' && <DiskGauge info={disk.info} />}
      </div>
      <div className="mt-6">
        <ScanPanel />
      </div>
    </section>
  );
}

function DiskGauge({ info }: { info: DiskInfo }) {
  const percent = percentOf(info.usedBytes, info.totalBytes);
  return (
    <div data-testid="disk-gauge">
      <div
        role="meter"
        aria-label={strings.dashboard.usageLabel(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mb-4 h-3 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
      >
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
      </div>
      <dl className="grid grid-cols-3 gap-4 text-sm">
        <Stat label={strings.dashboard.used} value={formatBytes(info.usedBytes)} />
        <Stat label={strings.dashboard.free} value={formatBytes(info.freeBytes)} />
        <Stat label={strings.dashboard.total} value={formatBytes(info.totalBytes)} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-neutral-600 dark:text-neutral-400">{label}</dt>
      <dd className="text-lg font-medium tabular-nums">{value}</dd>
    </div>
  );
}
