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

	it('drills into an m2o relation (user_id.email)', () => {
		const withUser = { user: { id: 'u1', email: 'alice@corp.io' } };
		const contains = { user_id: { email: { _contains: 'alice' } } };
		const miss = { user_id: { email: { _contains: 'bob' } } };

		expect(matchesFilter(withUser, contains, MAP)).toBe(true);
		expect(matchesFilter(withUser, miss, MAP)).toBe(false);
		expect(matchesFilter({ user: null }, contains, MAP)).toBe(false);
	});

	it('matches a scalar (non-operator) condition by equality', () => {
		expect(matchesFilter(row, { method: 'GET' })).toBe(true);
		expect(matchesFilter(row, { method: 'POST' })).toBe(false);
	});

	it('applies the string operators', () => {
		expect(matchesFilter(row, { path: { _neq: 'z' } })).toBe(true);
		expect(matchesFilter(row, { path: { _neq: '/items/articles' } })).toBe(false);
		expect(matchesFilter(row, { path: { _icontains: 'ARTICLES' } })).toBe(true);
		expect(matchesFilter(row, { path: { _ncontains: 'zzz' } })).toBe(true);
		expect(matchesFilter(row, { path: { _ncontains: 'articles' } })).toBe(false);
		expect(matchesFilter(row, { path: { _starts_with: '/items' } })).toBe(true);
		expect(matchesFilter(row, { path: { _ends_with: 'articles' } })).toBe(true);
	});

	it('applies the numeric operators', () => {
		expect(matchesFilter(row, { bytes: { _gte: 100 } }, MAP)).toBe(true);
		expect(matchesFilter(row, { bytes: { _gte: 200 } }, MAP)).toBe(false);
		expect(matchesFilter(row, { bytes: { _lt: 200 } }, MAP)).toBe(true);
		expect(matchesFilter(row, { bytes: { _lt: 50 } }, MAP)).toBe(false);
	});

	it('applies the null / empty operators on both operand polarities', () => {
		expect(matchesFilter(row, { user: { _null: false } })).toBe(true);
		expect(matchesFilter({ user: null }, { user: { _null: false } })).toBe(false);
		expect(matchesFilter(row, { user: { _nnull: false } })).toBe(false);
		expect(matchesFilter(row, { user: { _empty: false } })).toBe(true);
		expect(matchesFilter({ user: '' }, { user: { _empty: true } })).toBe(true);
		expect(matchesFilter(row, { user: { _nempty: true } })).toBe(true);
		expect(matchesFilter({ user: '' }, { user: { _nempty: false } })).toBe(true);
	});

	it('unknown operators never exclude', () => {
		expect(matchesFilter(row, { path: { _weird: 'x' } }, MAP)).toBe(true);
	});
});
