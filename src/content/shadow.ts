// Open shadow roots: web components (MSN, archive.org) keep their text there,
// out of reach of document-wide tree walkers, observers and selectors.
// Closed roots stay private.

const OWN_HOST = 'SWEDELINE-TOOLTIP';

export function isShadowRoot(node: Node | null | undefined): node is ShadowRoot {
  return node?.nodeType === Node.DOCUMENT_FRAGMENT_NODE && !!(node as ShadowRoot).host;
}

/** The open shadow roots under `root` (or of `root` itself), nested ones included; not Swedeline's own. */
export function shadowRootsIn(root: Node): ShadowRoot[] {
  const found: ShadowRoot[] = [];
  const visit = (el: Element) => {
    const sr = el.shadowRoot;
    if (sr && el.tagName !== OWN_HOST) {
      found.push(sr);
      collect(sr);
    }
  };
  const collect = (node: Node) => {
    const doc = node.ownerDocument ?? (node as Document);
    const walker = doc.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) visit(n as Element);
  };
  if (root.nodeType === Node.ELEMENT_NODE) visit(root as Element);
  collect(root);
  return found;
}

/** `closest` that continues from a shadow root to its host: a component inside <nav> is in the nav. */
export function closestComposed(el: Element | null, selector: string): Element | null {
  while (el) {
    const hit = el.closest(selector);
    if (hit) return hit;
    const root = el.getRootNode();
    el = isShadowRoot(root) ? root.host : null;
  }
  return null;
}

/** `contains` that also looks into shadow roots: scrolling the page moves a word inside a component. */
export function containsComposed(ancestor: Node, node: Node): boolean {
  for (let n: Node | null = node; n; ) {
    if (ancestor.contains(n)) return true;
    const root = n.getRootNode();
    n = isShadowRoot(root) ? root.host : null;
  }
  return false;
}
