import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ScanDone, ScanProgress } from '../../shared/types';
import { strings } from '../strings';
import { defaultSelection, setMany } from './selection';

export type ScanPhase = 'idle' | 'running' | 'done';

export interface ScanState {
  phase: ScanPhase;
  /** Latest progress per category, in the order the scan reached them. */
  progress: ScanProgress[];
  cancelling: boolean;
  result: ScanDone | null;
  selected: ReadonlySet<string>;
  error: string | null;
}

interface ScanActions {
  start: () => Promise<void>;
  cancel: () => void;
  setSelected: (paths: Iterable<string>, checked: boolean) => void;
}

const ScanContext = createContext<(ScanState & ScanActions) | null>(null);

const INITIAL: ScanState = {
  phase: 'idle',
  progress: [],
  cancelling: false,
  result: null,
  selected: new Set(),
  error: null,
};

function mergeProgress(list: ScanProgress[], next: ScanProgress): ScanProgress[] {
  const index = list.findIndex((p) => p.categoryId === next.categoryId);
  if (index === -1) return [...list, next];
  const copy = [...list];
  copy[index] = next;
  return copy;
}

export function ScanProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ScanState>(INITIAL);
  const scanId = useRef<string | null>(null);
  const cancelRequested = useRef(false);

  useEffect(() => {
    // Events from an older scan are ignored; before start() resolves the id is not known yet.
    const isCurrent = (id: string) => scanId.current === null || scanId.current === id;
    const offProgress = window.macsweep.scan.onProgress((progress) => {
      if (!isCurrent(progress.scanId)) return;
      setState((s) =>
        s.phase === 'running' ? { ...s, progress: mergeProgress(s.progress, progress) } : s,
      );
    });
    const offDone = window.macsweep.scan.onDone((result) => {
      if (!isCurrent(result.scanId)) return;
      setState((s) => ({
        ...s,
        phase: 'done',
        cancelling: false,
        result,
        selected: defaultSelection(result),
      }));
    });
    return () => {
      offProgress();
      offDone();
    };
  }, []);

  const start = useCallback(async () => {
    scanId.current = null;
    cancelRequested.current = false;
    setState((s) => ({ ...s, phase: 'running', progress: [], cancelling: false, error: null }));
    try {
      const id = await window.macsweep.scan.start();
      scanId.current = id;
      // Cancel clicked before the scan id came back: honour it now.
      if (cancelRequested.current) void window.macsweep.scan.cancel(id);
    } catch {
      setState((s) => ({
        ...s,
        phase: s.result ? 'done' : 'idle',
        error: strings.scan.startError,
      }));
    }
  }, []);

  const cancel = useCallback(() => {
    cancelRequested.current = true;
    setState((s) => ({ ...s, cancelling: true }));
    if (scanId.current) void window.macsweep.scan.cancel(scanId.current);
  }, []);

  const setSelected = useCallback((paths: Iterable<string>, checked: boolean) => {
    setState((s) => ({ ...s, selected: setMany(s.selected, paths, checked) }));
  }, []);

  const value = useMemo(
    () => ({ ...state, start, cancel, setSelected }),
    [state, start, cancel, setSelected],
  );
  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}

export function useScan(): ScanState & ScanActions {
  const value = useContext(ScanContext);
  if (!value) throw new Error('useScan doit être utilisé dans ScanProvider');
  return value;
}
