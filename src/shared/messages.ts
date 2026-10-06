import type { SourceLang } from '../content/langdata';

/** Dictionary value: [Swedish as shown, Swedish lemma, gender, part of speech, flags]. */
export type Entry = [shown: string, lemma: string, gender: '' | 'en' | 'ett', pos: 'n' | 'a' | 'r', flags: string];

/** What Trana is doing on a page; shown in the popup. */
export type PageState =
  | 'loading'
  | 'active'
  | 'off' // switched off everywhere
  | 'site-off' // switched off for this site
  | 'swedish' // page is already Swedish
  | 'unsupported' // page language is not en/de/fr/es
  | 'no-text'; // no longer texts found

export interface PageStatus {
  host: string;
  state: PageState;
  lang: SourceLang | null;
  count: number;
}

export type Message =
  | { type: 'lookup'; lang: SourceLang; words: string[] }
  | { type: 'page-state'; state: PageState }
  | { type: 'get-status' };

export type LookupResult = Record<string, Entry>;
