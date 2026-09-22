/**
 * Fingerprint index (section 31 — exact scene matching).
 *
 * SCOPE, STATED HONESTLY: this is not a worldwide frame database, and it does not
 * pretend to be. It is an index of frames this deployment has already CONFIRMED,
 * which means:
 *
 *   - the first time a scene is identified there is nothing to match against
 *   - the second time the same commercial break, the same screenshot from a friend,
 *     or the same frame from a re-watch arrives, the exact scene matches instantly
 *     and for free
 *
 * That is a genuinely useful behaviour (it is how recognitions get *cheaper* over
 * time) and it exercises the same interface a real frame-database backend would.
 *
 * The interface is what matters for the future:
 *
 *   VectorStore.add(entry)              -> persist a fingerprint
 *   VectorStore.search(hashes, opts)    -> nearest entries by similarity
 *   VectorStore.reinforce(id)           -> bump a hit's confidence
 *   VectorStore.remove(...)             -> delete
 *
 * Swapping in image embeddings + pgvector (or FAISS/Pinecone) later means writing a
 * second implementation of this class and registering it in `index.js`. Nothing in
 * the pipeline, the services or the app changes.
 */
import { prisma } from '../../database/prisma.js';
import { createLogger } from '../../utils/logger.js';
import { combinedSimilarity, isValidHash } from './phash.js';

const log = createLogger('sceneMatcher:store');

/** A hash-prefix bucket keeps candidate comparisons small as the index grows. */
function bucketKey(hash) {
  return hash ? hash.slice(0, 2) : 'zz';
}

export class LocalHashVectorStore {
  constructor({ maxScan = 5000, cache } = {}) {
    this.name = 'local-hash';
    this.maxScan = maxScan;
    this.cache = cache ?? null;
  }

  async add({ tmdbId, mediaType, seasonNumber = null, episodeNumber = null, label = null, pHash, dHash, aHash, thumbDataUrl = null, source = 'confirmed' }) {
    if (!tmdbId || !mediaType) return null;
    if (!isValidHash(pHash) && !isValidHash(dHash) && !isValidHash(aHash)) return null;

    try {
      const created = await prisma.frameFingerprint.create({
        data: {
          tmdbId: String(tmdbId),
          mediaType,
          seasonNumber,
          episodeNumber,
          label,
          pHash: isValidHash(pHash) ? pHash.toLowerCase() : null,
          dHash: isValidHash(dHash) ? dHash.toLowerCase() : null,
          aHash: isValidHash(aHash) ? aHash.toLowerCase() : null,
          thumbDataUrl,
          source,
        },
      });
      this.cache?.delete('all');
      log.debug(`indexed fingerprint ${created.id} for ${mediaType}/${tmdbId}`);
      return created;
    } catch (error) {
      // The index is an optimisation, never a hard dependency.
      log.warn(`could not index fingerprint: ${error.message}`);
      return null;
    }
  }

  /** Reinforces an existing entry so repeated confirmations raise its weight. */
  async reinforce(id) {
    try {
      return await prisma.frameFingerprint.update({
        where: { id },
        data: { recognitionsCount: { increment: 1 } },
      });
    } catch (error) {
      log.debug(`reinforce failed for ${id}: ${error.message}`);
      return null;
    }
  }

  async remove({ tmdbId, mediaType }) {
    return prisma.frameFingerprint.deleteMany({ where: { tmdbId: String(tmdbId), mediaType } });
  }

  /** Loads the candidate set. Cached briefly because an upload burst reuses it. */
  async load(hashes) {
    if (this.cache) {
      const cached = this.cache.get('all');
      if (cached) return cached;
    }

    let entries;
    try {
      entries = await prisma.frameFingerprint.findMany({
        orderBy: { updatedAt: 'desc' },
        take: this.maxScan,
        select: {
          id: true,
          tmdbId: true,
          mediaType: true,
          seasonNumber: true,
          episodeNumber: true,
          label: true,
          pHash: true,
          dHash: true,
          aHash: true,
          thumbDataUrl: true,
          recognitionsCount: true,
        },
      });
    } catch (error) {
      log.warn(`fingerprint index unavailable: ${error.message}`);
      return [];
    }

    if (this.cache) this.cache.set('all', entries, 15_000);
    return entries;
  }

  /**
   * Nearest-neighbour search by combined hash similarity.
   * @returns {Promise<Array<{id,tmdbId,mediaType,similarity,distanceLabel,label,thumbDataUrl}>>}
   */
  async search({ pHash, dHash, aHash }, { limit = 5, minSimilarity = 0.72 } = {}) {
    if (!isValidHash(pHash) && !isValidHash(dHash) && !isValidHash(aHash)) return [];

    const query = { pHash, dHash, aHash };
    const entries = await this.load(query);
    if (entries.length === 0) return [];

    const scored = [];
    for (const entry of entries) {
      const similarity = combinedSimilarity(query, entry);
      if (similarity < minSimilarity) continue;
      scored.push({
        id: entry.id,
        tmdbId: entry.tmdbId,
        mediaType: entry.mediaType,
        seasonNumber: entry.seasonNumber,
        episodeNumber: entry.episodeNumber,
        label: entry.label,
        thumbDataUrl: entry.thumbDataUrl,
        recognitionsCount: entry.recognitionsCount,
        similarity: Number(similarity.toFixed(4)),
        distanceLabel:
          similarity >= 0.97 ? 'same frame' : similarity >= 0.88 ? 'same shot' : 'similar composition',
        strategy: this.name,
      });
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    log.debug(`fingerprint search: ${scored.length} hit(s) above ${minSimilarity} in ${entries.length} entries`);
    return scored.slice(0, limit);
  }

  async stats() {
    try {
      const [total, byType] = await Promise.all([
        prisma.frameFingerprint.count(),
        prisma.frameFingerprint.groupBy({ by: ['mediaType'], _count: { _all: true } }),
      ]);
      return { strategy: this.name, total, byType, bucketPrefix: bucketKey };
    } catch (error) {
      return { strategy: this.name, total: 0, error: error.message };
    }
  }
}

/**
 * Disabled strategy. Used when SCENE_MATCHER=off, and the reference implementation
 * for what a "no index available" deployment looks like.
 */
export class NullVectorStore {
  constructor() {
    this.name = 'disabled';
  }
  async add() {
    return null;
  }
  async reinforce() {
    return null;
  }
  async remove() {
    return { count: 0 };
  }
  async search() {
    return [];
  }
  async stats() {
    return { strategy: this.name, total: 0, disabled: true };
  }
}

export default LocalHashVectorStore;
