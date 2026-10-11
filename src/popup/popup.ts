import { ext, isFirefox } from '../shared/ext';
import { isWebUrl, normalizeHost } from '../shared/host';
import type { Message, PageState, PageStatus } from '../shared/messages';
import { isSiteEnabled, loadSettings, saveSettings, setSiteEnabled } from '../shared/settings';
import { loadReviewState, reviewMilestone, reviewUrl, saveReviewState, shouldAskForReview } from '../shared/review';
import { loadStats, onStatsChanged, type Stats } from '../shared/stats';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const t = (key: string, ...subs: (string | number)[]) => ext.i18n.getMessage(key, subs.map(String)) || key;

const HOST_ORIGINS = ['http://*/*', 'https://*/*'];

const enabledInput = $<HTMLInputElement>('enabled');
const siteInput = $<HTMLInputElement>('site');
const densityInput = $<HTMLInputElement>('density');

let tab: chrome.tabs.Tab | undefined;
let host = '';

function localize(): void {
  document.documentElement.lang = ext.i18n.getUILanguage();
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n!);
}

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([ext.i18n.getUILanguage()], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function showDensity(percent: number): void {
  $('density-value').textContent = t('popupDensityValue', percent);
}

async function pageStatus(): Promise<PageStatus | null> {
  if (tab?.id === undefined) return null;
  try {
    return (await ext.tabs.sendMessage(tab.id, { type: 'get-status' } satisfies Message)) ?? null;
  } catch {
    return null; // no content script: restricted page, or loaded before Swedeline was installed
  }
}

const STATUS_TEXT: Record<Exclude<PageState, 'active'>, string> = {
  loading: 'statusLoading',
  off: 'statusOff',
  'site-off': 'statusSiteOff',
  swedish: 'statusSwedish',
  unsupported: 'statusUnsupported',
  'no-text': 'statusNoText',
};

async function renderStatus(): Promise<void> {
  const status = await pageStatus();
  const el = $('status');
  el.className = 'status';
  let text: string;
  if (status?.state === 'active' && status.lang) {
    text = t('statusActive', languageName(status.lang), status.count);
    el.classList.add('active');
  } else if (status) {
    text = t(STATUS_TEXT[status.state as Exclude<PageState, 'active'>] ?? 'statusLoading');
  } else if (isWebUrl(tab?.url)) {
    text = t('statusReload');
    el.classList.add('warn');
  } else {
    text = t('statusUnavailable');
  }
  $('status-text').textContent = text;
}

/** A message with element substitutions: each sub fills one $n$ placeholder. */
function richMessage(key: string, ...subs: Node[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const marked = t(key, ...subs.map((_, i) => `\uE000${i}\uE000`));
  marked.split(/\uE000(\d)\uE000/).forEach((part, i) => {
    // Odd parts are the indexes captured from the markers.
    fragment.append(i % 2 ? subs[Number(part)] : part);
  });
  return fragment;
}

/** "12,483 Swedish words", with the number in bold. */
function countPhrase(n: number, key: 'statsWords' | 'statsPages'): DocumentFragment {
  const form = new Intl.PluralRules(ext.i18n.getUILanguage()).select(n) === 'one' ? 'One' : 'Other';
  return richMessage(key + form, boldNumber(n));
}

function showStats({ words, pages }: Stats): void {
  const el = $('stats');
  if (!words) el.textContent = t('statsNone');
  else el.replaceChildren(richMessage('statsSummary', countPhrase(words, 'statsWords'), countPhrase(pages, 'statsPages')));
}

function boldNumber(n: number): HTMLElement {
  const num = document.createElement('strong');
  num.textContent = new Intl.NumberFormat(ext.i18n.getUILanguage()).format(n);
  return num;
}

/** At 20k, 50k, 100k and every 100k words after that, a friendly request to rate Swedeline. */
async function renderReview(words: number): Promise<void> {
  const state = await loadReviewState();
  const card = $('review');
  card.hidden = !shouldAskForReview(words, state);
  if (card.hidden) return;
  const milestone = reviewMilestone(words);
  // "ord" (Swedish for "words") is highlighted like a word Swedeline put on a page.
  const ord = document.createElement('mark');
  ord.textContent = 'ord';
  ord.lang = 'sv';
  const count = document.createTextNode(new Intl.NumberFormat(ext.i18n.getUILanguage()).format(milestone));
  $('review-title').replaceChildren(richMessage('reviewTitle', count, ord));
  $('review-text').textContent = t('reviewText', t(isFirefox() ? 'reviewStoreFirefox' : 'reviewStoreChrome'));
  const answer = async (patch: Partial<typeof state>) => {
    card.hidden = true;
    await saveReviewState({ ...state, ...patch });
  };
  $('review-yes').onclick = async () => {
    await answer({ done: true });
    await ext.tabs.create({ url: reviewUrl() });
    window.close();
  };
  $('review-later').onclick = () => void answer({ answered: milestone });
  $('review-never').onclick = () => void answer({ done: true });
}

async function renderShortcut(): Promise<void> {
  const commands = await ext.commands.getAll();
  const keys = commands.find((c) => c.name === 'toggle-site')?.shortcut;
  $('shortcut').textContent = keys ? t('shortcutIs', keys) : t('shortcutSet');
}

async function openShortcutSettings(): Promise<void> {
  const commands = ext.commands as typeof ext.commands & { openShortcutSettings?: () => Promise<void> };
  if (isFirefox()) {
    if (commands.openShortcutSettings) await commands.openShortcutSettings();
    else $('shortcut-help').hidden = false;
    return;
  }
  await ext.tabs.create({ url: 'chrome://extensions/shortcuts' });
}

async function checkPermission(): Promise<void> {
  if (!isFirefox()) return;
  const granted = await ext.permissions.contains({ origins: HOST_ORIGINS });
  $('permission').hidden = granted;
}

function syncDisabledStates(): void {
  const off = !enabledInput.checked;
  siteInput.disabled = off || !host;
  $('site-row').classList.toggle('disabled', siteInput.disabled);
  densityInput.disabled = off;
  $('density-card').classList.toggle('disabled', off);
}

/** The page restarts after a settings change; show the new status once it has (large pages take longer). */
function refreshStatusSoon(): void {
  for (const delay of [350, 1500]) setTimeout(() => void renderStatus(), delay);
}

async function init(): Promise<void> {
  localize();
  [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  const status = await pageStatus();
  host = status?.host ?? (isWebUrl(tab?.url) ? normalizeHost(tab!.url!) : '');

  const settings = await loadSettings();
  enabledInput.checked = settings.enabled;
  siteInput.checked = host ? await isSiteEnabled(host) : false;
  densityInput.value = String(settings.percent);
  $('site-title').textContent = host ? t('popupSite', host) : t('statusUnavailable');
  showDensity(settings.percent);
  syncDisabledStates();

  enabledInput.addEventListener('change', async () => {
    syncDisabledStates();
    await saveSettings({ enabled: enabledInput.checked });
    refreshStatusSoon();
  });
  siteInput.addEventListener('change', async () => {
    try {
      await setSiteEnabled(host, siteInput.checked);
    } catch {
      siteInput.checked = !siteInput.checked; // storage full (sync allows 512 items): show the real state
      return;
    }
    refreshStatusSoon();
  });
  let densityTimer = 0;
  densityInput.addEventListener('input', () => {
    const percent = Number(densityInput.value);
    showDensity(percent);
    clearTimeout(densityTimer);
    densityTimer = window.setTimeout(async () => {
      await saveSettings({ percent });
      refreshStatusSoon();
    }, 150);
  });
  $('shortcut').addEventListener('click', () => void openShortcutSettings());
  $('grant').addEventListener('click', async () => {
    if (await ext.permissions.request({ origins: HOST_ORIGINS })) {
      $('permission').hidden = true;
      if (tab?.id !== undefined) await ext.tabs.reload(tab.id);
    }
  });

  const showAll = (stats: Stats) => {
    showStats(stats);
    void renderReview(stats.words);
  };
  onStatsChanged(showAll);
  await Promise.all([renderStatus(), renderShortcut(), checkPermission(), loadStats().then(showAll)]);
}

void init();
