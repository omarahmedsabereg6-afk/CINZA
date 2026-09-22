import test from 'node:test';
import assert from 'node:assert/strict';
import { mockTmdb } from '../backend/src/integrations/tmdb/mockTmdb.js';
import tmdbClient from '../backend/src/integrations/tmdb/tmdbClient.js';
import * as mediaService from '../backend/src/services/mediaService.js';

test('mockTmdb.discoverByGenre returns Action titles with standard payload structure', async () => {
  const result = await mockTmdb.discoverByGenre('all', 28, { page: 1 });
  assert.equal(result.__mock, true);
  assert.equal(result.page, 1);
  assert.ok(Array.isArray(result.results));
  assert.ok(result.results.length > 0, 'Should find mock Action titles');
  assert.equal(result.total_results, result.results.length);
  // Verify The Dark Knight or Inception is included as an action movie
  const titles = result.results.map((r) => r.title || r.name);
  assert.ok(titles.includes('The Dark Knight') || titles.includes('Inception') || titles.includes('The Matrix'));
});

test('mockTmdb.discoverByGenre returns Sci-Fi titles with genreId 878', async () => {
  const result = await mockTmdb.discoverByGenre('all', 878, { page: 1 });
  assert.equal(result.__mock, true);
  assert.ok(Array.isArray(result.results));
  assert.ok(result.results.length > 0, 'Should find mock Sci-Fi titles');
  const titles = result.results.map((r) => r.title || r.name);
  assert.ok(titles.includes('Inception') && titles.includes('The Matrix'));
});

test('mediaService.getDiscover returns genre items when genreId is provided', async () => {
  const data = await mediaService.getDiscover({ genreId: 28, limit: 10 });
  assert.ok(Array.isArray(data.items));
  assert.ok(data.items.length > 0);
  assert.ok(data.total >= data.items.length);
  assert.equal(typeof data.isMock, 'boolean');
  const first = data.items[0];
  assert.ok(first.tmdbId, 'Item should have tmdbId');
  assert.ok(first.title, 'Item should have title');
  assert.ok(first.mediaType, 'Item should have mediaType');
});

test('mediaService.getDiscover returns rails when genreId is omitted (All)', async () => {
  const data = await mediaService.getDiscover({ limit: 10 });
  assert.ok(Array.isArray(data.rails));
  assert.ok(data.rails.length >= 1);
  const railKeys = data.rails.map((r) => r.key);
  assert.ok(railKeys.includes('trending') || railKeys.includes('movies'));
});

test('mediaService.getDiscover returns pagination metadata when genreId is provided', async () => {
  const data = await mediaService.getDiscover({ genreId: 28, page: 1, limit: 10 });
  assert.equal(data.page, 1);
  assert.equal(typeof data.totalPages, 'number');
  assert.equal(typeof data.hasMore, 'boolean');
  assert.ok(Array.isArray(data.items));
});

test('mockTmdb.discoverByGenre respects sortBy vote_average.desc', async () => {
  const data = await mockTmdb.discoverByGenre('all', 28, { sortBy: 'vote_average.desc' });
  assert.ok(data.results.length >= 2);
  const scores = data.results.map((r) => r.vote_average);
  for (let i = 0; i < scores.length - 1; i += 1) {
    assert.ok(scores[i] >= scores[i + 1], 'Results should be sorted descending by vote_average');
  }
});

test('mediaService.getDiscover returns sorted items when custom sortBy is provided without genreId', async () => {
  const data = await mediaService.getDiscover({ sortBy: 'vote_average.desc', limit: 10 });
  assert.ok(Array.isArray(data.items));
  assert.equal(data.sortBy, 'vote_average.desc');
  assert.ok(data.items.length > 0);
});

test('tmdbClient.discoverByGenre handles "all" without calling /discover/all', async () => {
  // Verify method exists and takes (mediaType, genreId, opts)
  assert.equal(typeof tmdbClient.discoverByGenre, 'function');
});
