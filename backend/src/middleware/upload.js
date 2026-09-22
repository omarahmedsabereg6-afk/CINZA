/**
 * Multipart upload handling (sections 9, 28, 40).
 *
 * - memoryStorage: uploaded bytes live only for the lifetime of the request and are
 *   never written to disk. That is the simplest way to satisfy "do not permanently
 *   store uploaded images" (section 40) — there is nothing to clean up.
 * - Hard byte caps are enforced by multer BEFORE the body is buffered into memory,
 *   so an oversized upload cannot exhaust the heap.
 * - Field names and file counts are constrained per route.
 * - Content types are NOT trusted here; preprocess.js re-derives them from magic
 *   bytes. Multer's filter is only a cheap first gate.
 */
import multer from 'multer';
import config from '../config/env.js';
import HttpError, { ErrorCode } from '../utils/httpError.js';

const imageFilter = (_req, file, cb) => {
  const declared = String(file.mimetype || '').toLowerCase();
  // HEIC is accepted at the gate so we can return a helpful "unsupported" message
  // with the real detected type rather than a generic filter error.
  const acceptable = [...config.uploads.allowedImageTypes, 'image/heic', 'image/heif'];
  if (acceptable.includes(declared)) return cb(null, true);
  cb(
    HttpError.badRequest(
      ErrorCode.IMAGE_TYPE_UNSUPPORTED,
      `${declared || 'unknown'} is not an accepted upload type. Allowed: ${config.uploads.allowedImageTypes.join(', ')}.`
    )
  );
};

const videoFilter = (_req, file, cb) => {
  const declared = String(file.mimetype || '').toLowerCase();
  if (declared.startsWith('video/')) return cb(null, true);
  cb(HttpError.badRequest(ErrorCode.VIDEO_TYPE_UNSUPPORTED, `${declared || 'unknown'} is not a video.`));
};

/** Images + optional video + optional describe text. */
export const recognitionUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Math.max(config.uploads.maxImageBytes, config.uploads.maxVideoBytes),
    files: config.uploads.maxVideoFrames + 4,
    fields: 12,
    fieldNameSize: 64,
    fieldSize: 64 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'video') return videoFilter(req, file, cb);
    if (file.fieldname === 'images' || file.fieldname === 'image' || file.fieldname === 'frame') {
      return imageFilter(req, file, cb);
    }
    cb(HttpError.badRequest(ErrorCode.VALIDATION_FAILED, `Unexpected upload field "${file.fieldname}".`));
  },
}).fields([
  { name: 'image', maxCount: 1 },
  { name: 'images', maxCount: config.uploads.maxVideoFrames + 2 },
  { name: 'frame', maxCount: config.uploads.maxVideoFrames },
  { name: 'video', maxCount: 1 },
]);

/** Avatar-style single small image (not currently used, kept for profile uploads). */
export const singleImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: imageFilter,
}).single('image');

/** Translates multer's own errors into our error contract. */
export function uploadErrorHandler(error, _req, _res, next) {
  if (!error) return next();
  if (error instanceof multer.MulterError) {
    const map = {
      LIMIT_FILE_SIZE: [ErrorCode.IMAGE_TOO_LARGE, 'That file is larger than the configured limit.'],
      LIMIT_FILE_COUNT: [ErrorCode.VALIDATION_FAILED, 'Too many files were uploaded.'],
      LIMIT_UNEXPECTED_FILE: [ErrorCode.VALIDATION_FAILED, `Unexpected upload field "${error.field}".`],
      LIMIT_FIELD_VALUE: [ErrorCode.VALIDATION_FAILED, 'An upload field was too large.'],
    };
    const [code, message] = map[error.code] ?? [ErrorCode.VALIDATION_FAILED, error.message];
    return next(HttpError.badRequest(code, message, { multerCode: error.code }));
  }
  next(error);
}

export default { recognitionUpload, singleImageUpload, uploadErrorHandler };
