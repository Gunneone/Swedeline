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
  await setStorage(worker, { percent: 8 });
  await page.goto(`${BASE}/en-article.html`);
  const words = page.locator('swedeline-w');
  await expect(words.first()).toBeVisible();
  expect(await words.count()).toBeGreaterThan(5);
  for (const sel of ['h1', 'nav', 'header', 'label', 'button', 'pre', 'footer']) {
    await expect(page.locator(`${sel} swedeline-w`)).toHaveCount(0);
  }
  const first = words.first();
  const original = await first.getAttribute('data-orig');
  await first.hover();
  const tooltip = page.locator('swedeline-tooltip .orig');
  await expect(tooltip).toHaveText(original!);
});

test('switching the site off restores the page, switching on brings words back', async ({ page, worker }) => {
  await page.goto(`${BASE}/en-article.html`);
  const article = page.locator('article');
  await expect(page.locator('swedeline-w').first()).toBeVisible();
  await setStorage(worker, { 'site:localhost': false });
  await expect(page.locator('swedeline-w')).toHaveCount(0);
  const original = await page.evaluate(async () => {
    const html = await (await fetch(location.href)).text();
    return new DOMParser().parseFromString(html, 'text/html').querySelector('article')!.textContent;
  });
  expect(await article.textContent()).toBe(original);
  await worker.evaluate(() => chrome.storage.sync.remove('site:localhost'));
  await expect(page.locator('swedeline-w').first()).toBeVisible();
});

test('the slider changes the number of words live', async ({ page, worker }) => {
  await setStorage(worker, { percent: 2 });
  await page.goto(`${BASE}/en-article.html`);
  await expect(page.locator('swedeline-w').first()).toBeVisible();
  const few = await page.locator('swedeline-w').count();
  await setStorage(worker, { percent: 20 });
  await expect.poll(() => page.locator('swedeline-w').count()).toBeGreaterThan(few * 2);
});

test('leaves Swedish pages alone and handles German, French and Spanish', async ({ page }) => {
  await page.goto(`${BASE}/sv-article.html`);
  await page.waitForTimeout(1500);
  await expect(page.locator('swedeline-w')).toHaveCount(0);
  for (const lang of ['de', 'fr', 'es']) {
    await page.goto(`${BASE}/${lang}-article.html`);
    await expect(page.locator(`swedeline-w[data-lang="${lang}"]`).first()).toBeVisible();
  }
});

test('picks up text added later by the page', async ({ page }) => {
  await page.goto(`${BASE}/en-article.html`);
  await expect(page.locator('swedeline-w').first()).toBeVisible();
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'late';
    p.textContent =
      'Later that evening the children walked down to the water with their father, and the whole family watched the sun go down behind the mountains near the old house.';
    document.querySelector('article')!.append(p);
  });
  await expect(page.locator('#late swedeline-w').first()).toBeVisible();
});

test('popup shows the page status', async ({ context, page, worker }) => {
  await page.goto(`${BASE}/en-article.html`);
  await expect(page.locator('swedeline-w').first()).toBeVisible();
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await expect(popup.locator('#enabled')).toBeChecked();
  await expect(popup.locator('#density-value')).toContainText('%');
});

test('copied text has the original words', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:5179' });
  await page.goto(`${BASE}/en-article.html`);
  const paragraph = page.locator('article p').filter({ has: page.locator('swedeline-w') }).first();
  await expect(paragraph.locator('swedeline-w').first()).toBeVisible();
  const original = await paragraph.evaluate((p) => {
    const clone = p.cloneNode(true) as HTMLElement;
    for (const w of clone.querySelectorAll<HTMLElement>('swedeline-w')) w.replaceWith(w.dataset.orig!);
    return clone.textContent!.replace(/\s+/g, ' ').trim();
  });
  await paragraph.evaluate((p) => getSelection()!.selectAllChildren(p));
  await page.keyboard.press('ControlOrMeta+C');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.replace(/\s+/g, ' ').trim()).toBe(original);
  // The page shows Swedish again right after.
  await expect(paragraph.locator('swedeline-w').first()).not.toHaveText(original.split(' ')[0]);
  expect(await paragraph.locator('swedeline-w').first().textContent()).not.toBe(
    await paragraph.locator('swedeline-w').first().getAttribute('data-orig'),
  );
});

test('unrelated page changes leave the replaced words alone', async ({ page }) => {
  await page.goto(`${BASE}/en-article.html`);
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'inline';
    p.innerHTML =
      'On the first morning I walk down to the <em>quiet</em> <em>river</em> with a cup of coffee,<br>and the birds are loud while the sun is still low over the forest and the water.';
    document.querySelector('article')!.append(p);
  });
  await expect(page.locator('#inline swedeline-w').first()).toBeVisible();
  const words = await page.locator('swedeline-w').elementHandles();
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      document.body.append(document.createElement('div'));
      await new Promise((r) => setTimeout(r, 600));
    }
  });
  for (const w of words) expect(await w.evaluate((el) => el.isConnected)).toBe(true);
});

test('text added to a page that keeps changing still gets processed', async ({ page }) => {
  await page.goto(`${BASE}/en-article.html`);
  await expect(page.locator('swedeline-w').first()).toBeVisible();
  await page.evaluate(() => {
    const clock = document.createElement('span');
    document.body.append(clock);
    setInterval(() => (clock.textContent = String(Date.now())), 100);
    const p = document.createElement('p');
    p.id = 'late';
    p.textContent =
      'Later that evening the children walked down to the water with their father, and the whole family watched the sun go down behind the mountains near the old house.';
    document.querySelector('article')!.append(p);
  });
  await expect(page.locator('#late swedeline-w').first()).toBeVisible({ timeout: 5000 });
});

test('the word count forgets text the page removed', async ({ context, page, worker }) => {
  await page.goto(`${BASE}/en-article.html`);
  await expect(page.locator('swedeline-w').first()).toBeVisible();
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  const count = () =>
    popup.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'http://localhost:5179/*' });
      return ((await chrome.tabs.sendMessage(tab.id!, { type: 'get-status' })) as { count: number }).count;
    });
  expect(await count()).toBeGreaterThan(0);
  await page.evaluate(() => document.querySelector('main')!.remove());
  await expect.poll(count).toBe(0);
});

test('the popup counts Swedish words and pages, once per spot', async ({ context, page, worker }) => {
  await setStorage(worker, { percent: 4 });
  await page.goto(`${BASE}/en-article.html`);
  await expect(page.locator('swedeline-w').first()).toBeVisible();
  const stats = () =>
    worker.evaluate(
      async () => ((await chrome.storage.local.get('stats')).stats ?? { words: 0, pages: 0 }) as Record<string, number>,
    );
  await expect.poll(async () => (await stats()).pages).toBe(1);
  const shown = await page.locator('swedeline-w').count();
  await expect.poll(async () => (await stats()).words).toBe(shown);
  const words = shown;

  // Redrawing the same words (lower then back) adds nothing.
  await setStorage(worker, { percent: 2 });
  await setStorage(worker, { percent: 4 });
  await page.waitForTimeout(2500);
  expect(await stats()).toEqual({ words, pages: 1 });

  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await expect(popup.locator('#stats')).toHaveText(
    `Swedeline inserted ${words.toLocaleString('en')} Swedish words across 1 page.`,
  );
  await expect(popup.locator('#stats strong')).toHaveText([words.toLocaleString('en'), '1']);

  // A new visit counts again, and the open popup follows along.
  await page.reload();
  await expect(popup.locator('#stats strong')).toHaveText([(words * 2).toLocaleString('en'), '2']);
});

test('the popup asks for a review at word milestones', async ({ context, worker }) => {
  const id = new URL(worker.url()).host;
  const setWords = (words: number) => worker.evaluate((w) => chrome.storage.local.set({ stats: { words: w, pages: 9 } }), words);
  const review = () => worker.evaluate(async () => (await chrome.storage.local.get('review')).review);
  const popup = await context.newPage();
  const open = () => popup.goto(`chrome-extension://${id}/popup/popup.html`);
  const card = popup.locator('#review');

  await setWords(19_999);
  await open();
  await expect(popup.locator('#stats strong').first()).toHaveText('19,999');
  await expect(card).toBeHidden();

  // The open popup notices the milestone; "Not now" waits for the next one.
  await setWords(20_000);
  await expect(card).toBeVisible();
  await expect(popup.locator('#review-title')).toHaveText('20,000 Swedish ord so far!');
  await expect(popup.locator('#review-title mark')).toHaveText('ord');
  await expect(popup.locator('#review-text')).toContainText('in the Chrome Web Store');
  await popup.locator('#review-later').click();
  await expect(card).toBeHidden();
  await setWords(49_999);
  await open();
  await expect(popup.locator('#stats strong').first()).toHaveText('49,999');
  await expect(card).toBeHidden();

  // "Rate Swedeline" opens the store's reviews page (caught here, so the test stays offline) and stops asking.
  await setWords(50_000);
  await open();
  await popup.evaluate(() => {
    const w = window as unknown as { opened?: string };
    chrome.tabs.create = (async ({ url }: { url: string }) => void (w.opened = url)) as unknown as typeof chrome.tabs.create;
    window.close = () => {};
  });
  await popup.locator('#review-yes').click();
  await expect
    .poll(() => popup.evaluate(() => (window as unknown as { opened?: string }).opened))
    .toBe(`https://chromewebstore.google.com/detail/swedeline/${id}/reviews`);
  expect(await review()).toEqual({ answered: 20_000, done: true });
});

test('"Don\'t ask again" stops the review requests', async ({ context, worker }) => {
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => chrome.storage.local.set({ stats: { words: 100_000, pages: 9 } }));
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await popup.locator('#review-never').click();
  await expect(popup.locator('#review')).toBeHidden();
  await worker.evaluate(() => chrome.storage.local.set({ stats: { words: 900_000, pages: 9 } }));
  await popup.reload();
  await expect(popup.locator('#stats strong').first()).toHaveText('900,000');
  await expect(popup.locator('#review')).toBeHidden();
});
