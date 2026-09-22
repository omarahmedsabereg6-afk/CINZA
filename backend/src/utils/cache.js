/**
 * In-process TTL + LRU cache.
 *
 * Used for TMDB responses and identical-image recognition results. This is the
 * cheapest form of API cost control we have (section 41): a repeated search or a
 * re-uploaded screenshot costs zero upstream calls.
 *
 * Deliberately small and dependency-free. For multi-instance deployments swap it
 * for Redis behind the same get/set interface.
 */
export class TtlCache {
  constructor({ max = 500, ttlMs = 60_000, name = 'cache' } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.name = name;
    this.map = new Map();
    this.stats = { hits: 0, misses: 0, evictions: 0, expired: 0 };
  }

  #alive(entry, now) {
    return entry.expiresAt > now;
  }

  get(key) {
    const now = Date.now();
    const entry = this.map.get(key);
    if (!entry) {
      this.stats.misses += 1;
      return undefined;
    }
    if (!this.#alive(entry, now)) {
      this.map.delete(key);
      this.stats.expired += 1;
      this.stats.misses += 1;
      return undefined;
    }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, entry);
    this.stats.hits += 1;
    return entry.value;
  }

  has(key) {
    const entry = this.map.get(key);
    return Boolean(entry && this.#alive(entry, Date.now()));
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) {
        this.map.delete(oldest);
        this.stats.evictions += 1;
      }
    }
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  /**
   * Read-through helper. `producer` only runs on a miss, so upstream is never
   * called twice for the same key while the entry is warm.
   */
  async wrap(key, ttlMs, producer) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await producer();
    if (value !== undefined) this.set(key, value, ttlMs);
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

  get hitRate() {
    const total = this.stats.hits + this.stats.misses;
    return total === 0 ? 0 : this.stats.hits / total;
  }
}

/** Shared caches, named so /api/meta/metrics can report them. */
export const caches = {
  tmdbSearch: new TtlCache({ name: 'tmdb:search', max: 800, ttlMs: 24 * 60 * 60 * 1000 }),
  tmdbDetail: new TtlCache({ name: 'tmdb:detail', max: 800, ttlMs: 24 * 60 * 60 * 1000 }),
  tmdbImages: new TtlCache({ name: 'tmdb:images', max: 400, ttlMs: 24 * 60 * 60 * 1000 }),
  providers: new TtlCache({ name: 'streaming:providers', max: 400, ttlMs: 6 * 60 * 60 * 1000 }),
  ratings: new TtlCache({ name: 'ratings:providers', max: 500, ttlMs: 24 * 60 * 60 * 1000 }),
  vision: new TtlCache({ name: 'ai:vision', max: 300, ttlMs: 30 * 24 * 60 * 60 * 1000 }),
};

export function cacheReport() {
  return Object.fromEntries(
    Object.entries(caches).map(([name, c]) => [
      name,
      { size: c.size, hits: c.stats.hits, misses: c.stats.misses, hitRate: Number(c.hitRate.toFixed(3)) },
    ])
  );
}

export default TtlCache;
