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

test('the tooltip shows on pages that hide undefined custom elements', async ({ page }) => {
  // Like Reddit, which hides custom elements until they are defined.
  await page.addInitScript(() =>
    document.addEventListener('DOMContentLoaded', () =>
      document.head.append(Object.assign(document.createElement('style'), { textContent: ':not(:defined) { visibility: hidden; }' })),
    ),
  );
  await page.goto(`${BASE}/en-article.html`);
  const first = page.locator('swedeline-w').first();
  await expect(first).toBeVisible();
  await first.hover();
  await expect(page.locator('swedeline-tooltip .card')).toBeVisible();
});

test('the tooltip stays open when something else on the page scrolls', async ({ page }) => {
  await page.goto(`${BASE}/en-article.html`);
  await page.evaluate(() => {
    const box = Object.assign(document.createElement('div'), { id: 'scroller' });
    box.style.cssText = 'height: 40px; overflow: auto';
    box.innerHTML = '<div style="height: 400px"></div>';
    document.body.prepend(box);
    document.body.append(Object.assign(document.createElement('div'), { style: 'height: 3000px' }));
  });
  const first = page.locator('swedeline-w').first();
  await expect(first).toBeVisible();
  await first.hover();
  const card = page.locator('swedeline-tooltip .card');
  await expect(card).toBeVisible();
  await page.evaluate(() => document.getElementById('scroller')!.scrollBy(0, 100));
  await page.waitForTimeout(200);
  await expect(card).toBeVisible();
  await page.evaluate(() => window.scrollBy(0, 2500));
  await expect(card).toBeHidden();
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

test('replaces words inside web components (open shadow roots)', async ({ page, worker }) => {
  await setStorage(worker, { percent: 13 });
  await page.goto(`${BASE}/shadow-article.html`);
  for (const id of ['first', 'quote', 'slotted']) {
    await expect(page.locator(`#${id} swedeline-w`).first()).toBeVisible();
  }
  // Defined later, so its shadow root appears without a change the observer sees.
  await expect(page.locator('#late swedeline-w').first()).toBeVisible({ timeout: 6000 });
  await expect(page.locator('nav swedeline-w')).toHaveCount(0);
  const background = await page
    .locator('#first swedeline-w')
    .first()
    .evaluate((w) => getComputedStyle(w).backgroundColor);
  expect(background).toContain('254, 204, 2');
});

test('the tooltip works when moving within a shadow root', async ({ page }) => {
  await page.goto(`${BASE}/shadow-article.html`);
  const word = page.locator('#first swedeline-w').first();
  await expect(word).toBeVisible();
  // Start on the paragraph's own text: the move into the word stays inside the shadow root.
  const p = await page.locator('#first').boundingBox();
  await page.mouse.move(p!.x + 2, p!.y + 2);
  const box = await word.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, { steps: 4 });
  await expect(page.locator('swedeline-tooltip .orig')).toHaveText((await word.getAttribute('data-orig'))!);
});

test('copied text from a shadow root has the original words', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:5179' });
  await page.goto(`${BASE}/shadow-article.html`);
  const paragraph = page.locator('#second');
  await expect(paragraph.locator('swedeline-w').first()).toBeVisible();
  await paragraph.click({ clickCount: 3 });
  await page.keyboard.press('ControlOrMeta+C');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('On the first morning I usually walk down to the river with a cup of coffee.');
});

test('switching the site off restores web components too', async ({ page, worker }) => {
  await page.goto(`${BASE}/shadow-article.html`);
  const first = page.locator('#first');
  await expect(first.locator('swedeline-w').first()).toBeVisible();
  await setStorage(worker, { 'site:localhost': false });
  await expect(page.locator('swedeline-w')).toHaveCount(0);
  await expect(first).toHaveText(/^Every summer my family drives north to a small red house near the lake\./);
  await worker.evaluate(() => chrome.storage.sync.remove('site:localhost'));
  await expect(first.locator('swedeline-w').first()).toBeVisible();
});

test('web components on pages that render late keep being watched', async ({ page, worker }) => {
  await setStorage(worker, { percent: 20 });
  await page.goto(`${BASE}/shadow-late.html`);
  await expect(page.locator('story-box swedeline-w').first()).toBeVisible({ timeout: 6000 });
  await expect(page.locator('#more swedeline-w').first()).toBeVisible({ timeout: 8000 });
});

test('scrolling the page closes the tooltip of a word inside a web component', async ({ page }) => {
  await page.goto(`${BASE}/shadow-article.html`);
  await page.evaluate(() => document.body.append(Object.assign(document.createElement('div'), { style: 'height: 3000px' })));
  const word = page.locator('#first swedeline-w').first();
  await expect(word).toBeVisible();
  // A hover event without moving the mouse, so leaving the word cannot be what closes the card.
  await word.dispatchEvent('mouseover');
  const card = page.locator('swedeline-tooltip .card');
  await expect(card).toBeVisible();
  await page.evaluate(() => window.scrollBy(0, 2500));
  await expect(card).toBeHidden();
});

test('words inside web components are counted too', async ({ page, worker }) => {
  await page.goto(`${BASE}/shadow-article.html`);
  await expect(page.locator('#quote swedeline-w').first()).toBeVisible();
  const shown = () =>
    page.evaluate(() => {
      const count = (root: Document | ShadowRoot): number =>
        root.querySelectorAll('swedeline-w').length +
        [...root.querySelectorAll('*')].reduce((n, el) => n + (el.shadowRoot ? count(el.shadowRoot) : 0), 0);
      return count(document);
    });
  const counted = () =>
    worker.evaluate(async () => ((await chrome.storage.local.get('stats')).stats as { words: number } | undefined)?.words ?? 0);
  // Some components get their words later; the counter catches up.
  await expect.poll(async () => (await counted()) - (await shown()), { timeout: 10_000 }).toBe(0);
  expect(await page.locator('#quote swedeline-w').count()).toBeGreaterThan(0);
});
