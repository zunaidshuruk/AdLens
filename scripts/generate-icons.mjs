/**
 * Generates the app icon set from public/logo.svg (Sprint 16.5).
 *
 *   npm i --no-save @resvg/resvg-js && node scripts/generate-icons.mjs
 *
 * The PNG files are committed, so this only needs to run when the logo changes.
 * - icon-192 / icon-512      "any" purpose: transparent background (Windows, Android, install dialogs)
 * - icon-maskable-512        full-bleed background with the logo inside the safe zone (Android crops it to a circle or squircle)
 * - apple-touch-icon-180     opaque background: iOS fills transparent icons with black
 * - favicon-32 / favicon-16  browser tabs
 */
import fs from 'node:fs';
import path from 'node:path';

const { Resvg } = await import(process.env.RESVG_PATH ?? '@resvg/resvg-js');
const root = process.cwd();
const logo = fs.readFileSync(path.join(root, 'public/logo.svg'), 'utf8');
const inner = logo.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

/** Logo scaled about the centre, optionally on a solid background. */
function render(size, scale, background) {
  const bg = background ? `<rect width="512" height="512" fill="${background}"/>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}" fill="none">${bg}<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${inner}</g></svg>`;
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render();
}

/** Farthest distance (in pixels) from the centre of any pixel that differs from the background colour. */
function farthestLogoPixel(image, bgRgb) {
  const { width, height, pixels } = image;
  let max = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const differs = pixels[i + 3] > 20 && (Math.abs(pixels[i] - bgRgb[0]) > 12 || Math.abs(pixels[i + 1] - bgRgb[1]) > 12 || Math.abs(pixels[i + 2] - bgRgb[2]) > 12);
      if (differs) max = Math.max(max, Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2));
    }
  }
  return max;
}

const out = path.join(root, 'public/icons');
fs.mkdirSync(out, { recursive: true });
const maskable = render(512, 0.74, '#ffffff');
// Android may crop a maskable icon to a circle of 40% of its width in radius: the logo must stay inside it.
const reach = farthestLogoPixel(maskable, [255, 255, 255]);
const safeRadius = 0.4 * 512;
if (reach > safeRadius) throw new Error(`Maskable icon logo reaches ${reach.toFixed(1)}px from the centre; the safe zone is ${safeRadius}px. Lower the scale.`);
console.log(`maskable safe zone: logo reaches ${reach.toFixed(1)}px of ${safeRadius}px allowed`);

const files = [
  ['icon-192.png', render(192, 0.9)],
  ['icon-512.png', render(512, 0.9)],
  ['icon-maskable-512.png', maskable],
  ['apple-touch-icon-180.png', render(180, 0.8, '#ffffff')],
  ['favicon-32.png', render(32, 1)],
  ['favicon-16.png', render(16, 1)],
];
for (const [name, image] of files) {
  const png = image.asPng();
  fs.writeFileSync(path.join(out, name), png);
  console.log(`${name.padEnd(28)} ${png.length} bytes`);
}
