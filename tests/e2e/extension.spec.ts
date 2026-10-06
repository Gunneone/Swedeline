// End-to-end: the built Chrome extension (dist/chrome) in Playwright's Chromium.
// Run `npm run build` first.
import { chromium, expect, test as base, type BrowserContext, type Worker } from '@playwright/test';
import path from 'node:path';

const DIST = path.resolve(import.meta.dirname, '../../dist/chrome');
const BASE = 'http://localhost:5179/tests/fixtures';

const test = base.extend<{ context: BrowserContext; worker: Worker }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
});

const setStorage = (worker: Worker, items: Record<string, unknown>) =>
  worker.evaluate((i) => chrome.storage.sync.set(i), items);

test('replaces words in body text only and shows the original on hover', async ({ page, worker }) => {
  await setStorage(worker, { density: 6 });
  await page.goto(`${BASE}/en-article.html`);
  const words = page.locator('trana-w');
  await expect(words.first()).toBeVisible();
  expect(await words.count()).toBeGreaterThan(5);
  for (const sel of ['h1', 'nav', 'header', 'label', 'button', 'pre', 'footer']) {
    await expect(page.locator(`${sel} trana-w`)).toHaveCount(0);
  }
  const first = words.first();
  const original = await first.getAttribute('data-orig');
  await first.hover();
  const tooltip = page.locator('trana-tooltip .orig');
  await expect(tooltip).toHaveText(original!);
});

test('switching the site off restores the page, switching on brings words back', async ({ page, worker }) => {
  await page.goto(`${BASE}/en-article.html`);
  const article = page.locator('article');
  await expect(page.locator('trana-w').first()).toBeVisible();
  await setStorage(worker, { 'site:localhost': false });
  await expect(page.locator('trana-w')).toHaveCount(0);
  const original = await page.evaluate(async () => {
    const html = await (await fetch(location.href)).text();
    return new DOMParser().parseFromString(html, 'text/html').querySelector('article')!.textContent;
  });
  expect(await article.textContent()).toBe(original);
  await worker.evaluate(() => chrome.storage.sync.remove('site:localhost'));
  await expect(page.locator('trana-w').first()).toBeVisible();
});

test('the slider changes the number of words live', async ({ page, worker }) => {
  await setStorage(worker, { density: 1 });
  await page.goto(`${BASE}/en-article.html`);
  await expect(page.locator('trana-w').first()).toBeVisible();
  const few = await page.locator('trana-w').count();
  await setStorage(worker, { density: 10 });
  await expect.poll(() => page.locator('trana-w').count()).toBeGreaterThan(few * 2);
});

test('leaves Swedish pages alone and handles German, French and Spanish', async ({ page }) => {
  await page.goto(`${BASE}/sv-article.html`);
  await page.waitForTimeout(1500);
  await expect(page.locator('trana-w')).toHaveCount(0);
  for (const lang of ['de', 'fr', 'es']) {
    await page.goto(`${BASE}/${lang}-article.html`);
    await expect(page.locator(`trana-w[data-lang="${lang}"]`).first()).toBeVisible();
  }
});

test('picks up text added later by the page', async ({ page }) => {
  await page.goto(`${BASE}/en-article.html`);
  await expect(page.locator('trana-w').first()).toBeVisible();
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'late';
    p.textContent =
      'Later that evening the children walked down to the water with their father, and the whole family watched the sun go down behind the mountains near the old house.';
    document.querySelector('article')!.append(p);
  });
  await expect(page.locator('#late trana-w').first()).toBeVisible();
});

test('popup shows the page status', async ({ context, page, worker }) => {
  await page.goto(`${BASE}/en-article.html`);
  await expect(page.locator('trana-w').first()).toBeVisible();
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await expect(popup.locator('#enabled')).toBeChecked();
  await expect(popup.locator('#density-value')).toContainText('%');
});
