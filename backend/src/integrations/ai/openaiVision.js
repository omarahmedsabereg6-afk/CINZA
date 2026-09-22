/**
 * Live vision adapter.
 *
 * Talks to any OpenAI-compatible `/chat/completions` endpoint, which covers OpenAI,
 * Azure OpenAI (with a compatible path), OpenRouter, Together, Groq, and most
 * self-hosted gateways. Swapping vendor is a change of AI_BASE_URL + AI_VISION_MODEL.
 *
 * Cost & reliability (section 41):
 *   - images are downscaled to AI_MAX_IMAGE_EDGE before sending, which is the single
 *     biggest driver of vision-token cost
 *   - `AI_MAX_CALLS_PER_RECOGNITION` is enforced by the pipeline, and this adapter
 *     refuses beyond it as a second line of defence
 *   - one retry, only for 429/5xx/timeout
 *   - a hard AbortController timeout so a hung provider cannot hang a request
 */
import OpenAI from 'openai';
import config from '../../config/env.js';
import HttpError, { ErrorCode } from '../../utils/httpError.js';
import { createLogger } from '../../utils/logger.js';
import { recordApiCall } from '../../services/metricsService.js';
import { sniffMime, probeImage } from '../../utils/imageProbe.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';

const log = createLogger('ai:openai');

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const MIME_BY_EXT = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function redactSecrets(value) {
  return String(value ?? '')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/Authorization\s*[:=]\s*['"]?Bearer\s+[A-Za-z0-9._-]+/gi, 'Authorization=[REDACTED]')
    .replace(/api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9._-]+/gi, 'apiKey=[REDACTED]')
    .replace(/\b(\w*token\w*)\s*[:=]\s*['"]?[A-Za-z0-9._-]+/gi, '$1=[REDACTED]')
    .slice(0, 250);
}

function classifyOpenAIError(error, fallbackStatus = 0) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? fallbackStatus);
  const type = String(error?.type ?? error?.code ?? '').toLowerCase();
  const message = redactSecrets(error?.message ?? 'OpenAI request failed');
  const lower = message.toLowerCase();

  if (error?.name === 'AbortError' || lower.includes('timeout') || status === 408) {
    return { status, classification: 'timeout', message };
  }
  if (status === 400 || lower.includes('malformed') || lower.includes('invalid_request') || type.includes('bad_request')) {
    return { status, classification: 'malformed OpenAI request', message };
  }
  if (status === 401 || lower.includes('authentication') || lower.includes('api key')) {
    return { status, classification: 'HTTP 401 authentication error', message };
  }
  if (status === 403 || lower.includes('forbidden')) {
    return { status, classification: 'HTTP 403 forbidden', message };
  }
  if (status === 404 || lower.includes('not found')) {
    return { status, classification: 'HTTP 404 not found', message };
  }
  if (status === 408 || lower.includes('request timeout')) {
    return { status, classification: 'HTTP 408 timeout', message };
  }
  if (status === 429 || lower.includes('rate limit') || lower.includes('quota') || lower.includes('billing')) {
    return { status, classification: 'HTTP 429 quota or rate-limit issue', message };
  }
  if (status === 500 || lower.includes('server error')) {
    return { status, classification: 'HTTP 500 provider server error', message };
  }
  if (status === 502 || lower.includes('bad gateway') || lower.includes('upstream')) {
    return { status, classification: 'HTTP 502 upstream gateway error', message };
  }
  if (lower.includes('network') || lower.includes('fetch failed') || lower.includes('dns')) {
    return { status, classification: 'DNS/network failure', message };
  }
  if (lower.includes('model') && (lower.includes('not found') || lower.includes('unsupported') || lower.includes('unknown'))) {
    return { status, classification: 'unsupported model', message };
  }
  if (lower.includes('image')) {
    return { status, classification: 'invalid image input', message };
  }
  if (lower.includes('response') || lower.includes('json')) {
    return { status, classification: 'response parsing failure', message };
  }
  return { status, classification: 'other concrete provider error', message };
}

function dataUri({ buffer, mimeType }) {
  const safeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
  const mime = MIME_BY_EXT[mimeType] ? mimeType : 'image/jpeg';
  return `data:${mime};base64,${safeBuffer.toString('base64')}`;
}

export function validateOpenAIImageInput(image) {
  if (!image) {
    throw new HttpError(400, ErrorCode.IMAGE_CORRUPT, 'OpenAI image input is empty.');
  }

  const raw = image.dataUrl ? image.dataUrl : image.buffer;
  let buffer = raw;

  if (typeof raw === 'string') {
    const match = /^data:(image\/(jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(raw.trim());
    if (!match) {
      throw new HttpError(400, ErrorCode.IMAGE_CORRUPT, 'Malformed image data URL supplied for OpenAI input.');
    }
    const b64 = match[3];
    if (!b64 || b64.length % 4 !== 0) {
      throw new HttpError(400, ErrorCode.IMAGE_CORRUPT, 'Malformed base64 image data URL supplied for OpenAI input.');
    }
    try {
      buffer = Buffer.from(b64, 'base64');
    } catch {
      throw new HttpError(400, ErrorCode.IMAGE_CORRUPT, 'Malformed base64 image data URL supplied for OpenAI input.');
    }
  }

  if (!buffer || buffer.length === 0) {
    throw new HttpError(400, ErrorCode.IMAGE_CORRUPT, 'OpenAI image input is empty.');
  }

  const typedBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const detectedMime = sniffMime(typedBuffer) ?? image.mimeType ?? null;
  if (!detectedMime || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(detectedMime)) {
    throw new HttpError(400, ErrorCode.IMAGE_CORRUPT, `Unsupported image format supplied to OpenAI: ${detectedMime ?? 'unknown'}`);
  }

  const probe = probeImage(typedBuffer);
  if (!probe.ok || !probe.width || !probe.height) {
    throw new HttpError(400, ErrorCode.IMAGE_CORRUPT, `Invalid image data supplied to OpenAI: ${detectedMime}`);
  }

  const safeMime = detectedMime;
  return {
    ...image,
    buffer: typedBuffer,
    mimeType: safeMime,
    fileName: typeof image.fileName === 'string' ? image.fileName.slice(0, 120) : image.originalName ?? null,
    byteLength: typedBuffer.length,
    detectedMime: safeMime,
    isEmpty: typedBuffer.length === 0,
    hasExpectedDataUrl: typeof image.dataUrl === 'string' ? /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(image.dataUrl.trim()) : true,
  };
}

export function buildOpenAIRequest({ images = [], mode = 'image', describe = '', hint = '', region = 'US', language = 'en-US' }) {
  const usable = images
    .map((image) => {
      try {
        return validateOpenAIImageInput(image);
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }
        throw new HttpError(400, ErrorCode.IMAGE_CORRUPT, 'OpenAI image input could not be validated.');
      }
    })
    .filter((image) => image?.buffer?.length > 0);
  const content = [];

  if (usable.length === 0 && mode !== 'describe') {
    mode = 'describe';
  }

  for (const [index, image] of usable.entries()) {
    if (mode === 'video') {
      content.push({ type: 'input_text', text: `Frame ${index + 1} of ${usable.length}${image.frameTimeMs ? ` (t=${(image.frameTimeMs / 1000).toFixed(1)}s)` : ''}:` });
    }
    const imageDiagnostics = {
      mimeType: image.detectedMime ?? image.mimeType ?? 'unknown',
      fileName: image.fileName ?? image.originalName ?? null,
      byteLength: image.byteLength ?? image.buffer?.length ?? 0,
      detectedFormat: image.detectedMime ?? image.mimeType ?? 'unknown',
      isEmpty: !(image.buffer?.length > 0),
      dataUrlFormatOk: /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(dataUri(image).split(',')[0] + ',')
    };
    log.debug('[TRACE ai] OpenAI image diagnostics', imageDiagnostics);
    content.push({
      type: 'input_image',
      image_url: dataUri(image),
      detail: 'high',
    });
  }

  content.push({
    type: 'input_text',
    text: buildUserPrompt({
      mode,
      describe,
      hint,
      region,
      language,
      frameCount: usable.length,
    }),
  });

  return {
    model: config.ai.model,
    instructions: SYSTEM_PROMPT,
    input: [{ role: 'user', content }],
    max_output_tokens: 1200,
    text: {
      format: { type: 'json_object' },
    },
    store: false,
  };
}

export function normaliseOpenAIResponseText(response) {
  const candidates = [
    response?.output_text,
    response?.output?.map((item) => item?.content ?? []).flat().map((part) => part?.text ?? '').join('\n'),
    response?.choices?.[0]?.message?.content,
  ];

  const text = candidates.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
  if (!text) {
    log.error('OpenAI response parsing failed: provider returned no usable message', {
      provider: 'openai',
      model: config.ai.model,
      classification: 'response parsing failure',
      responseShape: Object.keys(response ?? {}).slice(0, 10),
    });
    throw new HttpError(502, ErrorCode.AI_INVALID_RESPONSE, 'Vision provider returned an empty message.');
  }
  return String(text);
}

export const openaiVision = {
  name: 'openai',
  isMock: false,

  async analyze({ images = [], mode = 'image', describe = '', hint = '', region = 'US', language = 'en-US', callIndex = 0 }) {
    log.info('[TRACE recognition] openaiVision.analyze started');
    if (!config.ai.enabled) {
      log.warn('[TRACE recognition] AI provider disabled');
      throw new HttpError(503, ErrorCode.AI_UNAVAILABLE, 'AI provider is not configured.');
    }
    if (callIndex >= config.ai.maxCallsPerRecognition) {
      throw new HttpError(
        429,
        ErrorCode.RATE_LIMITED,
        `AI call budget for this recognition is exhausted (${config.ai.maxCallsPerRecognition}).`
      );
    }

    const request = buildOpenAIRequest({ images, mode, describe, hint, region, language });
    log.info('[TRACE recognition] before OpenAI request', { model: config.ai.model, imageCount: images.length, mode });
    const client = new OpenAI({
      apiKey: config.ai.apiKey,
      timeout: config.ai.timeoutMs,
      maxRetries: 0,
      dangerouslyAllowBrowser: false,
    });

    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);
      try {
        const response = await client.responses.create(request, { signal: controller.signal });
        log.info('[TRACE recognition] OpenAI request returned');
        const durationMs = Date.now() - started;
        clearTimeout(timer);

        recordApiCall({
          kind: 'ai',
          provider: config.ai.provider,
          operation: 'vision',
          status: 200,
          ok: true,
          durationMs,
        });

        const raw = normaliseOpenAIResponseText(response);
        log.info('[TRACE recognition] OpenAI response parsed');
        return {
          isMock: false,
          provider: config.ai.provider,
          model: response?.model ?? config.ai.model,
          raw,
          usage: response?.usage ?? null,
        };
      } catch (error) {
        clearTimeout(timer);
        const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? 0);
        const classification = classifyOpenAIError(error, status);
        const safeMessage = classification.message || 'OpenAI request failed';
        log.error('[TRACE recognition] OpenAI adapter error', {
          name: error?.name ?? 'Error',
          status,
          safeProviderErrorCode: error?.code ?? null,
          classification: classification.classification,
          message: safeMessage,
        });

        if (status && RETRYABLE_STATUS.has(status) && attempt === 0) {
          lastError = new HttpError(502, ErrorCode.AI_UNAVAILABLE, `AI responded ${status}`);
          recordApiCall({
            kind: 'ai',
            provider: config.ai.provider,
            operation: 'vision',
            status,
            ok: false,
            durationMs: Date.now() - started,
          });
          log.warn('Retrying OpenAI vision call after provider failure', {
            provider: 'openai',
            model: config.ai.model,
            status,
            classification: classification.classification,
            message: safeMessage,
          });
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }

        if (error instanceof HttpError) throw error;

        log.error('OpenAI vision request failed', {
          provider: 'openai',
          model: config.ai.model,
          status,
          classification: classification.classification,
          message: safeMessage,
          mode,
          imageCount: images.length,
          attempt: attempt + 1,
        });

        lastError = new HttpError(502, ErrorCode.AI_UNAVAILABLE, `Vision request failed: ${safeMessage}`);
        recordApiCall({
          kind: 'ai',
          provider: config.ai.provider,
          operation: 'vision',
          status,
          ok: false,
          durationMs: Date.now() - started,
        });
        if (attempt > 0) throw lastError;
      }
    }

    throw new HttpError(502, ErrorCode.AI_UNAVAILABLE, `Vision request failed: ${lastError?.message ?? 'unknown error'}`);
  },
};

export default openaiVision;
