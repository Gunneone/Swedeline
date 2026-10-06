/** The key a site is remembered by: lowercase hostname without a leading "www.". */
export function normalizeHost(hostOrUrl: string): string {
  let host = hostOrUrl;
  try {
    if (hostOrUrl.includes('://')) host = new URL(hostOrUrl).hostname;
  } catch {
    return '';
  }
  return host.toLowerCase().replace(/^www\./, '');
}

/** Whether Trana can run on a URL at all (content scripts only match http and https). */
export function isWebUrl(url: string | undefined): boolean {
  return !!url && /^https?:\/\//.test(url);
}
