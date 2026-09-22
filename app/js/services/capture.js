/**
 * Capture orchestration.
 *
 * The one place that turns "the user wants to identify something" into a prepared,
 * validated, hashed payload sitting in `store.pending`, ready for the preview screen.
 *
 * Every entry point (camera, gallery, video, description) funnels through here so
 * validation, compression and hashing happen exactly once, in exactly one place.
 */
import { prepareImage } from './image.js';
import { extractFrames } from './video.js';
import { pickFromGallery, pickVideo, takePhoto } from './media.js';
import { store, actions } from '../core/store.js';
import { AppError, Failure } from '../core/errors.js';
import { getCapabilities } from './capabilities.js';

function setPending(pending) {
  actions.setPending(pending);
  return pending;
}

/** Frees object URLs from a previous capture so memory does not creep up. */
function releasePending() {
  const pending = store.getState().pending;
  for (const frame of pending?.frames ?? []) {
    if (frame.previewUrl) URL.revokeObjectURL(frame.previewUrl);
  }
  actions.setPending(null);
}

/* ------------------------------------------------------------------ *
 * Camera
 * ------------------------------------------------------------------ */

/** @param {Blob} blob already captured by the camera screen (or the OS camera) */
export async function prepareCapturedPhoto(blob, { source = 'camera', filename } = {}) {
  releasePending();
  const prepared = await prepareImage(blob, { name: filename ?? 'capture.jpg' });

  return setPending({
    mode: 'image',
    source,
    frames: [prepared],
    describe: '',
    video: null,
  });
}

/**
 * Full-screen camera path: takes a photo through the OS camera and prepares it.
 * Used when the in-app preview is unavailable.
 */
export async function captureWithSystemCamera() {
  const photo = await takePhoto();
  return prepareCapturedPhoto(photo.blob, { source: 'camera', filename: photo.filename });
}

/* ------------------------------------------------------------------ *
 * Gallery
 * ------------------------------------------------------------------ */

export async function captureFromGallery() {
  const picked = await pickFromGallery();
  return prepareCapturedPhoto(picked.blob, { source: 'gallery', filename: picked.filename });
}

/* ------------------------------------------------------------------ *
 * Video (section 30)
 * ------------------------------------------------------------------ */

/**
 * Picks a clip and extracts representative frames on-device.
 * @param {(state:{stage:string,index:number,total:number}) => void} [onProgress]
 */
export async function captureFromVideo(onProgress) {
  const picked = await pickVideo();
  const limits = getCapabilities().uploads ?? {};

  const result = await extractFrames(picked.blob, {
    maxFrames: limits.maxVideoFrames ?? 6,
    onProgress,
  });

  releasePending();

  return setPending({
    mode: 'video',
    source: 'video',
    frames: result.frames,
    describe: '',
    video: {
      durationSeconds: Math.round(result.duration),
      sizeBytes: picked.sizeBytes ?? picked.blob.size,
      width: result.width,
      height: result.height,
      filename: picked.filename,
      partial: result.partial,
    },
  });
}

/* ------------------------------------------------------------------ *
 * Description only
 * ------------------------------------------------------------------ */

export function prepareDescription(describe) {
  if (String(describe ?? '').trim().length < 3) {
    throw new AppError(Failure.VALIDATION, { message: 'Describe the scene in a few words first.' });
  }
  releasePending();
  return setPending({ mode: 'describe', source: 'text', frames: [], describe: describe.trim(), video: null });
}

/** Adds a written description to an existing image capture (image + words). */
export function attachDescription(describe) {
  const pending = store.getState().pending;
  if (!pending) return null;
  actions.setPending({ ...pending, describe: String(describe ?? '').trim() });
  return store.getState().pending;
}

export function clearPending() {
  releasePending();
}

export const getPending = () => store.getState().pending;

export default {
  prepareCapturedPhoto,
  captureWithSystemCamera,
  captureFromGallery,
  captureFromVideo,
  prepareDescription,
  attachDescription,
  clearPending,
  getPending,
};
