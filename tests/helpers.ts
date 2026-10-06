import fs from 'node:fs';
import path from 'node:path';
import type { Entry } from '../src/shared/messages';
import type { SourceLang } from '../src/content/langdata';

const ROOT = path.resolve(import.meta.dirname, '..');

export function fixture(name: string): string {
  return fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', name), 'utf8');
}

/** Loads a fixture into the jsdom document. */
export function loadFixture(name: string): Document {
  const html = fixture(name);
  document.open();
  document.write(html);
  document.close();
  return document;
}

export function paragraphs(name: string): string[] {
  const doc = new DOMParser().parseFromString(fixture(name), 'text/html');
  return [...doc.querySelectorAll('p')].map((p) => p.textContent ?? '');
}

const dicts = new Map<SourceLang, Record<string, Entry>>();
export function dictionary(lang: SourceLang): Record<string, Entry> {
  let d = dicts.get(lang);
  if (!d) {
    d = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'dict', `${lang}.json`), 'utf8')).w as Record<string, Entry>;
    dicts.set(lang, d);
  }
  return d;
}
