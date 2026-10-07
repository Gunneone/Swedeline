import type { Entry } from '../shared/messages';
import { ARTICLE_PRONOUNS, NAME_TITLES, NOUN_CONTEXT, PRONOUN_CUES, STOPWORDS, type SourceLang } from './langdata';
import type { Token } from './tokenizer';

/** Words between two replacements, at least. */
export const MIN_GAP = 3;

export interface Candidate {
  token: Token;
  /** Index of the token in the block's token list. */
  index: number;
  entry: Entry;
}

export type Lookup = (key: string) => Entry | undefined;

/** The dictionary key for a token: exact case for German (Haus vs. haus), lowercase otherwise. */
export const lookupKey = (token: Token, lang: SourceLang): string => (lang === 'de' ? token.text : token.lower);

/** Tokens of one block that have a usable translation in this context. */
export function findCandidates(tokens: Token[], lang: SourceLang, lookup: Lookup): Candidate[] {
  const words = wordSets(lang);
  const out: Candidate[] = [];
  tokens.forEach((token, index) => {
    if (token.skip) return;
    const entry = lookup(lookupKey(token, lang));
    if (!entry) return;
    // Flag "d": the word is also a common verb form, so require a noun context
    // (an article, possessive, number or preposition, maybe with an adjective between).
    if (entry[4].includes('d') && !hasNounContext(tokens, index, lang, words, lookup)) return;
    if (lang === 'de' && isLikelyName(tokens, index, words, lookup)) return;
    out.push({ token, index, entry });
  });
  return out;
}

interface WordSets {
  context: Set<string>;
  articlePronouns: Set<string>;
  pronounCues: Set<string>;
  functionWords: Set<string>;
}

const setsCache = new Map<SourceLang, WordSets>();
function wordSets(lang: SourceLang): WordSets {
  let sets = setsCache.get(lang);
  if (!sets) {
    sets = {
      context: new Set(NOUN_CONTEXT[lang]),
      articlePronouns: new Set(ARTICLE_PRONOUNS[lang]),
      pronounCues: new Set(PRONOUN_CUES[lang]),
      functionWords: new Set([...STOPWORDS[lang], ...NOUN_CONTEXT[lang]]),
    };
    setsCache.set(lang, sets);
  }
  return sets;
}

function hasNounContext(tokens: Token[], index: number, lang: SourceLang, words: WordSets, lookup: Lookup): boolean {
  const prev = tokens[index - 1];
  if (!prev || tokens[index].sentenceStart) return false;
  const prev2 = tokens[index - 2];
  if (words.context.has(prev.lower)) {
    // "je l'aime", "tu la quieres": the article is an object pronoun and a verb follows.
    return !(words.articlePronouns.has(prev.lower) && prev2 && words.pronounCues.has(prev2.lower));
  }
  const prevEntry = lookup(lookupKey(prev, lang));
  return !!prev2 && prevEntry?.[3] === 'a' && !prev.sentenceStart && words.context.has(prev2.lower);
}

const TITLES = new Set(NAME_TITLES);

/**
 * German capitalizes nouns and names alike, and many surnames are nouns
 * (Fischer, Koch, Bauer). A capitalized word right after a title or after
 * another capitalized word that is no known word (a first name) is taken as a name.
 */
function isLikelyName(tokens: Token[], index: number, words: WordSets, lookup: Lookup): boolean {
  const token = tokens[index];
  const prev = tokens[index - 1];
  if (!prev || !token.afterSpace || token.text === token.lower) return false;
  if (TITLES.has(prev.text)) return true;
  if (prev.text === prev.lower || prev.skip === 'joined' || prev.skip === 'short') return false;
  if (words.functionWords.has(prev.lower)) return false;
  return !lookup(prev.text) && !lookup(prev.lower);
}

/**
 * Picks which candidates to replace so that about `rate` of the block's words
 * become Swedish. Candidates are ranked by a stable pseudo-random number from
 * the word and its position, and the first ones are taken. So the same words
 * come back after a reload, and moving the slider up only adds words, moving
 * it down only removes words.
 */
export function selectReplacements(candidates: Candidate[], blockWords: number, rate: number, seed: string): Candidate[] {
  if (!candidates.length || rate <= 0) return [];
  // How many words this block gets: rate × words, with the fraction rounded up
  // or down by a stable coin so short blocks still average out right.
  const target = rate * blockWords;
  const count = Math.floor(target + hash01(`${seed}#count`));
  // Greedy in hash order (not document order): a word picked at a low rate is
  // processed before anything that could crowd it out at a higher rate.
  const ranked = candidates
    .map((c) => ({ c, h: hash01(`${seed}|${c.token.lower}|${c.index}`) }))
    .sort((a, b) => a.h - b.h);
  const picked: Candidate[] = [];
  for (const { c } of ranked) {
    if (picked.length >= count) break;
    if (picked.some((p) => Math.abs(p.index - c.index) <= MIN_GAP)) continue;
    picked.push(c);
  }
  return picked.sort((a, b) => a.index - b.index);
}

/** FNV-1a hash mapped to [0, 1). */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}
