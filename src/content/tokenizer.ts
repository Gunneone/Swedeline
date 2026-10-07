import { ELISIONS, type SourceLang } from './langdata';

export interface Token {
  /** Offsets into the tokenized text. */
  start: number;
  end: number;
  text: string;
  /** Lowercased text, for context checks. */
  lower: string;
  /** First word of a sentence: capitalization says nothing about it being a name, so it is skipped. */
  sentenceStart: boolean;
  /** Only whitespace separates it from the previous token (no comma, bracket, etc.). */
  afterSpace: boolean;
  /** Why the token can never be replaced, or '' if it can. */
  skip: '' | 'joined' | 'caps' | 'name' | 'sentence-start' | 'short';
}

const WORD = /[\p{L}\p{M}]+/gu;
const LETTER_OR_DIGIT = /[\p{L}\p{M}\p{N}]/u;
const DIGIT = /\p{N}/u;
/** Characters that glue words together: hyphens, apostrophes, e-mail and URL punctuation. */
const JOINERS = new Set(['-', '‐', '‑', "'", '’', '_', '@', '/', '\\', '.', ':', '=', '&', '#', '+']);
const APOSTROPHES = new Set(["'", '’']);
const SENTENCE_END = /[.!?…]/u;
/** Skipped when looking back for the end of the previous sentence: spaces, quotes, brackets, dashes, ¡ ¿. */
const OPENERS = /[\s"'“”„«»‹›‘’()[\]{}¡¿–—*•·-]/u;

/**
 * Splits text into word tokens and marks the ones that must not be replaced:
 * parts of compounds, contractions, URLs and e-mail addresses, acronyms, proper
 * names (capitalized mid-sentence; German nouns excepted) and sentence-initial words.
 */
export function tokenize(text: string, lang: SourceLang): Token[] {
  const tokens: Token[] = [];
  const elisions = new Set(ELISIONS[lang]);
  for (const m of text.matchAll(WORD)) {
    const start = m.index;
    const end = start + m[0].length;
    const word = m[0];
    const lower = word.toLocaleLowerCase();
    const sentenceStart = isSentenceStart(text, start);
    const prev = tokens.at(-1);
    const afterSpace = !!prev && /^\s+$/u.test(text.slice(prev.end, start));
    const token: Token = { start, end, text: word, lower, sentenceStart, afterSpace, skip: '' };

    const before = text[start - 1] ?? '';
    const after = text[end] ?? '';
    const elided =
      APOSTROPHES.has(before) && prev?.end === start - 1 && elisions.has(prev.lower);
    if (
      (JOINERS.has(after) && LETTER_OR_DIGIT.test(text[end + 1] ?? '')) ||
      (JOINERS.has(before) && LETTER_OR_DIGIT.test(text[start - 2] ?? '') && !elided) ||
      DIGIT.test(before) ||
      DIGIT.test(after)
    ) {
      token.skip = 'joined';
    } else if (word.length < 2) {
      token.skip = 'short';
    } else if (word.length > 1 && word === word.toLocaleUpperCase() && word !== lower) {
      token.skip = 'caps';
    } else if (sentenceStart) {
      token.skip = 'sentence-start';
    } else if (lang !== 'de' && word !== lower) {
      token.skip = 'name';
    }
    tokens.push(token);
  }
  return tokens;
}

function isSentenceStart(text: string, start: number): boolean {
  for (let i = start - 1; i >= 0; i--) {
    const c = text[i];
    if (SENTENCE_END.test(c)) return true;
    if (!OPENERS.test(c)) return false;
  }
  return true;
}
