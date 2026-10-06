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
