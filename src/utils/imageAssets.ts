/**
 * Profile pictures and workspace logos are stored in Firestore as small base64 data URLs
 * (no Cloud Storage). This module shrinks an uploaded image in the browser until it fits the
 * limits enforced by firebase/firestore.rules:
 *   - avatar: square, max 256 px, data URL ≤ 100,000 characters
 *   - logo:   keeps aspect ratio, max 512 px on the longest side, data URL ≤ 200,000 characters
 *   - mime:   image/webp, image/jpeg or image/png; width/height 16–1024 px (integers)
 *
 * Pure helpers are exported for tests; prepareImageAsset() needs a browser (canvas).
 */

export type ImageAssetKind = 'avatar' | 'logo';
export type AssetMime = 'image/webp' | 'image/jpeg' | 'image/png';

export interface ImageAsset {
  dataUrl: string;
  mimeType: AssetMime;
  width: number;
  height: number;
}

export interface AssetLimits {
  maxSide: number;
  maxChars: number;
  square: boolean;
  /** Encoders to try in order; the first that the browser supports and that fits wins. */
  mimeOrder: AssetMime[];
}

export const ASSET_LIMITS: Record<ImageAssetKind, AssetLimits> = {
  // Avatars have no transparency needs, so JPEG is a good fallback when WebP isn't available.
  avatar: { maxSide: 256, maxChars: 100_000, square: true, mimeOrder: ['image/webp', 'image/jpeg'] },
  // Logos often need transparency, so fall back to PNG rather than JPEG.
  logo: { maxSide: 512, maxChars: 200_000, square: false, mimeOrder: ['image/webp', 'image/png'] },
};

export const ACCEPTED_INPUT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const MAX_INPUT_BYTES = 10 * 1024 * 1024; // 10 MB before resizing

const MIN_SIDE = 16;
const QUALITY_STEPS = [0.9, 0.8, 0.7, 0.6, 0.5];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Scale (w, h) to fit inside maxSide, never upscaling, keeping aspect ratio, integers ≥ 16. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) throw new Error('IMAGE_INVALID_DIMENSIONS');
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(MIN_SIDE, Math.round(width * scale)),
    height: Math.max(MIN_SIDE, Math.round(height * scale)),
  };
}

/** Centre square crop rectangle for avatars. */
export function centerSquareCrop(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height);
  return { sx: Math.floor((width - size) / 2), sy: Math.floor((height - size) / 2), size };
}

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/** Mirrors the Firestore rule: returns null if valid, otherwise a reason code. */
export function validateAsset(asset: ImageAsset, kind: ImageAssetKind): string | null {
  const limits = ASSET_LIMITS[kind];
  const m = DATA_URL_RE.exec(asset.dataUrl);
  if (!m) return 'IMAGE_BAD_DATA_URL';
  if (m[1] !== asset.mimeType) return 'IMAGE_MIME_MISMATCH';
  if (asset.dataUrl.length > limits.maxChars) return 'IMAGE_TOO_LARGE';
  for (const side of [asset.width, asset.height]) {
    if (!Number.isInteger(side) || side < MIN_SIDE || side > 1024) return 'IMAGE_BAD_DIMENSIONS';
  }
  return null;
}

/** Bytes of the decoded image represented by a base64 data URL. */
export function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.split(',')[1] ?? '';
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** Check the picked file before decoding it. Returns null if OK, otherwise a reason code. */
export function checkInputFile(file: { type: string; size: number }): string | null {
  if (!ACCEPTED_INPUT_TYPES.includes(file.type)) return 'IMAGE_UNSUPPORTED_TYPE';
  if (file.size > MAX_INPUT_BYTES) return 'IMAGE_INPUT_TOO_LARGE';
  return null;
}

export const IMAGE_ERROR_MESSAGES: Record<string, string> = {
  IMAGE_UNSUPPORTED_TYPE: 'Please choose a JPEG, PNG, WebP or GIF image.',
  IMAGE_INPUT_TOO_LARGE: 'That image is larger than 10 MB. Please choose a smaller one.',
  IMAGE_INVALID_DIMENSIONS: 'That file could not be read as an image.',
  IMAGE_DECODE_FAILED: 'That file could not be read as an image.',
  IMAGE_COULD_NOT_COMPRESS: 'That image could not be made small enough. Try a simpler image.',
  IMAGE_BAD_DATA_URL: 'The processed image was invalid. Please try another image.',
  IMAGE_MIME_MISMATCH: 'The processed image was invalid. Please try another image.',
  IMAGE_TOO_LARGE: 'The processed image is too large. Try a simpler image.',
  IMAGE_BAD_DIMENSIONS: 'The processed image has invalid dimensions.',
};

// ---------------------------------------------------------------------------
// Browser-only: decode, resize, compress
// ---------------------------------------------------------------------------

interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasRenderingContext2D | null;
  toDataURL(type?: string, quality?: number): string;
}

function makeCanvas(width: number, height: number): CanvasLike {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

/**
 * Resize and compress an image File into a Firestore-safe data URL.
 * Tries each mime in order, lowering quality and then size until it fits the limit.
 * Throws an Error whose message is a key of IMAGE_ERROR_MESSAGES.
 */
export async function prepareImageAsset(file: File, kind: ImageAssetKind): Promise<ImageAsset> {
  const inputError = checkInputFile(file);
  if (inputError) throw new Error(inputError);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('IMAGE_DECODE_FAILED');
  }

  const limits = ASSET_LIMITS[kind];
  try {
    const crop = limits.square
      ? centerSquareCrop(bitmap.width, bitmap.height)
      : { sx: 0, sy: 0, size: 0 };
    const srcW = limits.square ? crop.size : bitmap.width;
    const srcH = limits.square ? crop.size : bitmap.height;

    let target = fitWithin(srcW, srcH, limits.maxSide);
    for (let shrink = 0; shrink < 6; shrink++) {
      const canvas = makeCanvas(target.width, target.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('IMAGE_DECODE_FAILED');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (limits.square) {
        ctx.drawImage(bitmap, crop.sx, crop.sy, crop.size, crop.size, 0, 0, target.width, target.height);
      } else {
        ctx.drawImage(bitmap, 0, 0, target.width, target.height);
      }

      for (const mime of limits.mimeOrder) {
        const qualities = mime === 'image/png' ? [undefined] : QUALITY_STEPS;
        for (const q of qualities) {
          const dataUrl = canvas.toDataURL(mime, q);
          // Browsers silently fall back to PNG when they can't encode the requested type.
          if (!dataUrl.startsWith(`data:${mime};`)) break;
          const asset: ImageAsset = { dataUrl, mimeType: mime, width: target.width, height: target.height };
          if (validateAsset(asset, kind) === null) return asset;
        }
      }
      // Still too big at the lowest quality: shrink dimensions by 20% and retry.
      target = fitWithin(target.width, target.height, Math.max(MIN_SIDE, Math.floor(Math.max(target.width, target.height) * 0.8)));
    }
    throw new Error('IMAGE_COULD_NOT_COMPRESS');
  } finally {
    bitmap.close();
  }
}
