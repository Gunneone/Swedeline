import { describe, expect, it } from 'vitest';
import { SOURCE_LANGS, STOPWORDS } from '../src/content/langdata';
import { dictionary } from './helpers';

describe('dictionaries', () => {
  it.each(SOURCE_LANGS)('%s has thousands of well-formed entries', (lang) => {
    const dict = dictionary(lang);
    const entries = Object.entries(dict);
    expect(entries.length).toBeGreaterThan(3000);
    for (const [word, [shown, lemma, gender, pos, flags]] of entries) {
      expect(shown, word).toBeTruthy();
      expect(lemma, word).toBeTruthy();
      expect(['', 'en', 'ett'], word).toContain(gender);
      expect(['n', 'a', 'r'], word).toContain(pos);
      expect(flags, word).toMatch(/^[dp]*$/);
    }
  });

  it.each(SOURCE_LANGS)('%s never translates function words', (lang) => {
    const dict = dictionary(lang);
    const stop = STOPWORDS[lang].filter((w) => Object.hasOwn(dict, w));
    expect(stop).toEqual([]);
  });

  it('maps plurals to Swedish plurals and keeps gender', () => {
    expect(dictionary('en').houses).toEqual(['hus', 'hus', 'ett', 'n', 'dp']);
    expect(dictionary('en').children?.slice(0, 3)).toEqual(['barn', 'barn', 'ett']);
    expect(dictionary('de')['Häuser']?.slice(0, 3)).toEqual(['hus', 'hus', 'ett']);
    expect(dictionary('fr').maisons?.slice(0, 3)).toEqual(['hus', 'hus', 'ett']);
    expect(dictionary('es').flores?.slice(0, 3)).toEqual(['blommor', 'blomma', 'en']);
  });

  it('skips words whose usual sense the translation misses', () => {
    const skipped = {
      en: ['ground', 'principal', 'applications', 'rider', 'metropolitan', 'domestic', 'driver', 'variety', 'action'],
      de: ['Bestimmungen', 'zufällige', 'Grimm'],
      fr: ['action', 'terrestre', 'matières', 'propriété'],
      es: ['masa'],
    } as const;
    for (const [lang, words] of Object.entries(skipped)) {
      const dict = dictionary(lang as keyof typeof skipped);
      expect(words.filter((w) => Object.hasOwn(dict, w)), lang).toEqual([]);
    }
  });

  it('picks the common sense', () => {
    expect(dictionary('en').flavor?.[1]).toBe('smak');
    expect(dictionary('en').foods?.[1]).toBe('livsmedel');
    expect(dictionary('fr')['propriétés']?.[1]).toBe('egenskap');
    // A reviewed translation of the lemma carries over to its other forms.
    expect(dictionary('de').gute?.[1]).toBe('bra');
    expect(dictionary('de').Jahrhunderts?.[1]).toBe('århundrade');
  });

  it('keeps German noun capitalization in keys', () => {
    expect(dictionary('de').Haus).toBeDefined();
    expect(dictionary('de').haus).toBeUndefined();
  });
});
