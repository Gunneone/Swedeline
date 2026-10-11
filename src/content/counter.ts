/** Increments for the usage counters. */
export interface StatsDelta {
  words: number;
  pages: number;
}

/**
 * Counts Swedish words once per spot: each block counts the most words it has
 * shown during a visit, so redraws (slider, page re-renders, off/on) don't add
 * up. A visit is one URL; a new URL (single-page apps) starts a new one.
 */
export class VisitCounter {
  private url = '';
  private peaks = new WeakMap<Element, number>();
  private pageCounted = false;

  record(url: string, el: Element, shown: number): StatsDelta {
    if (url !== this.url) {
      this.url = url;
      this.peaks = new WeakMap();
      this.pageCounted = false;
    }
    const words = Math.max(0, shown - (this.peaks.get(el) ?? 0));
    if (!words) return { words: 0, pages: 0 };
    this.peaks.set(el, shown);
    const pages = this.pageCounted ? 0 : 1;
    this.pageCounted = true;
    return { words, pages };
  }
}

/** The page a visit is about: the URL without its #fragment. */
export const visitUrl = (loc: Pick<Location, 'origin' | 'pathname' | 'search'>): string =>
  loc.origin + loc.pathname + loc.search;
