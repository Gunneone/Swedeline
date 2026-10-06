import { beforeEach, describe, expect, it } from 'vitest';
import { findBlocks } from '../src/content/scanner';
import { loadFixture } from './helpers';

describe('findBlocks', () => {
  beforeEach(() => loadFixture('en-article.html'));

  it('finds the article paragraphs and long list items', () => {
    const blocks = findBlocks(document.body);
    const tags = blocks.map((b) => b.el.tagName);
    expect(tags.filter((t) => t === 'P')).toHaveLength(4);
    expect(blocks.some((b) => b.el.tagName === 'LI' && b.text.startsWith('When you visit'))).toBe(true);
  });

  it('never includes headings, navigation, labels, buttons, code, footers or short items', () => {
    const texts = findBlocks(document.body).map((b) => b.text).join('\n');
    for (const excluded of ['A weekend by the lake', 'Travel stories', 'By a friend', 'Short item', 'Your email address',
      'Subscribe', 'const house', 'Copyright notice']) {
      expect(texts).not.toContain(excluded);
    }
  });

  it('skips editable areas and text marked as not translatable', () => {
    document.body.innerHTML = `
      <div contenteditable="true"><p>This editable paragraph has more than twelve words in it, so it would qualify otherwise.</p></div>
      <p translate="no">This paragraph is marked translate no and has more than twelve words in it too.</p>
      <p>This normal paragraph has more than twelve words in it, so it should be picked up.</p>`;
    const blocks = findBlocks(document.body);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toContain('normal paragraph');
  });

  it('treats inline elements as part of the surrounding block', () => {
    document.body.innerHTML =
      '<p>The <a href="#">small house</a> near the <em>lake</em> has a red door and a garden full of flowers.</p>';
    const [block] = findBlocks(document.body);
    expect(block.el.tagName).toBe('P');
    expect(block.nodes).toHaveLength(5);
    expect(block.text).toBe('The small house near the lake has a red door and a garden full of flowers.');
  });

  it('keeps words apart across line breaks and whitespace between elements', () => {
    document.body.innerHTML =
      '<p>We walked along the quiet road for an hour<br>and then we saw the <em>old</em> <em>house</em> by the lake.</p>';
    const [block] = findBlocks(document.body);
    expect(block.text).toBe('We walked along the quiet road for an hour and then we saw the old house by the lake.');
    for (const [i, node] of block.nodes.entries()) {
      expect(block.text.slice(block.offsets[i], block.offsets[i] + node.data.length)).toBe(node.data);
    }
  });

  it('skips link lists', () => {
    document.body.innerHTML =
      '<div><a href="#">First related article about houses</a>. <a href="#">Second related article about water</a>. <a href="#">Third one</a>.</div>';
    expect(findBlocks(document.body)).toHaveLength(0);
  });
});
