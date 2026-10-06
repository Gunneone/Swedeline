// Finds the "longer texts" on a page: paragraphs and similar blocks of running
// prose. Headings, labels, navigation, buttons, form controls, code and short
// snippets are never touched.

/** Text inside any of these is ignored. */
export const EXCLUDED = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'nav', 'footer', 'aside', 'label', 'button',
  'legend', 'caption', 'th', 'summary', 'figcaption', 'title', 'option', 'optgroup', 'select',
  'input', 'textarea', 'code', 'pre', 'kbd', 'samp', 'var', 'script', 'style', 'noscript',
  'template', 'svg', 'math', 'iframe', 'canvas', 'video', 'audio', 'trana-w', 'trana-tooltip',
  '[contenteditable]:not([contenteditable="false"])', '[translate="no"]', '.notranslate',
  '[aria-hidden="true"]', '[hidden]', '[role="button"]', '[role="navigation"]', '[role="banner"]',
  '[role="menu"]', '[role="menubar"]', '[role="menuitem"]', '[role="tab"]', '[role="tablist"]',
  '[role="toolbar"]', '[role="heading"]', '[role="textbox"]', '[role="search"]',
  '[role="contentinfo"]', '[role="option"]', '[role="listbox"]', '[role="combobox"]',
].join(',');

/** Inline elements: text inside them belongs to the surrounding block. */
const INLINE = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'DATA', 'DFN', 'EM', 'FONT', 'I', 'INS', 'DEL', 'MARK',
  'Q', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'TT', 'BIG', 'WBR',
]);

/** A block needs at least this many words... */
export const MIN_WORDS = 12;
/** ...sentence punctuation, and at most this share of its text inside links. */
const MAX_LINK_SHARE = 0.6;
const SENTENCE_PUNCT = /[.!?…;:]/u;
const WORD = /[\p{L}\p{M}]+/gu;

export interface Block {
  el: Element;
  nodes: Text[];
  /** Start offset of each node in `text`. */
  offsets: number[];
  text: string;
  words: number;
}

/** The element whose text flow a node belongs to: its nearest non-inline ancestor. */
export function blockOf(node: Node): Element | null {
  let el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  while (el && (INLINE.has(el.tagName) || (el.tagName.includes('-') && el.tagName !== 'TRANA-W'))) {
    el = el.parentElement;
  }
  return el;
}

export function isExcluded(el: Element | null): boolean {
  return !el || !!el.closest(EXCLUDED);
}

/** Groups the text under `root` into blocks and returns the ones that are long running text. */
export function findBlocks(root: Node): Block[] {
  const doc = root.ownerDocument ?? (root as Document);
  const groups = new Map<Element, Text[]>();
  const excludedCache = new Map<Element, boolean>();
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text;
    if (!text.data.trim()) continue;
    const parent = text.parentElement;
    if (!parent) continue;
    let excluded = excludedCache.get(parent);
    if (excluded === undefined) {
      excluded = isExcluded(parent);
      excludedCache.set(parent, excluded);
    }
    if (excluded) continue;
    const block = blockOf(text);
    if (!block) continue;
    const list = groups.get(block) ?? [];
    list.push(text);
    groups.set(block, list);
  }
  const blocks: Block[] = [];
  for (const [el, nodes] of groups) {
    const block = makeBlock(el, nodes);
    if (block) blocks.push(block);
  }
  return blocks;
}

/** Builds a block from its text nodes if it qualifies as longer text, else null. */
export function makeBlock(el: Element, nodes: Text[]): Block | null {
  // Cheap check first: the separators added below only split words, at most one per node boundary.
  let raw = '';
  for (const node of nodes) raw += node.data;
  if ((raw.match(WORD)?.length ?? 0) + nodes.length - 1 < MIN_WORDS || !SENTENCE_PUNCT.test(raw)) return null;

  const offsets: number[] = [];
  let text = '';
  let linkChars = 0;
  const breaks = breaksBefore(el, nodes);
  nodes.forEach((node, i) => {
    // "hour<br>and" or "<em>Every</em> <em>summer</em>" must not read as one word.
    if (breaks[i] && text && !/\s$/.test(text) && !/^\s/.test(node.data)) text += ' ';
    offsets.push(text.length);
    text += node.data;
    if (node.parentElement?.closest('a')) linkChars += node.data.trim().length;
  });
  const words = text.match(WORD)?.length ?? 0;
  if (words < MIN_WORDS) return null;
  if (linkChars / Math.max(1, text.trim().length) > MAX_LINK_SHARE) return null;
  return { el, nodes, offsets, text, words };
}

/**
 * For each of a block's text nodes, whether something separates it from the
 * previous one: a line break or other non-inline element, or text that is not
 * part of the block (whitespace-only nodes, excluded or nested content).
 */
function breaksBefore(el: Element, nodes: Text[]): boolean[] {
  const breaks = nodes.map(() => false);
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let i = 0;
  let gap = false;
  for (let n = walker.nextNode(); n && i < nodes.length; n = walker.nextNode()) {
    if (n === nodes[i]) {
      breaks[i++] = gap;
      gap = false;
    } else if (n.nodeType === Node.TEXT_NODE || !isInline(n as Element)) {
      gap = true;
    }
  }
  return breaks;
}

const isInline = (el: Element): boolean => INLINE.has(el.tagName) || el.tagName.includes('-');

/** Re-reads a block's current text nodes (after the page changed it). */
export function rescanBlock(el: Element): Block | null {
  if (!el.isConnected || isExcluded(el)) return null;
  const nodes: Text[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text;
    if (text.data.trim() && blockOf(text) === el && !isExcluded(text.parentElement)) nodes.push(text);
  }
  return makeBlock(el, nodes);
}
