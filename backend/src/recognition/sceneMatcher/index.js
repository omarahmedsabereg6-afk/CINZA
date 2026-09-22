/**
 * SceneMatcher (section 31).
 *
 * Public surface used by the recognition pipeline:
 *
 *   sceneMatcher.search({ pHash, dHash, aHash })   -> ranked fingerprint hits
 *   sceneMatcher.index(result, images)             -> store confirmed frames
 *   sceneMatcher.stats()                           -> index health
 *
 * Strategy is selected by SCENE_MATCHER (default `local`):
 *
 *   local  LocalHashVectorStore — perceptual-hash index of confirmed frames
 *   off    NullVectorStore      — no index, candidates come from AI + TMDB only
 *
 * FUTURE WORK — the interface is shaped so none of this requires touching the
 * pipeline, services, controllers or the app:
 *
 *   1. Image embeddings. Replace the hash columns with a 512-d vector from a
 *      CLIP-style model, keep `search()` returning `{tmdbId, mediaType, similarity}`.
 *      A second implementation of VectorStore is the entire change.
 *   2. A real frame database. Ingest reference stills (TMDB /images gives us stills
 *      per title, see integrations/tmdb), hash or embed them, and back-fill
 *      FrameFingerprint rows with `source: 'reference'`. Candidate generation
 *      already consumes fingerprint hits (see candidateGenerator.js), so matches
 *      would start flowing through the existing scoring path automatically.
 *   3. Vector database. Swap `load()`/`search()` for pgvector (`ALTER TABLE ... USING
 *      ivfflat`), FAISS or a hosted index. The `minSimilarity`/`limit` contract stays.
 *   4. Shot-level dedupe and timestamp interpolation. Once multiple frames per title
 *      are indexed in order, a sequence of query frames can be aligned to a known
 *      sequence and an APPROXIMATE timestamp derived. Until that exists we never
 *      invent one — see sceneService timestamps.
 */
import { createLogger } from '../../utils/logger.js';
import { LocalHashVectorStore, NullVectorStore } from './vectorStore.js';

const log = createLogger('sceneMatcher');

const REGISTRY = {
  local: () => new LocalHashVectorStore(),
  off: () => new NullVectorStore(),
};

let instance = null;
let announced = false;

function strategyName() {
  return (process.env.SCENE_MATCHER || 'local').toLowerCase();
}

export function getVectorStore() {
  if (!instance) {
    const factory = REGISTRY[strategyName()] ?? REGISTRY.local;
    instance = factory();
    if (!announced) {
      announced = true;
      log.info(`SceneMatcher strategy: ${instance.name}`);
      if (instance.name === 'local-hash') {
        log.info('Exact scene matching is limited to frames confirmed by this deployment (no worldwide frame DB).');
      }
    }
  }
  return instance;
}

export class SceneMatcher {
  constructor(store = getVectorStore()) {
    this.store = store;
    this.name = store.name;
  }

  /** @returns {Promise<Array>} ranked hits, already filtered by minimum similarity */
  async search(hashes, options) {
    return this.store.search(hashes, options);
  }

  /**
   * Indexes the primary frame(s) of a successful recognition so the same scene can
   * be matched instantly next time.
   *
   * @param {object} result   a completed recognition result
   * @param {Array}  images   validated upload records (buffers excluded by the caller)
   */
  async index(result, images = []) {
    if (!result?.tmdbId || !result?.mediaType) return [];
    const stored = [];

    for (const [index, image] of images.entries()) {
      const hashes = {
        pHash: image.pHash,
        dHash: image.dHash,
        aHash: image.aHash,
      };
      if (!hashes.pHash && !hashes.dHash && !hashes.aHash) continue;

      const label =
        result.mediaType === 'tv' && result.seasonNumber && result.episodeNumber
          ? `S${String(result.seasonNumber).padStart(2, '0')}E${String(result.episodeNumber).padStart(2, '0')}`
          : result.title ?? null;

      const entry = await this.store.add({
        tmdbId: result.tmdbId,
        mediaType: result.mediaType,
        seasonNumber: result.seasonNumber ?? null,
        episodeNumber: result.episodeNumber ?? null,
        label: index === 0 ? label : `${label ?? ''} (frame ${index + 1})`.trim(),
        ...hashes,
        thumbDataUrl: image.thumbDataUrl ?? null,
        source: 'confirmed',
      });
      if (entry) stored.push(entry);
    }

    if (stored.length) log.debug(`indexed ${stored.length} fingerprint(s) for ${result.mediaType}/${result.tmdbId}`);
    return stored;
  }

  stats() {
    return this.store.stats();
  }
}

let matcher = null;
export function getSceneMatcher() {
  if (!matcher) matcher = new SceneMatcher();
  return matcher;
}

export { LocalHashVectorStore, NullVectorStore };
export default { getSceneMatcher, SceneMatcher };
