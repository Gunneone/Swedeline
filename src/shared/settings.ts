import { ext } from './ext';

export interface Settings {
  /** Master switch. */
  enabled: boolean;
  /** Share of the words in eligible text replaced, in percent (PERCENT_MIN..PERCENT_MAX). */
  percent: number;
}

export const PERCENT_MIN = 2;
export const PERCENT_MAX = 20;
export const DEFAULTS: Settings = { enabled: true, percent: 5 };

/** A stored percent, kept to whole steps within the slider's range. */
export function toPercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULTS.percent;
  return Math.min(PERCENT_MAX, Math.max(PERCENT_MIN, Math.round(value)));
}

// Up to 2026.10 the slider stored a level 1..10 under "density"; these were its percentages.
const LEGACY_DENSITY_PERCENTS = [1, 2, 3, 4, 6, 8, 10, 13, 16, 20];

/** Settings from what is stored, turning an old slider level into its percent. */
export function settingsFrom(stored: Record<string, unknown>): Settings {
  const { enabled, percent, density } = stored;
  const legacy =
    typeof density === 'number' ? LEGACY_DENSITY_PERCENTS[Math.min(10, Math.max(1, Math.round(density))) - 1] : undefined;
  return {
    enabled: typeof enabled === 'boolean' ? enabled : DEFAULTS.enabled,
    percent: toPercent(percent ?? legacy),
  };
}

// Disabled sites are stored one key each ("site:example.com": false) so the
// list never runs into storage.sync's per-item size limit.
const SITE_PREFIX = 'site:';
export const siteKey = (host: string): string => SITE_PREFIX + host;
export const isSiteKey = (key: string): boolean => key.startsWith(SITE_PREFIX);

const area = () => ext.storage.sync;

export async function loadSettings(): Promise<Settings> {
  return settingsFrom(await area().get(['enabled', 'percent', 'density']));
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
