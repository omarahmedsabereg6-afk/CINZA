/**
 * On-device image processing (sections 9, 10, 26, 41).
 *
 * Everything expensive happens HERE, on the phone, before anything is uploaded:
 *
 *   1. VALIDATE   — type and size are checked against the server's published limits
 *   2. DECODE     — via createImageBitmap (native decoder, off the main thread)
 *   3. COMPRESS   — downscale to a bounded edge and re-encode as JPEG/WebP
 *   4. FINGERPRINT— compute aHash / dHash / pHash from the actual pixels
 *   5. THUMBNAIL  — produce the small preview that is the only thing ever stored
 *
 * Why this matters:
 *   - an 8 MB phone photo becomes ~250 KB, which is the single biggest lever on
 *     upload time, memory and AI vision cost
 *   - perceptual hashes can only be computed where the pixels are. The server
 *     deliberately has no image decoder (see backend utils/imageProbe.js), so the
 *     device is the only place that can do it. Those hashes are what the
 *     SceneMatcher indexes (section 31).
 *
 * Longest edge is capped by the server's advertised limit and re-capped for AI to
 * keep vision-token cost predictable.
 */
import { uploadLimits } from './capabilities.js';
import { AppError, Failure } from '../core/errors.js';
import { getUploadQuality } from './settings.js';

/** Target longest edge for the image we upload for recognition. */
const RECOGNITION_MAX_EDGE = 1600;
/** Target longest edge for the stored preview thumbnail. */
const THUMB_MAX_EDGE = 240;

const QUALITY = { primary: 0.86, thumb: 0.7 };

/* ------------------------------------------------------------------ *
 * Decoding
 * ------------------------------------------------------------------ */

async function decode(source) {
  // createImageBitmap gives us a GPU-friendly, already-oriented bitmap.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(source, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to the <img> path */
    }
  }

  const url = source instanceof Blob ? URL.createObjectURL(source) : source;
  try {
    const img = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new AppError(Failure.VALIDATION, { message: 'That image could not be read.' }));
      element.src = url;
    });
    return img;
  } finally {
    if (source instanceof Blob) URL.revokeObjectURL(url);
  }
}

function fitInside(width, height, maxEdge) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height, scale: 1 };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

function drawToCanvas(bitmap, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { canvas, ctx };
}

async function canvasToBlob(canvas, mimeType, quality) {
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
    if (blob && blob.size > 0) return blob;
  }
  // Fallback for very old webviews: data URL -> Blob.
  const dataUrl = canvas.toDataURL(mimeType, quality);
  const [meta, base64] = dataUrl.split(',');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: meta.match(/:(.*?);/)?.[1] ?? mimeType });
}

/** WebP is ~30% smaller than JPEG at the same quality, where supported. */
let preferredMime = null;
function pickMime() {
  if (preferredMime) return preferredMime;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  preferredMime = canvas.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg';
  return preferredMime;
}

/* ------------------------------------------------------------------ *
 * Perceptual hashes (section 31)
 *
 * These are 64-bit hex strings computed from a greyscale downscale:
 *   aHash  average hash        — robust to brightness/contrast shifts
 *   dHash  difference hash     — robust to exposure, good at gradients
 *   pHash  DCT hash            — most robust to scaling and JPEG noise
 *
 * All three are sent and combined server-side (see recognition/sceneMatcher), which
 * is far more reliable than any one alone.
 * ------------------------------------------------------------------ */

function toGreyscale(bitmap, width, height) {
  const { ctx } = drawToCanvas(bitmap, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const grey = new Float64Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    // Rec. 601 luma
    grey[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return grey;
}

const toHex64 = (bits) => {
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    const nibble = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
    hex += nibble.toString(16);
  }
  return hex;
};

function averageHash(bitmap) {
  const size = 8;
  const grey = toGreyscale(bitmap, size, size);
  let sum = 0;
  for (const value of grey) sum += value;
  const mean = sum / grey.length;
  const bits = new Uint8Array(64);
  for (let i = 0; i < 64; i += 1) bits[i] = grey[i] > mean ? 1 : 0;
  return toHex64(bits);
}

function differenceHash(bitmap) {
  const width = 9;
  const height = 8;
  const grey = toGreyscale(bitmap, width, height);
  const bits = new Uint8Array(64);
  let index = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      bits[index++] = grey[y * width + x] > grey[y * width + x + 1] ? 1 : 0;
    }
  }
  return toHex64(bits);
}

/** 2D DCT-II on a 32x32 greyscale image, then the top-left 8x8 low frequencies. */
function perceptualHash(bitmap) {
  const size = 32;
  const grey = toGreyscale(bitmap, size, size);
  const cos = new Float64Array(size * size);
  for (let u = 0; u < size; u += 1) {
    for (let x = 0; x < size; x += 1) {
      cos[u * size + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size));
    }
  }

  const coefficients = new Float64Array(64);
  for (let v = 0; v < 8; v += 1) {
    for (let u = 0; u < 8; u += 1) {
      let sum = 0;
      for (let y = 0; y < size; y += 1) {
        const rowFactor = cos[v * size + y];
        for (let x = 0; x < size; x += 1) {
          sum += grey[y * size + x] * cos[u * size + x] * rowFactor;
        }
      }
      coefficients[v * 8 + u] = sum;
    }
  }

  // The DC term carries overall brightness, so it is excluded from the median.
  const ac = Array.from(coefficients.slice(1));
  const sorted = [...ac].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  const bits = new Uint8Array(64);
  bits[0] = 0;
  for (let i = 1; i < 64; i += 1) bits[i] = coefficients[i] > median ? 1 : 0;
  return toHex64(bits);
}

export function computeHashes(bitmap) {
  try {
    return {
      aHash: averageHash(bitmap),
      dHash: differenceHash(bitmap),
      pHash: perceptualHash(bitmap),
    };
  } catch (error) {
    console.warn('[image] hashing failed', error);
    return { aHash: null, dHash: null, pHash: null };
  }
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export function validate(file) {
  const limits = uploadLimits();
  const allowed = limits.allowedImageTypes ?? ['image/jpeg', 'image/png', 'image/webp'];
  // iOS hands us HEIC. We accept it locally (the canvas re-encodes to JPEG) even
  // when the server would reject the raw bytes, so iPhone photos just work.
  const heic = ['image/heic', 'image/heif'];
  const type = (file.type || '').toLowerCase();

  if (!allowed.includes(type) && !heic.includes(type)) {
    throw new AppError(Failure.VALIDATION, {
      message: `${type || 'That file type'} is not supported. Use JPG, PNG or WEBP.`,
    });
  }

  if (file.size > limits.maxImageBytes) {
    throw new AppError(Failure.VALIDATION, {
      message: `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${Math.round(
        limits.maxImageBytes / 1024 / 1024
      )} MB.`,
    });
  }

  if (file.size < 512) {
    throw new AppError(Failure.VALIDATION, { message: 'That image is too small to analyse.' });
  }
}

/* ------------------------------------------------------------------ *
 * Main pipeline
 * ------------------------------------------------------------------ */

/**
 * Prepares an image for upload.
 *
 * @param {Blob|File} file
 * @param {object} [options]
 * @param {string} [options.name]
 * @returns {Promise<{
 *   blob: Blob, file: File, mimeType: string, width: number, height: number,
 *   originalWidth: number, originalHeight: number, originalBytes: number,
 *   sizeBytes: number, hashes: {aHash:string|null,dHash:string|null,pHash:string|null},
 *   thumbDataUrl: string, previewUrl: string, resized: boolean, compressedRatio: number
 * }>}
 */
export async function prepareImage(file, { name = 'scene.jpg' } = {}) {
  validate(file);

  const limits = uploadLimits();
  const bitmap = await decode(file);
  const originalWidth = bitmap.width ?? bitmap.naturalWidth;
  const originalHeight = bitmap.height ?? bitmap.naturalHeight;

  if (!originalWidth || !originalHeight) {
    throw new AppError(Failure.VALIDATION, { message: 'That image has no readable dimensions.' });
  }

  const shortestEdge = Math.min(originalWidth, originalHeight);
  if (shortestEdge < (limits.minImageDimension ?? 120)) {
    throw new AppError(Failure.VALIDATION, {
      message: `That image is ${originalWidth}×${originalHeight}. The shortest edge must be at least ${
        limits.minImageDimension ?? 120
      } px.`,
    });
  }

  // ---- 1. recognition-sized copy ----
  const qualitySetting = getUploadQuality?.() ?? 'balanced';
  const edgeLimit = qualitySetting === 'high' ? 1600 : qualitySetting === 'saver' ? 960 : 1280;
  const primaryQuality = qualitySetting === 'high' ? 0.90 : qualitySetting === 'saver' ? 0.75 : 0.85;

  const target = fitInside(originalWidth, originalHeight, Math.min(edgeLimit, limits.maxImageDimension ?? 6000));
  const { canvas } = drawToCanvas(bitmap, target.width, target.height);
  const mime = pickMime();
  const blob = await canvasToBlob(canvas, mime, primaryQuality);

  // ---- 2. perceptual hashes (from the resized pixels, which is what the index holds) ----
  const hashes = computeHashes(bitmap);

  // ---- 3. stored preview thumbnail ----
  const thumbTarget = fitInside(originalWidth, originalHeight, THUMB_MAX_EDGE);
  const { canvas: thumbCanvas } = drawToCanvas(bitmap, thumbTarget.width, thumbTarget.height);
  const thumbDataUrl = thumbCanvas.toDataURL('image/jpeg', QUALITY.thumb);

  // Free the decoded bitmap promptly — phone photos are large.
  bitmap.close?.();

  const extension = mime === 'image/webp' ? 'webp' : 'jpg';
  const uploadFile = new File([blob], `${name.replace(/\.[^.]+$/, '')}.${extension}`, { type: mime });

  return {
    blob,
    file: uploadFile,
    mimeType: mime,
    width: target.width,
    height: target.height,
    originalWidth,
    originalHeight,
    originalBytes: file.size,
    sizeBytes: blob.size,
    hashes,
    thumbDataUrl,
    previewUrl: URL.createObjectURL(blob),
    resized: target.scale < 1,
    compressionRatio: file.size > 0 ? Number((1 - blob.size / file.size).toFixed(3)) : 0,
  };
}

/** Cheap dimension probe without keeping the decoded bitmap alive. */
export async function probe(file) {
  const bitmap = await decode(file);
  const result = {
    width: bitmap.width ?? bitmap.naturalWidth,
    height: bitmap.height ?? bitmap.naturalHeight,
  };
  bitmap.close?.();
  return result;
}

export const imageLimits = { RECOGNITION_MAX_EDGE, THUMB_MAX_EDGE };

export default { prepareImage, computeHashes, validate, probe, imageLimits };
