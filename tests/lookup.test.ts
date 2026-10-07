import { describe, expect, it } from 'vitest';
import { entryIn, type Entry, type LookupResult } from '../src/shared/messages';
import { findCandidates } from '../src/content/selector';
import { tokenize } from '../src/content/tokenizer';
import { dictionary } from './helpers';

const PROTOTYPE_WORDS = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf'];

describe('entryIn', () => {
  it('ignores keys inherited from Object.prototype', () => {
    // What the content script gets back from the background: a cloned plain object.
    const result = structuredClone({}) as LookupResult;
    for (const w of PROTOTYPE_WORDS) expect(entryIn(result, w)).toBeNull();
  });

  it('returns entries the result has', () => {
    const entry: Entry = ['vatten', 'vatten', 'ett', 'n', 'd'];
    expect(entryIn(structuredClone({ water: entry }), 'water')).toEqual(entry);
  });
});

describe('lookup results and candidates', () => {
  it('does not crash on "constructor" when the dictionary lacks it', () => {
    const en = dictionary('en');
    expect(Object.hasOwn(en, 'constructor')).toBe(false);
    const tokens = tokenize('Then the constructor sets up the water supply.', 'en');
    const words = [...new Set(tokens.map((t) => t.lower))];
    const result = structuredClone(Object.fromEntries(words.filter((w) => Object.hasOwn(en, w)).map((w) => [w, en[w]])));
    const cache = new Map(words.map((w) => [w, entryIn(result, w)]));
    const found = findCandidates(tokens, 'en', (k) => cache.get(k) ?? undefined).map((c) => c.token.text);
    expect(found).not.toContain('constructor');
    expect(found).toContain('water');
  });
});
