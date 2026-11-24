import { useEffect, useMemo, useState } from 'react';
import type { DuplicateGroup, ScanItem } from '../../shared/types';
import { SelectionFooter } from '../components/SelectionFooter';
import { buttonStyles, cardStyle } from '../components/ui';
import { formatBytes, formatDate, splitPath } from '../format';
import { useScan } from '../scan/ScanContext';
import { summarizeSelection } from '../scan/selection';
import { strings } from '../strings';

const numberFormat = new Intl.NumberFormat('fr-FR');

export function DuplicatesPage() {
  const { result, selected, setSelected } = useScan();
  const [folders, setFolders] = useState<string[] | null>(null);
  const [foldersChanged, setFoldersChanged] = useState(false);
  /** Originals the user explicitly allowed to be checked. */
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    void window.macsweep.settings
      .get()
      .then((settings) => setFolders(settings.duplicateDirs))
      .catch(() => setFolders([]));
  }, []);

  async function addFolder() {
    const folder = await window.macsweep.dialog.pickFolder().catch(() => null);
    if (!folder || !folders || folders.includes(folder)) return;
    const settings = await window.macsweep.settings.set({ duplicateDirs: [...folders, folder] });
    setFolders(settings.duplicateDirs);
    setFoldersChanged(true);
  }

  const category = result?.categories.find((c) => c.id === 'duplicates');
  const groups = result?.duplicateGroups ?? [];
  const details = useMemo(
    () => summarizeSelection(category ? [category] : [], selected),
    [category, selected],
  );
  const root = result?.root ?? '';

  function selectCopies() {
    setSelected(
      groups.flatMap((group) => group.files.slice(1).map((file) => file.path)),
      true,
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 px-8 pb-4">
        <h1 className="text-2xl font-semibold">{strings.duplicates.title}</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{strings.duplicates.intro}</p>
        <section aria-labelledby="duplicate-folders" className="text-sm">
          <h2 id="duplicate-folders" className="mb-1 font-medium">
            {strings.duplicates.folders}
          </h2>
          {folders && folders.length === 0 && <p>{strings.duplicates.noFolders}</p>}
          <ul
            data-testid="duplicate-folders"
            className="mb-2 text-neutral-600 dark:text-neutral-400"
          >
            {folders?.map((folder) => (
              <li key={folder}>
                {splitPath(folder, root).folder + '/' + splitPath(folder, root).name}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void addFolder()}
              className={buttonStyles.secondary}
            >
              {strings.duplicates.addFolder}
            </button>
            {groups.length > 0 && (
              <button type="button" onClick={selectCopies} className={buttonStyles.secondary}>
                {strings.duplicates.selectCopies}
              </button>
            )}
            {foldersChanged && (
              <span className="text-xs text-neutral-500">{strings.duplicates.rescan}</span>
            )}
          </div>
        </section>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto border-y border-neutral-200 px-8 py-4 dark:border-neutral-800">
        {!result && <p>{strings.duplicates.noScan}</p>}
        {result && groups.length === 0 && folders && folders.length > 0 && (
          <p>{strings.duplicates.empty}</p>
        )}
        <ul className="flex flex-col gap-3">
          {groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              root={root}
              selected={selected}
              unlocked={unlocked}
              onToggle={(path, checked) => setSelected([path], checked)}
              onUnlock={(path) => setUnlocked((current) => new Set(current).add(path))}
            />
          ))}
        </ul>
      </div>

      <SelectionFooter details={details} />
    </div>
  );
}

interface GroupCardProps {
  group: DuplicateGroup;
  root: string;
  selected: ReadonlySet<string>;
  unlocked: ReadonlySet<string>;
  onToggle: (path: string, checked: boolean) => void;
  onUnlock: (path: string) => void;
}

function GroupCard({ group, root, selected, unlocked, onToggle, onUnlock }: GroupCardProps) {
  const reclaimable = group.sizeBytes * (group.files.length - 1);
  return (
    <li data-testid="duplicate-group" className={`${cardStyle} p-4`}>
      <p className="mb-2 text-sm font-medium">
        {strings.duplicates.group(
          numberFormat.format(group.files.length),
          formatBytes(group.sizeBytes),
        )}
        <span className="ml-2 text-neutral-500">
          · {strings.duplicates.reclaimable(formatBytes(reclaimable))}
        </span>
      </p>
      <ul className="flex flex-col gap-1">
        {group.files.map((file, index) => (
          <FileRow
            key={file.path}
            file={file}
            root={root}
            isOriginal={index === 0}
            locked={index === 0 && !unlocked.has(file.path)}
            checked={selected.has(file.path)}
            onToggle={onToggle}
            onUnlock={onUnlock}
          />
        ))}
      </ul>
    </li>
  );
}

interface FileRowProps {
  file: ScanItem;
  root: string;
  isOriginal: boolean;
  locked: boolean;
  checked: boolean;
  onToggle: (path: string, checked: boolean) => void;
  onUnlock: (path: string) => void;
}

function FileRow({ file, root, isOriginal, locked, checked, onToggle, onUnlock }: FileRowProps) {
  const { name, folder } = splitPath(file.path, root);
  return (
    <li
      data-testid="duplicate-file"
      data-path={file.path}
      className="flex items-center gap-3 text-sm"
    >
      <input
        type="checkbox"
        aria-label={strings.review.selectItem(file.path)}
        checked={checked}
        disabled={locked}
        onChange={(event) => onToggle(file.path, event.target.checked)}
        className="size-4 accent-blue-600"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate" title={file.path}>
          {name}
          {isOriginal && (
            <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800 dark:bg-green-900/40 dark:text-green-300">
              {strings.duplicates.original}
            </span>
          )}
        </p>
        <p className="truncate text-xs text-neutral-500">{folder}</p>
      </div>
      {locked && (
        <button
          type="button"
          onClick={() => onUnlock(file.path)}
          aria-label={strings.duplicates.unlockLabel(name)}
          className={buttonStyles.ghost}
        >
          {strings.duplicates.unlock}
        </button>
      )}
      <span className="w-28 text-right text-xs text-neutral-600 dark:text-neutral-400">
        {formatDate(file.modifiedMs)}
      </span>
      <button
        type="button"
        aria-label={`${strings.review.reveal} : ${file.path}`}
        onClick={() => void window.macsweep.fs.reveal(file.path).catch(() => undefined)}
        className={buttonStyles.ghost}
      >
        {strings.review.revealShort}
      </button>
    </li>
  );
}
