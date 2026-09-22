/** Id / token / hashing helpers used across the backend. */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');

/** Stable hash of an image buffer + normalisation version + mode. */
export function inputHash({ buffer, mode = 'image', version = 'v1', extra = '' }) {
  const h = createHash('sha256');
  h.update(version);
  h.update('|');
  h.update(mode);
  h.update('|');
  h.update(extra);
  h.update('|');
  h.update(buffer);
  return h.digest('hex');
}

export const randomToken = (bytes = 48) => randomBytes(bytes).toString('base64url');
export { randomUUID };

/** Constant-time comparison that never throws on length mismatch. */
export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Hamming distance between two hex-encoded bitstrings (perceptual hashes). */
export function hammingDistanceHex(a, b) {
  if (!a || !b || a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    distance += ((x >> 3) & 1) + ((x >> 2) & 1) + ((x >> 1) & 1) + (x & 1);
  }
  return distance;
}

export default { sha256Hex, inputHash, randomToken, randomUUID, safeEqual, hammingDistanceHex };
