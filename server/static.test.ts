import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { configureStatic } from './app.js';

describe('configureStatic (PWA static serving)', () => {
  let tmpDist: string;
  let server: Server;
  let baseUrl: string;

  before(async () => {
    tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), 'adlens-dist-'));
    fs.mkdirSync(path.join(tmpDist, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(tmpDist, 'icons'), { recursive: true });

    fs.writeFileSync(path.join(tmpDist, 'index.html'), '<!doctype html><title>AdLens SPA</title>');
    fs.writeFileSync(path.join(tmpDist, 'offline.html'), '<!doctype html><title>Offline</title>');
    fs.writeFileSync(path.join(tmpDist, 'sw.js'), '// sw');
    fs.writeFileSync(path.join(tmpDist, 'version.json'), '{"version":"1.0.0"}');
    fs.writeFileSync(path.join(tmpDist, 'manifest.webmanifest'), '{"name":"AdLens"}');
    fs.writeFileSync(path.join(tmpDist, 'assets', 'main-abc123.js'), 'console.log(1);');
    fs.writeFileSync(path.join(tmpDist, 'icons', 'icon-192.png'), 'PNG');

    const testApp = express();
    configureStatic(testApp, tmpDist);

    await new Promise<void>((resolve) => {
      server = testApp.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpDist, { recursive: true, force: true });
  });

  it('serves /assets/* with immutable 1-year Cache-Control', async () => {
    const res = await fetch(`${baseUrl}/assets/main-abc123.js`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  });

  it('serves /icons/* with 1-day Cache-Control', async () => {
    const res = await fetch(`${baseUrl}/icons/icon-192.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=86400');
  });

  it('serves /sw.js, /version.json, /manifest.webmanifest, /offline.html, and /index.html with no-cache', async () => {
    for (const p of ['/sw.js', '/version.json', '/manifest.webmanifest', '/offline.html', '/index.html', '/']) {
      const res = await fetch(`${baseUrl}${p}`);
      assert.equal(res.status, 200, `expected 200 for ${p}`);
      assert.equal(res.headers.get('cache-control'), 'no-cache', `expected no-cache for ${p}`);
    }
  });

  it('returns 404 (not index.html) for missing files under /assets or non-.html extensions', async () => {
    for (const p of ['/assets/missing.js', '/assets/missing', '/assets/missing.html', '/icons/missing.png', '/missing.js', '/robots.txt']) {
      const res = await fetch(`${baseUrl}${p}`);
      assert.equal(res.status, 404, `expected 404 for ${p}`);
      const body = await res.text();
      assert.ok(!body.includes('AdLens SPA'), `expected non-SPA body for ${p}`);
    }
  });

  it('returns index.html with no-cache for unknown app routes such as /ga4', async () => {
    const res = await fetch(`${baseUrl}/ga4`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    const body = await res.text();
    assert.ok(body.includes('AdLens SPA'));
  });
});
