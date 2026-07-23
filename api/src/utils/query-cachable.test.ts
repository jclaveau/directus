import { expect, test, vi } from 'vitest';
import { queryCachable } from './query-cachable.js';

vi.mock('../database/index.js', () => ({ default: () => ({}) }));

import { sanitizeQuery } from './sanitize-query.js';

// By the time this gate runs, sanitizeQuery has resolved `$NOW` to a Date; static
// dates stay strings. So the signal is a Date in the resolved query, not `'$NOW'`.

test('a resolved $NOW (Date) makes the query uncachable', () => {
	expect(
		queryCachable({ filter: { created_on: { _gte: new Date() } } }),
	).toBe(false);

	expect(
		queryCachable({ filter: { _and: [{ created_on: { _gte: new Date() } }] } }),
	).toBe(false);

	// $NOW inside an _in array.
	expect(queryCachable({ filter: { at: { _in: [new Date(), 'x'] } } })).toBe(false);
});

test('a resolved $NOW inside deep._filter makes the query uncachable', () => {
	expect(
		queryCachable({ deep: { author: { _filter: { at: { _gte: new Date() } } } } }),
	).toBe(false);
});

test('a query with only static dates / ids is cachable', () => {
	expect(
		queryCachable({ filter: { created_on: { _gte: '2021-01-01' } } }),
	).toBe(true);

	expect(queryCachable({ filter: { owner: { _eq: 'user-id' } } })).toBe(true);
	expect(queryCachable({ filter: {} })).toBe(true);
});

test('a null / undefined / nested-null query is cachable and does not throw', () => {
	expect(queryCachable(null)).toBe(true);
	expect(queryCachable(undefined)).toBe(true);
	expect(queryCachable({ filter: { field: { _eq: null } } })).toBe(true);
});

// End-to-end at the real seam: pins the contract that sanitizeQuery resolves `$NOW`
// to a Date the gate can see. If a future parseFilter/sanitize change stopped
// producing a Date, the gate would silently no-op — this fails first.
const schema = { collections: {}, relations: [] } as any;
const accountability = { user: 'u', role: 'r', roles: ['r'] } as any;

test('sanitizeQuery resolves $NOW so the gate skips it (filter)', async () => {
	const query = await sanitizeQuery(
		{ filter: { created_on: { _gte: '$NOW' } } },
		schema,
		accountability,
	);

	expect(queryCachable(query)).toBe(false);
});

test('sanitizeQuery resolves $NOW so the gate skips it (deep._filter)', async () => {
	const query = await sanitizeQuery(
		{ deep: { author: { _filter: { at: { _gte: '$NOW' } } } } },
		schema,
		accountability,
	);

	expect(queryCachable(query)).toBe(false);
});

test('a sanitized static-date query stays cachable', async () => {
	const query = await sanitizeQuery(
		{ filter: { created_on: { _gte: '2021-01-01' } } },
		schema,
		accountability,
	);

	expect(queryCachable(query)).toBe(true);
});
