import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/content/tokenizer';

const replaceable = (text: string, lang: Parameters<typeof tokenize>[1]) =>
  tokenize(text, lang).filter((t) => !t.skip).map((t) => t.text);

describe('tokenize', () => {
  it('skips the first word of each sentence', () => {
    const tokens = tokenize('Houses are big. Water is wet! "Trees" grow? (Birds) sing', 'en');
    expect(tokens.filter((t) => t.sentenceStart).map((t) => t.text)).toEqual(['Houses', 'Water', 'Trees', 'Birds']);
  });

  it('skips capitalized words mid-sentence except in German', () => {
    expect(replaceable('So we met Anna in the garden today', 'en')).toEqual(['we', 'met', 'in', 'the', 'garden', 'today']);
    expect(replaceable('Dann sehen wir das Haus am Fluss', 'de')).toEqual(['sehen', 'wir', 'das', 'Haus', 'am', 'Fluss']);
  });

  it('skips acronyms, compounds, contractions, numbers and addresses', () => {
    const text = 'So the NASA well-known house isn\'t near mp3 files or www.example.com and mail@host.org';
    expect(replaceable(text, 'en')).toEqual(['the', 'house', 'near', 'files', 'or', 'and']);
  });

  it('splits French elisions so the noun can be replaced', () => {
    const tokens = tokenize("il voit l'homme et l’arbre d'aujourd'hui", 'fr');
    expect(tokens.filter((t) => !t.skip).map((t) => t.text)).toEqual(['voit', 'homme', 'et', 'arbre']);
  });

  it('knows which tokens follow the previous one after plain whitespace', () => {
    expect(tokenize('Joschka Fischer, Koch und (Bauer)', 'de').map((t) => t.afterSpace)).toEqual([false, true, false, true, false]);
  });

  it('keeps offsets that point into the original text', () => {
    const text = 'the old house';
    for (const t of tokenize(text, 'en')) expect(text.slice(t.start, t.end)).toBe(t.text);
  });
});
