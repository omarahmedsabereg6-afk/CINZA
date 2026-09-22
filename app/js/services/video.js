/**
 * Video frame extraction (section 30).
 *
 * STRATEGY: extract the frames ON THE DEVICE and upload them as images.
 *
 * Why not upload the video:
 *   - a 30-second phone clip is 30-80 MB; six JPEG frames are ~250 KB total
 *   - the server would need ffmpeg, which is a large native dependency we
 *     deliberately avoid (the backend detects it and says so if absent)
 *   - the duration, resolution and content are all known locally, so limits can be
 *     enforced before a single byte leaves the phone
 *
 * The backend still accepts a raw video upload (`fieldname: 'video'`) and will use
 * ffmpeg when it is available — this module is simply the path that always works.
 *
 * Frame selection: `maxFrames` positions are sampled AFTER the first 5% and BEFORE
 * the last 5% of the clip, because the opening and closing moments of a phone
 * recording are very often a hand, a pocket or a title card rather than the scene
 * the user meant to capture.
 */
import { uploadLimits } from './capabilities.js';
import { prepareImage } from './image.js';
import { AppError, Failure } from '../core/errors.js';

/** Reads duration + dimensions by loading the blob into a detached <video>. */
function readMetadata(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load?.();
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new AppError(Failure.VALIDATION, { message: 'That video could not be read. Try a shorter clip.' }));
    }, 15_000);

    video.addEventListener('loadedmetadata', () => {
      clearTimeout(timer);
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (!duration || duration <= 0) {
        cleanup();
        reject(new AppError(Failure.VALIDATION, { message: 'That video has no readable duration.' }));
        return;
      }
      resolve({ duration, width: video.videoWidth, height: video.videoHeight, url, video });
    });

    video.addEventListener('error', () => {
      clearTimeout(timer);
      cleanup();
      reject(new AppError(Failure.VALIDATION, { message: 'That video format is not supported on this device.' }));
    });
  });
}

function seek(video, time) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('seek timeout')), 8000);
    const onSeeked = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    try {
      video.currentTime = time;
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

async function drawFrame(videoElement, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoElement, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('frame encode failed');
  return blob;
}

/**
 * Validates a video against the server's published limits.
 * @returns {Promise<{duration:number,width:number,height:number}>}
 */
export async function validateVideo(file) {
  const limits = uploadLimits();
  const mime = (file.type || '').toLowerCase();

  if (!mime.startsWith('video/')) {
    throw new AppError(Failure.VALIDATION, { message: 'That file is not a video.' });
  }
  if (file.size > limits.maxVideoBytes) {
    throw new AppError(Failure.VALIDATION, {
      message: `That video is ${(file.size / 1024 / 1024).toFixed(0)} MB. Clips must be under ${Math.round(
        limits.maxVideoBytes / 1024 / 1024
      )} MB.`,
    });
  }

  const meta = await readMetadata(file);
  meta.video.pause();

  if (meta.duration > limits.maxVideoDurationSeconds) {
    URL.revokeObjectURL(meta.url);
    throw new AppError(Failure.VALIDATION, {
      message: `That clip is ${Math.round(meta.duration)} seconds. Clips must be under ${
        limits.maxVideoDurationSeconds
      } seconds — trim it and try again.`,
    });
  }

  return meta;
}

/**
 * Extracts and prepares representative frames.
 *
 * Each returned frame has already been through `prepareImage`, so it carries its own
 * perceptual hashes and thumbnail and can be uploaded directly.
 *
 * @param {File|Blob} file
 * @param {object} [options]
 * @param {number} [options.maxFrames]
 * @param {(progress:{stage:string,index:number,total:number}) => void} [options.onProgress]
 */
export async function extractFrames(file, { maxFrames, onProgress } = {}) {
  const limits = uploadLimits();
  const meta = await validateVideo(file);
  const video = meta.video;

  const target = Math.max(2, Math.min(maxFrames ?? limits.maxVideoFrames ?? 6, limits.maxVideoFrames ?? 6));
  // Avoid the first and last 5% of the clip (see the note at the top of the file).
  const start = meta.duration * 0.05;
  const end = meta.duration * 0.95;
  const span = Math.max(0.1, end - start);

  // Cap frame size so a 4K clip does not produce 8 MB JPEGs.
  const longest = Math.max(meta.width || 1280, meta.height || 720);
  const scale = longest > 1600 ? 1600 / longest : 1;
  const frameWidth = Math.max(1, Math.round((meta.width || 1280) * scale));
  const frameHeight = Math.max(1, Math.round((meta.height || 720) * scale));

  const frames = [];
  const times = [];

  for (let i = 0; i < target; i += 1) {
    // Evenly spaced, but never the same instant twice.
    const fraction = target === 1 ? 0.5 : i / (target - 1);
    times.push(Number((start + fraction * span).toFixed(2)));
  }

  for (const [index, time] of times.entries()) {
    onProgress?.({ stage: 'extracting', index, total: times.length });
    try {
      await seek(video, time);
      const blob = await drawFrame(video, frameWidth, frameHeight);
      const prepared = await prepareImage(blob, { name: `frame-${index + 1}.jpg` });
      prepared.frameTimeMs = Math.round(time * 1000);
      prepared.frameIndex = index;
      frames.push(prepared);
    } catch (error) {
      // One unreadable frame should not fail the whole extraction.
      console.warn(`[video] frame at ${time}s failed`, error?.message ?? error);
    }
  }

  video.pause();
  URL.revokeObjectURL(meta.url);

  if (frames.length === 0) {
    throw new AppError(Failure.VALIDATION, {
      message: 'No usable frames could be read from that video. Try a different clip.',
    });
  }

  return {
    frames,
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    sizeBytes: file.size,
    /** true when the requested frame count could not be met (partial extraction). */
    partial: frames.length < times.length,
  };
}

export default { extractFrames, validateVideo };
