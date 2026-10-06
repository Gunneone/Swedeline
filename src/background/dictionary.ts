import { ext } from '../shared/ext';
import type { Entry, LookupResult } from '../shared/messages';
import type { SourceLang } from '../content/langdata';

interface DictFile {
  w: Record<string, Entry>;
}

// Dictionaries are packaged with the extension and loaded on first use. A
// restarted service worker simply loads them again.
const loaded = new Map<SourceLang, Promise<Record<string, Entry>>>();

function load(lang: SourceLang): Promise<Record<string, Entry>> {
  let dict = loaded.get(lang);
  if (!dict) {
    dict = fetch(ext.runtime.getURL(`dict/${lang}.json`))
      .then((res) => res.json() as Promise<DictFile>)
      .then((file) => file.w);
    dict.catch(() => loaded.delete(lang));
    loaded.set(lang, dict);
  }
  return dict;
}

export async function lookup(lang: SourceLang, words: string[]): Promise<LookupResult> {
  const dict = await load(lang);
  const result: LookupResult = {};
  for (const w of words) {
    const entry = Object.hasOwn(dict, w) ? dict[w] : undefined;
    if (entry) result[w] = entry;
  }
  return result;
}
