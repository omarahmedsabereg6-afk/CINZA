/**
 * Google Gemini vision adapter.
 *
 * Keeps the existing OpenAI contract and internal response parsing intact by
 * returning the same internal `{ raw, isMock, provider, model, usage }` shape
 * expected by the shared AI pipeline.
 */
import config from '../../config/env.js';
import HttpError, { ErrorCode } from '../../utils/httpError.js';
import { createLogger } from '../../utils/logger.js';
import { recordApiCall } from '../../services/metricsService.js';
import { sniffMime, probeImage } from '../../utils/imageProbe.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';

const log = createLogger('ai:gemini');
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function redactSecrets(value) {
  return String(value ?? '')
    .replace(/AIza[0-9A-Za-z\-_]+/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/Authorization\s*[:=]\s*['"]?Bearer\s+[A-Za-z0-9._-]+/gi, 'Authorization=[REDACTED]')
    .replace(/api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9._-]+/gi, 'apiKey=[REDACTED]')
    .replace(/\b(token|key)\s*[:=]\s*['"]?[A-Za-z0-9._-]+/gi, '$1=[REDACTED]')
    .slice(0, 250);
}

function classifyGeminiError(error, fallbackStatus = 0) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? fallbackStatus);
  const code = String(error?.code ?? error?.status ?? '').toLowerCase();
  const message = redactSecrets(error?.message ?? 'Gemini request failed');
  const lower = message.toLowerCase();

  if (error?.name === 'AbortError' || lower.includes('timeout') || status === 408) {
    return { status, classification: 'timeout', message };
  }
  if (status === 400 || lower.includes('malformed') || lower.includes('invalid request') || code.includes('bad_request')) {
    return { status, classification: 'malformed Gemini request', message };
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
  if (lower.includes('image')) {
    return { status, classification: 'invalid image input', message };
  }
  return { status, classification: 'other concrete provider error', message };
}

function dataUri({ buffer, mimeType }) {
  const safeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
  const mime = mimeType && /^image\//.test(mimeType) ? mimeType : 'image/jpeg';
  return `data:${mime};base64,${safeBuffer.toString('base64')}`;
}

export function validateGeminiImageInput(image) {
  if (!image) {
    throw new HttpError(400, ErrorCode.IMAGE_CORRUPT, 'Gemini image input is empty.');
  }

  const raw = image.dataUrl ? image.dataUrl : image.buffer;
  let buffer = raw;

  if (typeof raw === 'string') {
    const match = /^data:(image\/(jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(raw.trim());
    if (!match) {
      throw new HttpError(400, ErrorCode.IMAGE_CORRUPT, 'Malformed image data URL supplied for Gemini input.');
    }
    const b64 = match[3];
    if (!b64 || b64.length % 4 !== 0) {
      throw new HttpError(400, ErrorCode.IMAGE_CORRUPT, 'Malformed base64 image data URL supplied for Gemini input.');
    }
    try {
      buffer = Buffer.from(b64, 'base64');
    } catch {
      throw new HttpError(400, ErrorCode.IMAGE_CORRUPT, 'Malformed base64 image data URL supplied for Gemini input.');
    }
  }

  if (!buffer || buffer.length === 0) {
    throw new HttpError(400, ErrorCode.IMAGE_CORRUPT, 'Gemini image input is empty.');
  }

  const typedBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const detectedMime = sniffMime(typedBuffer) ?? image.mimeType ?? null;
  if (!detectedMime || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(detectedMime)) {
    throw new HttpError(400, ErrorCode.IMAGE_CORRUPT, `Unsupported image format supplied to Gemini: ${detectedMime ?? 'unknown'}`);
  }

  const probe = probeImage(typedBuffer);
  if (!probe.ok || !probe.width || !probe.height) {
    throw new HttpError(400, ErrorCode.IMAGE_CORRUPT, `Invalid image data supplied to Gemini: ${detectedMime}`);
  }

  return {
    ...image,
    buffer: typedBuffer,
    mimeType: detectedMime,
    fileName: typeof image.fileName === 'string' ? image.fileName.slice(0, 120) : image.originalName ?? null,
    byteLength: typedBuffer.length,
    detectedMime,
    isEmpty: typedBuffer.length === 0,
  };
}

export function buildGeminiRequest({ images = [], mode = 'image', describe = '', hint = '', region = 'US', language = 'en-US' }) {
  const usable = images
    .map((image) => {
      try {
        return validateGeminiImageInput(image);
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }
        throw new HttpError(400, ErrorCode.IMAGE_CORRUPT, 'Gemini image input could not be validated.');
      }
    })
    .filter((image) => image?.buffer?.length > 0);

  if (usable.length === 0 && mode !== 'describe') {
    mode = 'describe';
  }

  const parts = [];
  for (const [index, image] of usable.entries()) {
    if (mode === 'video') {
      parts.push({ text: `Frame ${index + 1} of ${usable.length}${image.frameTimeMs ? ` (t=${(image.frameTimeMs / 1000).toFixed(1)}s)` : ''}:` });
    }

    parts.push({ inlineData: { mimeType: image.detectedMime ?? image.mimeType ?? 'image/jpeg', data: image.buffer.toString('base64') } });
  }

  parts.push({ text: buildUserPrompt({ mode, describe, hint, region, language, frameCount: usable.length }) });

  return {
    model: config.ai.model,
    contents: [{ role: 'user', parts }],
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens: 1200,
    },
  };
}

export function normaliseGeminiResponseText(response) {
  const candidates = [
    response?.candidates?.[0]?.content?.parts?.map((part) => part?.text ?? '').join('\n'),
    response?.text,
    response?.candidates?.[0]?.content?.parts?.[0]?.text,
  ];

  const text = candidates.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
  if (!text) {
    log.error('Gemini response parsing failed: provider returned no usable message', {
      provider: 'gemini',
      model: config.ai.model,
      classification: 'response parsing failure',
      responseShape: Object.keys(response ?? {}).slice(0, 10),
    });
    throw new HttpError(502, ErrorCode.AI_INVALID_RESPONSE, 'Vision provider returned an empty message.');
  }
  return String(text);
}

export const geminiVision = {
  name: 'gemini',
  isMock: false,

  async analyze({ images = [], mode = 'image', describe = '', hint = '', region = 'US', language = 'en-US', callIndex = 0 }) {
    log.info('[TRACE recognition] geminiVision.analyze started');
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

    const request = buildGeminiRequest({ images, mode, describe, hint, region, language });
    const endpoint = `${GEMINI_BASE_URL}/models/${encodeURIComponent(config.ai.model)}:generateContent`;
    const endpointHost = new URL(endpoint).host;
    const image = images[0] ?? null;
    const mimeType = image?.mimeType ?? image?.detectedMime ?? null;
    const imageBytes = image?.buffer?.length ?? 0;
    const imageDimensions = image?.width && image?.height ? `${image.width}x${image.height}` : null;

    log.info('[TRACE recognition] before Gemini request', {
      provider: 'gemini',
      model: config.ai.model,
      endpointHost,
      mimeType,
      imageByteLength: imageBytes,
      imageDimensions,
      imageCount: images.length,
      mode,
    });
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);

      try {
        const response = await fetch(`${endpoint}?key=${encodeURIComponent(config.ai.apiKey)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        clearTimeout(timer);

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const details = payload?.error?.message ?? payload?.error?.status ?? 'Gemini request failed';
          const err = new Error(details);
          err.status = response.status;
          err.code = payload?.error?.status ?? response.status;
          throw err;
        }

        recordApiCall({
          kind: 'ai',
          provider: config.ai.provider,
          operation: 'vision',
          status: 200,
          ok: true,
          durationMs: Date.now() - started,
        });

        const raw = normaliseGeminiResponseText(payload);
        log.info('[TRACE recognition] Gemini response parsed');
        return {
          isMock: false,
          provider: config.ai.provider,
          model: config.ai.model,
          raw,
          usage: { promptTokens: payload?.usageMetadata?.promptTokenCount ?? null, completionTokens: payload?.usageMetadata?.candidatesTokenCount ?? null },
        };
      } catch (error) {
        clearTimeout(timer);
        const status = Number(error?.status ?? error?.statusCode ?? 0);
        const classification = classifyGeminiError(error, status);
        const safeMessage = classification.message || 'Gemini request failed';
        log.error('[TRACE recognition] Gemini adapter error', {
          name: error?.name ?? 'Error',
          status,
          code: error?.code ?? null,
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
          log.warn('Retrying Gemini vision call after provider failure', {
            provider: 'gemini',
            model: config.ai.model,
            status,
            classification: classification.classification,
            message: safeMessage,
          });
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }

        if (error instanceof HttpError) throw error;

        log.error('Gemini vision request failed', {
          provider: 'gemini',
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

export default geminiVision;
