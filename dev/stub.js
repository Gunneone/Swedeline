// Development stand-in for the WebExtension APIs, so the built content script and
// popup can run in a normal page (see scripts/serve.mjs). Not part of the extension.
(() => {
  const KEY = 'swedeline-stub-storage';
  const read = () => {
    try { return JSON.parse(sessionStorage.getItem(KEY) || '{}'); } catch { return {}; }
  };
  const write = (data) => {
    try { sessionStorage.setItem(KEY, JSON.stringify(data)); } catch {}
  };
  const storageListeners = [];
  const messageListeners = [];
  const dicts = {};

  // Synchronous like chrome.i18n: fetch the locale once with a blocking request (dev only).
  const uiLang = (new URLSearchParams(location.search).get('ui') || navigator.language || 'en').slice(0, 2);
  const loadLocale = (lang) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `/dist/chrome/_locales/${lang}/messages.json`, false);
    xhr.send();
    return xhr.status === 200 ? JSON.parse(xhr.responseText) : null;
  };
  const messages = loadLocale(uiLang) || loadLocale('en');

  const fire = (changes) => storageListeners.forEach((fn) => fn(changes, 'sync'));

  async function lookup(lang, words) {
    dicts[lang] ??= fetch(`/dist/chrome/dict/${lang}.json`).then((r) => r.json()).then((j) => j.w);
    const dict = await dicts[lang];
    const out = {};
    for (const w of words) if (Object.hasOwn(dict, w)) out[w] = dict[w];
    return out;
  }

  function sendToPage(msg) {
    return new Promise((resolve) => {
      let answered = false;
      for (const fn of messageListeners) fn(msg, {}, (r) => { answered = true; resolve(r); });
      if (!answered) resolve(undefined);
    });
  }

  globalThis.chrome = {
    runtime: {
      getURL: (p) => `chrome-extension://stub/${p}`,
      sendMessage: async (msg) => (msg?.type === 'lookup' ? lookup(msg.lang, msg.words) : undefined),
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
    },
    storage: {
      sync: {
        async get(keys) {
          const data = read();
          if (keys && typeof keys === 'object' && !Array.isArray(keys)) {
            return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in data ? data[k] : d]));
          }
          const list = typeof keys === 'string' ? [keys] : keys ?? Object.keys(data);
          return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]));
        },
        async set(items) {
          const data = read();
          const changes = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: data[k], newValue: v };
            data[k] = v;
          }
          write(data);
          fire(changes);
        },
        async remove(keys) {
          const data = read();
          const changes = {};
          for (const k of [].concat(keys)) {
            changes[k] = { oldValue: data[k] };
            delete data[k];
          }
          write(data);
          fire(changes);
        },
      },
      onChanged: { addListener: (fn) => storageListeners.push(fn) },
    },
    i18n: {
      getUILanguage: () => uiLang,
      getMessage(key, subs = []) {
        const m = messages?.[key];
        if (!m) return '';
        let text = m.message;
        for (const [name, ph] of Object.entries(m.placeholders ?? {})) {
          const i = Number(ph.content.slice(1)) - 1;
          text = text.replaceAll(`$${name}$`, subs[i] ?? '');
        }
        return text;
      },
    },
    tabs: {
      query: async () => [{ id: 1, url: location.href }],
      sendMessage: async (_id, msg) => sendToPage(msg),
      create: async () => {},
      reload: async () => location.reload(),
    },
    commands: { getAll: async () => [{ name: 'toggle-site', shortcut: '' }] },
    permissions: { contains: async () => true, request: async () => true },
    action: { setIcon: async () => {} },
  };

  // Floating control panel for the harness pages (in a shadow root, so Swedeline ignores it).
  if (!location.pathname.startsWith('/harness/')) return;
  addEventListener('DOMContentLoaded', () => {
    const host = document.createElement('swedeline-dev-panel');
    host.setAttribute('translate', 'no');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        div{position:fixed;right:12px;bottom:12px;z-index:2147483646;background:#fff;color:#111;border:1px solid #ccc;
            border-radius:10px;padding:10px 12px;font:12px system-ui;box-shadow:0 4px 16px rgba(0,0,0,.15);display:grid;gap:6px;width:220px}
        label{display:flex;gap:6px;align-items:center} input[type=range]{width:100%} b{font-size:11px;color:#555}
      </style>
      <div>
        <b>Swedeline dev harness</b>
        <label><input type="checkbox" id="enabled"> enabled</label>
        <label><input type="checkbox" id="site"> this site</label>
        <label>density <input type="range" id="density" min="1" max="10"></label>
        <span id="status"></span>
      </div>`;
    document.documentElement.append(host);
    const $ = (id) => root.getElementById(id);
    const data = read();
    $('enabled').checked = data.enabled !== false;
    $('site').checked = data['site:localhost'] !== false;
    $('density').value = data.density ?? 4;
    $('enabled').onchange = (e) => chrome.storage.sync.set({ enabled: e.target.checked });
    $('site').onchange = (e) =>
      e.target.checked ? chrome.storage.sync.remove('site:localhost') : chrome.storage.sync.set({ 'site:localhost': false });
    $('density').oninput = (e) => chrome.storage.sync.set({ density: Number(e.target.value) });
    setInterval(async () => {
      const s = await sendToPage({ type: 'get-status' });
      if (s) $('status').textContent = `${s.state} · ${s.lang ?? '-'} · ${s.count} words`;
    }, 500);
  });
})();
