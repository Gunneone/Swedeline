#!/usr/bin/env node
// Store graphics for Chrome Web Store and AMO, from the built extension running on public-domain
// Project Gutenberg books:
// - screenshots, 1280x800: a headline on Swedish blue over a browser frame (docs/screenshots/)
// - promo tiles, 440x280 and 1400x560, opaque as the Chrome Web Store asks (docs/)
// Needs `npm run build` first and network access. Pass an output dir to write everything there
// instead, and a name prefix ("1-en", "promo") as the second argument to redo only those.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist/chrome');
const [OUT_ARG, ONLY] = process.argv.slice(2);
const OUT = OUT_ARG ?? 'docs/screenshots';
const PROMO_OUT = OUT_ARG ?? 'docs';
fs.mkdirSync(OUT, { recursive: true });

const G = 'https://www.gutenberg.org/cache/epub';
const ZOOM = 1.75;
const FRAME = { x: 80, y: 188, w: 1120, bar: 44 };
const CONTENT = { w: FRAME.w, h: 800 - FRAME.y - FRAME.bar }; // runs off the bottom edge
const VIEW = { width: Math.round(CONTENT.w / ZOOM), height: Math.ceil(CONTENT.h / ZOOM) };

const SHOTS = [
  {
    name: '1-en', url: `${G}/289/pg289-images.html`, para: 0, above: 120, hover: 'house',
    title: 'Learn Swedish while you browse',
    sub: 'Swedeline swaps a few words in what you read for their Swedish translation.',
  },
  {
    name: '2-de', url: `${G}/22367/pg22367-images.html`, para: 0, above: 24, hover: 'Zimmer',
    title: 'Hover a word to see the original',
    sub: 'With the Swedish base form, en or ett, and a button to hear it spoken.',
  },
  {
    name: '3-fr', url: `${G}/13256/pg13256-images.html`, para: 1, above: 6, hover: 'bonheur',
    title: 'Works in four languages',
    sub: 'English, German, French and Spanish pages. The language is detected for you.',
  },
  {
    name: '4-es', url: `${G}/17340/pg17340-images.html`, para: 0, above: 92, hover: 'noche',
    title: 'Private and offline',
    sub: 'No account and no tracking. The dictionaries ship with the extension.',
  },
  {
    name: '5-popup', url: `${G}/289/pg289-images.html`, para: 0, above: 120, popup: true,
    title: 'You decide how much Swedish',
    sub: 'Pick the amount of words, and switch Swedeline off everywhere or per site.',
  },
];

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  viewport: VIEW,
  deviceScaleFactor: ZOOM,
  locale: 'en-US',
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});
// Opened as a page, the popup would find itself as the active tab: point it at the book instead.
await context.addInitScript(() => {
  if (location.protocol !== 'chrome-extension:') return;
  const orig = chrome.tabs.query.bind(chrome.tabs);
  chrome.tabs.query = async () => (await orig({})).filter((t) => t.url?.includes('gutenberg.org')).slice(0, 1);
});
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
const extId = new URL(worker.url()).host;
await worker.evaluate(() => chrome.storage.sync.set({ density: 7 }));
const page = context.pages()[0] ?? (await context.newPage());
// The frame is composed at 1x so every file comes out at exactly 1280x800.
const plain = await chromium.launch({ channel: 'chromium' });
const composer = await plain.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

async function capturePage(s) {
  await page.goto(s.url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.addStyleTag({ content: '.pagenum, .pageno { display: none !important; }' });
  await page.locator('swedeline-w').first().waitFor();
  await page.evaluate(({ para, above }) => {
    const ps = [...document.querySelectorAll('p')].filter((p) => !p.closest('#pg-header') && p.textContent.length > 300);
    window.scrollTo(0, ps[para].getBoundingClientRect().top + scrollY - above);
  }, s);
  await page.waitForTimeout(500);
  if (s.hover) {
    const r = await page.evaluate((hover) => {
      const w = [...document.querySelectorAll('swedeline-w')].find((w) => {
        const b = w.getBoundingClientRect();
        return w.dataset.orig === hover && b.top > 0 && b.bottom < innerHeight;
      });
      const b = w?.getBoundingClientRect();
      return b && { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, s.hover);
    if (!r) throw new Error(`${s.name}: no visible word "${s.hover}"`);
    await page.mouse.move(r.x, r.y);
    await page.locator('swedeline-tooltip').first().waitFor({ state: 'attached' });
    await page.waitForTimeout(400);
  } else {
    await page.mouse.move(1, 1);
  }
  return page.screenshot();
}

async function capturePopup() {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 340, height: 600 });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.waitForTimeout(800);
  const h = await popup.evaluate(() => Math.ceil(document.body.getBoundingClientRect().bottom + parseFloat(getComputedStyle(document.body).marginBottom)));
  await popup.setViewportSize({ width: 340, height: h });
  const png = await popup.screenshot();
  await popup.close();
  return png;
}

const ICON = fs.readFileSync('assets/icon.svg').toString('base64');
const b64 = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

async function compose(s, shot, pop) {
  const comp = await composer.newPage();
  const popW = 340 * 1.3;
  await comp.setContent(`<!doctype html><html><head><style>
    * { box-sizing: border-box; }
    body { margin: 0; width: 1280px; height: 800px; overflow: hidden; position: relative;
           background: linear-gradient(160deg, #0A78BA 0%, #006AA7 55%, #005A8F 100%);
           font-family: 'Avenir Next', Avenir, 'Helvetica Neue', Arial, sans-serif; }
    h1 { position: absolute; left: 80px; top: 50px; margin: 0; color: #fff; font-size: 46px; font-weight: 700; letter-spacing: -0.5px; }
    h1 mark { background: none; color: #FECC02; }
    p { position: absolute; left: 80px; top: 116px; margin: 0; color: #D6E8F5; font-size: 22px; font-weight: 500; }
    .brand { position: absolute; right: 80px; top: 54px; width: 52px; height: 52px; }
    .frame { position: absolute; left: ${FRAME.x}px; top: ${FRAME.y}px; width: ${FRAME.w}px; height: ${800 - FRAME.y + 20}px;
             background: #fff; border-radius: 14px 14px 0 0; overflow: hidden; box-shadow: 0 24px 60px rgba(0, 25, 50, .45); }
    .bar { height: ${FRAME.bar}px; background: #EEF1F4; display: flex; align-items: center; gap: 8px; padding: 0 16px; border-bottom: 1px solid #DDE3E8; }
    .dot { width: 12px; height: 12px; border-radius: 50%; background: #CDD4DA; }
    .url { margin-left: 16px; flex: 0 1 460px; height: 28px; border-radius: 14px; background: #fff; color: #5B6B78;
           font: 14px/28px -apple-system, system-ui, sans-serif; padding: 0 14px; }
    .ext { margin-left: auto; width: 26px; height: 26px; border-radius: 6px; ${pop ? 'background: #DCE4EB;' : ''} display: grid; place-items: center; }
    .ext img { width: 20px; height: 20px; }
    .shot { display: block; width: ${CONTENT.w}px; }
    .popup { position: absolute; right: ${80 + 6}px; top: ${FRAME.y + FRAME.bar - 4}px; width: ${popW}px; border-radius: 10px;
             box-shadow: 0 16px 44px rgba(0, 0, 0, .3), 0 0 0 1px rgba(0, 0, 0, .08); }
  </style></head><body>
    <h1>${s.title}</h1>
    <p>${s.sub}</p>
    <img class="brand" src="data:image/svg+xml;base64,${ICON}" alt="">
    <div class="frame">
      <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>
        <span class="url">gutenberg.org</span>
        <span class="ext"><img src="data:image/svg+xml;base64,${ICON}" alt=""></span></div>
      <img class="shot" src="${b64(shot)}" alt="">
    </div>
    ${pop ? `<img class="popup" src="${b64(pop)}" alt="">` : ''}
  </body></html>`);
  await comp.waitForTimeout(200);
  await comp.screenshot({ path: path.join(OUT, `${s.name}.png`) });
  await comp.close();
}


const BG = 'background: linear-gradient(160deg, #0A78BA 0%, #006AA7 55%, #005A8F 100%);';
const FONT = "font-family: 'Avenir Next', Avenir, 'Helvetica Neue', Arial, sans-serif;";
// The extension's own marker style (src/content/content.css).
const MARK = `background: rgba(254, 204, 2, 0.32); box-shadow: inset 0 -0.12em 0 #006aa7; border-radius: 0.18em; padding: 0 0.12em;`;

async function render(html, width, height, file) {
  const p = await composer.newPage();
  await p.setViewportSize({ width, height });
  await p.setContent(`<!doctype html><html><head><style>
    * { box-sizing: border-box; }
    body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; position: relative; ${BG} ${FONT} }
    .logo { display: flex; align-items: center; color: #fff; font-weight: 600; letter-spacing: -0.5px; }
    .logo img { display: block; }
    mark { ${MARK} color: inherit; }
  </style></head><body>${html}</body></html>`);
  await p.waitForTimeout(200);
  // The page is opaque, so Chromium writes a 24-bit RGB PNG without alpha, as the store asks.
  await p.screenshot({ path: file });
  await p.close();
}

async function promoSmall() {
  await render(`
    <div class="logo" style="position:absolute; left:32px; top:30px; gap:12px; font-size:30px;">
      <img src="data:image/svg+xml;base64,${ICON}" width="44" height="44" alt="">Swedeline</div>
    <div style="position:absolute; left:32px; right:32px; top:100px; height:148px; background:#fff; border-radius:16px;
                box-shadow:0 14px 34px rgba(0,25,50,.35); display:grid; place-items:center;
                font: 33px/1.3 Georgia, 'Times New Roman', serif; color:#1d2328; text-align:center;">
      <div>Every <mark>dag</mark> a few<br>new <mark>ord</mark> to learn</div>
    </div>`, 440, 280, path.join(PROMO_OUT, 'promo-small-440x280.png'));
}

async function promoMarquee() {
  // A real crop of the extension on a book page, with the word card open.
  const crop = { name: 'promo-crop', url: `${G}/289/pg289-images.html`, para: 0, above: 6, hover: 'brooms' };
  await page.setViewportSize({ width: 340, height: 262 });
  const shot = await capturePage(crop);
  await page.setViewportSize(VIEW);
  await render(`
    <div style="position:absolute; left:90px; top:0; bottom:0; width:560px; display:flex; flex-direction:column; justify-content:center; gap:22px;">
      <div class="logo" style="gap:16px; font-size:40px;">
        <img src="data:image/svg+xml;base64,${ICON}" width="60" height="60" alt="">Swedeline</div>
      <div style="color:#fff; font-size:62px; font-weight:700; line-height:1.08; letter-spacing:-1px;">Learn Swedish<br>while you browse</div>
      <div style="color:#D6E8F5; font-size:25px; font-weight:500; line-height:1.4;">Swedish words, right inside the pages you already read. Hover one for the original.</div>
    </div>
    <img src="${b64(shot)}" alt="" style="position:absolute; right:90px; top:50%; transform:translateY(-50%); width:595px;
         border-radius:16px; box-shadow:0 24px 60px rgba(0,25,50,.45);">`, 1400, 560, path.join(PROMO_OUT, 'promo-marquee-1400x560.png'));
}

for (const s of SHOTS) {
  if (ONLY && !s.name.startsWith(ONLY)) continue;
  const shot = await capturePage(s);
  const pop = s.popup ? await capturePopup() : null;
  await compose(s, shot, pop);
  console.log('wrote', s.name);
}
if (!ONLY || ONLY === 'promo') {
  await promoSmall();
  await promoMarquee();
  console.log('wrote promo tiles');
}
await context.close();
await plain.close();
