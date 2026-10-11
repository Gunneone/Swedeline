import { beforeEach, describe, expect, it } from 'vitest';
import { findBlocks, isExcluded } from '../src/content/scanner';
import { closestComposed, containsComposed, shadowRootsIn } from '../src/content/shadow';

const SENTENCE = 'This paragraph inside a web component has more than twelve words, so it should be picked up.';

function component(parent: Element, html: string, tag = 'x-card'): ShadowRoot {
  const host = document.createElement(tag);
  parent.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = html;
  return root;
}

describe('shadow roots', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds open shadow roots, nested ones included, but not Swedeline’s own', () => {
    const outer = component(document.body, '<div></div>');
    const inner = component(outer.querySelector('div')!, '<p>inner</p>');
    component(document.body, '<p>card</p>', 'swedeline-tooltip');
    const closed = document.createElement('x-closed');
    closed.attachShadow({ mode: 'closed' }).innerHTML = '<p>private</p>';
    document.body.append(closed);
    expect(shadowRootsIn(document.body)).toEqual([outer, inner]);
    expect(shadowRootsIn(outer.host)).toEqual([outer, inner]);
  });

  it('finds blocks inside a shadow root', () => {
    const root = component(document.body, `<p>${SENTENCE}</p>`);
    const blocks = findBlocks(root);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe(SENTENCE);
  });

  it('excludes components inside navigation, headings and consent-like places', () => {
    const nav = document.createElement('nav');
    document.body.append(nav);
    const inNav = component(nav, `<p>${SENTENCE}</p>`);
    const nested = component(inNav.querySelector('p')!, `<span>${SENTENCE}</span>`, 'x-inner');
    const free = component(document.body, `<p>${SENTENCE}</p>`);
    expect(isExcluded(inNav.querySelector('p'))).toBe(true);
    expect(isExcluded(nested.querySelector('span'))).toBe(true);
    expect(isExcluded(free.querySelector('p'))).toBe(false);
    expect(findBlocks(inNav)).toHaveLength(0);
  });

  it('closestComposed climbs from shadow roots to their hosts', () => {
    const section = document.createElement('section');
    section.id = 'outer';
    document.body.append(section);
    const root = component(section, '<p><b>word</b></p>');
    const b = root.querySelector('b')!;
    expect(closestComposed(b, 'p')).toBe(root.querySelector('p'));
    expect(closestComposed(b, '#outer')).toBe(section);
    expect(closestComposed(b, 'article')).toBeNull();
  });

  it('containsComposed sees into shadow roots', () => {
    const section = document.createElement('section');
    document.body.append(section);
    const word = component(section, '<p><b>word</b></p>').querySelector('b')!;
    expect(section.contains(word)).toBe(false);
    expect(containsComposed(section, word)).toBe(true);
    expect(containsComposed(document, word)).toBe(true);
    expect(containsComposed(document.createElement('div'), word)).toBe(false);
  });
});
