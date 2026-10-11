import { describe, expect, it } from 'vitest';
import { VisitCounter, visitUrl } from '../src/content/counter';

const A = 'https://example.com/a';
const B = 'https://example.com/b';

describe('VisitCounter', () => {
  it('counts the page once, with the first words', () => {
    const c = new VisitCounter();
    const [p1, p2] = [document.createElement('p'), document.createElement('p')];
    expect(c.record(A, p1, 3)).toEqual({ words: 3, pages: 1 });
    expect(c.record(A, p2, 2)).toEqual({ words: 2, pages: 0 });
  });

  it('does not count redraws of the same block again', () => {
    const c = new VisitCounter();
    const p = document.createElement('p');
    c.record(A, p, 4);
    expect(c.record(A, p, 4)).toEqual({ words: 0, pages: 0 });
    expect(c.record(A, p, 2)).toEqual({ words: 0, pages: 0 });
    expect(c.record(A, p, 6)).toEqual({ words: 2, pages: 0 });
  });

  it('starts a new visit when the URL changes', () => {
    const c = new VisitCounter();
    const p = document.createElement('p');
    c.record(A, p, 4);
    expect(c.record(B, p, 4)).toEqual({ words: 4, pages: 1 });
  });

  it('ignores blocks without words', () => {
    const c = new VisitCounter();
    expect(c.record(A, document.createElement('p'), 0)).toEqual({ words: 0, pages: 0 });
    expect(c.record(A, document.createElement('p'), 1)).toEqual({ words: 1, pages: 1 });
  });
});

describe('visitUrl', () => {
  it('ignores the #fragment', () => {
    expect(visitUrl(new URL('https://example.com/a?q=1#top'))).toBe('https://example.com/a?q=1');
  });
});
