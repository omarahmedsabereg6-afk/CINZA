import test from 'node:test';
import assert from 'node:assert/strict';
import { toCountryCode, countryName, REGIONS } from '../backend/src/database/constants.js';
import { toCountryCode as feToCountryCode, countryName as feCountryName } from '../app/js/core/countries.js';
import { regionSchema } from '../backend/src/validation/schemas.js';
import { getStreamingProvider, getAvailability } from '../backend/src/integrations/streaming/index.js';
import tmdbWatchProviders from '../backend/src/integrations/streaming/tmdbWatchProviders.js';
import tmdbClient from '../backend/src/integrations/tmdb/tmdbClient.js';

test('toCountryCode normalizes user examples to ISO 3166-1 alpha-2 codes', () => {
  const examples = [
    ['Egypt', 'EG'],
    ['United States', 'US'],
    ['United Kingdom', 'GB'],
    ['Saudi Arabia', 'SA'],
    ['United Arab Emirates', 'AE'],
    ['France', 'FR'],
    ['Germany', 'DE'],
    ['Japan', 'JP'],
    ['Canada', 'CA'],
    ['eg', 'EG'],
    ['us', 'US'],
    ['gb', 'GB'],
    ['sa', 'SA'],
  ];

  for (const [input, expected] of examples) {
    assert.equal(toCountryCode(input), expected, `backend toCountryCode(${input}) should be ${expected}`);
    assert.equal(feToCountryCode(input), expected, `frontend toCountryCode(${input}) should be ${expected}`);
  }
});

test('countryName maps ISO codes to human-readable country names', () => {
  assert.equal(countryName('EG'), 'Egypt');
  assert.equal(countryName('US'), 'United States');
  assert.equal(countryName('SA'), 'Saudi Arabia');
  assert.equal(countryName('GB'), 'United Kingdom');
  assert.equal(feCountryName('EG'), 'Egypt');
  assert.equal(feCountryName('US'), 'United States');
  assert.equal(feCountryName('SA'), 'Saudi Arabia');
  assert.equal(feCountryName('GB'), 'United Kingdom');
});

test('regionSchema parses and transforms country names to ISO codes', () => {
  assert.equal(regionSchema.parse('Egypt'), 'EG');
  assert.equal(regionSchema.parse('United States'), 'US');
  assert.equal(regionSchema.parse('Saudi Arabia'), 'SA');
  assert.equal(regionSchema.parse('eg'), 'EG');
  assert.equal(regionSchema.parse('US'), 'US');
});

test('streaming provider is live and not mock', () => {
  const provider = getStreamingProvider();
  assert.equal(provider.name, 'tmdb');
  assert.equal(provider.isMock, false);
});

test('TMDB watch providers isolates country results: Egypt (EG) vs United States (US)', async () => {
  const [egyptResult, usResult] = await Promise.all([
    getAvailability({ mediaType: 'movie', tmdbId: 27205, region: 'Egypt' }),
    getAvailability({ mediaType: 'movie', tmdbId: 27205, region: 'United States' }),
  ]);

  assert.equal(egyptResult.region, 'EG');
  assert.equal(egyptResult.regionName, 'Egypt');
  assert.equal(egyptResult.isMock, false);
  assert.equal(egyptResult.hasAny, true);

  assert.equal(usResult.region, 'US');
  assert.equal(usResult.regionName, 'United States');
  assert.equal(usResult.isMock, false);
  assert.equal(usResult.hasAny, true);

  // Extract flatrate provider names for each country
  const egStream = egyptResult.groups.find((g) => g.category === 'stream')?.providers.map((p) => p.name) || [];
  const usStream = usResult.groups.find((g) => g.category === 'stream')?.providers.map((p) => p.name) || [];

  // Inception in Egypt has Shahid VIP as flatrate stream provider
  assert.ok(egStream.includes('Shahid VIP'), 'Egypt stream should include Shahid VIP');

  // Inception in US does NOT have Shahid VIP
  assert.ok(!usStream.includes('Shahid VIP'), 'US stream should NOT include Shahid VIP');

  // Verify all providers have valid logoUrl
  for (const group of egyptResult.groups) {
    for (const provider of group.providers) {
      assert.ok(provider.name, 'Provider must have name');
      assert.ok(provider.logoUrl, 'Provider must have logoUrl');
    }
  }
});

test('TMDB watch providers handles TV shows with watch_region', async () => {
  const tvAvailability = await getAvailability({ mediaType: 'tv', tmdbId: 1622, region: 'EG' });
  assert.equal(tvAvailability.region, 'EG');
  assert.equal(tvAvailability.regionName, 'Egypt');
  assert.equal(tvAvailability.isMock, false);
  assert.equal(tvAvailability.hasAny, true);
  const streamProviders = tvAvailability.groups.find((g) => g.category === 'stream')?.providers.map((p) => p.name) || [];
  assert.ok(streamProviders.includes('Amazon Prime Video'), 'TV stream in EG should include Amazon Prime Video');
});

test('availability handles empty state for titles with no providers in country', async () => {
  const result = await tmdbWatchProviders.availability({ mediaType: 'movie', tmdbId: 999999999, region: 'EG' });
  assert.equal(result.region, 'EG');
  assert.equal(result.regionName, 'Egypt');
  assert.equal(result.hasAny, false);
  assert.deepEqual(result.groups, []);
  assert.equal(result.isMock, false);
});
