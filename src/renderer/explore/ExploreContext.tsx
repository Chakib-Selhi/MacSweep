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
import type { ExploreDone, ExploreProgress, ExploreScope } from '../../shared/types';
import { strings } from '../strings';

interface ExploreState {
  running: boolean;
  progress: ExploreProgress | null;
  done: ExploreDone | null;
  error: string | null;
  start: (scope: ExploreScope) => Promise<void>;
  cancel: () => void;
}

const ExploreContext = createContext<ExploreState | null>(null);

/** Lives above the pages, so leaving the Exploration screen keeps the map and a running walk. */
export function ExploreProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ExploreProgress | null>(null);
  const [done, setDone] = useState<ExploreDone | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentId = useRef<string | null>(null);
  // A small folder can be explored before `start` has even returned its id.
  const early = useRef<ExploreDone | null>(null);

  const finish = useCallback((next: ExploreDone) => {
    currentId.current = null;
    setRunning(false);
    setProgress(null);
    setDone(next);
  }, []);

  useEffect(() => {
    const offProgress = window.macsweep.explore.onProgress((next) => {
      if (next.exploreId === currentId.current) setProgress(next);
    });
    const offDone = window.macsweep.explore.onDone((next) => {
      if (next.exploreId === currentId.current) finish(next);
      else early.current = next;
    });
    return () => {
      offProgress();
      offDone();
    };
  }, [finish]);

  const start = useCallback(
    async (scope: ExploreScope) => {
      setError(null);
      setDone(null);
      setProgress(null);
      try {
        early.current = null;
        const exploreId = await window.macsweep.explore.start(scope);
        const finishedEarly = early.current as ExploreDone | null;
        if (finishedEarly?.exploreId === exploreId) {
          finish(finishedEarly);
          return;
        }
        currentId.current = exploreId;
        setRunning(true);
      } catch {
        setError(strings.explore.startError);
      }
    },
    [finish],
  );

  const cancel = useCallback(() => {
    if (currentId.current) void window.macsweep.explore.cancel(currentId.current);
  }, []);

  const value = useMemo(
    () => ({ running, progress, done, error, start, cancel }),
    [running, progress, done, error, start, cancel],
  );
  return <ExploreContext.Provider value={value}>{children}</ExploreContext.Provider>;
}

export function useExplore(): ExploreState {
  const value = useContext(ExploreContext);
  if (!value) throw new Error('useExplore doit être utilisé dans ExploreProvider');
  return value;
}
