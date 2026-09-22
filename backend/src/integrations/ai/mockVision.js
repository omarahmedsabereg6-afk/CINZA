/**
 * Mock vision adapter (section 32).
 *
 * This is NOT a fake AI. It is an honest stand-in that:
 *   1. Explains, in its own output, that it is simulated (`isMock: true`).
 *   2. Is *deterministic*: the same image + the same description always produce the
 *      same analysis, so the pipeline can be tested repeatably.
 *   3. Is *driven by real input*: it reads the user's "describe the scene" text and
 *      the image bytes. That means the full end-to-end flow — upload, candidates,
 *      matching, confidence, result, history — can be exercised and demonstrated
 *      before any AI key exists, with results that make sense to a human tester.
 *
 * It never claims a title it has no input for: with no description and no usable
 * signal it returns low confidence and `content_type: "unknown"`.
 */
import { CATALOG, TRENDING, findById } from '../tmdb/fixtures/catalog.js';
import { sha256Hex } from '../../utils/ids.js';
import { normaliseTitle, titleSimilarity } from '../../utils/similarity.js';

/** Scores a catalog entry against free text (description, filename, hint). */
function scoreEntry(entry, text) {
  const q = normaliseTitle(text);
  if (!q) return 0;

  const words = q.split(' ').filter((w) => w.length > 2);
  if (!words.length) return titleSimilarity(text, entry.title);

  let score = titleSimilarity(text, entry.title) * 1.2;
  if (entry.originalTitle) score = Math.max(score, titleSimilarity(text, entry.originalTitle) * 1.05);

  const buckets = {
    keywords: entry.keywords.map(normaliseTitle),
    cast: entry.cast.map(normaliseTitle),
    characters: entry.characters.map(normaliseTitle),
    crew: [...entry.director, ...entry.writers].map(normaliseTitle),
    genres: entry.genres.map(normaliseTitle),
    clues: entry.visualClues.map(normaliseTitle),
  };

  const weights = { keywords: 1.4, cast: 1.5, characters: 1.3, crew: 1.1, genres: 0.8, clues: 1.2 };

  for (const [bucket, values] of Object.entries(buckets)) {
    const hit = words.filter((w) => values.some((v) => v.includes(w) || w.includes(v))).length;
    if (hit) score += (hit / words.length) * weights[bucket];
  }
  return score;
}

/** Deterministic integer from a string, used only to break ties. */
function seedFrom(text) {
  const hex = sha256Hex(text).slice(0, 8);
  return Number.parseInt(hex, 16);
}

export const mockVision = {
  name: 'mock',
  isMock: true,

  /**
   * @param {object} input
   * @param {Array<{buffer:Buffer, mimeType:string, role:string, frameTimeMs?:number}>} input.images
   * @param {'image'|'video'|'describe'} input.mode
   * @param {string} [input.describe]  user-provided scene description
   * @param {string} [input.hint]      extra app-supplied context
   */
  async analyze({ images = [], mode = 'image', describe = '', hint = '' }) {
    const combined = [describe, hint].filter(Boolean).join(' ');
    const firstBuffer = images[0]?.buffer ?? Buffer.alloc(0);
    const seed = seedFrom(`${combined}|${mode}|${firstBuffer.length}|${sha256Hex(firstBuffer).slice(0, 16)}`);

    const ranked = CATALOG.map((entry) => ({ entry, score: scoreEntry(entry, combined) })).sort(
      (a, b) => b.score - a.score || (seed % 2 === 0 ? 1 : -1)
    );

    const best = ranked[0];
    const hasSignal = Boolean(normaliseTitle(combined)) && best && best.score >= 0.9;

    const log = []; // human-readable provenance, surfaced in the result's debug panel

    if (!hasSignal) {
      // No usable description. Be explicit about it instead of inventing an answer.
      const decoys = TRENDING.slice(0, 3)
        .map((id) => findById(id))
        .filter(Boolean);
      log.push('No scene description was supplied, so the mock vision adapter has no signal to work from.');
      log.push('Provide a description of the scene (or an AI_API_KEY) to get a meaningful analysed result.');

      return {
        isMock: true,
        provider: 'mock',
        possible_titles: decoys.map((d) => d.title),
        alternative_titles_localised: [],
        actors: [],
        characters: [],
        scene_description:
          images.length > 1
            ? `Simulated analysis of ${images.length} frames. No description was supplied, so no real visual inference was performed.`
            : 'Simulated analysis. No description was supplied, so no real visual inference was performed.',
        visible_text: '',
        visual_clues: [],
        possible_quotes: [],
        settings: [],
        genres: [],
        time_period: '',
        animation: 'unknown',
        language_hint: '',
        estimated_year: null,
        content_type: 'unknown',
        season_hint: null,
        episode_hint: null,
        confidence: 8,
        reasoning: 'Mock adapter with no input signal.',
        debug: { mockLog: log, candidateTitlesAreDecoys: true },
      };
    }

    const { entry, score } = best;
    const normalisedScore = Math.min(1, score / 4.5);
    // Capped well below a real model's range on purpose: a simulated result must
    // never look as trustworthy as an analysed one.
    const confidence = Math.max(18, Math.min(62, Math.round(normalisedScore * 68)));

    log.push(`Matched description keywords against the mock catalog fixture and selected "${entry.title}".`);
    log.push(`Raw score ${score.toFixed(2)} -> simulated confidence ${confidence}.`);
    log.push('Replace this adapter with AI_PROVIDER=openai + AI_API_KEY for real vision analysis.');

    const frames = images.filter((i) => i.role === 'frame').length;
    const sceneDescription = describe
      ? `User-described scene, matched to fixture data: ${describe.slice(0, 240)}`
      : frames
        ? `Simulated analysis over ${frames} sampled video frames.`
        : 'Simulated analysis of a single frame.';

    return {
      isMock: true,
      provider: 'mock',
      possible_titles: ranked.slice(0, 5).map((r) => r.entry.title),
      alternative_titles_localised: entry.originalTitle && entry.originalTitle !== entry.title ? [entry.originalTitle] : [],
      actors: entry.cast.slice(0, 5),
      characters: entry.characters.slice(0, 5),
      scene_description: sceneDescription,
      visible_text: '',
      visual_clues: entry.visualClues.slice(0, 6),
      possible_quotes: [],
      settings: [],
      genres: entry.genres,
      time_period: '',
      animation: entry.genres.includes('Animation') ? 'animation' : 'live_action',
      language_hint: '',
      estimated_year: entry.year,
      content_type: entry.mediaType,
      season_hint: null,
      episode_hint: null,
      confidence,
      reasoning: `Simulated: description matched the "${entry.title}" fixture (score ${score.toFixed(2)}).`,
      debug: { mockLog: log, topScores: ranked.slice(0, 5).map((r) => ({ title: r.entry.title, score: Number(r.score.toFixed(2)) })) },
    };
  },
};

export default mockVision;
