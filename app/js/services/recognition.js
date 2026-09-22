/**
 * Recognition client (sections 10, 30, 41).
 *
 * Builds the multipart upload the backend expects and reports progress while it
 * works. The shape of the request:
 *
 *   images[]  one prepared blob per frame (a single image == one frame)
 *   meta      JSON describing mode, source, region, description and the
 *             per-frame metadata the server cannot compute itself
 *             (thumbnails, perceptual hashes, frame timestamps)
 *
 * Everything expensive already happened on-device (see services/image.js), so this
 * module is only responsible for a correct, cancellable, observable upload.
 */
import api from './api.js';
import { AppError, Failure } from '../core/errors.js';
import { store, actions } from '../core/store.js';
import { getCapabilities } from './capabilities.js';

/** The five labelled steps the user sees while scanning. */
export const STAGES = [
  { key: 'prepare', label: 'Preparing image…', weight: 0.08 },
  { key: 'upload', label: 'Uploading…', weight: 0.22 },
  { key: 'analyse', label: 'Reading the scene…', weight: 0.3 },
  { key: 'search', label: 'Searching the movie database…', weight: 0.24 },
  { key: 'verify', label: 'Verifying the match…', weight: 0.16 },
];

/** Server regions are ISO codes; the user's setting wins, then the device locale. */
function resolveRegion() {
  const session = store.getState().session;
  if (session.user?.region) return session.user.region;
  const caps = getCapabilities();
  try {
    const localeRegion = new Intl.Locale(navigator.language).region;
    if (localeRegion && caps.regions?.some((r) => r.code === localeRegion)) return localeRegion;
  } catch {
    /* older webview */
  }
  return caps.defaults?.region ?? 'US';
}

function resolveLanguage() {
  const session = store.getState().session;
  return session.user?.language ?? navigator.language ?? 'en-US';
}

/**
 * @param {object} input
 * @param {Array}  [input.frames]    prepared images from services/image.js or video.js
 * @param {string} input.mode        'image' | 'video' | 'describe'
 * @param {string} [input.describe]
 * @param {string} [input.source]    'camera' | 'gallery' | 'video' | 'text'
 * @param {object} [input.video]     { duration, sizeBytes, width, height }
 * @param {AbortSignal} [input.signal]
 * @param {(state:{stage:string,label:string,progress:number}) => void} [input.onProgress]
 */
export async function recognise({
  frames = [],
  mode = 'image',
  describe = '',
  source = 'gallery',
  video = null,
  signal,
  onProgress,
}) {
  const capabilities = getCapabilities();

  if (!capabilities.features?.recognition) {
    throw new AppError(Failure.SERVER_DOWN, {
      message: 'Recognition is not available on this server right now.',
    });
  }

  if (mode !== 'describe' && frames.length === 0) {
    throw new AppError(Failure.NO_MATCH, { message: 'Add an image, a video, or describe the scene to continue.' });
  }
  if (mode === 'describe' && describe.trim().length < 3) {
    throw new AppError(Failure.VALIDATION, { message: 'Describe the scene in a few words, or add an image instead.' });
  }

  const report = (stageKey, progress) => {
    const stage = STAGES.find((s) => s.key === stageKey) ?? STAGES[0];
    onProgress?.({ stage: stageKey, label: stage.label, progress: Math.max(0, Math.min(1, progress)) });
  };

  report('prepare', 0.05);

  const form = new FormData();

  const meta = {
    mode,
    source: mode === 'describe' ? 'text' : source,
    describe: describe.slice(0, 1200),
    region: resolveRegion(),
    language: resolveLanguage(),
    ...(video ? { video } : {}),
    files: frames.map((frame) => ({
      pHash: frame.hashes?.pHash ?? null,
      dHash: frame.hashes?.dHash ?? null,
      aHash: frame.hashes?.aHash ?? null,
      thumbDataUrl: frame.thumbDataUrl ?? null,
      frameTimeMs: frame.frameTimeMs ?? null,
    })),
  };

  form.append('meta', JSON.stringify(meta));

  for (const [index, frame] of frames.entries()) {
    const field = index === 0 ? 'images' : 'frame';
    form.append(field, frame.file ?? frame.blob, frame.file?.name ?? `scene-${index + 1}.jpg`);
  }

  report('upload', 0.15);

  // The upload itself is opaque to fetch, so the progress between 15% and 45% is
  // simulated as a slow walk. It is honest: it tracks "we are waiting on the
  // network", and it stops advancing at the point the upload must be complete.
  let simulated = 0.15;
  const ticker = setInterval(() => {
    simulated = Math.min(0.44, simulated + 0.02);
    report('upload', simulated);
  }, 260);

  let payload;
  try {
    payload = await api.upload('/recognitions', form, { signal, timeoutMs: 90_000 });
  } catch (error) {
    clearInterval(ticker);
    if (error instanceof AppError) throw error;
    throw new AppError(Failure.UNKNOWN, { cause: error });
  } finally {
    clearInterval(ticker);
  }

  // The response only arrives once the server has finished, so the remaining
  // stages are reported as completed in order. This is the honest sequence: we
  // cannot observe the server's internals, so we show what it did.
  report('analyse', 0.55);
  report('search', 0.78);
  report('verify', 0.92);

  const recognition = payload.recognition;

  if (!recognition) {
    throw new AppError(Failure.UNKNOWN, { message: 'The server returned an unexpected response.' });
  }

  report('verify', 1);
  actions.setLastResult(recognition);
  actions.touchHistory();

  return recognition;
}

/** Convenience wrapper for the describe-only flow. */
export async function recogniseFromDescription(describe, options = {}) {
  return recognise({ frames: [], mode: 'describe', source: 'text', describe, ...options });
}

/** Fetches a stored recognition. Anonymous ones are not readable via the API. */
export async function fetchRecognition(id) {
  const payload = await api.get(`/recognitions/${id}`);
  return payload.recognition;
}

/** Sends a confirmation or a correction (section 29). */
export async function sendFeedback({ recognitionId, correct, correctedTitle, correctedMediaType, correctedTmdbId, comment }) {
  return api.post('/feedback', {
    recognitionId,
    correct,
    ...(correctedTitle ? { correctedTitle } : {}),
    ...(correctedMediaType ? { correctedMediaType } : {}),
    ...(correctedTmdbId ? { correctedTmdbId } : {}),
    ...(comment ? { comment } : {}),
  });
}

export const stages = STAGES;
export default { recognise, recogniseFromDescription, fetchRecognition, sendFeedback, STAGES };
