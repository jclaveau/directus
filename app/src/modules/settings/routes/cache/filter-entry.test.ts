import { describe, expect, it } from 'vitest';
import { matchesFilter } from './filter-entry';

const MAP = { user_id: 'user', bytes: 'size' };

const row = {
	key: 'k1',
	path: '/items/articles',
	user: 'u1',
	size: 100,
	method: 'GET',
};

describe('matchesFilter', () => {
	it('passes when there is no filter', () => {
		expect(matchesFilter(row, null, MAP)).toBe(true);
		expect(matchesFilter(row, {}, MAP)).toBe(true);
	});

	it('applies _contains', () => {
		expect(matchesFilter(row, { path: { _contains: 'articles' } }, MAP)).toBe(true);
		expect(matchesFilter(row, { path: { _contains: 'zzz' } }, MAP)).toBe(false);
	});

	it('maps collection field names to the row keys', () => {
		expect(matchesFilter(row, { user_id: { _eq: 'u1' } }, MAP)).toBe(true);
		expect(matchesFilter(row, { user_id: { _eq: 'other' } }, MAP)).toBe(false);
	});

	it('compares mapped numeric fields', () => {
		expect(matchesFilter(row, { bytes: { _gt: 50 } }, MAP)).toBe(true);
		expect(matchesFilter(row, { bytes: { _gt: 200 } }, MAP)).toBe(false);
		expect(matchesFilter(row, { bytes: { _lte: 100 } }, MAP)).toBe(true);
	});

	it('_and requires every branch', () => {
		const pass = {
			_and: [{ path: { _contains: 'a' } }, { method: { _eq: 'GET' } }],
		};

		const fail = { _and: [{ method: { _eq: 'POST' } }] };
		expect(matchesFilter(row, pass, MAP)).toBe(true);
		expect(matchesFilter(row, fail, MAP)).toBe(false);
	});

	it('_or requires any branch', () => {
		const filter = {
			_or: [{ method: { _eq: 'POST' } }, { method: { _eq: 'GET' } }],
		};

		expect(matchesFilter(row, filter, MAP)).toBe(true);
	});

	it('_in / _nin over arrays', () => {
		expect(matchesFilter(row, { method: { _in: ['GET', 'POST'] } }, MAP)).toBe(true);
		expect(matchesFilter(row, { method: { _nin: ['GET'] } }, MAP)).toBe(false);
	});

	it('_null / _nnull', () => {
		expect(matchesFilter({ user: null }, { user: { _null: true } })).toBe(true);
		expect(matchesFilter({ user: 'x' }, { user: { _null: true } })).toBe(false);
		expect(matchesFilter({ user: 'x' }, { user: { _nnull: true } })).toBe(true);
	});

	it('unknown operators never exclude', () => {
		expect(matchesFilter(row, { path: { _weird: 'x' } }, MAP)).toBe(true);
	});
});
