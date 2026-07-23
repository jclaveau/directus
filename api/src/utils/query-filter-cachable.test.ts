import { expect, test } from 'vitest';
import { queryFilterCachable } from './query-filter-cachable.js';

test('query filter with $NOW is not cachable', () => {
	expect(queryFilterCachable({ created_on: { _gt: '$NOW' } })).toBe(false);

	expect(
		queryFilterCachable({ _and: [{ created_on: { _gt: '$NOW(-1 year)' } }] }),
	).toBe(false);

	expect(
		queryFilterCachable({ _or: [{ nested: { some: { _gt: '$NOW' } } }] }),
	).toBe(false);
});

test('query filter without $NOW is cachable', () => {
	expect(queryFilterCachable({ created_on: { _gt: '2021-01-01' } })).toBe(true);

	expect(
		queryFilterCachable({ _and: [{ created_on: { _gt: '2021-01-01' } }] }),
	).toBe(true);

	expect(queryFilterCachable(null)).toBe(true);
	expect(queryFilterCachable(undefined)).toBe(true);
});

// A nested null crashes filter_has_now (Object.entries(null)); the gate must
// swallow that and treat the filter as cacheable rather than 500 the request.
test('query filter with a nested null does not throw and is cachable', () => {
	expect(queryFilterCachable({ field: { _eq: null } })).toBe(true);
	expect(queryFilterCachable({ _and: [{ field: null }] })).toBe(true);
});
