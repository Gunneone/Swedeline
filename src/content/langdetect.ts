import { STOPWORDS, type DetectLang } from './langdata';

// Language detection without models: count high-frequency function words.
// A word shared by k languages counts 1/k for each of them, so "de" or "en"
// barely matter while "the", "und" or "och" decide.

const WEIGHTS = new Map<string, Map<DetectLang, number>>();
for (const [lang, list] of Object.entries(STOPWORDS) as [DetectLang, string[]][]) {
  for (const word of new Set(list)) {
    const langs = WEIGHTS.get(word) ?? new Map<DetectLang, number>();
    langs.set(lang, 1);
    WEIGHTS.set(word, langs);
  }
}
for (const langs of WEIGHTS.values()) for (const lang of langs.keys()) langs.set(lang, 1 / langs.size);

/** Fewer words than this give no verdict. */
const MIN_WORDS = 8;
/** The winner's weighted hits per word must reach this... */
const MIN_SCORE = 0.08;
/** ...and beat the runner-up by this factor. */
const MIN_MARGIN = 1.4;

const WORD = /[\p{L}\p{M}]+/gu;

export interface Detection {
  lang: DetectLang | null;
  scores: Partial<Record<DetectLang, number>>;
}

export function detectLanguage(text: string, maxWords = 2000): Detection {
  const totals: Partial<Record<DetectLang, number>> = {};
  let count = 0;
  for (const m of text.matchAll(WORD)) {
    if (++count > maxWords) break;
    const langs = WEIGHTS.get(m[0].toLocaleLowerCase());
    if (!langs) continue;
    for (const [lang, w] of langs) totals[lang] = (totals[lang] ?? 0) + w;
  }
  const words = Math.min(count, maxWords);
  const scores: Partial<Record<DetectLang, number>> = {};
  for (const [lang, hits] of Object.entries(totals) as [DetectLang, number][]) scores[lang] = hits / words;
  if (words < MIN_WORDS) return { lang: null, scores };

  const ranked = (Object.entries(scores) as [DetectLang, number][]).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  if (!best || best[1] < MIN_SCORE) return { lang: null, scores };
  if (second && best[1] < second[1] * MIN_MARGIN) return { lang: null, scores };
  return { lang: best[0], scores };
}

/** The page's declared language ("en-GB" -> "en"), if any. */
export function declaredLanguage(doc: Document): string | null {
  const lang = doc.documentElement.lang || doc.querySelector('meta[http-equiv="content-language" i]')?.getAttribute('content');
  return lang ? lang.trim().slice(0, 2).toLowerCase() : null;
}
