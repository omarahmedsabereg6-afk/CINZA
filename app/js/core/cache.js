/**
 * Tiny TTL + LRU cache for client-side service responses.
 *
 * Keeps the app from re-fetching a title's detail every time the user navigates
 * back and forth, which is the single most noticeable performance win in a
 * navigation-heavy app (section 26).
 */
export class TtlCache {
  constructor({ max = 50, ttlMs = 5 * 60 * 1000 } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  /**
   * Read-through helper. A rejected producer is never cached, so a transient
   * failure does not poison the cache.
   */
  async wrap(key, ttlMs, producer) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await producer();
    if (value !== undefined && value !== null) this.set(key, value, ttlMs ?? this.ttlMs);
    return value;
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

export default TtlCache;
