import { expect, test } from 'vitest';
import { cacheEventPrefix } from './cache-event-prefix.js';

test('takes the first path segment, dropping the query string', () => {
	expect(cacheEventPrefix('/items/articles?limit=5')).toBe('/items');
});

test('groups the self-polling cache endpoints under /utils', () => {
	expect(cacheEventPrefix('/utils/cache/timeseries?window=1h')).toBe('/utils');
});

test('keeps a bare single-segment path', () => {
	expect(cacheEventPrefix('/collections')).toBe('/collections');
});

test('falls back to / when there is no segment', () => {
	expect(cacheEventPrefix('/')).toBe('/');
	expect(cacheEventPrefix('')).toBe('/');
});
