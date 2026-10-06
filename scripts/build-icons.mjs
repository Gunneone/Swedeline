#!/usr/bin/env node
// Renders the icon SVGs to PNGs: icons/icon-{16,32,48,128}.png and greyscale
// "-off" variants for when Trana is switched off. Small sizes use a simplified drawing.
import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'src', 'icons');
const SIZES = { 16: 'icon-small.svg', 32: 'icon-small.svg', 48: 'icon.svg', 128: 'icon.svg', 256: 'icon.svg' };

/** Greyscale version of an SVG: every hex color mapped to its luminance, a little lighter. */
function greyscale(svg) {
  return svg.replace(/#([0-9a-f]{6})\b/gi, (_, hex) => {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const y = Math.round(Math.min(255, 0.2126 * r + 0.7152 * g + 0.0722 * b) * 0.55 + 90);
    const h = y.toString(16).padStart(2, '0');
    return `#${h}${h}${h}`;
  });
}

fs.mkdirSync(OUT, { recursive: true });
for (const [size, file] of Object.entries(SIZES)) {
  const svg = fs.readFileSync(path.join(ROOT, 'assets', file), 'utf8');
  for (const [suffix, source] of [['', svg], ['-off', greyscale(svg)]]) {
    if (size === '256' && suffix) continue;
    const png = new Resvg(source, { fitTo: { mode: 'width', value: Number(size) } }).render().asPng();
    fs.writeFileSync(path.join(OUT, `icon-${size}${suffix}.png`), png);
  }
}
console.log(`wrote ${fs.readdirSync(OUT).length} icons to ${path.relative(ROOT, OUT)}`);
