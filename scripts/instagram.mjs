#!/usr/bin/env node
// Instagram carousel posts from the content bank in marketing/instagram/posts/, one JSON file per
// post, and quiz stories from marketing/instagram/quizzes/ (format and rules:
// marketing/instagram/GENERATE.md).
//   check   validates every post and quiz: fields, lengths, repeated headwords, and the Swedish words
//           against the local WikDict and frequency data in .cache/ (made by `npm run dicts`)
//   render  writes 1080x1350 PNG slides and caption.txt for each post to out/ready/<id>/, and
//           1080x1920 question and answer stories plus sticker.txt for each quiz to out/stories/<id>/,
//           skipping whatever was moved to out/posted/, plus out/index.html to copy captions from.
//           `render --only 0007` (or `--only q03`) redoes a single post or quiz.
//   status  counts banked, posted and ready posts and quizzes
// IG_OUT overrides the output folder (default marketing/instagram/out).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BG, COLORS, FONT, ICON, ICON_SVG, LOGO, LOGO_WHITE, MARK, svgData } from './brand.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const BANK = path.join(ROOT, 'marketing/instagram/posts');
const OUT = path.resolve(process.env.IG_OUT ?? path.join(ROOT, 'marketing/instagram/out'));
const READY = path.join(OUT, 'ready');
const POSTED = path.join(OUT, 'posted');
const QUIZ_BANK = path.join(ROOT, 'marketing/instagram/quizzes');
const STORIES = path.join(OUT, 'stories');
const W = 1080;
const H = 1350;
const STORY_H = 1920;

const SERIES = {
  'literally': 'Literally',
  'no-english-word': 'No English word',
  'false-friend': 'False friend',
  'idiom': 'Swedish idiom',
  'en-or-ett': 'En or ett?',
  'say-it': 'Say it',
  'swedish-in-english': 'Swedish in English',
  'word-story': 'Word story',
  'cute-word': 'Cute word',
};

// Appended to every caption, so the call to action is never forgotten.
const CTA_CAPTION = 'Learn Swedish while you browse: Swedeline swaps a few words on the pages you already read for Swedish ones. Free for Chrome and Firefox, link in bio.';
const CAPTION_MAX = 2200;
const MAX_HASHTAGS = 5;

// Sample pages for the last slide, rotated by post number. Words between * appear as Swedeline shows
// them; the hover card opens under word number `hover` (0-based), so that word should be the last
// marked one, or the card covers the others.
const CTA_PAGES = [
  { text: 'After a long *dag* we walked down to the water and sat by the *sjö* until dark.', hover: 1, orig: 'lake', sv: 'sjö', article: 'en' },
  { text: 'She opened the *fönster*, made some tea and read the morning *tidning* in bed.', hover: 1, orig: 'newspaper', sv: 'tidning', article: 'en' },
  { text: 'We followed a path through the *skog* and found a little red *hus* by the water.', hover: 1, orig: 'house', sv: 'hus', article: 'ett' },
  { text: 'Every *morgon* I ride my old *cykel* to work, rain or shine.', hover: 1, orig: 'bicycle', sv: 'cykel', article: 'en' },
];

// Allowed fields per slide type: [min, max] characters, counted without the * and _ markup.
const FIELDS = {
  hook: { sv: [1, 40], article: [0, 3], say: [0, 32], fact: [1, 150] },
  breakdown: { title: [0, 40], sv: [1, 30], literal: [0, 40], means: [0, 40] },
  list: { title: [1, 48] },
  example: { title: [0, 40], sv: [1, 130], en: [1, 150], note: [0, 120] },
  note: { title: [1, 48], body: [1, 320] },
};
const ARRAYS = {
  breakdown: { key: 'parts', min: 2, max: 4, fields: { sv: [1, 20], en: [1, 24] } },
  list: { key: 'items', min: 2, max: 5, fields: { sv: [1, 32], en: [1, 40], lit: [0, 40] } },
};
const POST_KEYS = ['id', 'series', 'headwords', 'slides', 'caption', 'hashtags', 'verified'];

// Quiz stories: `show` goes big on the question story, the sticker gets `question` and `options`
// (typed into Instagram's quiz sticker, so plain text), and `reveal` explains the answer.
const QUIZ_FIELDS = { show: [1, 40], hint: [0, 90], question: [1, 50], reveal: [20, 220] };
const QUIZ_KEYS = ['id', ...Object.keys(QUIZ_FIELDS), 'options', 'answer', 'verified'];

const plain = (s) => s.replace(/[*_]/g, '');
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const curly = (s) => s.replace(/"([^"]*)"/g, '\u201C$1\u201D').replace(/'/g, '\u2019');
// *word* gets the marker (Swedish words), _text_ the accent color.
const inline = (s) => esc(curly(s)).replace(/\*([^*]+)\*/g, '<mark>$1</mark>').replace(/_([^_]+)_/g, '<em>$1</em>');
const marked = (s) => [...(s ?? '').matchAll(/\*([^*]+)\*/g)].map((m) => m[1]);
const tokens = (s) => s.toLowerCase().match(/\p{L}+/gu) ?? [];
const num = (id) => Number(id.slice(0, 4));
const quizNum = (id) => Number(id.match(/^q(\d+)/)[1]);

// ------------------------------------------------------------------ loading and validation

function loadBank(dir = BANK) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((file) => {
    try {
      return { file, post: JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) };
    } catch (e) {
      return { file, parseError: e.message };
    }
  });
}
const loadQuizzes = () => loadBank(QUIZ_BANK);

function checkText(errors, where, value, [min, max], required = min > 0) {
  if (value === undefined) {
    if (required) errors.push(`${where} is missing`);
    return;
  }
  if (typeof value !== 'string') return errors.push(`${where} must be a string`);
  const len = plain(value).length;
  if (len < min || len > max) errors.push(`${where} has ${len} characters, allowed ${min}–${max}`);
  if ((value.match(/\*/g) ?? []).length % 2) errors.push(`${where} has an unpaired *`);
  if ((value.match(/_/g) ?? []).length % 2) errors.push(`${where} has an unpaired _`);
}

function checkKeys(errors, where, obj, allowed) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) errors.push(`${where}: unknown field "${k}"`);
}

/** Field errors for one post (no dictionary lookups). */
function validate({ file, post, parseError }) {
  if (parseError) return [`invalid JSON: ${parseError}`];
  const errors = [];
  checkKeys(errors, 'post', post, POST_KEYS);
  if (!/^\d{4}-[a-z0-9-]+$/.test(post.id ?? '')) errors.push('id must look like 0001-some-slug (ASCII, lowercase)');
  else if (`${post.id}.json` !== file) errors.push(`id "${post.id}" does not match the file name`);
  if (!SERIES[post.series]) errors.push(`series must be one of: ${Object.keys(SERIES).join(', ')}`);
  if (!Array.isArray(post.headwords) || !post.headwords.length || post.headwords.some((h) => typeof h !== 'string' || !h.trim())) {
    errors.push('headwords must be a non-empty list of Swedish words');
  }
  const slides = post.slides;
  if (!Array.isArray(slides) || slides.length < 3 || slides.length > 5) {
    errors.push('slides must be a list of 3–5 slides (the call-to-action slide is added on top)');
  } else {
    slides.forEach((s, i) => {
      const where = `slide ${i + 1} (${s?.type})`;
      if (!FIELDS[s?.type]) return errors.push(`slide ${i + 1}: type must be one of: ${Object.keys(FIELDS).join(', ')}`);
      if ((i === 0) !== (s.type === 'hook')) errors.push(`${where}: the first slide, and only the first, is a hook`);
      const arr = ARRAYS[s.type];
      checkKeys(errors, where, s, ['type', ...Object.keys(FIELDS[s.type]), ...(arr ? [arr.key] : [])]);
      for (const [k, range] of Object.entries(FIELDS[s.type])) checkText(errors, `${where} ${k}`, s[k], range);
      if (s.type === 'hook' && s.article && !['en', 'ett'].includes(s.article)) errors.push(`${where}: article must be "en" or "ett"`);
      if (arr) {
        const list = s[arr.key];
        if (!Array.isArray(list) || list.length < arr.min || list.length > arr.max) {
          errors.push(`${where}: ${arr.key} must have ${arr.min}–${arr.max} entries`);
        } else {
          list.forEach((item, j) => {
            checkKeys(errors, `${where} ${arr.key}[${j}]`, item, Object.keys(arr.fields));
            for (const [k, range] of Object.entries(arr.fields)) checkText(errors, `${where} ${arr.key}[${j}].${k}`, item[k], range);
          });
        }
      }
    });
  }
  checkText(errors, 'caption', post.caption, [40, 1600]);
  if (typeof post.caption === 'string' && /link in bio/i.test(post.caption)) errors.push('caption: leave out the call to action, it is appended automatically');
  const tags = post.hashtags;
  if (!Array.isArray(tags) || !tags.length || tags.length > MAX_HASHTAGS) errors.push(`hashtags must be a list of 1–${MAX_HASHTAGS}`);
  else {
    for (const t of tags) if (!/^[a-z0-9_åäö]+$/.test(t)) errors.push(`hashtag "${t}": lowercase letters and digits only, without #`);
    if (new Set(tags).size !== tags.length) errors.push('hashtags repeat');
  }
  if (post.verified !== undefined && (!Array.isArray(post.verified) || post.verified.some((v) => typeof v !== 'string'))) {
    errors.push('verified must be a list of words');
  }
  if (!errors.length && captionText(post).length > CAPTION_MAX) errors.push(`caption is over ${CAPTION_MAX} characters with the call to action and hashtags`);
  return errors;
}

function captionText(post) {
  return `${post.caption.trim()}\n\n${CTA_CAPTION}\n\n${post.hashtags.map((t) => `#${t}`).join(' ')}\n`;
}

/** Field errors for one quiz (no dictionary lookups). */
function validateQuiz({ file, post: q, parseError }) {
  if (parseError) return [`invalid JSON: ${parseError}`];
  const errors = [];
  checkKeys(errors, 'quiz', q, QUIZ_KEYS);
  if (!/^q\d{2,3}-[a-z0-9-]+$/.test(q.id ?? '')) errors.push('id must look like q01-some-slug (ASCII, lowercase)');
  else if (`${q.id}.json` !== file) errors.push(`id "${q.id}" does not match the file name`);
  for (const [k, range] of Object.entries(QUIZ_FIELDS)) checkText(errors, k, q[k], range);
  const plainOnly = (where, v) => typeof v === 'string' && /[*_]/.test(v) && errors.push(`${where}: no * or _ markup, it goes into the quiz sticker as plain text`);
  plainOnly('question', q.question);
  if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) {
    errors.push('options must be a list of 2–4 answers');
  } else {
    q.options.forEach((o, i) => {
      checkText(errors, `options[${i}]`, o, [1, 30]);
      plainOnly(`options[${i}]`, o);
    });
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) errors.push('answer must be the index (from 0) of the right option');
  }
  if (q.verified !== undefined && (!Array.isArray(q.verified) || q.verified.some((v) => typeof v !== 'string'))) {
    errors.push('verified must be a list of words');
  }
  return errors;
}

function stickerText(q) {
  const letters = 'ABCD';
  return `Quiz sticker\nQuestion: ${q.question}\n${q.options.map((o, i) => `${letters[i]}: ${o}${i === q.answer ? '   <- correct' : ''}`).join('\n')}\n`;
}

// ------------------------------------------------------------------ dictionary check

function loadLexicon() {
  const freqFile = path.join(ROOT, '.cache/freq/sv_50k.txt');
  const dbFile = path.join(ROOT, '.cache/wikdict/sv.sqlite3');
  if (!fs.existsSync(freqFile) || !fs.existsSync(dbFile)) return null;
  const words = new Set();
  for (const line of fs.readFileSync(freqFile, 'utf8').split('\n')) {
    const w = line.split(' ')[0];
    if (w) words.add(w.toLowerCase());
  }
  const genders = new Map(); // word -> Set of 'en' | 'ett'
  const db = new DatabaseSync(dbFile, { readOnly: true });
  for (const { w, g } of db.prepare('SELECT written_rep AS w, gender AS g FROM entry').iterate()) {
    if (!w) continue;
    const word = w.toLowerCase();
    words.add(word);
    if (g) {
      if (!genders.has(word)) genders.set(word, new Set());
      genders.get(word).add(g === 'Neuter' ? 'ett' : 'en');
    }
  }
  for (const { w } of db.prepare('SELECT other_written AS w FROM form').iterate()) if (w) words.add(w.toLowerCase());
  db.close();
  return { words, genders };
}

/** The Swedish in a post: whole words or phrases, and running text checked word by word. */
function swedishOf(post) {
  const out = [];
  const word = (where, sv, article) => out.push({ where, sv: plain(sv), article, phrase: true });
  const text = (where, sv) => out.push({ where, sv: plain(sv), phrase: false });
  post.headwords.forEach((h) => word('headwords', h));
  post.slides.forEach((s, i) => {
    const where = `slide ${i + 1}`;
    if (s.type === 'hook') word(where, s.sv, s.article);
    if (s.type === 'breakdown') {
      word(where, s.sv);
      s.parts.forEach((p) => word(where, p.sv));
    }
    if (s.type === 'list') s.items.forEach((it) => word(where, it.sv));
    if (s.type === 'example') text(where, s.sv);
    for (const k of ['fact', 'title', 'body', 'note', 'en', 'literal', 'means']) marked(s[k]).forEach((m) => word(where, m));
    (s.items ?? []).forEach((it) => marked(it.en).concat(marked(it.lit)).forEach((m) => word(where, m)));
  });
  return out;
}

function swedishOfQuiz(q) {
  return ['show', 'hint', 'reveal'].flatMap((k) => marked(q[k]).map((m) => ({ where: k, sv: plain(m), phrase: true })));
}

function lexiconIssues(entries, lex, verified) {
  const ok = (w) => lex.words.has(w) || verified.has(w);
  const errors = [];
  const warnings = [];
  for (const { where, sv, article, phrase } of entries) {
    const whole = sv.toLowerCase().trim();
    if (article) {
      const g = lex.genders.get(whole);
      if (g && !g.has(article)) errors.push(`${where}: "${article} ${sv}" — the dictionary has it as ${[...g].join('/')} ${sv}`);
    }
    if (phrase && ok(whole)) continue;
    const unknown = tokens(sv).filter((t) => !ok(t));
    for (const t of new Set(unknown)) {
      warnings.push(`${where}: "${t}"${t !== whole ? ` (in "${sv}")` : ''} is not in WikDict or the frequency list — check the spelling, then add it to "verified"`);
    }
  }
  return { errors, warnings };
}

// ------------------------------------------------------------------ check

function check() {
  const bank = loadBank();
  const lex = loadLexicon();
  if (!lex) console.log('Note: .cache/ has no WikDict or frequency data, so Swedish words are not checked. Run `npm run dicts`.');
  let errorCount = 0;
  let warningCount = 0;
  const report = (id, errors, warnings) => {
    if (!errors.length && !warnings.length) return;
    console.log(`\n${id}`);
    errors.forEach((e) => console.log(`  ERROR    ${e}`));
    warnings.forEach((w) => console.log(`  warning  ${w}`));
    errorCount += errors.length;
    warningCount += warnings.length;
  };

  const seenIds = new Map();
  const seenHeadwords = new Map();
  let prev = null;
  for (const entry of bank) {
    const errors = validate(entry);
    const warnings = [];
    const { post } = entry;
    if (post) {
      if (/^\d{4}-/.test(post.id ?? '')) {
        const n = num(post.id);
        if (seenIds.has(n)) errors.push(`number ${post.id.slice(0, 4)} is also used by ${seenIds.get(n)}`);
        seenIds.set(n, post.id);
      }
      for (const h of Array.isArray(post.headwords) ? post.headwords.filter((h) => typeof h === 'string') : []) {
        const key = h.toLowerCase();
        if (seenHeadwords.has(key)) errors.push(`headword "${h}" was already used in ${seenHeadwords.get(key)}`);
        seenHeadwords.set(key, post.id);
      }
      if (prev && prev.series === post.series) warnings.push(`same series as ${prev.id}; alternate series`);
      if (lex) {
        try {
          const issues = lexiconIssues(swedishOf(post), lex, new Set((post.verified ?? []).map((v) => v.toLowerCase())));
          errors.push(...issues.errors);
          warnings.push(...issues.warnings);
        } catch {
          // A malformed post; its field errors are reported above.
        }
      }
      prev = post;
    }
    report(entry.post?.id ?? entry.file, errors, warnings);
  }
  if (lex) {
    const cta = CTA_PAGES.flatMap((p, i) => [
      ...marked(p.text).map((m) => ({ where: `page ${i + 1}`, sv: m, phrase: true })),
      { where: `page ${i + 1} hover card`, sv: p.sv, article: p.article, phrase: true },
    ]);
    const issues = lexiconIssues(cta, lex, new Set());
    report('call-to-action slide (CTA_PAGES in scripts/instagram.mjs)', issues.errors, issues.warnings);
  }
  const quizzes = loadQuizzes();
  const seenQuizzes = new Map();
  for (const entry of quizzes) {
    const errors = validateQuiz(entry);
    const warnings = [];
    const q = entry.post;
    if (q && /^q\d+-/.test(q.id ?? '')) {
      const n = quizNum(q.id);
      if (seenQuizzes.has(n)) errors.push(`number ${n} is also used by ${seenQuizzes.get(n)}`);
      seenQuizzes.set(n, q.id);
    }
    if (q && lex && !errors.length) {
      const issues = lexiconIssues(swedishOfQuiz(q), lex, new Set((q.verified ?? []).map((v) => v.toLowerCase())));
      errors.push(...issues.errors);
      warnings.push(...issues.warnings);
    }
    report(q?.id ?? entry.file, errors, warnings);
  }
  console.log(`\n${bank.length} posts and ${quizzes.length} quizzes checked: ${errorCount} errors, ${warningCount} warnings.`);
  if (errorCount) process.exit(1);
}

// ------------------------------------------------------------------ slides

const SPEAKER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>`;
const ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15M13 6l6 6-6 6"/></svg>`;
const ARROW_DOWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v15M6 13l6 6 6-6"/></svg>`;
const ARROW_UP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V5M6 11l6-6 6 6"/></svg>`;

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: ${W}px; height: ${H}px; overflow: hidden; position: relative; background: ${COLORS.paper};
         color: ${COLORS.text}; ${FONT} -webkit-font-smoothing: antialiased; }
  body.dark { ${BG} color: #fff; }
  mark { ${MARK} color: inherit; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  em { font-style: normal; color: ${COLORS.blue}; }
  svg { display: block; }

  .pill { position: absolute; left: 90px; top: 84px; padding: 15px 30px 13px; border-radius: 999px; background: ${COLORS.blue};
          color: #fff; font-size: 26px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
  .foot { position: absolute; left: 90px; right: 90px; bottom: 78px; height: 56px; display: flex; align-items: center; justify-content: space-between; }
  .foot img { height: 50px; }
  .count { font-size: 28px; font-weight: 600; color: ${COLORS.muted}; letter-spacing: .06em; }
  .swipe { display: flex; align-items: center; gap: 12px; font-size: 30px; font-weight: 700; color: ${COLORS.blue}; }
  .swipe svg { width: 38px; height: 38px; }

  .main { position: absolute; left: 90px; right: 90px; top: 196px; bottom: 196px; display: flex; flex-direction: column;
          justify-content: center; font-size: 40px; }
  .content { width: 100%; }
  h2 { font-size: 1.5em; font-weight: 700; line-height: 1.12; letter-spacing: -0.015em; margin-bottom: .85em; text-wrap: balance; }
  .fact, .body p, .quote .sv, .quote .en, .after, .line, .row .en { text-wrap: pretty; }
  .card { background: #fff; border-radius: 30px; box-shadow: 0 12px 36px rgba(15, 30, 45, .08), 0 1px 3px rgba(15, 30, 45, .06); }

  .tags { display: flex; gap: .4em; margin-bottom: .55em; }
  .tag { padding: .22em .7em .16em; border: 3px solid #CBD6E0; border-radius: 999px; font-size: .7em; font-weight: 600; color: ${COLORS.muted}; }
  .tag b { color: ${COLORS.text}; font-weight: 700; }
  .word { font-size: 4.2em; font-weight: 700; line-height: 1.36; letter-spacing: -0.02em; overflow-wrap: normal; text-wrap: balance; }
  .word mark { box-shadow: inset 0 -0.07em 0 #006aa7; padding: 0 .08em; border-radius: .1em; }
  .fact { margin-top: .6em; font-size: 1.5em; font-weight: 600; line-height: 1.22; letter-spacing: -0.01em; }

  .parts { display: flex; flex-wrap: wrap; align-items: center; gap: .45em; }
  .part { padding: .6em .8em .55em; text-align: center; }
  .part .sv { font-size: 1.55em; font-weight: 700; }
  .part .en { margin-top: .3em; font-size: .9em; color: ${COLORS.muted}; font-weight: 600; }
  .plus { font-size: 1.6em; font-weight: 700; color: ${COLORS.blue}; }
  .sum { margin-top: 1em; font-size: 1.9em; font-weight: 700; letter-spacing: -0.015em; }
  .line { display: grid; grid-template-columns: 5.2em 1fr; margin-top: .5em; font-size: 1.1em; font-weight: 600; }
  .line span { color: ${COLORS.muted}; font-weight: 500; }

  .row { display: grid; grid-template-columns: 1.15fr 1fr; gap: .7em; align-items: center; padding: .55em .8em; margin-top: .38em; }
  .row .sv { font-size: 1.18em; font-weight: 700; }
  .row .lit { margin-top: .2em; font-size: .72em; color: ${COLORS.muted}; font-weight: 500; }
  .row .en { text-align: right; font-weight: 600; }

  .quote { padding: 1em 1.1em; border-left: 12px solid ${COLORS.yellow}; }
  .quote .sv { font-size: 1.45em; font-weight: 600; line-height: 1.3; }
  .quote .en { margin-top: .7em; font-size: .98em; color: ${COLORS.muted}; font-style: italic; font-weight: 500; line-height: 1.35; }
  .after { margin-top: .9em; font-size: .92em; color: ${COLORS.muted}; font-weight: 500; line-height: 1.4; }

  .body p { font-size: 1.12em; font-weight: 500; line-height: 1.42; }
  .body p + p { margin-top: .7em; }

  .dark .count { color: ${COLORS.sub}; }
  .logo { position: absolute; left: 90px; top: 96px; height: 64px; }
  .cta { top: 210px; bottom: 170px; justify-content: flex-start; }
  .cta h1 { font-size: 92px; font-weight: 700; line-height: 1.04; letter-spacing: -0.025em; }
  .cta .sub { margin-top: 26px; font-size: 36px; font-weight: 500; line-height: 1.38; color: ${COLORS.sub}; }
  .browser { position: relative; margin-top: 56px; height: 470px; background: #fff; border-radius: 26px; overflow: visible;
             box-shadow: 0 30px 70px rgba(0, 25, 50, .4); }
  .bar { height: 58px; display: flex; align-items: center; gap: 12px; padding: 0 26px; background: #EEF1F4; border-bottom: 2px solid #DDE3E8;
         border-radius: 26px 26px 0 0; }
  .bar i { width: 16px; height: 16px; border-radius: 50%; background: #CDD4DA; }
  .page { padding: 40px 50px; font: 42px/1.7 Georgia, 'Times New Roman', serif; color: #1d2328; }
  .hover { position: absolute; min-width: 340px; padding: 22px 26px 22px 30px; background: #fff; color: #1c2733;
           border-radius: 22px; border-left: 9px solid ${COLORS.yellow}; font: 30px/1.35 system-ui, -apple-system, sans-serif;
           box-shadow: 0 14px 50px rgba(15, 30, 45, .22), 0 2px 6px rgba(15, 30, 45, .14); }
  .hover .orig { font-size: 38px; font-weight: 600; }
  .hover .from { margin-top: 2px; font-size: 26px; color: #5d6b7a; }
  .hover .sv { display: flex; align-items: center; gap: 18px; margin-top: 16px; padding-top: 16px; border-top: 2px solid #e3e8ee; }
  .hover .w { flex: 1; color: #006aa7; font-weight: 600; font-size: 34px; }
  .hover .w span { color: #5d6b7a; font-weight: 400; }
  .hover .btn { width: 62px; height: 62px; border-radius: 50%; display: grid; place-items: center; color: #006aa7; background: rgba(0, 106, 167, .12); }
  .hover .btn svg { width: 34px; height: 34px; }
  .get { position: absolute; left: 90px; right: 90px; bottom: 76px; display: flex; align-items: center; gap: 36px; }
  .get .btn { padding: 26px 44px 22px; border-radius: 999px; background: ${COLORS.yellow}; color: ${COLORS.navy}; font-size: 36px; font-weight: 700; }
  .get .bio { display: flex; align-items: center; gap: 10px; font-size: 34px; font-weight: 600; }
  .get .bio svg { width: 36px; height: 36px; }
  .get .count { margin-left: auto; }

  /* Quiz stories, 1080x1920. Instagram covers about 250px at the top and 300px at the bottom. */
  body.story { height: ${STORY_H}px; }
  .spill { position: absolute; left: 90px; top: 270px; padding: 18px 36px 15px; border-radius: 999px; background: ${COLORS.yellow};
           color: ${COLORS.navy}; font-size: 34px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
  .story .main { top: 400px; bottom: 1010px; justify-content: flex-start; }
  .story.answer .main { top: 300px; bottom: 700px; justify-content: center; }
  .story.answer .spill { position: static; display: inline-block; margin-bottom: 1.1em; font-size: .85em; }
  .story .scard { background: #fff; color: ${COLORS.text}; border-radius: 40px; padding: 1.3em 1.1em; text-align: center;
                  box-shadow: 0 30px 70px rgba(0, 25, 50, .35); }
  .story .word { font-size: 3.2em; }
  .hint { margin-top: 1.1em; font-size: 1.1em; font-weight: 600; line-height: 1.3; text-align: center; text-wrap: balance; }
  .tap { position: absolute; left: 0; right: 0; top: 960px; display: flex; justify-content: center; align-items: center; gap: 14px;
         font-size: 38px; font-weight: 700; color: ${COLORS.sub}; }
  .tap svg { width: 42px; height: 42px; }
  .slogo { position: absolute; left: 50%; bottom: 330px; height: 64px; transform: translateX(-50%); }
  .story.answer .spill { background: ${COLORS.blue}; color: #fff; }
  .asked { font-size: .95em; font-weight: 600; color: ${COLORS.muted}; text-wrap: balance; }
  .right { margin: .25em 0 .7em; font-size: 2.4em; font-weight: 700; line-height: 1.1; letter-spacing: -0.02em; color: ${COLORS.blue}; text-wrap: balance; }
  .story .reveal { text-align: left; padding: 1.1em 1.1em; border-left: 14px solid ${COLORS.yellow}; font-size: 1.12em; font-weight: 500;
                   line-height: 1.42; box-shadow: 0 12px 36px rgba(15, 30, 45, .08); text-wrap: pretty; }
  .promo { position: absolute; left: 90px; right: 90px; bottom: 330px; display: flex; align-items: center; gap: 36px;
           padding: 44px 48px; border-radius: 36px; ${BG} color: #fff; box-shadow: 0 24px 60px rgba(0, 25, 50, .3); }
  .promo img { width: 120px; height: 120px; flex: none; }
  .promo b { display: block; font-size: 42px; line-height: 1.15; letter-spacing: -0.01em; text-wrap: balance; }
  .promo span { display: block; margin-top: 10px; font-size: 30px; font-weight: 500; color: ${COLORS.sub}; }
`;

function slideBody(s) {
  switch (s.type) {
    case 'hook': {
      const tags = [s.article && `<span class="tag"><b>${esc(s.article)}</b> ${esc(plain(s.sv))}</span>`, s.say && `<span class="tag">say <b>${esc(s.say)}</b></span>`].filter(Boolean);
      // Very short words start bigger, and phrases smaller; fitInPage shrinks them from there.
      const len = plain(s.sv).length;
      const em = len <= 2 ? 6.5 : len > 10 && s.sv.includes(' ') ? 3.4 : 4.2;
      return `${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
        <div class="word" style="font-size: ${em}em"><mark>${esc(plain(s.sv))}</mark></div>
        <div class="fact">${inline(s.fact)}</div>`;
    }
    case 'breakdown':
      return `<h2>${inline(s.title || 'Word math')}</h2>
        <div class="parts">${s.parts.map((p) => `<div class="part card"><div class="sv"><mark>${esc(plain(p.sv))}</mark></div><div class="en">${inline(p.en)}</div></div>`).join('<div class="plus">+</div>')}</div>
        <div class="sum">= <mark>${esc(plain(s.sv))}</mark></div>
        ${s.literal ? `<div class="line"><span>literally</span> ${inline(s.literal)}</div>` : ''}
        ${s.means ? `<div class="line"><span>means</span> ${inline(s.means)}</div>` : ''}`;
    case 'list':
      return `<h2>${inline(s.title)}</h2>
        ${s.items.map((it) => `<div class="row card"><div><div class="sv"><mark>${esc(plain(it.sv))}</mark></div>${it.lit ? `<div class="lit">lit. ${inline(it.lit)}</div>` : ''}</div><div class="en">${inline(it.en)}</div></div>`).join('')}`;
    case 'example':
      return `<h2>${inline(s.title || 'In a sentence')}</h2>
        <div class="quote card"><div class="sv">${inline(s.sv)}</div><div class="en">${inline(s.en)}</div></div>
        ${s.note ? `<div class="after">${inline(s.note)}</div>` : ''}`;
    case 'note':
      return `<h2>${inline(s.title)}</h2>
        <div class="body">${s.body.split(/\n\s*\n/).map((p) => `<p>${inline(p.trim())}</p>`).join('')}</div>`;
  }
}

function slideHtml(post, i, total) {
  const s = post.slides[i];
  const foot = i === 0
    ? `<span class="swipe">Swipe ${ARROW}</span>`
    : `<span class="count">${i + 1} / ${total}</span>`;
  return `<body>
    <div class="pill">${esc(SERIES[post.series])}</div>
    <div class="main"><div class="content">${slideBody(s)}</div></div>
    <div class="foot"><img src="${LOGO}" alt="">${foot}</div>
  </body>`;
}

function ctaHtml(post, total) {
  const page = CTA_PAGES[num(post.id) % CTA_PAGES.length];
  let k = 0;
  const text = esc(page.text).replace(/\*([^*]+)\*/g, (_, w) => `<mark${k++ === page.hover ? ' id="hovered"' : ''}>${w}</mark>`);
  return `<body class="dark">
    <img class="logo" src="${LOGO_WHITE}" alt="">
    <div class="main cta"><div class="content">
      <h1>Learn Swedish<br>while you browse</h1>
      <p class="sub">Swedeline swaps a few words on the pages you already read for Swedish ones.</p>
      <div class="browser">
        <div class="bar"><i></i><i></i><i></i></div>
        <div class="page">${text}</div>
        <div class="hover"><div class="orig">${esc(page.orig)}</div><div class="from">English → Swedish</div>
          <div class="sv"><span class="w"><span>${page.article}</span> ${esc(page.sv)}</span><span class="btn">${SPEAKER}</span></div></div>
      </div>
    </div></div>
    <div class="get"><span class="btn">Free for Chrome &amp; Firefox</span><span class="bio">Link in bio ${ARROW_UP}</span>
      <span class="count">${total} / ${total}</span></div>
  </body>`;
}

function quizQuestionHtml(q) {
  return `<body class="story dark">
    <div class="spill">Quiz time</div>
    <div class="main"><div class="content">
      <div class="scard"><div class="word" style="font-size: 3.2em">${inline(q.show)}</div></div>
      ${q.hint ? `<p class="hint">${inline(q.hint)}</p>` : ''}
    </div></div>
    <p class="tap">Tap your answer ${ARROW_DOWN}</p>
    <img class="slogo" src="${LOGO_WHITE}" alt="">
  </body>`;
}

function quizAnswerHtml(q) {
  return `<body class="story answer">
    <div class="main"><div class="content">
      <div class="spill">Answer</div>
      <p class="asked">${esc(curly(q.question))}</p>
      <div class="right">${esc(curly(q.options[q.answer]))}</div>
      <div class="scard reveal">${inline(q.reveal)}</div>
    </div></div>
    <div class="promo"><img src="${ICON}" alt=""><div><b>Learn words like this while you browse</b>
      <span>Swedeline · free for Chrome &amp; Firefox</span></div></div>
  </body>`;
}

// Runs in the page: shrinks the text until it fits, and places the hover card under its word.
function fitInPage() {
  const main = document.querySelector('.main');
  const content = document.querySelector('.content');
  const word = document.querySelector('.word');
  const card = document.querySelector('.hover');
  if (card) {
    const w = document.getElementById('hovered').getBoundingClientRect();
    const box = card.parentElement.getBoundingClientRect();
    const left = Math.min(w.left - box.left - 20, box.width - card.offsetWidth - 30);
    card.style.left = `${Math.max(30, left)}px`;
    card.style.top = `${w.bottom - box.top + 14}px`;
  }
  const wide = (el) => el.scrollWidth > el.clientWidth + 1;
  if (word) {
    // Keep the word or phrase on one line if it fits at a decent size, else wrap it in balanced lines.
    const start = parseFloat(word.style.fontSize);
    let em = start;
    word.style.whiteSpace = 'nowrap';
    while (wide(word) && em > 2.6) word.style.fontSize = `${(em -= 0.1)}em`;
    if (wide(word)) {
      word.style.whiteSpace = '';
      word.style.fontSize = `${(em = Math.min(start, 3.4))}em`;
      while (wide(word) && em > 1.5) word.style.fontSize = `${(em -= 0.1)}em`;
    }
  }
  const fits = () => content.offsetHeight <= main.clientHeight && !wide(content) && !(word && wide(word));
  for (let px = 40; !fits() && px > 24; px -= 1) main.style.fontSize = `${px}px`;
  return fits();
}

async function shoot(page, body, file) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head>${body}</html>`);
  await page.evaluate(() => document.fonts.ready);
  const fits = await page.evaluate(fitInPage);
  await page.screenshot({ path: file });
  return fits;
}

// ------------------------------------------------------------------ render

function postedNumbers() {
  if (!fs.existsSync(POSTED)) return new Set();
  return new Set(fs.readdirSync(POSTED).filter((d) => /^\d{4}/.test(d)).map(num));
}

function loadValidPosts() {
  const bank = loadBank();
  const bad = bank.filter((e) => validate(e).length);
  if (bad.length) {
    console.error(`Posts with errors: ${bad.map((e) => e.file).join(', ')}. Run \`npm run ig:check\` for details.`);
    process.exit(1);
  }
  return bank.map((e) => e.post);
}

async function render() {
  const onlyArg = process.argv.indexOf('--only');
  const only = onlyArg > 0 ? process.argv[onlyArg + 1] : null;
  const posted = postedNumbers();
  let posts = loadValidPosts().filter((p) => !posted.has(num(p.id)));
  const postedQuizzes = postedQuizNumbers();
  let quizzes = loadValidQuizzes().filter((q) => !postedQuizzes.has(quizNum(q.id)));
  if (only) {
    posts = posts.filter((p) => p.id.startsWith(only));
    quizzes = quizzes.filter((q) => q.id.startsWith(only));
    if (!posts.length && !quizzes.length) throw new Error(`no unposted post or quiz matches "${only}"`);
  } else {
    fs.rmSync(READY, { recursive: true, force: true });
    fs.rmSync(STORIES, { recursive: true, force: true });
  }
  fs.mkdirSync(READY, { recursive: true });
  fs.mkdirSync(STORIES, { recursive: true });

  const browser = await chromium.launch({ channel: 'chromium' });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'en-US' });
  const failures = [];
  const queue = [...posts];
  const worker = async () => {
    const page = await context.newPage();
    for (let post; (post = queue.shift());) {
      const dir = path.join(READY, post.id);
      for (const d of [dir, `${dir}.too-long`]) fs.rmSync(d, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const total = post.slides.length + 1;
      const tooLong = [];
      for (let i = 0; i < post.slides.length; i++) {
        if (!(await shoot(page, slideHtml(post, i, total), path.join(dir, `${String(i + 1).padStart(2, '0')}.png`)))) tooLong.push(i + 1);
      }
      await shoot(page, ctaHtml(post, total), path.join(dir, `${String(total).padStart(2, '0')}.png`));
      fs.writeFileSync(path.join(dir, 'caption.txt'), captionText(post));
      if (tooLong.length) {
        failures.push(`${post.id}: text does not fit on slide ${tooLong.join(', ')}; shorten it`);
        fs.renameSync(dir, `${dir}.too-long`); // kept for a look, but never listed as ready
      }
    }
    await page.close();
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  const storyPage = await context.newPage();
  await storyPage.setViewportSize({ width: W, height: STORY_H });
  for (const q of quizzes) {
    const dir = path.join(STORIES, q.id);
    for (const d of [dir, `${dir}.too-long`]) fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const tooLong = [];
    if (!(await shoot(storyPage, quizQuestionHtml(q), path.join(dir, '1-question.png')))) tooLong.push('question');
    if (!(await shoot(storyPage, quizAnswerHtml(q), path.join(dir, '2-answer.png')))) tooLong.push('answer');
    fs.writeFileSync(path.join(dir, 'sticker.txt'), stickerText(q));
    if (tooLong.length) {
      failures.push(`${q.id}: text does not fit on the ${tooLong.join(' and ')} story; shorten it`);
      fs.renameSync(dir, `${dir}.too-long`);
    }
  }
  await storyPage.close();

  // Profile picture: the icon on white, sized for Instagram's round crop.
  const page = await context.newPage();
  await page.setViewportSize({ width: 1080, height: 1080 });
  await page.setContent(`<body style="margin:0;background:#fff;display:grid;place-items:center;height:1080px">
    <img src="${svgData(ICON_SVG.replace('stroke="#D5E3EE"', 'stroke="none"'))}" width="820" height="820"></body>`);
  await page.screenshot({ path: path.join(OUT, 'profile.png') });
  await browser.close();

  writeGallery();
  const ready = readyIds();
  console.log(`Rendered ${posts.length + quizzes.length - failures.length} post(s) and quiz(zes). Ready: ${ready.length} posts, ${storyIds().length} quiz stories.`);
  console.log(`Gallery: ${path.join(OUT, 'index.html')}`);
  if (failures.length) {
    failures.forEach((f) => console.error(`ERROR ${f}`));
    process.exit(1);
  }
}

function readyIds() {
  if (!fs.existsSync(READY)) return [];
  return fs.readdirSync(READY).filter((d) => /^\d{4}-[a-z0-9-]+$/.test(d)).sort();
}

function storyIds() {
  if (!fs.existsSync(STORIES)) return [];
  return fs.readdirSync(STORIES).filter((d) => /^q\d+-[a-z0-9-]+$/.test(d)).sort((a, b) => quizNum(a) - quizNum(b));
}

function postedQuizNumbers() {
  if (!fs.existsSync(POSTED)) return new Set();
  return new Set(fs.readdirSync(POSTED).filter((d) => /^q\d+-/.test(d)).map(quizNum));
}

function loadValidQuizzes() {
  const bank = loadQuizzes();
  const bad = bank.filter((e) => validateQuiz(e).length);
  if (bad.length) {
    console.error(`Quizzes with errors: ${bad.map((e) => e.file).join(', ')}. Run \`npm run ig:check\` for details.`);
    process.exit(1);
  }
  return bank.map((e) => e.post).sort((a, b) => quizNum(a.id) - quizNum(b.id));
}

function writeGallery() {
  const byId = new Map(loadBank().map((e) => [e.post.id, e.post]));
  const ids = readyIds().filter((id) => byId.has(id));
  const cards = ids.map((id, n) => {
    const post = byId.get(id);
    const slides = fs.readdirSync(path.join(READY, id)).filter((f) => f.endsWith('.png')).sort();
    const caption = fs.readFileSync(path.join(READY, id, 'caption.txt'), 'utf8');
    return `<section${n === 0 ? ' class="next"' : ''}>
      <header><b>${n === 0 ? 'Next up · ' : ''}${esc(id)}</b> <span>${esc(SERIES[post.series])} · ${esc(post.headwords.join(', '))}</span>
        <a href="ready/${id}/">open folder</a></header>
      <div class="slides">${slides.map((f) => `<a href="ready/${id}/${f}"><img src="ready/${id}/${f}" alt="${f}"></a>`).join('')}</div>
      <textarea id="c${n}" readonly>${esc(caption)}</textarea>
      <button data-copy="c${n}">Copy caption</button>
    </section>`;
  }).join('\n');
  const quizById = new Map(loadQuizzes().filter((e) => e.post?.id).map((e) => [e.post.id, e.post]));
  const quizIds = storyIds().filter((id) => quizById.has(id));
  const quizCards = quizIds.map((id, n) => {
    const sticker = fs.readFileSync(path.join(STORIES, id, 'sticker.txt'), 'utf8');
    return `<section class="quiz">
      <header><b>${esc(id)}</b> <span>${esc(quizById.get(id).question)}</span><a href="stories/${id}/">open folder</a></header>
      <div class="slides">${['1-question.png', '2-answer.png'].map((f) => `<a href="stories/${id}/${f}"><img src="stories/${id}/${f}" alt="${f}"></a>`).join('')}
        <pre id="s${n}">${esc(sticker)}</pre></div>
    </section>`;
  }).join('\n');
  fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Swedeline posts</title><style>
  body { margin: 0; padding: 32px; background: #F4F7FA; color: #17212B; font: 15px/1.4 system-ui, sans-serif; }
  h1 { margin: 0 0 4px; font-size: 24px; } p.help { margin: 0 0 24px; color: #5B6876; max-width: 820px; }
  section { background: #fff; border-radius: 14px; padding: 18px 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  section.next { outline: 3px solid #FECC02; }
  header { display: flex; gap: 12px; align-items: baseline; margin-bottom: 12px; } header span { color: #5B6876; }
  header a { margin-left: auto; color: #006AA7; }
  .slides { display: flex; gap: 10px; overflow-x: auto; } .slides img { width: 176px; border-radius: 6px; display: block; border: 1px solid #E1E7EE; }
  textarea { width: 100%; box-sizing: border-box; height: 150px; margin-top: 12px; font: inherit; padding: 10px; border: 1px solid #E1E7EE; border-radius: 8px; resize: vertical; }
  button { margin-top: 8px; padding: 8px 16px; border: 0; border-radius: 999px; background: #006AA7; color: #fff; font: 600 14px system-ui; cursor: pointer; }
  h2 { margin: 40px 0 4px; font-size: 20px; }
  .quiz .slides img { width: 120px; } .quiz pre { margin: 0 0 0 12px; padding: 12px 16px; background: #F4F7FA; border-radius: 8px; font: 14px/1.6 ui-monospace, monospace; align-self: flex-start; }
</style></head><body>
<h1>Swedeline posts · ${ids.length} ready</h1>
<p class="help">Post them top to bottom. Upload the slides in order, paste the caption, schedule, then move the post's folder from <code>ready/</code> to <code>posted/</code> so it drops off this list on the next render. <a href="#quizzes">Quiz stories (${quizIds.length})</a></p>
${cards || '<p>Nothing ready. Run <code>npm run ig:render</code>.</p>'}
<h2 id="quizzes">Quiz stories · ${quizIds.length} ready</h2>
<p class="help">From the Instagram app: post the question story, add a quiz sticker in the empty space under "Tap your answer" with the question and options shown here, and mark the right one. A few hours later, post the answer story (optionally with a link sticker to the Chrome Web Store above the logo). Then move the quiz's folder from <code>stories/</code> to <code>posted/</code>.</p>
${quizCards || '<p>No quiz stories ready.</p>'}
<script>
  for (const b of document.querySelectorAll('button[data-copy]')) b.onclick = async () => {
    const ta = document.getElementById(b.dataset.copy);
    try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand('copy'); }
    b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy caption'), 1500);
  };
</script></body></html>\n`);
}

// ------------------------------------------------------------------ status

function status() {
  const bank = loadBank().filter((e) => e.post?.id);
  const posted = postedNumbers();
  const ready = bank.filter((e) => !posted.has(num(e.post.id)));
  const rendered = new Set(readyIds());
  const unrendered = ready.filter((e) => !rendered.has(e.post.id));
  console.log(`Bank: ${bank.length} posts. Posted: ${posted.size}. Ready to post: ${ready.length} (${ready.length} days at one a day).`);
  if (ready.length) console.log(`Next up: ${ready[0].post.id}. Highest number in the bank: ${bank.at(-1).post.id.slice(0, 4)}.`);
  if (unrendered.length) console.log(`Not rendered yet: ${unrendered.length}. Run \`npm run ig:render\`.`);
  const quizzes = loadQuizzes().filter((e) => e.post?.id);
  const postedQuizzes = postedQuizNumbers();
  console.log(`Quiz stories: ${quizzes.length} in the bank, ${quizzes.filter((e) => !postedQuizzes.has(quizNum(e.post.id))).length} not posted yet.`);
}

const cmd = process.argv[2];
if (cmd === 'check') check();
else if (cmd === 'render') await render();
else if (cmd === 'status') status();
else {
  console.error('Usage: node scripts/instagram.mjs check | render [--only <id>] | status');
  process.exit(1);
}
