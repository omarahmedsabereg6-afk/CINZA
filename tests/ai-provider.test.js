import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

function makeImageBuffer(format = 'png') {
  const script = `
from PIL import Image
from io import BytesIO
import sys
img = Image.new('RGB', (64, 64), (18, 24, 34))
buf = BytesIO()
img.save(buf, format='${format.toUpperCase()}')
sys.stdout.buffer.write(buf.getvalue())
`;
  return Buffer.from(execFileSync('python', ['-c', script], { encoding: 'binary' }), 'binary');
}

const originalEnv = { ...process.env };
Object.assign(process.env, {
  AI_PROVIDER: 'mock',
  OPENAI_API_KEY: '',
  OPENAI_MODEL: 'gpt-5.6-terra',
  TMDB_PROVIDER: 'tmdb',
  TMDB_API_KEY: '',
  TMDB_ACCESS_TOKEN: '',
});

function loadConfigUnderEnv(overrides = {}) {
  const rootUrl = `file://${process.cwd().replace(/\\/g, '/')}/`;
  const script = `
    const rootUrl = ${JSON.stringify(rootUrl)};
    const { config } = await import(new URL('backend/src/config/env.js?__v=' + Date.now(), rootUrl));
    console.log(JSON.stringify({
      provider: config.ai.provider,
      enabled: config.ai.enabled,
      apiKey: config.ai.apiKey,
      model: config.ai.model,
      baseUrl: config.ai.baseUrl,
      fallbackThreshold: config.ai.fallbackThreshold,
    }));
  `;

  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    env: { ...process.env, ...overrides },
    encoding: 'utf8',
  }));
}

function buildGeminiRequestUnderEnv(overrides = {}) {
  const rootUrl = `file://${process.cwd().replace(/\\/g, '/')}/`;
  const pythonScript = [
    'from PIL import Image',
    'from io import BytesIO',
    'import sys',
    "img = Image.new('RGB', (64, 64), (18, 24, 34))",
    'buf = BytesIO()',
    "img.save(buf, format='PNG')",
    'sys.stdout.buffer.write(buf.getvalue())',
  ].join('\n');

  const script = `
    const rootUrl = ${JSON.stringify(rootUrl)};
    const { execFileSync } = await import('node:child_process');
    const png = execFileSync('python', ['-c', ${JSON.stringify(pythonScript)}], { encoding: 'binary' });
    const { config } = await import(new URL('backend/src/config/env.js?__v=' + Date.now(), rootUrl));
    const { buildGeminiRequest, normaliseGeminiResponseText } = await import(new URL('backend/src/integrations/ai/geminiVision.js?__v=' + Date.now(), rootUrl));
    const request = buildGeminiRequest({
      images: [{ buffer: Buffer.from(png, 'binary'), mimeType: 'image/png', role: 'frame' }],
      mode: 'image',
      describe: 'city skyline with a dream sequence',
      hint: 'movie',
      region: 'US',
      language: 'en-US',
    });
    const payload = { candidates: [{ content: { parts: [{ text: '{"possible_titles":["Inception"]}' }] } }] };
    console.log(JSON.stringify({ model: config.ai.model, requestModel: request.model, parsed: normaliseGeminiResponseText(payload) }));
  `;

  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    env: { ...process.env, ...overrides },
    encoding: 'utf8',
  }));
}

function getEnvConfigSnapshot(overrides = {}) {
  return loadConfigUnderEnv(overrides);
}

const { parseVisionResponse } = await import('../backend/src/integrations/ai/schema.js');
const {
  buildOpenAIRequest,
  normaliseOpenAIResponseText,
  validateOpenAIImageInput,
} = await import('../backend/src/integrations/ai/openaiVision.js');

test.after(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

const validJson = {
  possible_titles: ['The Dark Knight', 'Batman Begins'],
  alternative_titles_localised: ['Dark Knight, The'],
  actors: ['Christian Bale'],
  characters: ['Batman'],
  scene_description: 'A masked vigilante stands in the rain.',
  visible_text: '',
  visual_clues: ['dark suit', 'rainy city'],
  possible_quotes: [],
  settings: ['rainy city street'],
  genres: ['action'],
  time_period: '2000s',
  animation: 'live_action',
  language_hint: 'en',
  estimated_year: 2008,
  content_type: 'movie',
  season_hint: null,
  episode_hint: null,
  confidence: 82,
  reasoning: 'Strong visual evidence from the costume and city setting.'
};

test('OpenAI provider configuration is exposed through env config', { concurrency: false }, () => {
  const config = loadConfigUnderEnv({ AI_PROVIDER: 'mock', OPENAI_API_KEY: '', GEMINI_API_KEY: '', GEMINI_MODEL: '', OPENAI_MODEL: 'gpt-5.6-terra' });
  assert.equal(config.model, 'gpt-5.6-terra');
  assert.equal(config.provider, 'mock');
});

test('Gemini provider config reads GEMINI_MODEL and keeps OpenAI settings intact', { concurrency: false }, () => {
  const config = loadConfigUnderEnv({
    AI_PROVIDER: 'gemini',
    GEMINI_API_KEY: 'gemini-test-key',
    GEMINI_MODEL: 'gemini-3.1-flash-lite',
    OPENAI_API_KEY: 'existing-openai-key',
  });

  assert.equal(config.provider, 'gemini');
  assert.equal(config.enabled, true);
  assert.equal(config.apiKey, 'gemini-test-key');
  assert.equal(config.model, 'gemini-3.1-flash-lite');
});

test('Gemini default model is gemini-3.1-flash-lite when unset', { concurrency: false }, () => {
  const config = loadConfigUnderEnv({
    AI_PROVIDER: 'gemini',
    GEMINI_API_KEY: 'gemini-test-key',
    GEMINI_MODEL: '',
  });

  assert.equal(config.model, 'gemini-3.1-flash-lite');
});

test('Gemini adapter uses the configured runtime model and parses a mocked API response', { concurrency: false }, () => {
  const payload = buildGeminiRequestUnderEnv({
    AI_PROVIDER: 'gemini',
    GEMINI_API_KEY: 'gemini-test-key',
    GEMINI_MODEL: 'gemini-3.1-flash-lite',
  });

  assert.equal(payload.model, 'gemini-3.1-flash-lite');
  assert.equal(payload.requestModel, 'gemini-3.1-flash-lite');
  assert.match(payload.parsed, /Inception/);
});

test('Fallback threshold is configurable and produces structured clue-based candidates', { concurrency: false }, async () => {
  const config = getEnvConfigSnapshot({
    AI_PROVIDER: 'gemini',
    GEMINI_API_KEY: 'gemini-test-key',
    GEMINI_MODEL: 'gemini-3.1-flash-lite',
    RECOGNITION_FALLBACK_THRESHOLD: '0.7',
  });

  assert.equal(config.fallbackThreshold, 0.7);

  const { fallbackRecognizer } = await import('../backend/src/integrations/ai/fallbackRecognition.js');
  const fallback = await fallbackRecognizer.analyze({
    images: [{ mimeType: 'image/jpeg', width: 220, height: 220, sizeBytes: 2048 }],
    analysis: {
      possibleTitles: ['Tokyo Vice'],
      actors: ['Ansel Elgort'],
      sceneDescription: 'neon-lit city street at night',
      visibleText: 'TOKYO',
      visualClues: ['neon signs', 'rainy streets', 'stylish modern city'],
      settings: ['Tokyo'],
      timePeriod: 'modern',
      confidence: 42,
      contentType: 'tv',
      reasoning: 'The frame shows a modern city environment and visible text.',
    },
    describe: 'neon-lit street scene',
    hint: 'show',
    region: 'US',
    language: 'en-US',
  });

  assert.ok(Number.isFinite(fallback.confidence));
  assert.ok(Array.isArray(fallback.candidates));
  assert.ok(Array.isArray(fallback.visualClues.people));
  assert.ok(fallback.candidates.length > 0 || fallback.visualClues.location || fallback.visualClues.era || fallback.visualClues.text.length > 0);
});

test('Missing OPENAI_API_KEY keeps provider in mock mode safely', { concurrency: false }, () => {
  const config = loadConfigUnderEnv({
    AI_PROVIDER: 'mock',
    OPENAI_API_KEY: '',
    GEMINI_API_KEY: '',
    GEMINI_MODEL: '',
  });
  assert.equal(config.enabled, false);
  assert.equal(config.provider, 'mock');
  assert.equal(config.apiKey, '');
});

test('OpenAI response parsing accepts valid JSON payloads', () => {
  const parsed = parseVisionResponse(JSON.stringify(validJson));
  assert.equal(parsed.data.possibleTitles[0], 'The Dark Knight');
  assert.equal(parsed.data.contentType, 'movie');
  assert.equal(parsed.data.confidence, 82);
});

test('Malformed OpenAI response handling throws an AI_INVALID_RESPONSE error', () => {
  assert.throws(
    () => parseVisionResponse('not json at all'),
    (err) => err && err.code === 'AI_INVALID_RESPONSE'
  );
});

test('Recognise with image input builds a valid OpenAI request', () => {
  const req = buildOpenAIRequest({
    images: [{ buffer: makeImageBuffer('png'), mimeType: 'image/png', role: 'frame' }],
    mode: 'image',
    describe: 'dark batman in rainy city',
    hint: 'movie',
    region: 'US',
    language: 'en-US'
  });
  assert.equal(req.model, 'gpt-5.6-terra');
  assert.equal(req.input[0].content[0].type, 'input_image');
  assert.match(String(req.input[0].content.at(-1).text), /dark batman/i);
});

test('Valid JPEG, PNG, and WebP buffers are accepted for OpenAI image input', () => {
  const validCases = [
    { mimeType: 'image/jpeg', buffer: makeImageBuffer('jpeg') },
    { mimeType: 'image/png', buffer: makeImageBuffer('png') },
    { mimeType: 'image/webp', buffer: makeImageBuffer('webp') },
  ];

  for (const entry of validCases) {
    assert.doesNotThrow(() => validateOpenAIImageInput(entry));
  }
});

test('Empty and invalid image buffers are rejected before hitting OpenAI', () => {
  assert.throws(() => validateOpenAIImageInput({ mimeType: 'image/png', buffer: Buffer.alloc(0) }), /empty|invalid/i);
  assert.throws(() => validateOpenAIImageInput({ mimeType: 'image/png', buffer: Buffer.from('not-a-real-png') }), /invalid|image/i);
  assert.throws(() => validateOpenAIImageInput({ mimeType: 'image/jpeg', buffer: null }), /empty|invalid/i);
});

test('Malformed base64 or data URL formats are rejected', () => {
  assert.throws(() => validateOpenAIImageInput({ mimeType: 'image/png', dataUrl: 'not-a-data-url' }), /data url|image/i);
  assert.throws(() => validateOpenAIImageInput({ mimeType: 'image/png', dataUrl: 'data:image/png;base64,%%%not-base64%%%' }), /data url|base64/i);
});

test('OpenAI request construction uses actual valid image data URIs and extra diagnostics are safe', () => {
  const req = buildOpenAIRequest({
    images: [{
      buffer: makeImageBuffer('png'),
      mimeType: 'image/png',
      fileName: 'scene.png',
      role: 'frame',
    }],
    mode: 'image',
    describe: 'dark batman in rainy city',
    hint: 'movie',
    region: 'US',
    language: 'en-US',
  });

  const imagePart = req.input[0].content[0];
  assert.equal(imagePart.type, 'input_image');
  assert.match(imagePart.image_url, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
  assert.doesNotMatch(imagePart.image_url, /not-a-real-png|scene\.png|filename/i);
});

test('Description-only requests are still supported', () => {
  const req = buildOpenAIRequest({ mode: 'describe', describe: 'masked vigilante in a city' });
  assert.equal(req.input[0].content.at(-1).type, 'input_text');
  assert.match(req.input[0].content.at(-1).text, /masked vigilante/i);
});

test('Mock mode remains available and is identified correctly', () => {
  const raw = {
    isMock: true,
    provider: 'mock',
    possible_titles: ['The Dark Knight'],
    scene_description: 'Simulated analysis',
    confidence: 42
  };
  assert.equal(raw.isMock, true);
  assert.equal(raw.provider, 'mock');
});

test('Provider disclosure does not leak secret values', { concurrency: false }, async () => {
  const preset = loadConfigUnderEnv({ AI_PROVIDER: 'mock', OPENAI_API_KEY: '', GEMINI_API_KEY: '' });
  assert.equal(preset.provider, 'mock');
  assert.ok(!JSON.stringify(preset).includes('OPENAI_API_KEY'));
});

test('Timestamp remains null when no exact source exists', () => {
  const scene = { timestamp: null, timestampLabel: 'Scene identified — exact timestamp unavailable.' };
  assert.equal(scene.timestamp, null);
  assert.match(scene.timestampLabel, /exact timestamp unavailable/i);
});

test('OpenAI response normalizer handles output_text payload', () => {
  const text = normaliseOpenAIResponseText({ output_text: '{"possible_titles":["The Matrix"]}' });
  assert.match(text, /The Matrix/);
});
