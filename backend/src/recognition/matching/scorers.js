/**
 * The matching engine's scorers (section 13).
 *
 * Design principles:
 *  - Each clue type is a SEPARATE, independently testable function returning 0..1.
 *    Nothing is hard-coded to a single source of truth, which is what "do not simply
 *    use the first TMDB result" demands.
 *  - When a clue is genuinely unavailable we return a NEUTRAL 0.5, not 0. Punishing a
 *    candidate for evidence that does not exist would silently bias results toward
 *    titles that happen to have richer metadata.
 *  - The weights below are the tuning surface. They are exported so a future version
 *    can learn them from RecognitionFeedback instead of hand-tuning.
 *  - Scores are fuzzy by design: subtitles drift, cast lists are incomplete, years are
 *    guessed in different regions, so exact equality is never required.
 */
import { titleSimilarity, bestNameSimilarity, containsLoose, clamp01, normaliseTitle } from '../../utils/similarity.js';

export const WEIGHTS = Object.freeze({
  title: 0.28,
  actors: 0.18,
  characters: 0.12,
  clues: 0.12,
  year: 0.1,
  genres: 0.07,
  visibleText: 0.07,
  contentType: 0.06,
});

/** Above this similarity two names are treated as the same person. */
const NAME_MATCH_THRESHOLD = 0.87;

/* ---------------------------------------------------------------- *
 * Individual scorers
 * ---------------------------------------------------------------- */

/**
 * Title similarity across every title the vision stage proposed, including the
 * original-language title. A candidate matching hint #1 scores higher than one
 * matching hint #4, because the model's ordering carries information.
 */
export function scoreTitle(analysis, candidate) {
  const hints = [...(analysis.possibleTitles ?? []), ...(analysis.alternativeTitles ?? [])];
  if (hints.length === 0) return { score: 0.5, detail: 'no title hints' };

  const candidateTitles = [candidate.title, candidate.originalTitle].filter(Boolean);
  if (candidateTitles.length === 0) return { score: 0, detail: 'candidate has no title' };

  let best = 0;
  let bestDetail = '';
  hints.forEach((hint, index) => {
    const rankDiscount = index === 0 ? 1 : Math.max(0.55, 1 - index * 0.11);
    for (const title of candidateTitles) {
      const similarity = titleSimilarity(hint, title);
      const weighted = similarity * rankDiscount;
      if (weighted > best) {
        best = weighted;
        bestDetail = `"${hint}" ≈ "${title}" (${(similarity * 100).toFixed(0)}%${index ? `, hint #${index + 1}` : ''})`;
      }
    }
  });

  return { score: clamp01(best), detail: bestDetail || 'no title overlap' };
}

/**
 * Actor coverage: what fraction of the actors the model spotted can be found in
 * this candidate's cast. Partial credit for near-misses on spelling.
 */
export function scoreActors(analysis, candidate) {
  const observed = analysis.actors ?? [];
  const cast = (candidate.cast ?? []).map((c) => (typeof c === 'string' ? c : c?.name)).filter(Boolean);
  if (observed.length === 0) return { score: 0.5, detail: 'no actors recognised' };
  if (cast.length === 0) return { score: 0.4, detail: 'candidate cast unavailable' };

  const matches = [];
  for (const actor of observed) {
    const similarity = bestNameSimilarity(actor, cast);
    if (similarity >= NAME_MATCH_THRESHOLD) matches.push(actor);
  }

  // Coverage matters more than raw count, but a single confirmed actor should not
  // score as highly as three, so we blend coverage with a small absolute component.
  const coverage = matches.length / observed.length;
  const absolute = Math.min(1, matches.length / 2);
  return {
    score: clamp01(coverage * 0.75 + absolute * 0.25),
    detail: matches.length ? `matched ${matches.length}/${observed.length}: ${matches.join(', ')}` : 'no actor overlap',
  };
}

/** Character-name coverage against the credited characters of a candidate. */
export function scoreCharacters(analysis, candidate) {
  const observed = analysis.characters ?? [];
  const characters = (candidate.characters ?? []).filter(Boolean);
  if (observed.length === 0) return { score: 0.5, detail: 'no characters recognised' };
  if (characters.length === 0) return { score: 0.45, detail: 'character data unavailable' };

  const matches = [];
  for (const character of observed) {
    const similarity = bestNameSimilarity(character, characters);
    if (similarity >= NAME_MATCH_THRESHOLD) matches.push(character);
    else if (characters.some((c) => containsLoose(c, character))) matches.push(character);
  }
  const coverage = matches.length / observed.length;
  return {
    score: clamp01(coverage),
    detail: matches.length ? `characters: ${matches.join(', ')}` : 'no character overlap',
  };
}

/**
 * Year proximity. A miss does not disqualify a candidate — models frequently guess
 * the era depicted rather than the release year — so the curve degrades gently and
 * never reaches zero inside a decade.
 */
export function scoreYear(analysis, candidate) {
  const estimated = analysis.estimatedYear;
  const actual = candidate.year;
  if (!estimated || !actual) return { score: 0.5, detail: 'year unknown on one side' };

  const diff = Math.abs(estimated - actual);
  const curve = diff === 0 ? 1 : diff === 1 ? 0.88 : diff === 2 ? 0.66 : diff <= 4 ? 0.42 : diff <= 8 ? 0.22 : 0.08;
  return { score: curve, detail: `estimated ${estimated} vs ${actual} (Δ${diff}y)` };
}

/** Genre overlap, using a symmetric difference so extra genres are only mildly penalised. */
export function scoreGenres(analysis, candidate) {
  const observed = (analysis.genres ?? []).map(normaliseTitle).filter(Boolean);
  const candidateGenres = (candidate.genres ?? []).map(normaliseTitle).filter(Boolean);
  if (observed.length === 0 || candidateGenres.length === 0) return { score: 0.5, detail: 'genre data incomplete' };

  let hits = 0;
  for (const genre of observed) {
    if (candidateGenres.some((g) => g.includes(genre) || genre.includes(g))) hits += 1;
  }
  const recall = hits / observed.length;
  const precision = hits / candidateGenres.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { score: clamp01(f1), detail: hits ? `${hits} genre match(es)` : 'no genre overlap' };
}

/**
 * Visual clues and settings. This is the scorer that lets a candidate win on
 * evidence the model never turned into a title — a location, a costume, a vehicle.
 */
export function scoreClues(analysis, candidate) {
  const clues = [...(analysis.visualClues ?? []), ...(analysis.settings ?? [])].filter(Boolean);
  if (clues.length === 0) return { score: 0.5, detail: 'no visual clues' };

  const haystack = [
    candidate.title,
    candidate.originalTitle,
    candidate.overview,
    ...(candidate.keywords ?? []),
    ...(candidate.genres ?? []),
    ...(candidate.characters ?? []),
  ]
    .filter(Boolean)
    .join(' ');

  if (!haystack) return { score: 0.5, detail: 'candidate metadata too thin to compare' };

  let hits = 0;
  for (const clue of clues) {
    if (containsLoose(haystack, clue)) hits += 1;
  }
  if (hits === 0) return { score: 0.25, detail: 'no clue corroboration (weak negative evidence)' };
  return { score: clamp01(0.35 + (hits / clues.length) * 0.65), detail: `${hits}/${clues.length} clue(s) corroborated` };
}

/**
 * Visible on-screen text (subtitle line, sign, logo, caption).
 * Compared against cast names and overview text, since a transcribed subtitle line
 * rarely equals the title but often contains a character or actor name.
 */
export function scoreVisibleText(analysis, candidate) {
  const text = analysis.visibleText ?? '';
  if (!text.trim()) return { score: 0.5, detail: 'no visible text' };

  const cast = (candidate.cast ?? []).map((c) => (typeof c === 'string' ? c : c?.name)).filter(Boolean);
  const targets = [candidate.title, candidate.originalTitle, ...cast, ...(candidate.characters ?? [])].filter(Boolean);

  for (const target of targets) {
    if (containsLoose(text, target)) return { score: 0.95, detail: `visible text contains "${target}"` };
  }
  // A quoted line that overlaps the overview is weak but real evidence.
  if (candidate.overview && containsLoose(candidate.overview, text.slice(0, 40))) {
    return { score: 0.7, detail: 'visible text echoes the synopsis' };
  }
  return { score: 0.3, detail: 'visible text did not corroborate this candidate' };
}

/** Movie vs series. A confident mismatch is meaningful evidence against a candidate. */
export function scoreContentType(analysis, candidate) {
  const observed = analysis.contentType;
  if (!observed || observed === 'unknown') return { score: 0.5, detail: 'content type not determined' };
  if (observed === candidate.mediaType) return { score: 1, detail: `content type agrees (${observed})` };
  return { score: 0, detail: `content type conflict: model says ${observed}, candidate is ${candidate.mediaType}` };
}

/* ---------------------------------------------------------------- *
 * Aggregation
 * ---------------------------------------------------------------- */

export const SCORERS = {
  title: scoreTitle,
  actors: scoreActors,
  characters: scoreCharacters,
  clues: scoreClues,
  year: scoreYear,
  genres: scoreGenres,
  visibleText: scoreVisibleText,
  contentType: scoreContentType,
};

/**
 * Runs every scorer and returns a weighted score plus a full breakdown.
 * The breakdown is persisted on RecognitionCandidate and rendered in the app's
 * "why this match" panel, so a result is always explainable.
 */
export function scoreCandidate(analysis, candidate, { weights = WEIGHTS } = {}) {
  const parts = {};
  let total = 0;
  let weightSum = 0;

  for (const [key, scorer] of Object.entries(SCORERS)) {
    const weight = weights[key] ?? 0;
    let result;
    try {
      result = scorer(analysis, candidate);
    } catch (error) {
      result = { score: 0.5, detail: `scorer error: ${error.message}` };
    }
    const score = clamp01(result.score);
    parts[key] = { score: Number(score.toFixed(4)), weight, detail: result.detail ?? '' };
    total += score * weight;
    weightSum += weight;
  }

  const weighted = weightSum === 0 ? 0 : total / weightSum;

  return {
    score: Number(clamp01(weighted).toFixed(4)),
    breakdown: parts,
  };
}

/**
 * Cheap pre-ranking used to decide which candidates deserve a (paid) detail fetch.
 * Uses only information already present in the search response.
 */
export function preRank(analysis, candidates) {
  return candidates
    .map((candidate) => {
      const title = scoreTitle(analysis, candidate);
      const year = scoreYear(analysis, candidate);
      const type = scoreContentType(analysis, candidate);
      const popularity = candidate.popularity ? Math.min(1, candidate.popularity / 150) : 0.3;
      const seed = candidate.seedScore ?? 0;
      return {
        candidate,
        preScore: title.score * 0.5 + year.score * 0.14 + type.score * 0.14 + popularity * 0.1 + seed * 0.12,
      };
    })
    .sort((a, b) => b.preScore - a.preScore);
}

export default { SCORERS, WEIGHTS, scoreCandidate, preRank };
