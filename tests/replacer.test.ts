import { describe, expect, it } from 'vitest';
import type { Entry } from '../src/shared/messages';
import { applyReplacements, revertApplied } from '../src/content/replacer';

const HUS: Entry = ['hus', 'hus', 'ett', 'n', ''];
const SJO: Entry = ['sjö', 'sjö', 'en', 'n', ''];

describe('applyReplacements', () => {
  it('wraps the words and keeps the original node in place', () => {
    document.body.innerHTML = '<p>A small house near the lake.</p>';
    const p = document.querySelector('p')!;
    const node = p.firstChild as Text;
    const applied = applyReplacements(node, [
      { start: 8, end: 13, entry: HUS, lang: 'en' },
      { start: 23, end: 27, entry: SJO, lang: 'en' },
    ], false)!;
    expect(p.textContent).toBe('A small hus near the sjö.');
    expect(p.firstChild).toBe(node);
    const words = p.querySelectorAll('swedeline-w');
    expect(words).toHaveLength(2);
    expect((words[0] as HTMLElement).dataset).toMatchObject({ orig: 'house', lemma: 'hus', g: 'ett', lang: 'en' });
    expect(applied.words).toHaveLength(2);
  });

  it('reverts to exactly the original text', () => {
    document.body.innerHTML = '<p>A small house near the lake</p>';
    const p = document.querySelector('p')!;
    const before = p.innerHTML;
    const node = p.firstChild as Text;
    const applied = applyReplacements(node, [
      { start: 8, end: 13, entry: HUS, lang: 'en' },
      { start: 23, end: 27, entry: SJO, lang: 'en' },
    ], false)!;
    revertApplied(applied);
    expect(p.innerHTML).toBe(before);
    expect(p.firstChild).toBe(node);
    expect(p.childNodes).toHaveLength(1);
  });

  it('keeps text a framework wrote into the node meanwhile', () => {
    document.body.innerHTML = '<p>A small house near the lake</p>';
    const p = document.querySelector('p')!;
    const node = p.firstChild as Text;
    const applied = applyReplacements(node, [{ start: 8, end: 13, entry: HUS, lang: 'en' }], false)!;
    node.data = 'Completely new text from the app';
    revertApplied(applied, false);
    expect(p.textContent).toBe('Completely new text from the app');
  });
});
