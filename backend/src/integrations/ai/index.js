/**
 * Vision provider selection + the single normalised entry point used by the
 * recognition pipeline.
 *
 * Interface:
 *   analyze({ images, mode, describe, hint, region, language, callIndex })
 *     -> provider-specific payload
 *
 * `analyseScene()` wraps either adapter and ALWAYS returns the validated internal
 * analysis shape, so the pipeline never branches on which provider is active.
 */
import config from '../../config/env.js';
import HttpError, { ErrorCode } from '../../utils/httpError.js';
import { createLogger } from '../../utils/logger.js';
import { caches } from '../../utils/cache.js';
import { sha256Hex } from '../../utils/ids.js';
import { mockVision } from './mockVision.js';
import { openaiVision } from './openaiVision.js';
import { geminiVision } from './geminiVision.js';
import { parseVisionResponse } from './schema.js';

const log = createLogger('ai');

let announced = false;

export function getVisionProvider() {
  const provider = config.ai.enabled
    ? (config.ai.provider === 'gemini' ? geminiVision : openaiVision)
    : mockVision;
  if (!announced) {
    announced = true;
    if (provider.isMock) {
      log.warn('AI vision is running in MOCK mode — analyses are simulated, never presented as real.');
      log.warn('Enable real analysis with: AI_PROVIDER=openai|gemini and AI_API_KEY|GEMINI_API_KEY=<key>');
    } else {
      log.info(`AI vision live: ${config.ai.provider} / ${config.ai.model}`);
    }
  }
  return provider;
}

/** Stable cache key for an identical request, so we never pay twice for one image. */
export function visionCacheKey({ images = [], mode, describe = '', hint = '' }) {
  const h = sha256Hex(
    images.map((i) => `${i.role}:${i.frameTimeMs ?? ''}:${sha256Hex(i.buffer ?? Buffer.alloc(0))}`).join('|')
  );
  return `${mode}|${h}|${sha256Hex(describe)}|${sha256Hex(hint)}`;
}

/**
 * Runs the vision stage and normalises the result.
 *
 * @returns {Promise<{analysis: object, meta: {provider:string,isMock:boolean,model?:string,cached:boolean,usage?:object}}>}
 */
export async function analyseScene({ images, mode = 'image', describe = '', hint = '', region = 'US', language = 'en-US', callIndex = 0, useCache = true }) {
  const provider = getVisionProvider();
  log.info('[TRACE recognition] AI provider resolved', { provider: provider.name, isMock: provider.isMock });
  const cacheKey = visionCacheKey({ images, mode, describe, hint });

  if (useCache) {
    const cached = caches.vision.get(cacheKey);
    if (cached) {
      log.debug('vision cache hit — no upstream call');
      return { ...cached, meta: { ...cached.meta, cached: true } };
    }
  }

  const raw = await provider.analyze({ images, mode, describe, hint, region, language, callIndex });

  // Mock already returns the internal shape; the live adapter returns raw text.
  let analysis;
  if (raw.isMock && raw.possible_titles) {
    const { visionAnalysisSchema } = await import('./schema.js');
    const parsed = visionAnalysisSchema.safeParse({
      possibleTitles: raw.possible_titles,
      alternativeTitles: raw.alternative_titles_localised,
      actors: raw.actors,
      characters: raw.characters,
      sceneDescription: raw.scene_description,
      visibleText: raw.visible_text,
      visualClues: raw.visual_clues,
      possibleQuotes: raw.possible_quotes,
      settings: raw.settings,
      genres: raw.genres,
      timePeriod: raw.time_period,
      animation: raw.animation,
      languageHint: raw.language_hint,
      estimatedYear: raw.estimated_year,
      contentType: raw.content_type,
      seasonHint: raw.season_hint,
      episodeHint: raw.episode_hint,
      confidence: raw.confidence,
      reasoning: raw.reasoning,
    });
    if (!parsed.success) {
      throw new HttpError(502, ErrorCode.AI_INVALID_RESPONSE, 'Mock vision adapter produced an invalid payload.', {
        issues: parsed.error.issues.slice(0, 5),
      });
    }
    analysis = parsed.data;
    analysis.debug = raw.debug ?? null;
  } else {
    const { data } = parseVisionResponse(raw.raw);
    analysis = data;
  }

  const result = {
    analysis,
    meta: {
      provider: provider.name,
      isMock: Boolean(raw.isMock),
      model: raw.model ?? null,
      cached: false,
      usage: raw.usage ?? null,
    },
  };

  if (useCache) caches.vision.set(cacheKey, result);
  return result;
}

export default { getVisionProvider, analyseScene, visionCacheKey };
