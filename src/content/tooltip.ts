import { ext } from '../shared/ext';
import { WORD_TAG } from './replacer';
import { canSpeak, initSpeech, speak } from './speech';

// A single hover card for all replaced words. It lives in a shadow root
// so page styles cannot reach it, and is positioned with `position: fixed`.

const SHOW_DELAY = 60;
const HIDE_DELAY = 250;

const CSS = `
:host { all: initial; }
.card {
  --bg: #ffffff; --fg: #1c2733; --muted: #5d6b7a; --line: #e3e8ee; --blue: #006aa7; --yellow: #fecc02;
  position: fixed; z-index: 2147483647; box-sizing: border-box;
  min-width: 150px; max-width: 280px; padding: 10px 12px 10px 14px;
  background: var(--bg); color: var(--fg);
  border-radius: 10px; border-left: 4px solid var(--yellow);
  box-shadow: 0 6px 24px rgba(15, 30, 45, .18), 0 1px 3px rgba(15, 30, 45, .12);
  font: 14px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  opacity: 0; transform: translateY(2px); transition: opacity .12s ease, transform .12s ease;
  pointer-events: auto; text-align: left;
}
.card.visible { opacity: 1; transform: none; }
.card[hidden] { display: none; }
@media (prefers-color-scheme: dark) {
  .card { --bg: #1e2a36; --fg: #eef3f8; --muted: #a3b2c2; --line: #33465a; --blue: #6fb8ec; }
}
.orig { font-size: 17px; font-weight: 600; word-break: break-word; }
.from { margin-top: 1px; color: var(--muted); font-size: 12px; }
.sv { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); }
.sv-word { flex: 1; color: var(--blue); font-weight: 600; font-size: 15px; }
.article { font-weight: 400; color: var(--muted); }
.tag { margin-left: 6px; padding: 1px 6px; border-radius: 999px; background: var(--line); color: var(--muted); font-size: 11px; font-weight: 500; }
button {
  all: unset; box-sizing: border-box; display: inline-grid; place-items: center;
  width: 28px; height: 28px; border-radius: 50%; cursor: pointer; color: var(--blue);
  background: color-mix(in srgb, var(--blue) 12%, transparent);
}
button:hover { background: color-mix(in srgb, var(--blue) 22%, transparent); }
button:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
button[hidden] { display: none; }
svg { width: 16px; height: 16px; }
`;

function speakerIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const attrs = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  const cone = document.createElementNS(ns, 'path');
  cone.setAttribute('d', 'M11 5 6 9H3v6h3l5 4V5z');
  cone.setAttribute('fill', 'currentColor');
  const waves = document.createElementNS(ns, 'path');
  waves.setAttribute('d', 'M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13');
  svg.append(cone, waves);
  return svg;
}

function div(className: string, ...children: Node[]): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  el.append(...children);
  return el;
}

let card: HTMLElement | null = null;
let current: HTMLElement | null = null;
let showTimer = 0;
let hideTimer = 0;
let languageNames: Intl.DisplayNames | null = null;

function languageName(code: string): string {
  try {
    languageNames ??= new Intl.DisplayNames([ext.i18n.getUILanguage()], { type: 'language' });
    return languageNames.of(code) ?? code;
  } catch {
    return code;
  }
}

function ensureCard(): HTMLElement {
  if (card?.isConnected) return card;
  const host = document.createElement('swedeline-tooltip');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const word = document.createElement('span');
  word.className = 'sv-word';
  const button = document.createElement('button');
  button.type = 'button';
  button.append(speakerIcon());
  card = div('card', div('orig'), div('from'), div('sv', word, button));
  card.hidden = true;
  card.setAttribute('role', 'tooltip');
  button.setAttribute('aria-label', ext.i18n.getMessage('tooltipListen') || 'Listen');
  button.title = button.getAttribute('aria-label')!;
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = card?.dataset.say;
    if (text) speak(text);
  });
  card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  card.addEventListener('mouseleave', scheduleHide);
  root.append(style, card);
  document.documentElement.append(host);
  return card;
}

function fill(el: HTMLElement): void {
  const c = ensureCard();
  const { orig = '', lang = '', lemma = '', g, plural } = el.dataset;
  c.querySelector('.orig')!.textContent = orig;
  c.querySelector('.from')!.textContent = `${languageName(lang)} → ${languageName('sv')}`;
  const sv = c.querySelector('.sv-word')!;
  sv.textContent = '';
  if (g) {
    const article = document.createElement('span');
    article.className = 'article';
    article.textContent = `${g} `;
    sv.append(article);
  }
  sv.append(lemma);
  if (plural !== undefined && el.textContent !== lemma) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = `${ext.i18n.getMessage('tooltipPlural') || 'plural'}: ${el.textContent}`;
    sv.append(tag);
  }
  c.dataset.say = g ? `${g} ${lemma}` : lemma;
  c.querySelector('button')!.hidden = !canSpeak();
}

function position(el: HTMLElement): void {
  const c = ensureCard();
  const r = el.getBoundingClientRect();
  const margin = 8;
  const { innerWidth: vw, innerHeight: vh } = window;
  const w = c.offsetWidth;
  const h = c.offsetHeight;
  let top = r.top - h - margin;
  if (top < margin) top = r.bottom + margin;
  if (top + h > vh - margin) top = Math.max(margin, vh - h - margin);
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(margin, Math.min(left, vw - w - margin));
  c.style.top = `${Math.round(top)}px`;
  c.style.left = `${Math.round(left)}px`;
}

function show(el: HTMLElement): void {
  clearTimeout(hideTimer);
  clearTimeout(showTimer);
  showTimer = window.setTimeout(() => {
    current = el;
    const c = ensureCard();
    fill(el);
    c.hidden = false;
    position(el);
    requestAnimationFrame(() => c.classList.add('visible'));
  }, current ? 0 : SHOW_DELAY);
}

function scheduleHide(): void {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hideTooltip, HIDE_DELAY);
}

export function hideTooltip(): void {
  clearTimeout(showTimer);
  current = null;
  if (!card) return;
  card.classList.remove('visible');
  card.hidden = true;
}

function wordFrom(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? (target.closest(WORD_TAG) as HTMLElement | null) : null;
}

let installed = false;

export function installTooltip(): void {
  if (installed) return;
  installed = true;
  initSpeech();
  document.addEventListener(
    'mouseover',
    (e) => {
      const el = wordFrom(e.target);
      if (el) show(el);
    },
    true,
  );
  document.addEventListener(
    'mouseout',
    (e) => {
      const el = wordFrom(e.target);
      if (el && !el.contains(e.relatedTarget as Node | null)) scheduleHide();
    },
    true,
  );
  document.addEventListener('focusin', (e) => {
    const el = wordFrom(e.target);
    if (el) show(el);
  });
  window.addEventListener('scroll', () => current && hideTooltip(), { passive: true, capture: true });
}
