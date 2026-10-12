// Brand constants shared by the image scripts (store graphics, Instagram posts).
import fs from 'node:fs';
import path from 'node:path';

const ASSETS = path.resolve(import.meta.dirname, '..', 'assets');
const svg = (file) => fs.readFileSync(path.join(ASSETS, file), 'utf8');
export const svgData = (source) => `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`;

export const COLORS = {
  blue: '#006AA7',
  blueStrong: '#00558A',
  yellow: '#FECC02',
  paper: '#F4F7FA',
  text: '#17212B',
  muted: '#5B6876',
  line: '#E1E7EE',
  navy: '#00314F',
  sub: '#D6E8F5', // subtitles on Swedish blue
};

export const BG = 'background: linear-gradient(160deg, #0A78BA 0%, #006AA7 55%, #005A8F 100%);';
export const FONT = "font-family: 'Avenir Next', Avenir, 'Helvetica Neue', Arial, sans-serif;";
// The extension's own marker style (src/content/content.css).
export const MARK = `background: rgba(254, 204, 2, 0.32); box-shadow: inset 0 -0.12em 0 #006aa7; border-radius: 0.18em; padding: 0 0.12em;`;

export const ICON_SVG = svg('icon.svg');
export const ICON = svgData(ICON_SVG);
const logo = svg('logo.svg');
export const LOGO = svgData(logo.replace(/@media[^}]*}\s*}/, ''));
export const LOGO_WHITE = svgData(logo.replace(/@media[^}]*}\s*}/, '').replace('fill: #00314F', 'fill: #FFFFFF'));
