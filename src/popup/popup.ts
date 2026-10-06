import { ext, isFirefox } from '../shared/ext';
import { isWebUrl, normalizeHost } from '../shared/host';
import type { Message, PageState, PageStatus } from '../shared/messages';
import { densityRate, isSiteEnabled, loadSettings, saveSettings, setSiteEnabled } from '../shared/settings';

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

function showDensity(level: number): void {
  $('density-value').textContent = t('popupDensityValue', Math.round(densityRate(level) * 100));
}

async function pageStatus(): Promise<PageStatus | null> {
  if (tab?.id === undefined) return null;
  try {
    return (await ext.tabs.sendMessage(tab.id, { type: 'get-status' } satisfies Message)) ?? null;
  } catch {
    return null; // no content script: restricted page, or loaded before Trana was installed
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

/** The page restarts after a settings change; show the new status once it has. */
function refreshStatusSoon(): void {
  setTimeout(() => void renderStatus(), 350);
}

async function init(): Promise<void> {
  localize();
  [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  const status = await pageStatus();
  host = status?.host ?? (isWebUrl(tab?.url) ? normalizeHost(tab!.url!) : '');

  const settings = await loadSettings();
  enabledInput.checked = settings.enabled;
  siteInput.checked = host ? await isSiteEnabled(host) : false;
  densityInput.value = String(settings.density);
  $('site-title').textContent = host ? t('popupSite', host) : t('statusUnavailable');
  showDensity(settings.density);
  syncDisabledStates();

  enabledInput.addEventListener('change', async () => {
    syncDisabledStates();
    await saveSettings({ enabled: enabledInput.checked });
    refreshStatusSoon();
  });
  siteInput.addEventListener('change', async () => {
    await setSiteEnabled(host, siteInput.checked);
    refreshStatusSoon();
  });
  let densityTimer = 0;
  densityInput.addEventListener('input', () => {
    const level = Number(densityInput.value);
    showDensity(level);
    clearTimeout(densityTimer);
    densityTimer = window.setTimeout(async () => {
      await saveSettings({ density: level });
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

  await Promise.all([renderStatus(), renderShortcut(), checkPermission()]);
}

void init();
