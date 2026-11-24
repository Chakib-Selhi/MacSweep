import { useEffect, useId, useState } from 'react';
import type { Settings } from '../../shared/types';
import { buttonStyles, cardStyle } from '../components/ui';
import { formatBytes } from '../format';
import { useScan } from '../scan/ScanContext';
import { strings } from '../strings';

const THRESHOLDS = [100e6, 250e6, 500e6, 1e9, 2e9, 5e9];
const DUPLICATE_MINIMUMS = [100e3, 1e6, 10e6, 100e6];

type FolderKey = 'exclusions' | 'projectDirs' | 'duplicateDirs';
type Status = 'idle' | 'saved' | 'error';

export function SettingsPage() {
  const { dryRun, setDryRun } = useScan();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    void window.macsweep.settings
      .get()
      .then(setSettings)
      .catch(() => setStatus('error'));
  }, []);

  async function save(patch: Partial<Settings>) {
    try {
      setSettings(await window.macsweep.settings.set(patch));
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  async function addFolder(key: FolderKey) {
    if (!settings) return;
    const folder = await window.macsweep.dialog.pickFolder().catch(() => null);
    if (!folder || settings[key].includes(folder)) return;
    await save({ [key]: [...settings[key], folder] });
  }

  if (!settings) return <div className="px-8">{status === 'error' && strings.settings.error}</div>;

  return (
    <div className="h-full overflow-y-auto px-8 pb-8">
      <h1 className="mb-2 text-2xl font-semibold">{strings.settings.title}</h1>
      <p
        role="status"
        aria-live="polite"
        data-testid="settings-status"
        className="mb-4 h-5 text-sm"
      >
        {status === 'saved' && strings.settings.saved}
        {status === 'error' && (
          <span className="text-red-700 dark:text-red-400">{strings.settings.error}</span>
        )}
      </p>

      <div className="flex max-w-3xl flex-col gap-6">
        <section className={cardStyle} aria-labelledby="settings-cleaning">
          <h2 id="settings-cleaning" className="mb-3 font-medium">
            {strings.settings.cleaningTitle}
          </h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(event) => void setDryRun(event.target.checked)}
              className="size-4 accent-blue-600"
            />
            {strings.dryRun.toggle} ({strings.dryRun.hint})
          </label>
        </section>

        <section className={`${cardStyle} flex flex-col gap-4`} aria-labelledby="settings-scan">
          <h2 id="settings-scan" className="font-medium">
            {strings.settings.scanTitle}
          </h2>
          <SizeSelect
            label={strings.settings.threshold}
            value={settings.largeFileThresholdBytes}
            options={THRESHOLDS}
            onChange={(value) => void save({ largeFileThresholdBytes: value })}
          />
          <SizeSelect
            label={strings.settings.duplicateMin}
            value={settings.duplicateMinBytes}
            options={DUPLICATE_MINIMUMS}
            onChange={(value) => void save({ duplicateMinBytes: value })}
          />
          <DaysInput
            label={strings.settings.downloadsAge}
            value={settings.downloadsMinAgeDays}
            onChange={(value) => void save({ downloadsMinAgeDays: value })}
          />
          <DaysInput
            label={strings.settings.nodeModulesAge}
            value={settings.nodeModulesMinAgeDays}
            onChange={(value) => void save({ nodeModulesMinAgeDays: value })}
          />
        </section>

        <section className={`${cardStyle} flex flex-col gap-5`} aria-labelledby="settings-folders">
          <h2 id="settings-folders" className="font-medium">
            {strings.settings.foldersTitle}
          </h2>
          {(['exclusions', 'projectDirs', 'duplicateDirs'] as const).map((key) => (
            <FolderList
              key={key}
              testId={`folders-${key}`}
              label={strings.settings[key]}
              folders={settings[key]}
              onAdd={() => void addFolder(key)}
              onRemove={(folder) => void save({ [key]: settings[key].filter((f) => f !== folder) })}
            />
          ))}
        </section>
      </div>
    </div>
  );
}

function SizeSelect(props: {
  label: string;
  value: number;
  options: number[];
  onChange: (value: number) => void;
}) {
  const id = useId();
  const options = props.options.includes(props.value)
    ? props.options
    : [...props.options, props.value].sort((a, b) => a - b);
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <label htmlFor={id}>{props.label}</label>
      <select
        id={id}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
        className="rounded-md border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {formatBytes(option)}
          </option>
        ))}
      </select>
    </div>
  );
}

function DaysInput(props: { label: string; value: number; onChange: (value: number) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(String(props.value));
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type="number"
        min={0}
        max={3650}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const days = Number(draft);
          if (Number.isInteger(days) && days >= 0 && days <= 3650 && days !== props.value) {
            props.onChange(days);
          } else {
            setDraft(String(props.value));
          }
        }}
        className="w-24 rounded-md border border-neutral-300 bg-white px-2 py-1 text-right dark:border-neutral-700 dark:bg-neutral-900"
      />
    </div>
  );
}

function FolderList(props: {
  testId: string;
  label: string;
  folders: string[];
  onAdd: () => void;
  onRemove: (folder: string) => void;
}) {
  return (
    <div data-testid={props.testId} className="text-sm">
      <div className="mb-1 flex items-center justify-between gap-4">
        <p className="font-medium">{props.label}</p>
        <button type="button" onClick={props.onAdd} className={buttonStyles.secondary}>
          {strings.settings.add}
        </button>
      </div>
      {props.folders.length === 0 ? (
        <p className="text-neutral-500">{strings.settings.none}</p>
      ) : (
        <ul>
          {props.folders.map((folder) => (
            <li key={folder} className="flex items-center justify-between gap-4 py-0.5">
              <span className="truncate" title={folder}>
                {folder}
              </span>
              <button
                type="button"
                onClick={() => props.onRemove(folder)}
                aria-label={strings.settings.remove(folder)}
                className={buttonStyles.ghost}
              >
                {strings.settings.removeShort}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
