import Store from 'electron-store';
import type { HistoryEntry, Settings } from '../shared/types';
import { appendHistory, DEFAULT_SETTINGS } from './history';

interface StoreShape {
  settings: Settings;
  history: HistoryEntry[];
}

export interface AppStore {
  getSettings(): Settings;
  updateSettings(patch: Partial<Settings>): Settings;
  listHistory(): HistoryEntry[];
  addHistory(entry: HistoryEntry): void;
}

/** Settings and history, in a local JSON file under the app's data folder. */
export function createAppStore(): AppStore {
  const store = new Store<StoreShape>({
    name: 'macsweep',
    defaults: { settings: DEFAULT_SETTINGS, history: [] },
    clearInvalidConfig: true,
  });
  const getSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...store.get('settings') });

  return {
    getSettings,
    updateSettings(patch) {
      const next = { ...getSettings(), ...patch };
      store.set('settings', next);
      return next;
    },
    listHistory: () => store.get('history'),
    addHistory: (entry) => store.set('history', appendHistory(store.get('history'), entry)),
  };
}
