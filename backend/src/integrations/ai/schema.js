/**
 * Validation + normalisation of raw model output.
 *
 * Vision models are usually *close* to the contract but can:
 *   - wrap JSON in ``` fences
 *   - return a bare array, or nest under a key
 *   - send numbers as strings, or nulls as "null"
 *   - use singular/plural variants of our keys
 *
 * We repair all of that here rather than failing the request, because a 500 on a
 * repairable response wastes a paid AI call. Anything we genuinely cannot read
 * raises AI_INVALID_RESPONSE.
 */
import { z } from 'zod';
import HttpError, { ErrorCode } from '../../utils/httpError.js';
import { clamp01 } from '../../utils/similarity.js';

const strArray = z
  .array(z.union([z.string(), z.number(), z.null()]))
  .optional()
  .transform((arr) =>
    (arr ?? [])
      .map((v) => (v === null || v === undefined ? '' : String(v).trim()))
      .filter((v) => v.length > 0 && v.length < 200)
      .slice(0, 20)
  );

const optionalText = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return '';
    const s = String(v).trim();
    return s === 'null' || s === 'undefined' || s === 'N/A' ? '' : s.slice(0, 2000);
  });

const optionalYear = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === '' || v === 'null') return null;
    const n = Number.parseInt(String(v), 10);
    if (!Number.isFinite(n) || n < 1888 || n > 2100) return null;
    return n;
  });

const optionalIndex = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === '' || v === 'null') return null;
    const n = Number.parseInt(String(v), 10);
    return Number.isFinite(n) && n >= 0 && n < 1000 ? n : null;
  });

const optionalConfidence = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => {
    const n = Number.parseFloat(String(v ?? ''));
    if (!Number.isFinite(n)) return 0;
    return Math.round(n);
  });

const contentType = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    const s = String(v ?? '').toLowerCase().trim();
    if (s.startsWith('tv') || s.includes('series') || s.includes('episode') || s.includes('show')) return 'tv';
    if (s.startsWith('movie') || s.startsWith('film')) return 'movie';
    return 'unknown';
  });

const animationKind = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    const s = String(v ?? '').toLowerCase().trim();
    if (s.includes('anim') || s === 'anime' || s === 'cartoon') return 'animation';
    if (s.includes('mixed') || s.includes('hybrid')) return 'mixed';
    if (s.includes('live')) return 'live_action';
    return 'unknown';
  });

export const visionAnalysisSchema = z.object({
  possibleTitles: strArray,
  alternativeTitles: strArray,
  actors: strArray,
  characters: strArray,
  sceneDescription: optionalText,
  visibleText: optionalText,
  visualClues: strArray,
  possibleQuotes: strArray,
  settings: strArray,
  genres: strArray,
  timePeriod: optionalText,
  animation: animationKind,
  languageHint: optionalText,
  estimatedYear: optionalYear,
  contentType,
  seasonHint: optionalIndex,
  episodeHint: optionalIndex,
  confidence: optionalConfidence,
  reasoning: optionalText,
});

/** Snake_case contract keys -> camelCase internal keys. */
const KEY_MAP = {
  possible_titles: 'possibleTitles',
  alternative_titles_localised: 'alternativeTitles',
  alternative_titles: 'alternativeTitles',
  actors: 'actors',
  characters: 'characters',
  scene_description: 'sceneDescription',
  visible_text: 'visibleText',
  visual_clues: 'visualClues',
  possible_quotes: 'possibleQuotes',
  quotes: 'possibleQuotes',
  settings: 'settings',
  genres: 'genres',
  time_period: 'timePeriod',
  animation: 'animation',
  language_hint: 'languageHint',
  estimated_year: 'estimatedYear',
  content_type: 'contentType',
  season_hint: 'seasonHint',
  episode_hint: 'episodeHint',
  confidence: 'confidence',
  reasoning: 'reasoning',
};

/** Strips code fences / prose and returns the first balanced JSON object. */
export function extractJsonObject(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw;

  let text = String(raw).trim();
  text = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();

  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Rewrites contract keys, tolerating near-miss naming, then validates. */
export function normaliseVisionPayload(rawObject) {
  if (!rawObject || typeof rawObject !== 'object') return null;

  // Some models nest the answer, e.g. { "analysis": {...} } or { "result": {...} }
  const unwrapKeys = ['analysis', 'result', 'data', 'response', 'output'];
  let source = rawObject;
  if (!Object.keys(source).some((k) => k in KEY_MAP) && !('possibleTitles' in source)) {
    for (const key of unwrapKeys) {
      const nested = source[key];
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        source = nested;
        break;
      }
    }
  }

  const mapped = {};
  for (const [rawKey, value] of Object.entries(source)) {
    const normalisedKey = rawKey.trim().toLowerCase();
    const target = KEY_MAP[normalisedKey] ?? (normalisedKey in visionAnalysisSchema.shape ? normalisedKey : null);
    if (!target) continue;
    if (mapped[target] === undefined) mapped[target] = value;
  }
  return mapped;
}

/**
 * @param {unknown} raw raw model output (string or already-parsed object)
 * @returns {{data: z.infer<typeof visionAnalysisSchema>, repaired: boolean}}
 */
export function parseVisionResponse(raw) {
  const object = typeof raw === 'string' ? extractJsonObject(raw) : raw;
  if (!object) {
    throw new HttpError(
      502,
      ErrorCode.AI_INVALID_RESPONSE,
      `Vision model did not return JSON. Received: ${String(raw).slice(0, 300)}`
    );
  }

  const mapped = normaliseVisionPayload(object);
  const result = visionAnalysisSchema.safeParse(mapped);

  if (!result.success) {
    throw new HttpError(502, ErrorCode.AI_INVALID_RESPONSE, 'Vision model returned an unusable payload.', {
      issues: result.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  const data = result.data;
  // A payload with no titles at all is valid-but-useless: report it as a failed match.
  data.confidence = Math.min(100, Math.max(0, Math.round(data.confidence)));
  data.selfConfidence = clamp01(data.confidence / 100);
  return { data, repaired: true };
}

export default { parseVisionResponse, extractJsonObject, normaliseVisionPayload, visionAnalysisSchema };
