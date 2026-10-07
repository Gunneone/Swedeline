<p align="center"><img src="src/icons/icon-128.png" width="96" alt="Trana icon: a yellow crane on Swedish blue"></p>

# Trana

Learn Swedish while you browse. Trana replaces a few words on English, German,
French and Spanish web pages with their Swedish translation. Hover a word to
see the original, the Swedish base form with its gender (*en bil*, *ett hus*),
and hear it pronounced.

It works like [Toucan](https://jointoucan.com), but for Swedish, and it needs
no account, no API key and no server: the dictionaries ship with the extension,
so it works offline and nothing you read leaves your browser.

## Features

- Replaces words in **running text only**: paragraphs, long list items and
  article bodies. Headings, navigation, labels, buttons, form fields, code,
  footers and short snippets are left alone.
- **Recognizable style**: a soft Swedish-yellow marker with a blue underline
  that keeps the page's font and color. A brighter variant is used on dark pages.
- **Hover card** with the original word, its language, the Swedish lemma with
  *en/ett*, and a 🔊 button that uses your system's Swedish voice. The button
  is hidden if no Swedish voice is installed.
- **Amount slider** (1–10 = roughly 1–20 % of the words). Changes apply live.
  Raising it only adds words and lowering it only removes words, and the same
  words come back after a reload.
- **On/off everywhere** and **per site** from the toolbar popup. There is also
  an optional keyboard shortcut for "toggle this site". No default key is set,
  so you pick one that doesn't clash with anything (see below).
- **Automatic language detection** (English, German, French, Spanish). Swedish
  pages and other languages are left untouched. Mixed pages are checked per
  paragraph.
- Popup in English, Swedish, German, French and Spanish, following your
  browser language (English otherwise).
- Works on single-page apps and infinite scroll: new text gets processed as it
  appears.
- Copying text or printing the page gives you the original words, not the
  Swedish ones.

### How translation works (no AI)

Translations come from a word list built offline from Wiktionary (via
WikDict) and word-frequency data; see [How the dictionaries are built](#how-the-dictionaries-are-built).
Word-by-word translation has no context, so Trana goes for precision over
coverage. It skips words that are ambiguous (*light* = ljus or lätt), names,
words at the start of a sentence, and words that are also common verb forms.
The exception is nouns that follow an article, possessive, number or
preposition (*the water* → *the vatten*, but not *we water the plants*). Nouns,
adjectives and adverbs are translated; verbs are not (yet).

## Install from source

Requires Node.js 22.13 or newer.

```bash
npm install
npm run build
```

**Chrome / Edge / Brave:** open `chrome://extensions`, enable *Developer
mode*, click *Load unpacked* and pick `dist/chrome`.

**Firefox (140+):** run `npm run run:firefox` to start a Firefox with Trana
loaded. To install temporarily in your own Firefox, open
`about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* → pick
`dist/firefox/manifest.json`. If the popup says Trana needs access to
websites, click *Allow*.

### Keyboard shortcut

The "toggle this site" command ships without a default key, because common
picks such as Alt+Shift+T are already taken (in Chrome it focuses the
toolbar). Set your own:

- Chrome: `chrome://extensions/shortcuts`, or the link in Trana's popup.
- Firefox: Add-ons Manager → ⚙️ → *Manage Extension Shortcuts*.

## Development

| Command | What it does |
| --- | --- |
| `npm run build` | Build `dist/chrome` and `dist/firefox` |
| `npm run watch` | Rebuild on change |
| `npm test` | Unit tests (Vitest + jsdom) |
| `npm run test:e2e` | End-to-end tests with the real extension in Chromium (Playwright; run `npx playwright install chromium` once) |
| `npm run typecheck` | TypeScript check |
| `npm run lint:firefox` | `web-ext lint` on the Firefox build |
| `npm run harness` | Dev server at http://localhost:5178: the test articles with the content script and a fake extension API, plus a popup preview |
| `npm run dicts` | Rebuild the dictionaries (downloads ~2.5 GB of source data into `.cache/` the first time) |
| `npm run dict-report` | List every word Trana would replace in the test articles, for reviewing translation quality |
| `npm run icons` | Render `assets/*.svg` to the PNG icons |
| `npm run zip` | Store-ready zips in `dist/` |

### Project layout

```
src/
  manifest.base.json      shared manifest; scripts/build.mjs adds the browser-specific parts
  background/             service worker / event page: dictionary lookups, toolbar icon state, shortcut
  content/                runs in pages: language detection, finding text, choosing and replacing words, hover card
  popup/                  toolbar popup
  shared/                 settings, messages, browser API shim
  dict/                   generated dictionaries + hand-made overrides
  _locales/               UI translations (en, sv, de, fr, es)
scripts/                  build, dictionary pipeline, icons, packaging, dev server
tests/                    unit tests, fixtures, e2e
```

### How the dictionaries are built

`scripts/build-dicts.mjs` reads WikDict's SQLite databases and the
FrequencyWords lists, then for each source language:

1. Takes the ~15,000 most frequent words that are nouns, adjectives or
   adverbs, never function words.
2. Picks the best-scored Swedish translation that is a single word, exists in
   Swedish Wiktionary with the same part of speech, and differs from the
   source word.
3. Adds inflected forms. Plurals map to the Swedish plural (*cars* → *bilar*).
   The gender comes from Swedish Wiktionary.
4. Drops forms with competing readings: other senses with different
   translations, function-word uses, or verb forms. Rule-based conjugation
   covers English, French and Spanish, where WikDict has no verb forms. Nouns
   that clash with a verb form get flag `d` (needs noun context).
5. Applies `src/dict/overrides/<lang>.json`: a `block` list (the word and all
   its forms), a `drop` list (only that exact form: *einfach* but not
   *einfache*) and `fix`ed entries.

To correct a translation, add it to the language's override file, run
`npm run dicts`, and check it with `npm run dict-report`. Add the sentence
where it went wrong to `tests/translations.test.ts` so it stays fixed.

Entry format: `"surface": ["shown in page", "Swedish lemma", "en|ett|", "n|a|r", "flags"]`.

## License

Code: MIT (see [LICENSE](LICENSE)). Dictionary data: CC BY-SA; see [NOTICE](NOTICE).
