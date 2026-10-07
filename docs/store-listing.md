# Store listing text

Use the same text on Chrome Web Store and AMO unless noted.

## Name
Trana

## Category
Chrome: Education (or Productivity). AMO: Language Support / Other.

## Short description (Chrome limit 132 chars)
Learn Swedish while you browse: Trana swaps some words on English, German, French and Spanish pages for Swedish ones.

## Summary (AMO limit 250 chars)
Learn Swedish while you browse. Trana replaces a few words in the text of English, German, French and Spanish pages with their Swedish translation. Hover for the original word, gender and pronunciation. No account, no tracking, works offline.

## Full description

Learn Swedish while you read what you already read.

Trana replaces a few words on English, German, French and Spanish web pages with their Swedish translation. You keep reading as usual, and the Swedish words slowly stick, in context, without a flashcard in sight.

HOW IT WORKS
• Swedish words appear inside running text with a soft yellow marker and a blue underline.
• Hover a word to see the original, the Swedish base form with its gender (en bil, ett hus), and press 🔊 to hear it spoken with a Swedish voice from your system or browser.
• Pick how many words get replaced with the slider (roughly 1–20 %). Changes apply live.
• Turn Trana on or off for all sites or just the current one from the toolbar popup. You can also set a keyboard shortcut.

DESIGNED NOT TO GET IN YOUR WAY
• Only running text is touched: paragraphs and article bodies. Headings, menus, buttons, form fields, code and footers are left alone.
• Ambiguous words, names and words that are also common verb forms are skipped, because precision beats coverage.
• Swedish pages and other languages are left untouched. Language is detected automatically, per paragraph.
• Works on single-page apps and infinite scroll.
• Copying text or printing gives you the original words.

PRIVATE BY DESIGN
• No account, no API key, no AI service and no server.
• The dictionaries ship with the extension, so it works offline.
• Nothing you read ever leaves your browser. Trana collects no data.

The interface is available in English, Swedish, German, French and Spanish.

Translations are built from Wiktionary (via WikDict) and word-frequency data, licensed CC BY-SA. Source code (MIT): https://github.com/Gunneone/trana

## Permission justifications (Chrome "Privacy practices" tab)

**Single purpose:** Replace a few words in the text of web pages with their Swedish translation to help the user learn Swedish.

**storage:** Saves the user's settings (on/off, number of words, per-site switches).

**Host permission (http://*/*, https://*/*):** The extension must read and modify the text of pages the user visits in order to replace words. Page content is processed locally and never transmitted.

**Remote code:** No. All code and dictionaries are bundled in the package.

**Data usage:** Collects none of the listed data types. Check all three certifications (no selling, no unrelated use, no creditworthiness use).

**Privacy policy URL:** https://github.com/Gunneone/trana/blob/main/PRIVACY.md (the repo must be public, or host the page elsewhere)

## Notes to reviewer (AMO)
No account needed. Build from source: `npm ci && npm run build:firefox` (Node 22.13+); output is `dist/firefox`. The dictionaries in `src/dict/*.json` are generated offline by `npm run dicts` from public Wiktionary/WikDict data and are committed, so the build does not need network access.

## Screenshots to prepare
1. An English article with Swedish words highlighted (1280×800).
2. The hover card open on a word.
3. The popup with the amount slider.
