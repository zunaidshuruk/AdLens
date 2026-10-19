import test from 'node:test';
import assert from 'node:assert/strict';
import { centerSquareCrop, checkInputFile, dataUrlBytes, fitWithin, validateAsset } from './imageAssets.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('fitWithin keeps aspect, never upscales, rounds, enforces minimum', () => {
  assert.deepEqual(fitWithin(1024, 512, 512), { width: 512, height: 256 });
  assert.deepEqual(fitWithin(100, 80, 256), { width: 100, height: 80 });
  assert.deepEqual(fitWithin(3000, 10, 512), { width: 512, height: 16 });
  assert.throws(() => fitWithin(0, 10, 256), /IMAGE_INVALID_DIMENSIONS/);
});

test('centerSquareCrop takes the centred square', () => {
  assert.deepEqual(centerSquareCrop(400, 300), { sx: 50, sy: 0, size: 300 });
  assert.deepEqual(centerSquareCrop(300, 401), { sx: 0, sy: 50, size: 300 });
});

test('validateAsset mirrors the Firestore rule', () => {
  const ok = { dataUrl: PNG, mimeType: 'image/png' as const, width: 256, height: 256 };
  assert.equal(validateAsset(ok, 'avatar'), null);
  assert.equal(validateAsset({ ...ok, mimeType: 'image/jpeg' }, 'avatar'), 'IMAGE_MIME_MISMATCH');
  assert.equal(validateAsset({ ...ok, dataUrl: 'https://evil.example/x.png' }, 'avatar'), 'IMAGE_BAD_DATA_URL');
  assert.equal(validateAsset({ ...ok, dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }, 'avatar'), 'IMAGE_BAD_DATA_URL');
  const big = 'data:image/png;base64,' + 'A'.repeat(150000);
  assert.equal(validateAsset({ ...ok, dataUrl: big }, 'avatar'), 'IMAGE_TOO_LARGE');
  assert.equal(validateAsset({ ...ok, dataUrl: big }, 'logo'), null);
  assert.equal(validateAsset({ ...ok, width: 256.5 }, 'avatar'), 'IMAGE_BAD_DIMENSIONS');
  assert.equal(validateAsset({ ...ok, height: 2000 }, 'logo'), 'IMAGE_BAD_DIMENSIONS');
});

test('dataUrlBytes and input checks', () => {
  assert.equal(dataUrlBytes('data:image/png;base64,AAAA'), 3);
  assert.equal(dataUrlBytes('data:image/png;base64,AAA='), 2);
  assert.equal(checkInputFile({ type: 'image/jpeg', size: 2_000_000 }), null);
  assert.equal(checkInputFile({ type: 'image/svg+xml', size: 1000 }), 'IMAGE_UNSUPPORTED_TYPE');
  assert.equal(checkInputFile({ type: 'image/png', size: 11 * 1024 * 1024 }), 'IMAGE_INPUT_TOO_LARGE');
});
