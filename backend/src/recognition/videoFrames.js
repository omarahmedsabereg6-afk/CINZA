/**
 * Video handling (section 30).
 *
 * Two strategies, in order of preference:
 *
 * 1. CLIENT-SIDE FRAME EXTRACTION (default, works everywhere).
 *    The app decodes the clip in a <video> element, draws N evenly-spaced frames to
 *    a canvas and uploads them as images. No server-side video tooling is required,
 *    the upload is far smaller than the video, and it works identically on Android
 *    and iOS. The client also enforces the duration/size limits before uploading.
 *
 * 2. SERVER-SIDE EXTRACTION via ffmpeg (optional, for when a raw video file arrives).
 *    Detected at runtime. If ffmpeg is absent we say so explicitly rather than
 *    silently degrading — see `probeFfmpeg()`.
 *
 * Both paths converge on the same downstream behaviour: several analysed frames are
 * combined into ONE fused analysis, where agreement between frames raises
 * confidence and disagreement lowers it.
 */
import { spawnSync } from 'node:child_process';
import config from '../config/env.js';
import HttpError, { ErrorCode } from '../utils/httpError.js';
import { createLogger } from '../utils/logger.js';
import { titleSimilarity } from '../utils/similarity.js';

const log = createLogger('video');

let ffmpegState = null;

/** Cached ffmpeg capability probe. Returns { available, version, reason }. */
export function probeFfmpeg() {
  if (ffmpegState) return ffmpegState;
  try {
    const result = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 5000 });
    if (result.status === 0) {
      const version = String(result.stdout).split('\n')[0].slice(0, 80);
      ffmpegState = { available: true, version, reason: null };
    } else {
      ffmpegState = { available: false, version: null, reason: 'ffmpeg exited non-zero' };
    }
  } catch (error) {
    ffmpegState = { available: false, version: null, reason: error.code === 'ENOENT' ? 'ffmpeg is not on PATH' : error.message };
  }
  if (!ffmpegState.available) {
    log.warn(`Server-side video extraction unavailable (${ffmpegState.reason}).`);
    log.warn('The app extracts frames on-device instead, so video recognition still works.');
  } else {
    log.info(`Server-side video extraction available: ${ffmpegState.version}`);
  }
  return ffmpegState;
}

/**
 * Extracts evenly-spaced JPEG frames from a video buffer using ffmpeg.
 * Frames are returned as buffers and never written anywhere permanent.
 */
export function extractFramesFromVideo({ buffer, mimeType, maxFrames = config.uploads.maxVideoFrames }) {
  const capability = probeFfmpeg();
  if (!capability.available) {
    throw HttpError.unavailable(
      ErrorCode.VIDEO_TYPE_UNSUPPORTED,
      `Server-side video extraction is unavailable (${capability.reason}). The app uploads extracted frames instead.`
    );
  }

  const inputExt = mimeType === 'video/webm' ? 'webm' : 'mp4';
  const started = Date.now();

  // -vf fps filter samples evenly; scale caps the longest edge to keep AI cost bounded.
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', `pipe:0`,
    '-t', String(config.uploads.maxVideoDurationSeconds),
    '-vf', `fps=1/${Math.max(1, Math.ceil(config.uploads.maxVideoDurationSeconds / maxFrames))},scale='min(${config.ai.maxImageEdge},iw)':-2`,
    '-frames:v', String(maxFrames),
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    'pipe:1',
  ];

  const result = spawnSync('ffmpeg', args, { input: buffer, maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });
  if (result.status !== 0) {
    throw HttpError.badRequest(
      ErrorCode.VIDEO_TYPE_UNSUPPORTED,
      `ffmpeg could not decode the ${inputExt} video: ${String(result.stderr).slice(0, 300)}`
    );
  }

  // Split the mjpeg stream on SOI markers (FFD8FF).
  const frames = [];
  const out = result.stdout;
  let start = -1;
  for (let i = 0; i < out.length - 2; i += 1) {
    if (out[i] === 0xff && out[i + 1] === 0xd8 && out[i + 2] === 0xff) {
      if (start !== -1) frames.push(out.subarray(start, i));
      start = i;
    }
  }
  if (start !== -1) frames.push(out.subarray(start));

  log.debug(`ffmpeg produced ${frames.length} frame(s) in ${Date.now() - started}ms`);
  if (frames.length === 0) {
    throw HttpError.badRequest(ErrorCode.VIDEO_TYPE_UNSUPPORTED, 'No frames could be extracted from that video.');
  }

  return frames.map((frameBuffer, index) => ({
    kind: index === 0 ? 'primary' : 'frame',
    sortOrder: index,
    buffer: frameBuffer,
    mimeType: 'image/jpeg',
    sizeBytes: frameBuffer.length,
    width: null,
    height: null,
    pHash: null,
    dHash: null,
    aHash: null,
    thumbDataUrl: null,
    frameTimeMs: Math.round((index * config.uploads.maxVideoDurationSeconds * 1000) / frames.length),
    estimated: true,
  }));
}

/**
 * Fuses per-frame analyses into one.
 *
 * Algorithm:
 *  - Candidate titles are pooled across frames. Each occurrence adds weighted
 *    support; a title seen in multiple frames accumulates more than a title seen
 *    once, which is exactly the behaviour you want for a moving camera.
 *  - The strongest frame's observations (actors, clues, visible text) are merged
 *    with the union of the rest, so no evidence from any frame is thrown away.
 *  - Confidence is adjusted by agreement: unanimous frames are trusted more than
 *    frames that each propose something different.
 *
 * @param {Array<{analysis: object, frameIndex: number, frameTimeMs?: number}>} perFrame
 */
export function fuseFrameAnalyses(perFrame) {
  const usable = perFrame.filter((f) => f?.analysis);
  if (usable.length === 0) {
    throw HttpError.internal('No frame analyses were produced.');
  }
  if (usable.length === 1) {
    return { analysis: usable[0].analysis, agreement: 1, frameCount: 1, perFrameTitles: [usable[0].analysis.possibleTitles ?? []] };
  }

  const titleScores = new Map();
  const titleDisplay = new Map();

  usable.forEach((frame, frameIndex) => {
    const titles = frame.analysis.possibleTitles ?? [];
    titles.forEach((title, rank) => {
      // Rank-weighted, recency-of-rank aware: 1st place in a frame counts most.
      const rankWeight = 1 / (1 + rank * 0.6);
      const key = title.toLowerCase().trim();
      if (!key) return;
      titleScores.set(key, (titleScores.get(key) ?? 0) + rankWeight);
      if (!titleDisplay.has(key)) titleDisplay.set(key, title);
    });
  });

  const ranked = [...titleScores.entries()].sort((a, b) => b[1] - a[1]);
  const bestScore = ranked[0]?.[1] ?? 0;
  const secondScore = ranked[1]?.[1] ?? 0;

  // Agreement: how much of the total vote the winner holds.
  const total = ranked.reduce((sum, [, v]) => sum + v, 0) || 1;
  const agreement = bestScore / total;

  // Which frames actually contained the winning title (fuzzy, for subtitle drift)?
  const winner = titleDisplay.get(ranked[0]?.[0]) ?? '';
  const supportingFrames = usable.filter((f) =>
    (f.analysis.possibleTitles ?? []).some((t) => titleSimilarity(t, winner) > 0.75)
  ).length;
  const frameAgreement = supportingFrames / usable.length;

  const union = (selector) => {
    const seen = new Set();
    const out = [];
    for (const frame of usable) {
      for (const value of selector(frame.analysis) ?? []) {
        const key = String(value).toLowerCase().trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(value);
      }
    }
    return out;
  };

  // Confidence: average of per-frame confidence, pulled up by consensus and down by dissent.
  const avgConfidence = usable.reduce((sum, f) => sum + (f.analysis.confidence ?? 0), 0) / usable.length;
  const consensusBoost = (frameAgreement - 0.5) * 24; // ±12
  const conflictPenalty = secondScore > 0 && bestScore > 0 ? Math.min(12, (secondScore / bestScore) * 12) : 0;
  const confidence = Math.max(0, Math.min(96, Math.round(avgConfidence + consensusBoost - conflictPenalty)));

  const bestFrame = usable.reduce(
    (acc, f) => ((f.analysis.confidence ?? 0) > (acc.analysis.confidence ?? 0) ? f : acc),
    usable[0]
  );

  const merged = {
    ...bestFrame.analysis,
    possibleTitles: union((a) => a.possibleTitles).slice(0, 5),
    alternativeTitles: union((a) => a.alternativeTitles),
    actors: union((a) => a.actors).slice(0, 8),
    characters: union((a) => a.characters).slice(0, 8),
    visualClues: union((a) => a.visualClues).slice(0, 10),
    possibleQuotes: union((a) => a.possibleQuotes),
    settings: union((a) => a.settings),
    genres: union((a) => a.genres),
    visibleText: union((a) => (a.visibleText ? [a.visibleText] : [])).join(' | ').slice(0, 500),
    sceneDescription:
      bestFrame.analysis.sceneDescription ||
      `Analysed ${usable.length} frames from the clip.`,
    confidence,
    estimatedYear: bestFrame.analysis.estimatedYear ?? null,
    contentType: bestFrame.analysis.contentType ?? 'unknown',
    reasoning: `Fused ${usable.length} frames: ${supportingFrames}/${usable.length} agree on "${winner}". ${bestFrame.analysis.reasoning ?? ''}`.trim(),
    frameEvidence: usable.map((f, i) => ({
      frameIndex: i,
      frameTimeMs: f.frameTimeMs ?? null,
      topTitle: (f.analysis.possibleTitles ?? [])[0] ?? null,
      confidence: f.analysis.confidence ?? 0,
    })),
  };

  return {
    analysis: merged,
    agreement: Number(frameAgreement.toFixed(3)),
    frameCount: usable.length,
    supportingFrames,
    perFrameTitles: usable.map((f) => f.analysis.possibleTitles ?? []),
  };
}

export default { probeFfmpeg, extractFramesFromVideo, fuseFrameAnalyses };
