/**
 * Text similarity toolkit for the matching engine (section 13).
 *
 * Everything here is pure and synchronous so the engine stays easy to unit test
 * and cheap to run over dozens of candidates.
 */

/** Damerau-Levenshtein distance (with transposition), bounded for speed. */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        curr[j] = Math.min(curr[j], prev[j - 2] + 1);
      }
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** 0..1 similarity derived from edit distance. */
export function editSimilarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const longest = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / longest;
}

/**
 * Normalises a title for comparison:
 *  - lowercase, strip diacritics
 *  - drop articles/qualifiers that differ between releases
 *  - collapse punctuation and whitespace
 *  - keep trailing digits because sequels depend on them ("2", "part ii", "iii")
 */
const NOISE = [
  'the', 'a', 'an', 'and', 'of', 'le', 'la', 'les', 'el', 'los', 'las', 'der', 'die', 'das',
  'movie', 'film', 'series', 'tv',
];
const ROMAN = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10',
};

export function normaliseTitle(input) {
  if (!input) return '';
  let s = String(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  s = s
    .split(' ')
    .map((w) => ROMAN[w] ?? w)
    .filter((w) => !NOISE.includes(w))
    .join(' ');
  return s || String(input).toLowerCase().trim();
}

/** Character n-grams of a string. */
export function ngrams(input, n = 3) {
  const s = ` ${input} `;
  const out = new Set();
  if (s.length <= n) {
    out.add(s.trim());
    return out;
  }
  for (let i = 0; i <= s.length - n; i += 1) out.add(s.slice(i, i + n));
  return out;
}

/** Dice coefficient over character trigrams — robust to word order and typos. */
export function diceCoefficient(a, b, n = 3) {
  const A = ngrams(a, n);
  const B = ngrams(b, n);
  if (!A.size || !B.size) return 0;
  let overlap = 0;
  for (const g of A) if (B.has(g)) overlap += 1;
  return (2 * overlap) / (A.size + B.size);
}

/** token_set_ratio style score: order-independent overlap of word sets. */
export function tokenSetRatio(a, b) {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared += 1;
  const precision = shared / B.size;
  const recall = shared / A.size;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall); // F1
}

/**
 * Combined title similarity used by the matcher.
 * Weighted blend because no single metric is reliable:
 *  - dice  : typos, punctuation, subtitle drift
 *  - token : word reordering ("Dark Knight, The")
 *  - edit  : short titles where n-grams are noisy
 *  - containment: one title fully inside the other (e.g. "Dune" vs "Dune Part Two")
 */
export function titleSimilarity(rawA, rawB) {
  const a = normaliseTitle(rawA);
  const b = normaliseTitle(rawB);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const dice = diceCoefficient(a, b);
  const token = tokenSetRatio(a, b);
  const edit = editSimilarity(a, b);
  const containment =
    a.includes(b) || b.includes(a)
      ? Math.min(a.length, b.length) / Math.max(a.length, b.length)
      : 0;

  return clamp01(dice * 0.34 + token * 0.26 + edit * 0.22 + containment * 0.18);
}

/**
 * Best similarity between a single query name and any name in a candidate pool.
 * Used for cast/character comparison where a clue may match any credited person.
 */
export function bestNameSimilarity(query, pool = []) {
  if (!query || !pool.length) return 0;
  let best = 0;
  for (const name of pool) {
    const score = titleSimilarity(query, name);
    if (score > best) best = score;
    if (best === 1) break;
  }
  return best;
}

/** Fuzzy case-insensitive "is this substring roughly present anywhere" check. */
export function containsLoose(haystackRaw, needleRaw) {
  if (!haystackRaw || !needleRaw) return false;
  const haystack = normaliseTitle(haystackRaw);
  const needle = normaliseTitle(needleRaw);
  if (!needle) return false;
  if (haystack.includes(needle)) return true;
  const words = needle.split(' ').filter((w) => w.length > 3);
  if (!words.length) return false;
  const matched = words.filter((w) => haystack.includes(w)).length;
  return matched / words.length >= 0.6;
}

export function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Pretty-prints two strings side by side — handy when tuning weights. */
export function explainTitleMatch(a, b) {
  return {
    a: normaliseTitle(a),
    b: normaliseTitle(b),
    dice: Number(diceCoefficient(normaliseTitle(a), normaliseTitle(b)).toFixed(3)),
    token: Number(tokenSetRatio(normaliseTitle(a), normaliseTitle(b)).toFixed(3)),
    edit: Number(editSimilarity(normaliseTitle(a), normaliseTitle(b)).toFixed(3)),
    combined: Number(titleSimilarity(a, b).toFixed(3)),
  };
}

export default {
  levenshtein,
  editSimilarity,
  normaliseTitle,
  diceCoefficient,
  tokenSetRatio,
  titleSimilarity,
  bestNameSimilarity,
  containsLoose,
  clamp01,
  explainTitleMatch,
};
