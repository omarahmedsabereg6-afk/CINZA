/**
 * Recognition endpoint (section 34: POST /api/recognitions).
 *
 * This is the one endpoint where the client sends binary data. The order of
 * operations matters:
 *
 *   1. multer has already capped the byte size in memory (middleware/upload.js)
 *   2. `validateUploadMeta` validated the accompanying JSON metadata
 *   3. `validateImages` re-derives MIME types from magic bytes and checks dimensions
 *   4. the pipeline runs
 *
 * A describe-only request (no image) is supported: the app can identify a title from
 * a user's written description, and the same pipeline handles it with `mode=describe`.
 */
import { asyncHandler } from '../utils/asyncHandler.js';
import { createLogger } from '../utils/logger.js';
import HttpError, { ErrorCode } from '../utils/httpError.js';
import { runRecognition } from '../recognition/pipeline.js';
import {
  collectFiles,
  validateImages,
  parseClientMeta,
  validateVideo,
} from '../recognition/preprocess.js';
import { extractFramesFromVideo, probeFfmpeg } from '../recognition/videoFrames.js';
import { RecognitionMode, RecognitionSource } from '../database/constants.js';
import { languageForRegion } from '../database/constants.js';
import config from '../config/env.js';
import { getVisionProvider } from '../integrations/ai/index.js';
import { sha256Hex, inputHash } from '../utils/ids.js';

const log = createLogger('recognition:controller');

export const createRecognition = asyncHandler(async (req, res) => {
  log.info('[TRACE recognition] request entered');
  const files = collectFiles(req);
  const clientMeta = req.clientMeta ?? parseClientMeta(req.body?.meta);
  log.info('[TRACE recognition] controller started');
  for (const file of files) {
    const detectedMime = file?.mimetype ?? null;
    const sniffed = file?.buffer && file.buffer.length > 0 ? (await import('../utils/imageProbe.js')).sniffMime(file.buffer) : null;
    log.info('[TRACE upload] file diagnostics', {
      fieldname: file?.fieldname ?? null,
      originalName: file?.originalname ?? null,
      reportedMimeType: detectedMime,
      detectedMime: sniffed ?? null,
      byteLength: file?.buffer?.length ?? 0,
      isEmpty: !file?.buffer || file.buffer.length === 0,
    });
  }

  const mode = clientMeta.mode ?? RecognitionMode.IMAGE;
  const region = (clientMeta.region ?? req.user?.region ?? config.streaming.defaultRegion).toUpperCase();
  const language = clientMeta.language ?? req.user?.language ?? languageForRegion(region);
  const source =
    clientMeta.source ??
    (mode === RecognitionMode.DESCRIBE
      ? RecognitionSource.TEXT
      : mode === RecognitionMode.VIDEO
        ? RecognitionSource.VIDEO
        : RecognitionSource.GALLERY);

  const describe = clientMeta.describe ?? '';
  const hint = clientMeta.hint ?? '';

  /* -------- describe-only: no image required -------- */
  if (mode === RecognitionMode.DESCRIBE) {
    if (describe.trim().length < 3) {
      throw HttpError.badRequest(
        ErrorCode.NO_INPUT,
        'Describe the scene in a few words, or upload an image instead.'
      );
    }
    log.info('[TRACE recognition] describe-only path');
    const payload = await runRecognition({
      images: [],
      mode,
      describe,
      hint,
      region,
      language,
      source,
      userId: req.user?.id ?? null,
      inputHashValue: sha256Hex(`describe:${describe}:${region}`),
      debug: Boolean(req.query?.debug),
    });
    log.info('[TRACE recognition] controller completed');
    return res.status(201).json({ recognition: payload });
  }

  /* -------- image / video -------- */
  const imageFiles = files.filter((f) => f.fieldname !== 'video');
  const videoFile = files.find((f) => f.fieldname === 'video');

  let images;
  let videoNotice = null;

  if (imageFiles.length > 0) {
    ({ images } = validateImages({ files: imageFiles, clientMeta, mode }));
  } else if (videoFile) {
    // A raw video arrived. The app normally extracts frames on-device; this path
    // exists for clients that cannot (and requires ffmpeg on the server).
    const video = validateVideo(videoFile);
    const capability = probeFfmpeg();
    if (!capability.available) {
      throw HttpError.unavailable(
        ErrorCode.VIDEO_TYPE_UNSUPPORTED,
        'This server cannot extract frames from a video. Update the app, which extracts frames on the device before uploading.'
      );
    }
    images = extractFramesFromVideo(video);
    videoNotice = `Frames extracted server-side with ffmpeg (${images.length} frame(s)).`;
  } else {
    throw HttpError.badRequest(ErrorCode.NO_INPUT, 'No image or video was uploaded.');
  }

  if (images.length === 0) {
    throw HttpError.badRequest(ErrorCode.NO_INPUT, 'No usable image data was found in the upload.');
  }

  const inputHashValue = inputHash({
    buffer: images[0].buffer,
    mode,
    extra: `${images.length}:${region}`,
  });

  log.info('[TRACE recognition] image/video path');
  const payload = await runRecognition({
    images,
    mode,
    describe,
    hint,
    region,
    language,
    source,
    userId: req.user?.id ?? null,
    inputHashValue,
    debug: Boolean(req.query?.debug),
  });

  log.info('[TRACE recognition] controller preparing response');
  res.status(201).json({
    recognition: {
      ...payload,
      ...(videoNotice ? { videoNotice } : {}),
      video: clientMeta.video ?? null,
      visionProvider: getVisionProvider().name,
    },
  });
});

/** Capability probe so the app can hide Upload Video when it would not work. */
export const recognitionCapabilities = asyncHandler(async (_req, res) => {
  const ffmpeg = probeFfmpeg();
  log.info('[TRACE recognition] capability probe');
  res.json({
    imageUpload: true,
    describeScene: true,
    videoUpload: true,
    serverSideVideoFrames: ffmpeg.available,
    serverSideVideoReason: ffmpeg.reason,
    clientFrameExtraction: true,
    limits: {
      maxImageBytes: config.uploads.maxImageBytes,
      maxVideoBytes: config.uploads.maxVideoBytes,
      maxVideoDurationSeconds: config.uploads.maxVideoDurationSeconds,
      maxVideoFrames: config.uploads.maxVideoFrames,
      allowedImageTypes: config.uploads.allowedImageTypes,
    },
  });
});

export default { createRecognition, recognitionCapabilities };
