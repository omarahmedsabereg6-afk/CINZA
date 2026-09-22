import test from 'node:test';
import assert from 'node:assert/strict';
import * as searchService from '../backend/src/services/searchService.js';
import mockTmdb from '../backend/src/integrations/tmdb/mockTmdb.js';

test('searchService: type=movie returns only movies', async () => {
  const result = await searchService.search({ query: 'batman', type: 'movie' });
  assert.equal(result.type, 'movie');
  assert.ok(result.titles.length > 0);
  assert.equal(result.people.length, 0);
  for (const t of result.titles) {
    assert.equal(t.mediaType, 'movie');
  }
});

test('searchService: type=tv returns only tv series', async () => {
  const result = await searchService.search({ query: 'batman', type: 'tv' });
  assert.equal(result.type, 'tv');
  assert.ok(result.titles.length > 0);
  assert.equal(result.people.length, 0);
  for (const t of result.titles) {
    assert.equal(t.mediaType, 'tv');
  }
});

test('searchService: type=person returns only people and empty titles', async () => {
  const result = await searchService.search({ query: 'Nolan', type: 'person' });
  assert.equal(result.type, 'person');
  assert.ok(result.people.length > 0);
  assert.equal(result.titles.length, 0);
  for (const p of result.people) {
    assert.ok(p.name);
    assert.ok(p.id);
  }
});

test('searchService: type=all returns mixed results', async () => {
  const result = await searchService.search({ query: 'Nolan', type: 'all' });
  assert.equal(result.type, 'all');
  assert.ok(result.titles.length > 0 || result.people.length > 0);
});

test('mockTmdb: popular handles person, movie, and tv', async () => {
  const movieRes = await mockTmdb.popular('movie', 5);
  assert.ok(movieRes.results.length > 0);

  const tvRes = await mockTmdb.popular('tv', 5);
  assert.ok(tvRes.results.length > 0);

  const personRes = await mockTmdb.popular('person', 5);
  assert.ok(personRes.results.length > 0);
  assert.ok(personRes.results[0].name);
});
