// Translation quality on real sentences with the real dictionaries: words that
// must not be replaced in these contexts, and replacements that must stay.
// Add a line here when fixing a wrong translation (overrides/<lang>.json).
import { describe, expect, it } from 'vitest';
import type { SourceLang } from '../src/content/langdata';
import { findCandidates } from '../src/content/selector';
import { tokenize } from '../src/content/tokenizer';
import { dictionary } from './helpers';

/** [sentence, expected "word=swedish" pairs, words that must stay untouched] */
const CASES: Record<SourceLang, [string, string[], string[]][]> = {
  en: [
    ['I think you are right about the first time we met.', [], ['right', 'first']],
    ['We have done everything we could, and I am sorry for that.', ['sorry=ledsen'], ['done']],
    ['These are the things that need attention before we leave.', ['things=saker'], ['need']],
    ['They said that we all want the same outcome here.', [], ['want']],
    ['There is nobody else who could help us with it.', [], ['else']],
    ['She was a pretty girl with a red hat.', ['red=röd', 'hat=hatt'], ['pretty']],
    ['Some felt that the team had done a good job this year.', ['good=bra'], ['felt', 'done']],
    ['He paid in cash and the law says that the suit is his.', ['cash=kontanter', 'law=lag', 'suit=kostym'], []],
    ['It was a common mistake with a fresh team and a new trick.', ['common=vanlig', 'fresh=färsk', 'trick=knep'], []],
    ['The knight and the bishop took a cab to the port.', ['knight=riddare', 'bishop=biskop', 'cab=taxi', 'port=hamn'], []],
    ['Throw the trash in the corner, because the elevator is broken.', ['trash=skräp', 'elevator=hiss'], []],
  ],
  es: [
    ['Mañana ellos van a la playa con sus amigos del colegio.', ['playa=strand'], ['van']],
    ['Él llegó muy tarde a la reunión de ayer por la noche.', ['noche=natt'], ['tarde']],
    ['Tenía una sonrisa enorme en la cara cuando lo vio.', ['sonrisa=leende'], ['cara']],
    ['Mi madre prepara una cena sencilla con pescado y patatas.', ['patatas=potatisar'], []],
    ['Las reglas del colegio son claras y corren cien metros en la pista.', ['reglas=regler', 'colegio=skola', 'metros=meter'], ['pista']],
    ['En julio vamos a la isla con un miembro de la familia.', ['julio=juli', 'isla=ö', 'miembro=medlem'], []],
    ['No sé cuyo es el perro, pero vimos una colina muy verde.', ['colina=kulle'], ['cuyo']],
    ['Los músicos tienen un plazo muy corto para el concurso.', ['músicos=musiker', 'plazo=frist'], []],
  ],
  fr: [
    ["Je pense que je l'aime beaucoup, et tu l'as bien vu.", ['beaucoup=mycket'], ['aime', 'as']],
    ["C'est une solution parfaite pour notre petite maison.", ['parfaite=perfekt', 'maison=hus'], []],
    ['Il est en train de manger avec ses amis.', [], ['train']],
    ['Il le lit souvent, puis il dort dans le lit.', ['lit=säng'], []],
    ["C'est formidable, mais c'est dommage pour le bar du village.", ['formidable=fantastisk', 'dommage=synd'], ['bar']],
    ['Il est membre du club depuis huit ans avec un professeur.', ['membre=medlem', 'professeur=lärare'], ['huit']],
    ['Elle cherche un indice dans la vieille cassette de la demoiselle.', ['indice=ledtråd', 'cassette=kassett', 'demoiselle=fröken'], []],
    ['Il nous faut un enregistrement de la réception pour le dossier.', ['enregistrement=inspelning', 'réception=mottagning'], []],
  ],
  de: [
    ['Ich war zum ersten Mal in der großen Stadt bei meiner Mutter.', ['Mal=gång', 'Stadt=stad'], []],
    ['Das ist natürlich recht gut, sagte der alte Mann leise.', ['natürlich=naturligtvis', 'gut=bra'], ['recht']],
    ['Gestern hat Joschka Fischer mit Robert Koch gesprochen.', [], ['Fischer', 'Koch']],
    ['Heute Abend trinken wir eine Tasse Kaffee mit Herrn Vogel.', ['Abend=kväll', 'Kaffee=kaffe'], ['Vogel']],
    ['Er hat das ganze Zeug in die alte Kiste gelegt und plötzlich gelacht.', ['Zeug=grejer', 'Kiste=låda', 'plötzlich=plötsligt'], []],
    ['Der lange Flug war um Acht vorbei, sagte der kleine Geist.', ['Flug=flygning', 'Geist=ande'], ['Acht']],
    ['Nach dem Vorfall hat die alte Puppe ihre Stärke verloren.', ['Vorfall=incident', 'Puppe=docka', 'Stärke=styrka'], []],
    ['Der junge Künstler wohnt jetzt im Westen der Stadt.', ['Künstler=konstnär', 'Westen=väster'], []],
  ],
};

describe('translations in context', () => {
  for (const [lang, cases] of Object.entries(CASES) as [SourceLang, (typeof CASES)['en']][]) {
    const dict = dictionary(lang);
    for (const [sentence, expected, untouched] of cases) {
      it(`${lang}: ${sentence}`, () => {
        const found = findCandidates(tokenize(sentence, lang), lang, (k) => dict[k]);
        const pairs = found.map((c) => `${c.token.text}=${c.entry[0]}`);
        for (const pair of expected) expect(pairs).toContain(pair);
        for (const word of untouched) expect(found.map((c) => c.token.text)).not.toContain(word);
      });
    }
  }
});
