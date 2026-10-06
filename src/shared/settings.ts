import { ext } from './ext';

export interface Settings {
  /** Master switch. */
  enabled: boolean;
  /** Slider level 1..10, see DENSITY_RATES. */
  density: number;
}

export const DEFAULTS: Settings = { enabled: true, density: 4 };

/** Share of the words in eligible text replaced at each slider level. */
export const DENSITY_RATES = [0.01, 0.02, 0.03, 0.04, 0.06, 0.08, 0.1, 0.13, 0.16, 0.2];

export const densityRate = (level: number): number =>
  DENSITY_RATES[Math.min(DENSITY_RATES.length, Math.max(1, Math.round(level))) - 1];

// Disabled sites are stored one key each ("site:example.com": false) so the
// list never runs into storage.sync's per-item size limit.
const SITE_PREFIX = 'site:';
export const siteKey = (host: string): string => SITE_PREFIX + host;
export const isSiteKey = (key: string): boolean => key.startsWith(SITE_PREFIX);

const area = () => ext.storage.sync;

export async function loadSettings(): Promise<Settings> {
  // Passing the defaults returns them for keys that were never stored.
  const stored = (await area().get({ ...DEFAULTS })) as Partial<Settings>;
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await area().set(patch);
}

export async function isSiteEnabled(host: string): Promise<boolean> {
  const key = siteKey(host);
  const stored = await area().get(key);
  return stored[key] !== false;
}

export async function setSiteEnabled(host: string, enabled: boolean): Promise<void> {
  if (enabled) await area().remove(siteKey(host));
  else await area().set({ [siteKey(host)]: false });
}

export type StorageChanges = Record<string, chrome.storage.StorageChange>;

export function onSettingsChanged(listener: (changes: StorageChanges) => void): void {
  ext.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') listener(changes);
  });
}
