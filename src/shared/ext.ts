// One handle for the WebExtension API in both browsers. Firefox exposes the
// promise-based `browser` namespace; Chrome's MV3 `chrome` APIs return promises too.
export const ext: typeof chrome =
  (globalThis as unknown as { browser?: typeof chrome }).browser ?? globalThis.chrome;

export const isFirefox = (): boolean => ext.runtime.getURL('').startsWith('moz-extension:');
