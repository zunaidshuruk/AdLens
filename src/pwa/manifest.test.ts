import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PUBLIC = path.resolve('public');
const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf8')) as Record<string, any>;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** PNG width and height straight from the file header (no image library needed). */
function pngSize(file: string): { width: number; height: number } {
  const b = fs.readFileSync(file);
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} is not a PNG`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
const onDisk = (src: string) => path.join(PUBLIC, src.replace(/^\//, ''));

test('manifest has everything Chrome and Windows need to offer installation', () => {
  for (const key of ['id', 'name', 'short_name', 'start_url', 'scope', 'display', 'icons', 'background_color', 'theme_color']) assert.ok(key in manifest, `missing ${key}`);
  assert.ok(manifest.short_name.length <= 12, 'short_name must fit under the icon (12 characters)');
  assert.ok(manifest.name.length <= 45);
  assert.equal(manifest.display, 'standalone');
  assert.match(manifest.background_color, HEX);
  assert.match(manifest.theme_color, HEX);
  assert.equal(manifest.id, '/'); // a stable identity so updates stay the same app
  assert.equal(manifest.scope, '/');
  assert.ok(new URL(manifest.start_url, 'https://app.example').pathname.startsWith(manifest.scope));
  assert.ok(!/^https?:/.test(manifest.start_url), 'start_url must be relative so the app works on any domain');
});

test('icons exist, are real PNGs, and match the sizes they declare', () => {
  for (const icon of manifest.icons) {
    assert.equal(icon.type, 'image/png');
    assert.ok(fs.existsSync(onDisk(icon.src)), `${icon.src} is missing`);
    const [w, h] = icon.sizes.split('x').map(Number);
    assert.deepEqual(pngSize(onDisk(icon.src)), { width: w, height: h }, `${icon.src} is not ${icon.sizes}`);
  }
  const any = manifest.icons.filter((i: any) => i.purpose === 'any');
  const maskable = manifest.icons.filter((i: any) => i.purpose === 'maskable');
  assert.ok(any.some((i: any) => i.sizes === '192x192') && any.some((i: any) => i.sizes === '512x512'));
  assert.ok(maskable.some((i: any) => i.sizes === '512x512'));
  // never mark one image as both: a maskable crop of a full logo would cut it off
  assert.ok(manifest.icons.every((i: any) => !/any.*maskable|maskable.*any/.test(i.purpose)));
  assert.ok(maskable.every((m: any) => !any.some((a: any) => a.src === m.src)));
});

test('the extra icons the page links to exist at the right size', () => {
  assert.deepEqual(pngSize(path.join(PUBLIC, 'icons/apple-touch-icon-180.png')), { width: 180, height: 180 });
  assert.deepEqual(pngSize(path.join(PUBLIC, 'icons/favicon-32.png')), { width: 32, height: 32 });
  assert.deepEqual(pngSize(path.join(PUBLIC, 'icons/favicon-16.png')), { width: 16, height: 16 });
  assert.ok(fs.existsSync(path.join(PUBLIC, 'logo.svg')));
});

test('shortcuts stay inside the app and point at pages that exist', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const routes = new Set([...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(routes.has('/') && routes.has('/ai-analyst'));
  assert.ok(manifest.shortcuts.length >= 1 && manifest.shortcuts.length <= 4, 'Windows shows at most a few shortcuts');
  for (const s of manifest.shortcuts) {
    const u = new URL(s.url, 'https://app.example');
    assert.ok(u.pathname.startsWith(manifest.scope), `${s.name} leaves the app scope`);
    assert.ok(routes.has(u.pathname), `${s.name} points at ${u.pathname}, which is not a route`);
    assert.ok(s.name.length <= 30 && (s.short_name ?? s.name).length <= 12 + 4);
    for (const i of s.icons ?? []) assert.ok(fs.existsSync(onDisk(i.src)), `${s.name} icon ${i.src} is missing`);
  }
  assert.equal(new Set(manifest.shortcuts.map((s: any) => s.url)).size, manifest.shortcuts.length);
});

test('the offline page works with no network: no external files, no scripts from elsewhere, no user data', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'offline.html'), 'utf8');
  assert.ok(!/(src|href)=["']https?:/i.test(html), 'must not load anything from the network');
  assert.ok(!/<script[^>]+src=/i.test(html));
  assert.ok(!/<link[^>]+rel=["']stylesheet/i.test(html));
  assert.match(html, /<title>[^<]*offline/i);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /safe-area-inset/);
  assert.match(html, /location\.reload\(\)/);
});

test('page wiring (activates itself once PWA-1 adds the tags to index.html)', { skip: !/rel="manifest"/.test(fs.readFileSync('index.html', 'utf8')) }, () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /<link[^>]+rel="manifest"[^>]+href="\/manifest\.webmanifest"/);
  assert.match(html, /<link[^>]+rel="apple-touch-icon"[^>]+href="\/icons\/apple-touch-icon-180\.png"/);
  assert.match(html, /<meta[^>]+name="theme-color"/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /<meta[^>]+name="apple-mobile-web-app-capable"[^>]+content="yes"/);
  assert.match(html, /<meta[^>]+name="apple-mobile-web-app-title"[^>]+content="AdLens"/);
  for (const href of [...html.matchAll(/<link[^>]+rel="(?:icon|apple-touch-icon)"[^>]+href="([^"]+)"/g)].map((m) => m[1])) {
    assert.ok(fs.existsSync(path.join(PUBLIC, href.replace(/^\//, ''))), `index.html links ${href}, which does not exist`);
  }
});
