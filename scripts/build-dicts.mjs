#!/usr/bin/env node
// Builds src/dict/{en,de,fr,es}.json from open data:
//   - WikDict SQLite dictionaries (CC BY-SA, from Wiktionary via DBnary)
//   - FrequencyWords 2018 lists (CC BY-SA 4.0, from OpenSubtitles)
// Sources are cached in .cache/ (several GB); the generated JSON is committed.
//
// Usage: node scripts/build-dicts.mjs [en de fr es]

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { STOPWORDS, NOUN_CONTEXT, SOURCE_LANGS } from '../src/content/langdata.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.cache');
const OUT_DIR = path.join(ROOT, 'src', 'dict');
const WIKDICT_URL = 'https://download.wikdict.com/dictionaries/sqlite/2/';
const FREQ_URL = (l) =>
  `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/${l}/${l}_50k.txt`;

const PREFIX = { en: 'eng/', de: 'deu/', fr: 'fra/', es: 'spa/', sv: 'swe/' };
/** Only lemmas among the N most frequent words of the source language are included. */
const MAX_LEMMA_RANK = 15000;
const POS_CODE = { noun: 'n', adjective: 'a', adverb: 'r' };
/** Readings of these parts of speech never block a word. */
const IGNORED_POS = new Set([
  'properNoun', 'symbol', 'letter', 'prefix', 'suffix', 'infix', 'affix', 'phraseologicalUnit',
  'proverb', 'abbreviation', 'participle', 'interjection', '',
]);
/** Readings as these parts of speech block a word unless they are very rare. */
const FUNCTION_POS = new Set([
  'pronoun', 'indefinitePronoun', 'preposition', 'conjunction', 'determiner', 'article',
  'particle', 'numeral', 'auxiliary',
]);
const MAX_FUNCTION_RATIO = 0.1;
/** Weight of a sense with no Swedish translation (unknown, probably rare). */
const DEFAULT_WEIGHT = 30;
/** Translation rows below this score are weak or inferred and don't add weight. */
const MIN_WEIGHT_SCORE = 50;
/** Inflected-form readings count less than lemma readings. */
const FORM_DISCOUNT = 0.6;
/** Competing reading weight / chosen reading weight above which a word is ambiguous. */
const MAX_RATIO = 0.4;
const MAX_VERB_RATIO = 0.25;
const MAX_NOUN_VERB_RATIO = 1.0;

const isWord = (s) => /^\p{L}+$/u.test(s);
/** Swedish language names: used without en/ett ("talar tyska"), and their plurals in the source mean people. */
const LANGUAGES = new Set(
  `svenska engelska tyska franska spanska italienska portugisiska ryska kinesiska japanska koreanska
  arabiska grekiska danska norska finska polska nederländska holländska turkiska hebreiska persiska
  ungerska tjeckiska`.split(/\s+/),
);
/** Month names take no en/ett either ("i juli"). */
const MONTHS = new Set('januari februari mars april maj juni juli augusti september oktober november december'.split(' '));
/** Swedish nouns for digits and grades (en åtta = an eight), almost never what a source number word means. */
const NUMBER_NOUNS = new Set('nolla etta tvåa trea fyra femma sexa sjua åtta nia tia elva tolva'.split(' '));
/** Words to trace through the ambiguity check: DEBUG=car,happy node scripts/build-dicts.mjs en */
const DEBUG = new Set((process.env.DEBUG ?? '').split(',').filter(Boolean));
const lower = (s) => s.toLocaleLowerCase();

// ---------------------------------------------------------------- downloads

async function download(url, file) {
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  console.log(`  downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const tmp = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, file);
  return file;
}

const wikdict = (name) => download(`${WIKDICT_URL}${name}.sqlite3`, path.join(CACHE, 'wikdict', `${name}.sqlite3`));

async function loadFreq(lang) {
  const file = await download(FREQ_URL(lang), path.join(CACHE, 'freq', `${lang}_50k.txt`));
  const rank = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const word = line.split(' ')[0];
    if (word && !rank.has(word)) rank.set(word, rank.size + 1);
  }
  return rank;
}

function openDb(file) {
  return new DatabaseSync(file, { readOnly: true });
}

function prefixRange(prefix) {
  // All lexentries "eng/..." sort between "eng/" and "eng0" ("0" follows "/").
  return [prefix, prefix.slice(0, -1) + '0'];
}

// ---------------------------------------------------------------- Swedish

class Swedish {
  constructor(db, freq) {
    this.db = db;
    this.freq = freq;
    this.entries = new Map(); // written_rep -> [{lexentry, pos, gender}]
    const [lo, hi] = prefixRange(PREFIX.sv);
    const rows = db
      .prepare(
        `SELECT lexentry, written_rep, part_of_speech, gender FROM entry
         WHERE lexentry >= ? AND lexentry < ? AND part_of_speech IN ('noun','adjective','adverb')`,
      )
      .all(lo, hi);
    for (const r of rows) {
      const list = this.entries.get(r.written_rep) ?? [];
      list.push({ lexentry: r.lexentry, pos: r.part_of_speech, gender: r.gender });
      this.entries.set(r.written_rep, list);
    }
    this.formStmt = db.prepare(
      `SELECT other_written, number, "case", definiteness FROM form WHERE lexentry = ?`,
    );
    this.cache = new Map();
  }

  rank(word) {
    return this.freq.get(word) ?? Infinity;
  }

  /** Swedish data for a translation candidate, or null if it is not a known word with that POS. */
  info(word, pos) {
    const key = `${word}|${pos}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const lex = (this.entries.get(word) ?? []).filter((e) => e.pos === pos);
    let result = null;
    if (lex.length) {
      const forms = lex.flatMap((e) => this.formStmt.all(e.lexentry));
      result = { gender: '', plural: null, adjPlural: null };
      if (pos === 'noun') {
        result.gender = this.#gender(word, lex, forms);
        result.plural = this.#nounPlural(forms);
      } else if (pos === 'adjective') {
        result.adjPlural = this.#adjPlural(word, forms);
      }
    }
    this.cache.set(key, result);
    return result;
  }

  #gender(word, lex, forms) {
    const genders = new Set(
      lex.map((e) => ({ CommonGender: 'en', Neuter: 'ett' })[e.gender]).filter(Boolean),
    );
    if (genders.size === 1) return [...genders][0];
    if (genders.size > 1) return '';
    // No gender recorded: derive it from the definite singular (bilen -> en, huset -> ett).
    const plural = new Set(forms.filter((f) => f.number === 'Plural').map((f) => f.other_written));
    const definite = forms
      .filter(
        (f) =>
          f.number === 'Singular' && f.definiteness === 'Definite' && f.case !== 'GenitiveCase' &&
          f.other_written.startsWith(word.slice(0, 2)) && !plural.has(f.other_written),
      )
      .map((f) => f.other_written)
      .sort((a, b) => this.rank(a) - this.rank(b));
    const best = definite[0];
    if (!best) return '';
    if (best.endsWith('t')) return 'ett';
    if (best.endsWith('n')) return 'en';
    return '';
  }

  #nounPlural(forms) {
    const candidates = [
      ...new Set(
        forms
          .filter(
            (f) => f.number === 'Plural' && f.definiteness === 'Indefinite' && f.case !== 'GenitiveCase',
          )
          .map((f) => f.other_written)
          .filter(isWord),
      ),
    ];
    if (candidates.length === 1) return candidates[0];
    const known = candidates.filter((c) => this.freq.has(c)).sort((a, b) => this.rank(a) - this.rank(b));
    return known[0] ?? null;
  }

  #adjPlural(word, forms) {
    if (word === 'liten') return 'små';
    const plural = new Set(forms.filter((f) => f.number === 'Plural').map((f) => f.other_written));
    const options = [word + 'a', word.replace(/e([lnr])$/, '$1') + 'a', word.replace(/(.)\1$/, '$1') + 'a'];
    return options.find((o) => plural.has(o)) ?? null;
  }
}

// ---------------------------------------------------------------- inflection rules

const VOWELS = 'aeiouyàâäéèêëïîôöùûüáíóú';
const isVowel = (c) => VOWELS.includes(c);

/** English verb forms by rule plus common irregulars (WikDict has no English verb forms). */
function englishVerbForms(v) {
  // Rules on very short verbs only produce noise (be -> bed); their irregular forms still count.
  if (v.length < 3) return new Set([v, ...(EN_IRREGULAR[v] ?? [])]);
  const out = new Set([v]);
  const last = v.at(-1);
  const cvc = v.length >= 3 && !isVowel(v.at(-3)) && isVowel(v.at(-2)) && !isVowel(last) && !'wxy'.includes(last);
  if (/(s|x|z|ch|sh|o)$/.test(v)) out.add(v + 'es');
  else if (/[^aeiou]y$/.test(v)) out.add(v.slice(0, -1) + 'ies');
  else out.add(v + 's');
  if (v.endsWith('ie')) out.add(v.slice(0, -2) + 'ying');
  else if (v.endsWith('e') && !/(ee|ye|oe)$/.test(v)) out.add(v.slice(0, -1) + 'ing');
  else out.add(v + 'ing');
  if (v.endsWith('e')) out.add(v + 'd');
  else if (/[^aeiou]y$/.test(v)) out.add(v.slice(0, -1) + 'ied');
  else out.add(v + 'ed');
  if (cvc) {
    out.add(v + last + 'ing');
    out.add(v + last + 'ed');
  }
  for (const f of EN_IRREGULAR[v] ?? []) out.add(f);
  return out;
}

const EN_IRREGULAR = Object.fromEntries(
  `arise arose arisen|awake awoke awoken|bear bore borne born|beat beaten|become became|begin began begun|
  bend bent|bet|bind bound|bite bit bitten|bleed bled|blow blew blown|break broke broken|breed bred|
  bring brought|build built|burn burnt|buy bought|catch caught|choose chose chosen|cling clung|
  come came|cost|creep crept|cut|deal dealt|dig dug|do did done does|draw drew drawn|dream dreamt|
  drink drank drunk|drive drove driven|eat ate eaten|fall fell fallen|feed fed|feel felt|fight fought|
  find found|flee fled|fly flew flown|forbid forbade forbidden|forget forgot forgotten|forgive forgave forgiven|
  freeze froze frozen|get got gotten|give gave given|go went gone goes|grind ground|grow grew grown|
  hang hung|have had has|hear heard|hide hid hidden|hit|hold held|hurt|keep kept|kneel knelt|
  know knew known|lay laid|lead led|lean leant|leap leapt|learn learnt|leave left|lend lent|let|
  lie lay lain|light lit|lose lost|make made|mean meant|meet met|pay paid|prove proven|put|quit|
  read|ride rode ridden|ring rang rung|rise rose risen|run ran|say said|see saw seen|seek sought|
  sell sold|send sent|set|shake shook shaken|shed|shine shone|shoot shot|show shown|shrink shrank shrunk|
  shut|sing sang sung|sink sank sunk|sit sat|sleep slept|slide slid|sling slung|speak spoke spoken|
  speed sped|spend spent|spin spun|spit spat|split|spread|spring sprang sprung|stand stood|
  steal stole stolen|stick stuck|sting stung|stink stank stunk|strike struck stricken|string strung|
  strive strove striven|swear swore sworn|sweep swept|swell swollen|swim swam swum|swing swung|
  take took taken|teach taught|tear tore torn|tell told|think thought|throw threw thrown|
  tread trod trodden|understand understood|wake woke woken|wear wore worn|weave wove woven|
  weep wept|win won|wind wound|write wrote written|be am is are was were been being`
    .split('|')
    .map((g) => g.trim().split(/\s+/))
    .map(([v, ...forms]) => [v, forms]),
);

/** French verb forms by rule (WikDict has almost no French verb forms). */
function frenchVerbForms(v) {
  const out = new Set([v, ...(FR_IRREGULAR[v] ?? [])]);
  if (v.length < 4) return out;
  const add = (stem, ends) => ends.forEach((e) => out.add(stem + e));
  if (v.endsWith('er')) {
    const s = v.slice(0, -2);
    add(s, ['e', 'es', 'ent', 'ons', 'ez', 'é', 'ée', 'és', 'ées', 'ais', 'ait', 'aient', 'a', 'as', 'èrent', 'era', 'eras']);
    // e -> è in the stem (lever -> lève, acheter -> achète)
    const m = s.match(/^(.*)e([^aeiouy]+)$/);
    if (m) add(`${m[1]}è${m[2]}`, ['e', 'es', 'ent']);
  } else if (v.endsWith('ir')) {
    const s = v.slice(0, -2);
    add(s, ['is', 'it', 'issons', 'issez', 'issent', 'i', 'ie', 'ies']);
    add(s.slice(0, -1), ['s', 't']); // partir -> pars, part ; sortir -> sors, sort
  } else if (v.endsWith('re')) {
    const s = v.slice(0, -2);
    add(s, ['s', 't', '', 'ons', 'ez', 'ent', 'u', 'ue', 'us', 'ues', 'is', 'it', 'ise', 'ises']);
  }
  return out;
}

const FR_IRREGULAR = Object.fromEntries(
  `être suis es est sommes êtes sont été était|avoir ai as a avons avez ont eu|faire fais fait faisons faites font|
  aller vais vas va allons allez vont|pouvoir peux peut pouvons pouvez peuvent pu|
  vouloir veux veut voulons voulez veulent voulu|devoir dois doit devons devez doivent dû|
  savoir sais sait savons savez savent su|voir vois voit voyons voyez voient vu vue|
  venir viens vient venons venez viennent venu venue|prendre prends prend prenons prenez prennent pris prise|
  dire dis dit disons dites disent|mettre mets met mettons mettez mettent mis mise|
  tenir tiens tient tenons tenez tiennent tenu|vivre vis vit vivons vivez vivent vécu|
  croire crois croit croyons croient cru|boire bois boit buvons buvez boivent bu|lire lis lit lu|
  écrire écris écrit écrite|connaître connais connaît connu|ouvrir ouvre ouvres ouvert ouverte|
  couvrir couvre couvert|offrir offre offert|mourir meurt mort morte|naître né née|
  courir cours court couru|sentir sens sent senti|servir sers sert servi|dormir dors dort|
  suivre suis suit suivi|rire ris rit ri|plaire plais plaît plu|craindre crains craint|
  peindre peins peint|joindre joins joint|valoir vaut valu|falloir faut fallu|pleuvoir pleut plu`
    .split('|')
    .map((g) => g.trim().split(/\s+/))
    .map(([v, ...forms]) => [v, forms]),
);

/** Spanish verb forms by rule, including stem changes (contar -> cuenta, jugar -> juego). */
function spanishVerbForms(v) {
  const out = new Set([v]);
  const ending = v.slice(-2);
  const stem = v.slice(0, -2);
  for (const f of ES_IRREGULAR[v] ?? []) out.add(f);
  // Very short stems (ver, dar, ir) are irregular; rules would only produce noise like "vida".
  if (!['ar', 'er', 'ir'].includes(ending) || stem.length < 2) return out;
  const present =
    ending === 'ar' ? ['o', 'as', 'a', 'amos', 'an', 'e', 'es', 'en'] : ['o', 'es', 'e', 'emos', 'imos', 'en', 'a', 'as', 'an'];
  const other =
    ending === 'ar'
      ? ['ado', 'ada', 'ados', 'adas', 'é', 'ó', 'aron', 'aba', 'abas', 'aban', 'ando']
      : ['ido', 'ida', 'idos', 'idas', 'í', 'ió', 'ieron', 'ía', 'ías', 'ían', 'iendo'];
  for (const e of [...present, ...other]) out.add(stem + e);
  // Stem-changing variants on the last stem vowel.
  const m = stem.match(/^(.*)([eou])([^aeiou]*)$/);
  if (m) {
    const [, head, vowel, tail] = m;
    const changed = { e: ['ie', 'i'], o: ['ue'], u: ['ue'] }[vowel];
    for (const c of changed) for (const e of present) out.add(head + c + tail + e);
  }
  return out;
}

const ES_IRREGULAR = Object.fromEntries(
  `ser soy eres es somos son fue fui era eran sido|estar estoy estás está están estuvo|
  haber he has ha hemos han hay había hubo haya hayan habrá habría|tener tengo tienes tiene tienen tuvo|
  hacer hago hace hacen hizo hecho hecha|ir voy vas va van fue iba|poder puedo puede pueden pudo|
  decir digo dice dicen dijo dicho|ver veo ves ve vemos ven vio visto vista|dar doy das da damos dan dio dado dada|
  saber sé sabe saben supo|querer quiero quiere quieren quiso|poner pongo pone ponen puso puesto puesta|
  venir vengo viene vienen vino|salir salgo sale salen|traer traigo trae traen trajo|
  conocer conozco conoce|volver vuelvo vuelve vuelta vuelto|morir muere muerto muerta|
  abrir abierto abierta|escribir escrito escrita|romper roto rota|cubrir cubierto`
    .split('|')
    .map((g) => g.trim().split(/\s+/))
    .map(([v, ...forms]) => [v, forms]),
);

/** Regular noun plurals for languages whose WikDict data lacks forms. */
function rulePlurals(lang, w) {
  if (lang === 'es') {
    if (/[aeiouéó]$/.test(w)) return [w + 's'];
    if (w.endsWith('z')) return [w.slice(0, -1) + 'ces'];
    const unaccented = w.replace(/á(?=[^aeiou]*$)/, 'a').replace(/é(?=[^aeiou]*$)/, 'e')
      .replace(/í(?=[^aeiou]*$)/, 'i').replace(/ó(?=[^aeiou]*$)/, 'o').replace(/ú(?=[^aeiou]*$)/, 'u');
    return [unaccented + 'es'];
  }
  if (lang === 'fr') {
    if (/[sxz]$/.test(w)) return [];
    if (w.endsWith('al')) return [w.slice(0, -2) + 'aux'];
    if (/(eau|eu|au)$/.test(w)) return [w + 'x'];
    return [w + 's'];
  }
  return [];
}

/** Gender/number forms of adjectives for French and Spanish: [form, isPlural]. */
function ruleAdjectiveForms(lang, a) {
  const out = [];
  const add = (f, pl) => f !== a && out.push([f, pl]);
  if (lang === 'es') {
    if (a.endsWith('o')) {
      const s = a.slice(0, -1);
      add(s + 'a', false); add(s + 'os', true); add(s + 'as', true);
    } else if (a.endsWith('e')) add(a + 's', true);
    else if (a.endsWith('z')) add(a.slice(0, -1) + 'ces', true);
    else if (a.endsWith('or')) { add(a + 'a', false); add(a + 'es', true); add(a + 'as', true); }
    else add(a + 'es', true);
  } else if (lang === 'fr') {
    const fem = a.endsWith('eux') ? a.slice(0, -1) + 'se'
      : a.endsWith('if') ? a.slice(0, -1) + 've'
      : /(el|en|on)$/.test(a) ? a + a.at(-1) + 'e'
      : a.endsWith('er') ? a.slice(0, -2) + 'ère'
      : a.endsWith('e') ? null
      : a + 'e';
    if (fem) { add(fem, false); add(fem + 's', true); }
    if (a.endsWith('al')) add(a.slice(0, -2) + 'aux', true);
    else if (!/[sx]$/.test(a)) add(a + 's', true);
  }
  return out;
}

const DE_ARTICLE = /^(der|die|das|des|dem|den|ein|eine|einen|einem|einer|eines|ich|du|er|sie|es|wir|ihr|man|zu) /;

// ---------------------------------------------------------------- per language

async function buildLanguage(lang, sv) {
  console.log(`\n[${lang}] building`);
  const freq = await loadFreq(lang);
  const pairDb = openDb(await wikdict(`${lang}-sv`));
  const srcDb = openDb(await wikdict(lang));
  const [lo, hi] = prefixRange(PREFIX[lang]);
  const caseSensitive = lang === 'de';
  const key = (s) => (caseSensitive ? s : lower(s));
  const inFreq = (s) => freq.has(lower(s));
  const overrides = loadOverrides(lang);
  const stop = new Set([...STOPWORDS[lang], ...NOUN_CONTEXT[lang]]);
  const blocked = new Set(overrides.block.map(key));

  // 1. Translations grouped by source lexentry, with POS from the source DB.
  const posStmt = srcDb.prepare('SELECT part_of_speech FROM entry WHERE lexentry = ?');
  const lexs = new Map(); // lexentry -> {rep, pos, weight, rows[]}
  for (const r of pairDb
    .prepare(
      `SELECT lexentry, written_rep, trans_list, score, is_good FROM translation
       WHERE lexentry >= ? AND lexentry < ? ORDER BY is_good DESC, score DESC`,
    )
    .all(lo, hi)) {
    if (!(r.is_good || r.score >= 10)) continue;
    let lex = lexs.get(r.lexentry);
    if (!lex) {
      const pos = posStmt.get(r.lexentry)?.part_of_speech ?? '';
      lex = { lexentry: r.lexentry, rep: r.written_rep, pos, weight: 1, rows: [] };
      lexs.set(r.lexentry, lex);
    }
    if (r.score >= MIN_WEIGHT_SCORE) lex.weight += r.score;
    lex.rows.push(r);
  }
  console.log(`  ${lexs.size} translated senses`);

  // 2. Choose a Swedish translation for each noun/adjective/adverb lemma.
  const candidates = [];
  for (const lex of lexs.values()) {
    lex.sv = firstTranslation(lex.rows); // rough, for comparing readings
    if (DEBUG.has(key(lex.rep))) {
      console.log(`  [debug] ${lex.lexentry} (${lex.pos}) rank ${freq.get(lower(lex.rep))}: ${lex.rows.map((r) => r.trans_list).join(' / ')}`);
    }
    if (!POS_CODE[lex.pos] || !isWord(lex.rep)) continue;
    const rank = freq.get(lower(lex.rep));
    if (!rank || rank > MAX_LEMMA_RANK) continue;
    if (stop.has(lower(lex.rep)) || blocked.has(key(lex.rep))) continue;
    if (lang !== 'de' && lex.rep !== lower(lex.rep)) continue; // proper nouns, acronyms
    if (lang === 'de' && lex.pos === 'noun' && lex.rep[0] === lower(lex.rep[0])) continue;
    const choice = chooseTranslation(lex, sv);
    if (!choice) continue;
    lex.sv = choice.word;
    lex.svInfo = choice.info;
    candidates.push(lex);
  }
  console.log(`  ${candidates.length} candidate lemmas`);

  // 3. Surface forms of each candidate.
  const formStmt = srcDb.prepare('SELECT other_written, number FROM form WHERE lexentry = ?');
  const surfaces = new Map(); // key -> [{lex, plural}]
  const addSurface = (s, lex, plural) => {
    if (!isWord(s) || !inFreq(s)) return;
    if (stop.has(lower(s)) || blocked.has(key(s))) return;
    const list = surfaces.get(key(s)) ?? [];
    if (!list.some((x) => x.lex === lex)) list.push({ lex, plural, surface: s });
    surfaces.set(key(s), list);
  };
  for (const lex of candidates) {
    addSurface(lex.rep, lex, false);
    const forms = formStmt.all(lex.lexentry).map((f) => ({
      word: f.other_written.replace(DE_ARTICLE, '').split(' ')[0],
      number: f.number,
    }));
    if (lex.pos === 'noun') {
      if (lang === 'en' || lang === 'de') {
        for (const f of forms) if (f.number === 'Plural' || (lang === 'de' && f.number === 'Singular')) addSurface(f.word, lex, f.number === 'Plural');
      } else {
        const plurals = forms.map((f) => f.word).filter((w) => w !== lex.rep && /[sxz]$/.test(w));
        for (const p of plurals.length ? plurals : rulePlurals(lang, lex.rep)) addSurface(p, lex, true);
      }
    } else if (lex.pos === 'adjective') {
      if (lang === 'de') {
        const stems = [lex.rep, lex.rep.replace(/e([lr])$/, '$1')];
        // "-er" is left out: schneller is as often the comparative (snabbare) as the declined positive.
        const ends = lex.rep.endsWith('e') ? ['n', 's', 'm'] : ['e', 'en', 'es', 'em'];
        const known = new Set(forms.map((f) => f.word));
        for (const st of stems) for (const e of ends) if (known.has(st + e)) addSurface(st + e, lex, false);
      } else if (lang === 'fr' || lang === 'es') {
        const tableForms = forms.map((f) => f.word).filter((w) => w !== lex.rep);
        const pairs = tableForms.length
          ? tableForms.map((w) => [w, /[sx]$/.test(w) && !/[sx]$/.test(lex.rep)])
          : ruleAdjectiveForms(lang, lex.rep);
        for (const [w, pl] of pairs) addSurface(w, lex, pl);
      }
    }
  }
  console.log(`  ${surfaces.size} candidate surface forms`);

  // 4. Every other reading of those surfaces in the source language.
  const readings = new Map(); // key -> [{lexentry, pos, form}]
  const addReading = (s, lexentry, pos, form) => {
    // Capitalized entries (Blue, CAR) are names or acronyms; capitalized words are never replaced there.
    if (!caseSensitive && s !== lower(s)) return;
    const k = key(s);
    if (!surfaces.has(k)) return;
    const list = readings.get(k) ?? [];
    list.push({ lexentry, pos, form });
    readings.set(k, list);
  };
  const posOf = new Map();
  const repOf = new Map();
  for (const r of srcDb
    .prepare('SELECT lexentry, written_rep, part_of_speech FROM entry WHERE lexentry >= ? AND lexentry < ?')
    .iterate(lo, hi)) {
    posOf.set(r.lexentry, r.part_of_speech);
    repOf.set(r.lexentry, r.written_rep);
    addReading(r.written_rep, r.lexentry, r.part_of_speech, false);
    // Short verbs (do, go, be, ir) count too: done, gone, van are among their forms.
    if (r.part_of_speech === 'verb' && r.written_rep.length >= 2 && isWord(r.written_rep) && inFreq(r.written_rep)) {
      const gen = { en: englishVerbForms, fr: frenchVerbForms, es: spanishVerbForms }[lang];
      if (gen) for (const f of gen(lower(r.written_rep))) if (f !== lower(r.written_rep)) addReading(f, r.lexentry, 'verb', 'rule');
    }
  }
  for (const r of srcDb
    .prepare('SELECT lexentry, other_written FROM form WHERE lexentry >= ? AND lexentry < ?')
    .iterate(lo, hi)) {
    const w = r.other_written.replace(DE_ARTICLE, '');
    if (isWord(w)) addReading(w, r.lexentry, posOf.get(r.lexentry) ?? '', true);
  }

  // 5. Resolve each surface: keep it only if one reading clearly dominates.
  // How likely a competing reading is. For inflected forms of another lemma (pasa <- pasar),
  // the lemma's own corpus frequency is a better signal than sparse translation data.
  const byFreq = (word) => {
    const rank = freq.get(lower(word)) ?? Infinity;
    return rank <= 1000 ? 400 : rank <= 5000 ? 200 : rank <= 15000 ? 80 : DEFAULT_WEIGHT;
  };
  // How likely a competing reading is. For rule-generated forms of another lemma (pasa <- pasar),
  // that lemma's corpus frequency is a better signal than sparse translation data.
  const weight = (lexentry, form, surfaceKey) => {
    const translated = lexs.get(lexentry)?.weight || DEFAULT_WEIGHT;
    if (!form) return translated;
    const lemma = lower(repOf.get(lexentry) ?? '');
    if (lemma === lower(surfaceKey)) return translated; // the lemma itself, listed among its forms
    return (form === 'rule' ? Math.max(translated, byFreq(lemma)) : translated) * FORM_DISCOUNT;
  };
  const out = {};
  const stats = { kept: 0, flagged: 0, ambiguous: 0, function: 0, noPlural: 0 };
  for (const [k, options] of surfaces) {
    const main = pickMain(options);
    const mainWeight =
      Math.max(main.lex.weight, byFreq(main.lex.rep)) * (main.surface === main.lex.rep ? 1 : FORM_DISCOUNT);
    const debug = DEBUG.has(k);
    if (debug) console.log(`  [debug] ${k}: main ${main.lex.lexentry} -> ${main.lex.sv} (weight ${mainWeight}, plural ${main.plural})`);
    let flag = '';
    let verdict = 'ok';
    const seen = new Set();
    for (const r of readings.get(k) ?? []) {
      if (r.lexentry === main.lex.lexentry || seen.has(r.lexentry + r.form)) continue;
      seen.add(r.lexentry + r.form);
      if (IGNORED_POS.has(r.pos)) continue;
      const other = lexs.get(r.lexentry);
      if (other && translations(other).has(main.lex.sv)) continue; // same translation, no conflict
      const ratio = weight(r.lexentry, r.form, k) / mainWeight;
      if (debug) console.log(`  [debug]   vs ${r.lexentry}${r.form ? ' (form)' : ''} ${r.pos} -> ${other?.sv ?? '?'} ratio ${ratio.toFixed(2)}`);
      if (FUNCTION_POS.has(r.pos)) {
        // Pronouns etc. rarely have Swedish translations listed; their spelling's frequency
        // is mostly theirs (nobody, none), so use it.
        const functionRatio = Math.max(ratio, byFreq(k) / mainWeight);
        if (functionRatio <= MAX_FUNCTION_RATIO) continue;
        verdict = 'function'; break;
      }
      if (r.pos === 'verb') {
        // Forms of common verbs (works, casa) are frequent enough that a noun reading needs context.
        // English plurals double as 3rd-person verbs (leaks, works): always ask for noun context.
        const commonVerb = byFreq(repOf.get(r.lexentry) ?? '') >= 200 || (lang === 'en' && main.plural);
        if (commonVerb && main.lex.pos === 'noun' && ratio <= MAX_NOUN_VERB_RATIO) { flag = 'd'; continue; }
        // Adjectives that double as participles (impressed, boring) are almost always verbs in text.
        const limit = main.lex.pos === 'noun' || !r.form ? MAX_VERB_RATIO : MAX_VERB_RATIO / 2;
        if (ratio <= limit) continue;
        // A noun that is mostly a verb (abandon, remain) is skipped; otherwise it needs noun context.
        if (main.lex.pos === 'noun' && ratio <= MAX_NOUN_VERB_RATIO) { flag = 'd'; continue; }
        verdict = 'ambiguous'; break;
      }
      if (ratio > MAX_RATIO) { verdict = 'ambiguous'; break; }
    }
    if (debug) console.log(`  [debug]   => ${verdict}${flag ? ' (needs determiner)' : ''}`);
    if (verdict !== 'ok') { stats[verdict]++; continue; }

    const info = main.lex.svInfo;
    // "Acht", "huit": numbers, not the digit nouns (en åtta) WikDict offers.
    if (NUMBER_NOUNS.has(main.lex.sv)) { stats.ambiguous++; continue; }
    const noArticle = main.lex.pos === 'noun' && (LANGUAGES.has(main.lex.sv) || MONTHS.has(main.lex.sv));
    if (noArticle && main.plural) { stats.ambiguous++; continue; } // espagnols: Spaniards, not "spanskor"
    let display = main.lex.sv;
    if (main.plural && main.lex.pos === 'noun') {
      if (!info.plural) { stats.noPlural++; continue; }
      display = info.plural;
    } else if (main.plural && main.lex.pos === 'adjective' && info.adjPlural) {
      display = info.adjPlural;
    }
    const flags = flag + (main.plural ? 'p' : '');
    out[caseSensitive ? main.surface : k] = [display, main.lex.sv, noArticle ? '' : info.gender, POS_CODE[main.lex.pos], flags];
    stats.kept++;
    if (flag) stats.flagged++;
  }

  for (const surface of overrides.drop) delete out[key(surface)];
  for (const [surface, entry] of Object.entries(overrides.fix)) out[key(surface)] = entry;
  console.log(`  kept ${stats.kept} (${stats.flagged} need a determiner), dropped: ` +
    `${stats.ambiguous} ambiguous, ${stats.function} function words, ${stats.noPlural} without Swedish plural`);

  pairDb.close();
  srcDb.close();
  return out;
}

/** The reading a surface most likely has; an adjective wins over a noun with the same translation (red, blue). */
function pickMain(options) {
  const main = options.reduce((a, b) => (b.lex.weight > a.lex.weight ? b : a));
  if (main.lex.pos !== 'noun') return main;
  return options.find((o) => o.lex.pos === 'adjective' && o.lex.sv === main.lex.sv) ?? main;
}

/** All Swedish words offered in a sense's best two translation rows. */
function translations(lex) {
  lex.all ??= new Set(lex.rows.slice(0, 2).flatMap((r) => r.trans_list.split(' | ').map((t) => t.trim())));
  return lex.all;
}

function firstTranslation(rows) {
  for (const r of rows) {
    const first = r.trans_list.split(' | ')[0]?.trim();
    if (first) return first;
  }
  return null;
}

function chooseTranslation(lex, sv) {
  // Same word in Swedish (problem -> problem): nothing to learn, and the alternatives are worse.
  if (lower(firstTranslation(lex.rows) ?? '') === lower(lex.rep)) return null;
  for (const row of lex.rows.slice(0, 3)) {
    const valid = row.trans_list
      .split(' | ')
      .map((t) => t.trim())
      .filter((t) => /^\p{Ll}{2,}$/u.test(t) && t !== lower(lex.rep))
      .map((t) => ({ word: t, info: sv.info(t, lex.pos) }))
      .filter((c) => c.info);
    if (!valid.length) continue;
    // Prefer the first listed translation unless only a later one is in common use.
    const common = valid.find((c) => sv.freq.has(c.word));
    return sv.freq.has(valid[0].word) ? valid[0] : (common ?? valid[0]);
  }
  return null;
}

function loadOverrides(lang) {
  const file = path.join(OUT_DIR, 'overrides', `${lang}.json`);
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  // block: the word and all its forms; drop: only this surface form (einfach, but not einfache).
  return { block: data.block ?? [], drop: data.drop ?? [], fix: data.fix ?? {} };
}

// ---------------------------------------------------------------- main

const langs = process.argv.slice(2).length ? process.argv.slice(2) : SOURCE_LANGS;
const svDb = openDb(await wikdict('sv'));
const sv = new Swedish(svDb, await loadFreq('sv'));
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const lang of langs) {
  const words = await buildLanguage(lang, sv);
  const sorted = Object.fromEntries(Object.entries(words).sort(([a], [b]) => a.localeCompare(b)));
  const json = {
    meta: {
      lang,
      built: new Date().toISOString().slice(0, 10),
      sources: [
        'WikDict (https://www.wikdict.com), data from Wiktionary via DBnary, CC BY-SA',
        'FrequencyWords by Hermit Dave (OpenSubtitles 2018), CC BY-SA 4.0',
      ],
      format: 'surface: [swedish shown, swedish lemma, en|ett|"", pos n|a|r, flags d=needs determiner p=plural]',
    },
    w: sorted,
  };
  const file = path.join(OUT_DIR, `${lang}.json`);
  fs.writeFileSync(file, JSON.stringify(json));
  console.log(`  wrote ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB, ${Object.keys(sorted).length} words)`);
}
svDb.close();
