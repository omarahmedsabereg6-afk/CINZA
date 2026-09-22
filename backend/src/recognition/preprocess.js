/**
 * Upload validation and normalisation.
 *
 * Security posture (section 28 + 40):
 *  - Trust NOTHING from the client: every declared MIME type is re-derived from the
 *    file's magic bytes. A `.jpg` that is really a script is rejected here.
 *  - Dimensions are read from the header, so a decompression-bomb sized image is
 *    rejected without ever being decoded.
 *  - Uploaded bytes are held in memory for the duration of one request and are
 *    NEVER written to disk. Only the small client-generated preview thumbnail and
 *    non-reversible perceptual hashes are persisted, and both are deleted with the
 *    recognition.
 *  - Client-supplied hashes are treated as ADVISORY (they help scene matching and
 *    dedupe, they are not a security boundary), so they are format-validated and
 *    truncated rather than trusted.
 */
import config from '../config/env.js';
import HttpError, { ErrorCode } from '../utils/httpError.js';
import { probeImage, sniffMime, isImageMime, isVideoMime } from '../utils/imageProbe.js';
import { inputHash } from '../utils/ids.js';
import { ImageKind, RecognitionMode } from '../database/constants.js';

const HEX64 = /^[0-9a-f]{16}$/i;
const DATA_URL_MAX_BYTES = 240 * 1024;

/** Normalises multer's file objects into one list. */
export function collectFiles(req) {
  const files = [];
  if (Array.isArray(req.files)) {
    const grouped = req.files;
    for (const file of grouped) files.push(file);
  } else if (req.files && typeof req.files === 'object') {
    for (const list of Object.values(req.files)) {
      if (Array.isArray(list)) files.push(...list);
    }
  }
  if (req.file) files.push(req.file);
  return files.filter(Boolean);
}

function assertImageWithinLimits({ buffer, declaredMime, label }) {
  const { maxImageBytes, maxImageDimension, minImageDimension, allowedImageTypes } = config.uploads;

  if (buffer.length > maxImageBytes) {
    throw HttpError.badRequest(
      ErrorCode.IMAGE_TOO_LARGE,
      `${label} is ${Math.round(buffer.length / 1024 / 1024)}MB; the limit is ${Math.round(maxImageBytes / 1024 / 1024)}MB.`
    );
  }
  if (buffer.length < 512) {
    throw HttpError.badRequest(ErrorCode.IMAGE_CORRUPT, `${label} is too small to be an image.`);
  }

  const probed = probeImage(buffer);
  if (!probed.ok) {
    throw HttpError.badRequest(
      ErrorCode.IMAGE_TYPE_UNSUPPORTED,
      `${label} is not a supported image. Detected: ${probed.mime ?? 'unknown'}; declared: ${declaredMime ?? 'none'}.`
    );
  }

  // The bytes must agree with what the client claimed, and both must be allow-listed.
  if (!allowedImageTypes.includes(probed.mime)) {
    throw HttpError.badRequest(
      ErrorCode.IMAGE_TYPE_UNSUPPORTED,
      `${probed.mime} is not accepted. Allowed: ${allowedImageTypes.join(', ')}.`
    );
  }

  if (probed.width && probed.height) {
    const longest = Math.max(probed.width, probed.height);
    const shortest = Math.min(probed.width, probed.height);
    if (longest > maxImageDimension) {
      throw HttpError.badRequest(
        ErrorCode.IMAGE_TOO_LARGE,
        `${label} is ${probed.width}×${probed.height}; the maximum edge is ${maxImageDimension}px.`
      );
    }
    if (shortest < minImageDimension) {
      throw HttpError.badRequest(
        ErrorCode.IMAGE_TOO_SMALL,
        `${label} is ${probed.width}×${probed.height}; the minimum edge is ${minImageDimension}px.`
      );
    }
  }

  return probed;
}

/** Validates the client's preview thumbnail: must be a small inline image data URL. */
export function sanitiseThumbDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('data:image/')) return null;
  if (value.length > DATA_URL_MAX_BYTES * 4) return null;
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return null;
  return value;
}

const sanitiseHash = (value) => (typeof value === 'string' && HEX64.test(value) ? value.toLowerCase() : null);

/** Pulls the per-file metadata block the app sends alongside the multipart body. */
export function parseClientMeta(raw) {
  if (!raw) return { files: [], describe: '', hint: '', mode: null, region: null, source: null, video: null };
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    throw HttpError.badRequest(ErrorCode.VALIDATION_FAILED, 'The `meta` field must be valid JSON.');
  }
}

/**
 * Validates every uploaded image and pairs it with the client metadata.
 *
 * @returns {{images: Array<object>, mode: string, inputHashValue: string}}
 */
export function validateImages({ files, clientMeta, mode = RecognitionMode.IMAGE }) {
  if (files.length === 0) {
    throw HttpError.badRequest(ErrorCode.NO_INPUT, 'No image was uploaded.');
  }

  const metaByIndex = Array.isArray(clientMeta?.files) ? clientMeta.files : [];
  const maxFrames = mode === RecognitionMode.VIDEO ? config.uploads.maxVideoFrames + 2 : 4;
  if (files.length > maxFrames) {
    throw HttpError.badRequest(
      ErrorCode.VALIDATION_FAILED,
      `Too many images: ${files.length}. The limit for ${mode} is ${maxFrames}.`
    );
  }

  const images = files.map((file, index) => {
    const meta = metaByIndex[index] ?? {};
    const label = mode === RecognitionMode.VIDEO ? `Frame ${index + 1}` : 'Image';
    const detectedMime = sniffMime(file.buffer);

    if (!file.buffer || file.buffer.length === 0) {
      throw HttpError.badRequest(ErrorCode.IMAGE_CORRUPT, `${label} is empty.`);
    }

    if (!isImageMime(detectedMime)) {
      throw HttpError.badRequest(
        ErrorCode.IMAGE_TYPE_UNSUPPORTED,
        `${label} is not an image (detected ${detectedMime ?? 'unknown'}).`
      );
    }

    const probed = assertImageWithinLimits({
      buffer: file.buffer,
      declaredMime: file.mimetype,
      label,
    });

    const isFrame = mode === RecognitionMode.VIDEO && index > 0;
    const kind = mode === RecognitionMode.VIDEO ? (isFrame ? ImageKind.FRAME : ImageKind.PRIMARY) : ImageKind.PRIMARY;

    return {
      kind,
      sortOrder: index,
      buffer: file.buffer,
      mimeType: probed.mime,
      sizeBytes: file.buffer.length,
      width: probed.width,
      height: probed.height,
      // Advisory, client-computed fingerprints.
      pHash: sanitiseHash(meta.pHash),
      dHash: sanitiseHash(meta.dHash),
      aHash: sanitiseHash(meta.aHash),
      thumbDataUrl: sanitiseThumbDataUrl(meta.thumbDataUrl),
      frameTimeMs: Number.isFinite(Number(meta.frameTimeMs)) ? Math.max(0, Math.round(Number(meta.frameTimeMs))) : null,
      originalName: typeof file.originalname === 'string' ? file.originalname.slice(0, 120) : null,
    };
  });

  const primary = images[0];
  const inputHashValue = inputHash({
    buffer: primary.buffer,
    mode,
    extra: images.length > 1 ? images.map((i) => `${i.frameTimeMs ?? ''}`).join(',') : '',
  });

  return { images, mode, inputHashValue };
}

/** Validates an uploaded video container. Frames are extracted elsewhere. */
export function validateVideo(file) {
  if (!file) throw HttpError.badRequest(ErrorCode.NO_INPUT, 'No video was uploaded.');
  const { maxVideoBytes, maxVideoDurationSeconds } = config.uploads;

  if (file.buffer.length > maxVideoBytes) {
    throw HttpError.badRequest(
      ErrorCode.VIDEO_TOO_LARGE,
      `That video is ${Math.round(file.buffer.length / 1024 / 1024)}MB; the limit is ${Math.round(maxVideoBytes / 1024 / 1024)}MB.`
    );
  }
  const mime = sniffMime(file.buffer);
  if (!isVideoMime(mime)) {
    throw HttpError.badRequest(
      ErrorCode.VIDEO_TYPE_UNSUPPORTED,
      `Unsupported video container (detected ${mime ?? 'unknown'}).`
    );
  }
  return {
    buffer: file.buffer,
    mimeType: mime,
    sizeBytes: file.buffer.length,
    maxDurationSeconds: maxVideoDurationSeconds,
  };
}

export default { collectFiles, validateImages, validateVideo, sanitiseThumbDataUrl, parseClientMeta };
