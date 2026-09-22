/**
 * JSON helpers.
 *
 * Why these exist: the canonical Prisma schema deliberately avoids the `Json` column
 * type so the same models compile for SQLite and PostgreSQL (see prisma/schema.prisma).
 * Every structured payload is therefore stored as a string and must go through here,
 * so a corrupt row can never crash a request.
 */

export function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function parseJsonArray(value) {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function stringifyJson(value) {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export default { parseJson, parseJsonArray, stringifyJson };
