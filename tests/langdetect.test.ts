import { describe, expect, it } from 'vitest';
import { detectLanguage } from '../src/content/langdetect';
import { paragraphs } from './helpers';

describe('detectLanguage', () => {
  for (const [file, lang] of [
    ['en-article.html', 'en'],
    ['de-article.html', 'de'],
    ['fr-article.html', 'fr'],
    ['es-article.html', 'es'],
    ['sv-article.html', 'sv'],
    ['dark-article.html', 'en'],
  ] as const) {
    it(`detects every paragraph of ${file} as ${lang}`, () => {
      const long = paragraphs(file).filter((p) => p.split(/\s+/).length >= 12);
      expect(long.length).toBeGreaterThan(1);
      for (const p of long) expect(detectLanguage(p).lang, p).toBe(lang);
    });
  }

  it('does not mistake related languages for supported ones', () => {
    const samples = {
      nl: 'Elke zomer rijdt mijn familie naar een klein rood huis bij het meer. De weg is lang, maar de kinderen slapen altijd in de auto en mijn vader vertelt dezelfde oude verhalen.',
      da: 'Hver sommer kører min familie nordpå til et lille rødt hus ved søen. Vejen er lang, men børnene sover altid i bilen, og min far fortæller de samme gamle historier om første gang han så vandet.',
      pt: 'Todos os verões a minha família viaja para a aldeia dos meus avós. O caminho é longo, mas as crianças dormem no carro e o meu pai conta sempre as mesmas histórias.',
      it: 'Ogni estate la mia famiglia va al paese dei miei nonni. La strada è lunga, ma i bambini dormono sempre in macchina e mio padre racconta sempre le stesse storie.',
    };
    for (const [lang, text] of Object.entries(samples)) {
      const detected = detectLanguage(text).lang;
      // Danish and Norwegian may be too close to call; either way they are not translated.
      if (lang === 'da') expect(['da', 'nb', null]).toContain(detected);
      else expect(detected, lang).toBe(lang);
    }
  });

  it('gives no verdict for very short text', () => {
    expect(detectLanguage('Hello world').lang).toBeNull();
  });
});
