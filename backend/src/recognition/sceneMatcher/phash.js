/**
 * Perceptual hashing helpers (server side).
 *
 * The hashes themselves are computed ON THE DEVICE, in `app/js/services/image.js`,
 * because the browser/WebView already has decoded pixels while the server does not
 * (and we deliberately avoid a native image dependency, see utils/imageProbe.js).
 *
 * This module only compares hashes. A 64-bit difference hash is enough to recognise
 * that two frames are the same shot; it is NOT enough to recognise a shot we have
 * never indexed, which is why SceneMatcher is an index of confirmed frames rather
 * than a claim of worldwide scene search.
 */
import { hammingDistanceHex } from '../../utils/ids.js';
import { clamp01 } from '../../utils/similarity.js';

export const HASH_BITS = 64;

/**
 * Similarity from Hamming distance.
 *  - 0-4 bits apart  -> effectively the same frame (JPEG noise, scaling)
 *  - 5-10            -> same shot, different moment or heavy compression
 *  - 11-18           -> related imagery, same location or similar composition
 *  - > 18            -> unrelated
 */
export function hammingSimilarity(a, b, bits = HASH_BITS) {
  if (!a || !b) return 0;
  const distance = hammingDistanceHex(a, b);
  if (distance === Number.MAX_SAFE_INTEGER) return 0;
  return clamp01(1 - distance / bits);
}

/** Piecewise similarity tuned to the bands above, which discriminates better than the linear form. */
export function gradedSimilarity(a, b) {
  if (!a || !b) return 0;
  const distance = hammingDistanceHex(a, b);
  if (distance === Number.MAX_SAFE_INTEGER) return 0;
  if (distance <= 4) return 1;
  if (distance <= 10) return 0.85 - (distance - 4) * 0.02;
  if (distance <= 18) return 0.72 - (distance - 10) * 0.035;
  return Math.max(0, 0.44 - (distance - 18) * 0.02);
}

/** Combines several hash families into one similarity, which is far more robust than any single one. */
export function combinedSimilarity(a, b) {
  const parts = [];
  if (a.dHash && b.dHash) parts.push({ value: gradedSimilarity(a.dHash, b.dHash), weight: 0.5 });
  if (a.pHash && b.pHash) parts.push({ value: gradedSimilarity(a.pHash, b.pHash), weight: 0.35 });
  if (a.aHash && b.aHash) parts.push({ value: gradedSimilarity(a.aHash, b.aHash), weight: 0.15 });
  if (parts.length === 0) return 0;

  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  return clamp01(parts.reduce((sum, p) => sum + p.value * p.weight, 0) / totalWeight);
}

export const isValidHash = (value) => typeof value === 'string' && /^[0-9a-f]{16}$/i.test(value);

export default { hammingSimilarity, gradedSimilarity, combinedSimilarity, isValidHash, HASH_BITS };
