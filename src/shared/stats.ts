import { ext } from './ext';

/** Usage counters, kept on this device only (storage.local) and never sent anywhere. */
export interface Stats {
  /** Swedish words shown, counted once per spot on a page. */
  words: number;
  /** Page visits that got at least one Swedish word. */
  pages: number;
}

const KEY = 'stats';
const EMPTY: Stats = { words: 0, pages: 0 };

const area = () => ext.storage.local;

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

export function toStats(value: unknown): Stats {
  const v = (value ?? {}) as Partial<Stats>;
  return { words: count(v.words), pages: count(v.pages) };
}

export async function loadStats(): Promise<Stats> {
  const stored = await area().get(KEY);
  return toStats(stored[KEY] ?? EMPTY);
}

let queue: Promise<unknown> = Promise.resolve();

/** Adds to the counters. Calls run one after another, so increments from several tabs are never lost. */
export function addStats(delta: Stats): Promise<void> {
  const next = queue.then(async () => {
    const stats = await loadStats();
    await area().set({ [KEY]: { words: stats.words + delta.words, pages: stats.pages + delta.pages } });
  });
  queue = next.catch(() => {});
  return next;
}

export function onStatsChanged(listener: (stats: Stats) => void): void {
  ext.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[KEY]) listener(toStats(changes[KEY].newValue));
  });
}
