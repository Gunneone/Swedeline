import type { Entry } from '../shared/messages';
import type { SourceLang } from './langdata';

export const WORD_TAG = 'trana-w';

export interface Replacement {
  /** Offsets within the text node. */
  start: number;
  end: number;
  entry: Entry;
  lang: SourceLang;
}

/**
 * One text node Trana has split. The original node object stays in the
 * document (holding the text before the first replacement), so frameworks that
 * keep a reference to it still find it; `inserted` are the nodes added after it.
 */
export interface Applied {
  node: Text;
  original: string;
  inserted: Node[];
  words: HTMLElement[];
}

export function applyReplacements(node: Text, replacements: Replacement[], dark: boolean): Applied | null {
  if (!replacements.length) return null;
  const doc = node.ownerDocument;
  const original = node.data;
  const inserted: Node[] = [];
  const words: HTMLElement[] = [];
  // Work backwards so earlier offsets stay valid: node keeps the prefix each time.
  const sorted = [...replacements].sort((a, b) => b.start - a.start);
  for (const r of sorted) {
    const tail = node.splitText(r.end);
    const word = node.splitText(r.start);
    const el = createWord(doc, word.data, r.entry, r.lang, dark);
    word.replaceWith(el);
    inserted.unshift(el, tail);
    words.unshift(el);
  }
  // Drop empty tail nodes so the DOM stays tidy.
  for (const n of inserted) {
    if (n.nodeType === Node.TEXT_NODE && !(n as Text).data) n.parentNode?.removeChild(n);
  }
  return { node, original, inserted: inserted.filter((n) => n.parentNode), words };
}

export function createWord(doc: Document, original: string, entry: Entry, lang: SourceLang, dark: boolean): HTMLElement {
  const [shown, lemma, gender, pos, flags] = entry;
  const el = doc.createElement(WORD_TAG);
  el.textContent = shown;
  el.dataset.orig = original;
  el.dataset.lang = lang;
  el.dataset.lemma = lemma;
  el.dataset.pos = pos;
  if (gender) el.dataset.g = gender;
  if (flags.includes('p')) el.dataset.plural = '';
  if (dark) el.dataset.dark = '';
  return el;
}

/**
 * Puts the original text back. When the page itself has rewritten the node
 * (a framework re-render), only Trana's leftovers are removed and the page's
 * new text is kept.
 */
export function revertApplied(applied: Applied, restoreText = true): void {
  for (const n of applied.inserted) n.parentNode?.removeChild(n);
  if (restoreText && applied.node.data !== applied.original) applied.node.data = applied.original;
}
