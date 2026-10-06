import { describe, expect, it } from 'vitest';
import type { Entry } from '../src/shared/messages';
import { findCandidates, selectReplacements } from '../src/content/selector';
import { tokenize } from '../src/content/tokenizer';
import { dictionary, paragraphs } from './helpers';

const en = dictionary('en');
const lookup = (k: string): Entry | undefined => en[k];

describe('findCandidates', () => {
  it('requires noun context for words that are also common verbs', () => {
    expect(en.water?.[4]).toContain('d');
    const ok = findCandidates(tokenize('we drank the water slowly', 'en'), 'en', lookup).map((c) => c.token.text);
    const notOk = findCandidates(tokenize('we water the plants slowly', 'en'), 'en', lookup).map((c) => c.token.text);
    expect(ok).toContain('water');
    expect(notOk).not.toContain('water');
  });

  it('accepts an adjective between the article and the noun', () => {
    const found = findCandidates(tokenize('we drank the cold water slowly', 'en'), 'en', lookup).map((c) => c.token.text);
    expect(found).toContain('water');
  });

  it('does not take pronouns that usually precede a verb as noun context', () => {
    const found = (text: string) => findCandidates(tokenize(text, 'en'), 'en', lookup).map((c) => c.token.text);
    expect(found('these are the things that need attention')).not.toContain('need');
    expect(found('they said we all want the same')).not.toContain('want');
    expect(found('there is a real need for change')).toContain('need');
  });

  it('reads French and Spanish object pronouns as pronouns', () => {
    const SANG: Entry = ['säng', 'säng', 'en', 'n', 'd'];
    const HUS: Entry = ['hus', 'hus', 'ett', 'n', 'd'];
    const fr = (text: string) => findCandidates(tokenize(text, 'fr'), 'fr', (k) => (k === 'lit' ? SANG : undefined));
    expect(fr('il le lit souvent le soir')).toHaveLength(0);
    expect(fr('elle dort dans le lit ce soir')).toHaveLength(1);
    const es = (text: string) => findCandidates(tokenize(text, 'es'), 'es', (k) => (k === 'casa' ? HUS : undefined));
    expect(es('ayer ella la casa con su novio')).toHaveLength(0);
    expect(es('ayer vimos la casa de mi abuela')).toHaveLength(1);
  });

  it('skips German surnames that are also nouns', () => {
    const de = dictionary('de');
    const found = (text: string) => findCandidates(tokenize(text, 'de'), 'de', (k) => de[k]).map((c) => c.token.text);
    expect(found('gestern hat Joschka Fischer mit Herr Koch gesprochen')).toEqual([]);
    expect(found('der alte Fischer fährt mit dem Boot hinaus')).toContain('Fischer');
    expect(found('weil der Vater Geld braucht')).toEqual(['Vater', 'Geld']);
  });
});

describe('selectReplacements', () => {
  const text = paragraphs('en-article.html').join(' ');
  const tokens = tokenize(text, 'en');
  const candidates = findCandidates(tokens, 'en', lookup);
  const words = tokens.length;

  it('replaces about the requested share of words', () => {
    for (const rate of [0.02, 0.06, 0.13]) {
      const n = selectReplacements(candidates, words, rate, 'seed').length;
      expect(n).toBeGreaterThanOrEqual(Math.floor(rate * words * 0.7));
      expect(n).toBeLessThanOrEqual(Math.ceil(rate * words) + 1);
    }
  });

  it('only adds words when the rate goes up, and is stable', () => {
    let previous = new Set<number>();
    for (const rate of [0.01, 0.02, 0.03, 0.04, 0.06, 0.08, 0.1, 0.13, 0.16, 0.2]) {
      const picked = new Set(selectReplacements(candidates, words, rate, 'seed').map((c) => c.index));
      for (const i of previous) expect(picked.has(i)).toBe(true);
      previous = picked;
    }
    const again = selectReplacements(candidates, words, 0.06, 'seed').map((c) => c.index);
    expect(again).toEqual(selectReplacements(candidates, words, 0.06, 'seed').map((c) => c.index));
  });

  it('keeps replacements apart', () => {
    const picked = selectReplacements(candidates, words, 0.2, 'seed');
    for (let i = 1; i < picked.length; i++) expect(picked[i].index - picked[i - 1].index).toBeGreaterThan(3);
  });
});
