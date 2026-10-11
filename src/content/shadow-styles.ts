import css from './content.css';

// The manifest's content.css styles the document only; shadow roots that get
// words need the same rules.

const styled = new WeakSet<ShadowRoot>();
let sheet: CSSStyleSheet | null = null;

export function styleShadowRoot(root: ShadowRoot): void {
  if (styled.has(root)) return;
  styled.add(root);
  try {
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
    }
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    if (root.adoptedStyleSheets.includes(sheet)) return;
  } catch {
    // Firefox content scripts cannot hand their own sheets to the page.
  }
  const style = root.ownerDocument.createElement('style');
  style.textContent = css;
  root.append(style);
}
