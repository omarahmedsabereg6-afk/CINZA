import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
loadEnv({ path: path.join(projectRoot, '.env'), quiet: true });

const provider = 'gemini';
const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const apiKey = process.env.GEMINI_API_KEY || '';
const imagePath = path.join(projectRoot, 'tmp-real-recognition.jpg');

function sanitizeProviderError(value) {
  const raw = value == null ? '' : String(value);
  return raw
    .replace(/AIza[0-9A-Za-z\-_]+/g, '[REDACTED]')
    .replace(/x-goog-api-key\s*[:=]\s*['"]?[A-Za-z0-9._\-]+/gi, 'x-goog-api-key=[REDACTED]')
    .replace(/Authorization\s*[:=]\s*['"]?Bearer\s+[A-Za-z0-9._\-]+/gi, 'Authorization=[REDACTED]')
    .replace(/\bkey\s*[:=]\s*['"]?[A-Za-z0-9._\-]+/gi, 'key=[REDACTED]')
    .slice(0, 500);
}

function buildGeminiError(payload, fallbackStatus) {
  const error = payload?.error ?? payload;
  const message = sanitizeProviderError(error?.message || error?.status || payload || 'Gemini request failed');
  const status = Number(error?.status ?? payload?.status ?? fallbackStatus ?? 0);
  return { status, message };
}

async function postGenerativeText(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: [{
      role: 'user',
      parts: [{ text }],
    }],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  const rawText = await response.text();
  let payload = null;
  try { payload = JSON.parse(rawText); } catch {}

  return {
    status: response.status,
    ok: response.ok,
    providerError: response.ok ? null : buildGeminiError(payload, response.status).message,
    payload,
    rawText,
  };
}

async function postGenerativeImage(imagePathOnDisk) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const buffer = fs.readFileSync(imagePathOnDisk);
  const base64 = buffer.toString('base64');

  const body = {
    contents: [{
      role: 'user',
      parts: [
        {
          text: 'Identify the movie or TV series shown in this image. Return the title and explain the visual evidence.',
        },
        {
          inline_data: {
            mime_type: 'image/jpeg',
            data: base64,
          },
        },
      ],
    }],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  const rawText = await response.text();
  let payload = null;
  try { payload = JSON.parse(rawText); } catch {}

  return {
    status: response.status,
    ok: response.ok,
    providerError: response.ok ? null : buildGeminiError(payload, response.status).message,
    payload,
    rawText,
  };
}

async function main() {
  if (!apiKey) {
    console.log(JSON.stringify({
      provider,
      model,
      phase: 'text-only',
      httpStatus: 0,
      success: false,
      sanitizedProviderError: 'GEMINI_API_KEY is missing',
    }, null, 2));
    process.exit(1);
  }

  const textResult = await postGenerativeText('Reply with exactly: CINZA_GEMINI_OK');
  const textSuccess = textResult.ok && typeof textResult.payload?.candidates?.[0]?.content?.parts?.some((part) => String(part?.text ?? '').includes('CINZA_GEMINI_OK')) === 'boolean'
    ? textResult.payload.candidates[0].content.parts.some((part) => String(part?.text ?? '').includes('CINZA_GEMINI_OK'))
    : false;

  console.log(JSON.stringify({
    provider,
    model,
    phase: 'text-only',
    httpStatus: textResult.status,
    success: textSuccess,
    sanitizedProviderError: textSuccess ? null : (textResult.providerError || 'Gemini text request failed'),
  }, null, 2));

  if (!textSuccess) {
    process.exit(0);
  }

  if (!fs.existsSync(imagePath)) {
    console.log(JSON.stringify({
      provider,
      model,
      phase: 'image',
      httpStatus: 0,
      success: false,
      sanitizedProviderError: 'Known-good Gemini image asset is missing',
    }, null, 2));
    process.exit(1);
  }

  const imageResult = await postGenerativeImage(imagePath);
  console.log(JSON.stringify({
    provider,
    model,
    phase: 'image',
    httpStatus: imageResult.status,
    success: imageResult.ok,
    sanitizedProviderError: imageResult.ok ? null : (imageResult.providerError || 'Gemini image request failed'),
  }, null, 2));
}

main().catch((error) => {
  console.log(JSON.stringify({
    provider,
    model,
    phase: 'diagnostic',
    httpStatus: 0,
    success: false,
    sanitizedProviderError: sanitizeProviderError(error?.message || String(error)),
  }, null, 2));
  process.exit(1);
});
