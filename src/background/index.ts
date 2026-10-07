import { SOURCE_LANGS } from '../content/langdata';
import { ext } from '../shared/ext';
import { isWebUrl, normalizeHost } from '../shared/host';
import type { Message, PageState } from '../shared/messages';
import { isSiteEnabled, loadSettings, onSettingsChanged, setSiteEnabled } from '../shared/settings';
import { lookup } from './dictionary';

const ICON_SIZES = [16, 32, 48, 128];
const iconPaths = (off: boolean) =>
  Object.fromEntries(ICON_SIZES.map((s) => [s, `icons/icon-${s}${off ? '-off' : ''}.png`]));

ext.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  if (msg?.type === 'lookup' && SOURCE_LANGS.includes(msg.lang) && Array.isArray(msg.words)) {
    lookup(msg.lang, msg.words).then(sendResponse, () => sendResponse({}));
    return true; // async response
  }
  if (msg?.type === 'page-state' && sender.tab?.id !== undefined) {
    void showTabState(sender.tab.id, msg.state);
  }
  return false;
});

/** Grey icon in tabs where Swedeline is switched off for the site. */
async function showTabState(tabId: number, state: PageState): Promise<void> {
  try {
    await ext.action.setIcon({ tabId, path: iconPaths(state === 'off' || state === 'site-off') });
  } catch {
    // Tab closed meanwhile.
  }
}

/** Grey icon everywhere while Swedeline is switched off. */
async function showGlobalState(): Promise<void> {
  const { enabled } = await loadSettings();
  await ext.action.setIcon({ path: iconPaths(!enabled) });
}

onSettingsChanged((changes) => {
  if (changes.enabled) void showGlobalState();
});
ext.runtime.onStartup.addListener(() => void showGlobalState());
ext.runtime.onInstalled.addListener(() => void showGlobalState());

// Keyboard command (no default key; users pick one in the browser's shortcut settings).
ext.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-site') return;
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (!isWebUrl(tab?.url)) return;
  const host = normalizeHost(tab.url!);
  await setSiteEnabled(host, !(await isSiteEnabled(host)));
});
