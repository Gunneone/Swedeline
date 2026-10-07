import { ext } from '../shared/ext';
import { normalizeHost } from '../shared/host';
import type { Entry, LookupResult, Message, PageState, PageStatus } from '../shared/messages';
import {
  DEFAULTS,
  densityRate,
  isSiteEnabled,
  loadSettings,
  onSettingsChanged,
  siteKey,
  type Settings,
  type StorageChanges,
} from '../shared/settings';
import { declaredLanguage, detectLanguage } from './langdetect';
import { SOURCE_LANGS, type SourceLang } from './langdata';
import { applyReplacements, revertApplied, WORD_TAG, type Applied, type Replacement } from './replacer';
import { blockOf, findBlocks, isExcluded, rescanBlock, type Block } from './scanner';
import { findCandidates, lookupKey, selectReplacements } from './selector';
import { tokenize, type Token } from './tokenizer';
import { hideTooltip, installTooltip } from './tooltip';

/** Blocks at least this long get their own language check (mixed-language pages). */
const BLOCK_DETECT_WORDS = 20;
const MUTATION_DEBOUNCE = 400;
/** Pages that never stop changing still get their new text processed this often. */
const MUTATION_MAX_WAIT = 2000;

const host = normalizeHost(location.hostname);
let settings: Settings = { ...DEFAULTS };
let siteEnabled = true;
let pageLang: SourceLang | null = null;
let state: PageState = 'loading';
/** Bumped by every restart, so async work from an earlier run stops. */
let generation = 0;

/** What Trana changed, per block element. */
const applied = new Map<Element, Applied[]>();
/** Split text nodes -> their block, to react when the page rewrites them. */
const tracked = new Map<Text, Element>();
/** Word elements Trana created (pages can clone them, and those copies are not Trana's). */
const ownWords = new WeakSet<Element>();
/** Blocks already handled, with their text at that time. */
let handled = new WeakMap<Element, string>();
const dictCache = Object.fromEntries(SOURCE_LANGS.map((l) => [l, new Map<string, Entry | null>()])) as Record<
  SourceLang,
  Map<string, Entry | null>
>;

let observer: MutationObserver | null = null;
/** Nodes the page changed -> whether their subtree is new (added) rather than just modified. */
const pending = new Map<Node, boolean>();
let pendingTimer = 0;
let pendingSince = 0;

// ------------------------------------------------------------------ lifecycle

async function init(): Promise<void> {
  ext.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
    if (msg?.type === 'get-status') sendResponse(status());
    return false;
  });
  onSettingsChanged(onStorageChange);
  [settings, siteEnabled] = await Promise.all([loadSettings(), isSiteEnabled(host)]);
  installTooltip();
  installOriginalsForCopyAndPrint();
  await start();
}

function status(): PageStatus {
  let count = 0;
  for (const [el, list] of applied) if (el.isConnected) for (const a of list) count += a.words.length;
  return { host, state, lang: pageLang, count };
}

function setState(next: PageState): void {
  state = next;
  ext.runtime.sendMessage({ type: 'page-state', state: next } satisfies Message).catch(() => {});
}

async function start(): Promise<void> {
  const gen = ++generation;
  if (!settings.enabled) return setState('off');
  if (!siteEnabled) return setState('site-off');
  if (!document.body) return;
  const blocks = findBlocks(document.body);
  const lang = pageLanguage(blocks);
  if (lang === null) {
    // Nothing to read yet (single-page apps render later): wait for content.
    setState('no-text');
    observe();
    return;
  }
  if (lang === 'sv') return setState('swedish');
  if (lang === 'other') return setState('unsupported');
  pageLang = lang;
  setState('active');
  observe();
  await processBlocks(blocks, gen);
}

function stop(): void {
  generation++;
  observer?.disconnect();
  observer = null;
  clearTimeout(pendingTimer);
  pendingSince = 0;
  pending.clear();
  revertAll();
  hideTooltip();
  pageLang = null;
}

async function restart(): Promise<void> {
  stop();
  await start();
}

/** Density changed: same language, new selection. */
async function reselect(): Promise<void> {
  if (state !== 'active' || !pageLang) return;
  const gen = ++generation;
  revertAll();
  await processBlocks(findBlocks(document.body), gen);
}

function onStorageChange(changes: StorageChanges): void {
  let needsRestart = false;
  if (changes.enabled) {
    settings.enabled = (changes.enabled.newValue as boolean | undefined) ?? DEFAULTS.enabled;
    needsRestart = true;
  }
  const key = siteKey(host);
  if (changes[key]) {
    siteEnabled = changes[key].newValue !== false;
    needsRestart = true;
  }
  if (changes.density) {
    settings.density = (changes.density.newValue as number | undefined) ?? DEFAULTS.density;
    if (!needsRestart) void reselect();
  }
  if (needsRestart) void restart();
}

// ------------------------------------------------------------------ language

/** The page's language: a source language, 'sv', 'other', or null when there is no text yet. */
function pageLanguage(blocks: Block[]): SourceLang | 'sv' | 'other' | null {
  if (!blocks.length) return null;
  const detected = detectLanguage(blocks.map((b) => b.text).join('\n'), 3000).lang;
  const lang = detected ?? declaredLanguage(document);
  if (lang === 'sv') return 'sv';
  return SOURCE_LANGS.includes(lang as SourceLang) ? (lang as SourceLang) : 'other';
}

/** A long block can be in another language than the page (quotes, comments). */
function blockLanguage(block: Block): SourceLang | null {
  if (!pageLang) return null;
  if (block.words < BLOCK_DETECT_WORDS) return pageLang;
  const detected = detectLanguage(block.text).lang;
  if (!detected) return pageLang;
  return SOURCE_LANGS.includes(detected as SourceLang) ? (detected as SourceLang) : null;
}

// ------------------------------------------------------------------ replacing

interface Job {
  block: Block;
  lang: SourceLang;
  tokens: Token[];
}

async function processBlocks(blocks: Block[], gen: number): Promise<void> {
  const jobs: Job[] = [];
  for (const block of blocks) {
    handled.set(block.el, squash(block.text));
    const lang = blockLanguage(block);
    if (lang) jobs.push({ block, lang, tokens: tokenize(block.text, lang) });
  }
  if (!jobs.length) return;
  await lookupWords(jobs);
  const rate = densityRate(settings.density);
  for (let i = 0; i < jobs.length; ) {
    const deadline = await idle();
    if (gen !== generation) return;
    do {
      applyJob(jobs[i++], rate);
    } while (i < jobs.length && (deadline ? deadline.timeRemaining() > 3 : i % 20 !== 0));
  }
}

/** Fetches translations for all words not looked up before, one message per language. */
async function lookupWords(jobs: Job[]): Promise<void> {
  const wanted = new Map<SourceLang, Set<string>>();
  for (const { lang, tokens } of jobs) {
    const cache = dictCache[lang];
    let set = wanted.get(lang);
    if (!set) wanted.set(lang, (set = new Set()));
    for (const t of tokens) {
      if (t.skip && t.skip !== 'sentence-start') continue;
      const key = lookupKey(t, lang);
      if (!cache.has(key)) set.add(key);
      // German: "Gestern" is only capitalized by the sentence; the name check needs "gestern".
      if (lang === 'de' && t.sentenceStart && !cache.has(t.lower)) set.add(t.lower);
    }
  }
  await Promise.all(
    [...wanted].map(async ([lang, words]) => {
      if (!words.size) return;
      const list = [...words];
      let result: LookupResult = {};
      try {
        result = (await ext.runtime.sendMessage({ type: 'lookup', lang, words: list } satisfies Message)) ?? {};
      } catch {
        // Background unavailable (extension reloading): try again next time.
        return;
      }
      const cache = dictCache[lang];
      for (const w of list) cache.set(w, result[w] ?? null);
    }),
  );
}

function applyJob({ block, lang, tokens }: Job, rate: number): void {
  if (!block.el.isConnected) return;
  const cache = dictCache[lang];
  const candidates = findCandidates(tokens, lang, (key) => cache.get(key) ?? undefined);
  const picked = selectReplacements(candidates, block.words, rate, block.text.slice(0, 48));
  if (!picked.length) return;

  const perNode = new Map<number, Replacement[]>();
  for (const c of picked) {
    const i = nodeIndexAt(block.offsets, c.token.start);
    const start = c.token.start - block.offsets[i];
    const end = c.token.end - block.offsets[i];
    // The word is split across elements, or the page changed the text since it was read.
    if (block.nodes[i].data.slice(start, end) !== c.token.text) continue;
    const list = perNode.get(i) ?? [];
    list.push({ start, end, entry: c.entry, lang });
    perNode.set(i, list);
  }

  flushRecords(); // page changes so far are handled before Trana's own
  const dark = hasLightText(block.el);
  const list: Applied[] = [];
  for (const [i, reps] of perNode) {
    const node = block.nodes[i];
    if (!node.isConnected || tracked.has(node)) continue;
    const a = applyReplacements(node, reps, dark);
    if (!a) continue;
    list.push(a);
    tracked.set(node, block.el);
    for (const w of a.words) ownWords.add(w);
  }
  observer?.takeRecords(); // the mutations just made are Trana's own
  if (list.length) applied.set(block.el, [...(applied.get(block.el) ?? []), ...list]);
}

function nodeIndexAt(offsets: number[], pos: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Light text means a dark background: use the brighter marker variant. */
function hasLightText(el: Element): boolean {
  const m = getComputedStyle(el).color.match(/[\d.]+/g);
  if (!m || m.length < 3) return false;
  const [r, g, b] = m.map(Number).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45;
}

function revertBlock(el: Element, restoreText = true): void {
  for (const a of applied.get(el) ?? []) {
    revertApplied(a, restoreText);
    tracked.delete(a.node);
  }
  applied.delete(el);
}

function revertAll(): void {
  flushRecords();
  for (const el of [...applied.keys()]) revertBlock(el);
  handled = new WeakMap();
  observer?.takeRecords();
}

// ------------------------------------------------------------------ page changes

function observe(): void {
  if (observer || !document.body) return;
  observer = new MutationObserver(onMutations);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function flushRecords(): void {
  if (observer) onMutations(observer.takeRecords());
}

function isTrana(node: Node): boolean {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return !!el?.closest(`${WORD_TAG}, trana-tooltip`);
}

function onMutations(records: MutationRecord[]): void {
  if (!records.length) return;
  for (const r of records) {
    if (isTrana(r.target)) continue;
    if (r.type === 'characterData') {
      const block = tracked.get(r.target as Text);
      // The page rewrote a node Trana had split: drop the leftovers, keep the new text.
      if (block) revertBlock(block, false);
      addPending(r.target, false);
      continue;
    }
    for (const n of r.removedNodes) {
      if (n.nodeType === Node.TEXT_NODE && tracked.has(n as Text)) revertBlock(tracked.get(n as Text)!, false);
    }
    for (const n of r.addedNodes) if (!isTrana(n)) addPending(n, true);
    // Only the target's own block can have changed; its other descendants did not.
    addPending(r.target, false);
  }
  if (pending.size) {
    // Debounce, but don't let a page that changes all the time postpone its new text forever.
    clearTimeout(pendingTimer);
    pendingSince ||= Date.now();
    const wait = Math.min(MUTATION_DEBOUNCE, Math.max(0, pendingSince + MUTATION_MAX_WAIT - Date.now()));
    pendingTimer = window.setTimeout(() => {
      pendingSince = 0;
      void processPending();
    }, wait);
  }
}

function addPending(node: Node, added: boolean): void {
  pending.set(node, added || (pending.get(node) ?? false));
}

async function processPending(): Promise<void> {
  const nodes = [...pending];
  pending.clear();
  if (state === 'no-text') {
    // Rescan the page only once something with text has appeared.
    if (nodes.some(([n, added]) => (added || n.nodeType === Node.TEXT_NODE) && n.textContent?.trim())) await start();
    return;
  }
  if (state !== 'active') return;
  pruneDetached();
  const gen = generation;
  const els = new Set<Element>();
  for (const [n, added] of nodes) {
    if (!n.isConnected) continue;
    const el = blockOf(n);
    if (el) els.add(el);
    if (added && n.nodeType === Node.ELEMENT_NODE) {
      const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const b = blockOf(t);
        if (b) els.add(b);
      }
    }
  }
  const blocks: Block[] = [];
  for (const el of els) {
    if (isExcluded(el)) continue;
    if (handled.get(el) === originalText(el)) continue; // unchanged
    revertBlock(el);
    const block = rescanBlock(el);
    if (block) blocks.push(block);
  }
  observer?.takeRecords();
  if (blocks.length) await processBlocks(blocks, gen);
}

/** Blocks the page removed: put their text back (the page may reinsert them) and forget them. */
function pruneDetached(): void {
  for (const el of [...applied.keys()]) {
    if (el.isConnected) continue;
    revertBlock(el);
    handled.delete(el);
  }
}

/** A block's text as the page has it, reading replaced words as their originals. */
function originalText(el: Element): string {
  let text = '';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) =>
      n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName === 'TRANA-W'
        ? NodeFilter.FILTER_ACCEPT
        : n.nodeType === Node.TEXT_NODE
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      const word = n as HTMLElement;
      // Words of nested blocks and copies made by the page are not part of this block's text.
      if (ownWords.has(word) && blockOf(word.parentNode!) === el && !isExcluded(word.parentElement)) {
        text += word.dataset.orig ?? '';
      }
      // Skip the word's own text.
      let last: Node = word;
      while (last.lastChild) last = last.lastChild;
      walker.currentNode = last;
    } else if (blockOf(n) === el && !isExcluded((n as Text).parentElement)) {
      text += (n as Text).data;
    }
  }
  return squash(text);
}

/** A block's text without any whitespace, for change detection (separators between nodes vary). */
const squash = (text: string): string => text.replace(/\s+/g, '');

// ------------------------------------------------------------------ copy and print

/**
 * Copied text and printouts get the page's original words: Swedish words in a
 * quote or a pasted paragraph would be a surprise. Returns a function that
 * switches the words back.
 */
function showOriginals(include: (word: HTMLElement) => boolean): () => void {
  const swapped: [Text, string][] = [];
  for (const list of applied.values()) {
    for (const a of list) {
      for (const word of a.words) {
        const text = word.firstChild;
        if (text?.nodeType !== Node.TEXT_NODE || !word.dataset.orig || !include(word)) continue;
        swapped.push([text as Text, (text as Text).data]);
        (text as Text).data = word.dataset.orig;
      }
    }
  }
  return () => {
    for (const [text, data] of swapped) text.data = data;
  };
}

function installOriginalsForCopyAndPrint(): void {
  document.addEventListener(
    'copy',
    () => {
      const selection = getSelection();
      if (!selection || selection.isCollapsed || !applied.size) return;
      // The browser copies the selection after this handler: switch back right after.
      const restore = showOriginals((word) => selection.containsNode(word, true));
      setTimeout(restore, 0);
    },
    true,
  );
  let restorePrint: (() => void) | null = null;
  window.addEventListener('beforeprint', () => {
    restorePrint ??= showOriginals(() => true);
  });
  window.addEventListener('afterprint', () => {
    restorePrint?.();
    restorePrint = null;
  });
}

function idle(): Promise<IdleDeadline | null> {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) requestIdleCallback(resolve, { timeout: 300 });
    else setTimeout(() => resolve(null), 16);
  });
}

void init();
