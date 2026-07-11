import { describe, expect, it } from 'vitest';
import {
	buildGroups,
	filterEntries,
	formatAge,
	formatExpiry,
	formatLastHit,
	formatQuery,
	formatSize,
	formatUser,
	isSystemPath,
	shortKey,
	splitSections,
	type CacheEntry,
} from './cache-view';

function entry(over: Partial<CacheEntry>): CacheEntry {
	return {
		key: 'k',
		path: '/items/x',
		method: 'GET',
		user: null,
		query: '{}',
		url: '',
		createdAt: 0,
		expiresAt: null,
		lastHitAt: null,
		size: 0,
		hits: 0,
		...over,
	};
}

describe('isSystemPath', () => {
	it('flags directus system routes and directus_* item reads', () => {
		expect(isSystemPath('/server/info')).toBe(true);
		expect(isSystemPath('/items/directus_users')).toBe(true);
		expect(isSystemPath('/graphql/system')).toBe(true);
	});

	it('treats app data as non-system', () => {
		expect(isSystemPath('/items/articles')).toBe(false);
		expect(isSystemPath('/graphql')).toBe(false);
	});
});

describe('formatSize', () => {
	it('scales bytes to B / KB / MB', () => {
		expect(formatSize(512)).toBe('512 B');
		expect(formatSize(2048)).toBe('2.0 KB');
		expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB');
	});
});

describe('formatAge', () => {
	it('buckets elapsed seconds', () => {
		expect(formatAge(10_000, 5_000)).toBe('5s');
		expect(formatAge(200_000, 0)).toBe('3m');
		expect(formatAge(7_200_000, 0)).toBe('2h');
		expect(formatAge(172_800_000, 0)).toBe('2d');
	});
});

describe('formatExpiry', () => {
	it('shows ∞, the expired label, or a countdown', () => {
		expect(formatExpiry(0, null, 'expired')).toBe('∞');
		expect(formatExpiry(10_000, 5_000, 'expired')).toBe('expired');
		expect(formatExpiry(0, 30_000, 'expired')).toBe('30s');
	});
});

describe('formatLastHit', () => {
	it('shows the never label or the age', () => {
		expect(formatLastHit(0, null, 'never')).toBe('never');
		expect(formatLastHit(10_000, 5_000, 'never')).toBe('5s');
	});
});

describe('formatUser', () => {
	it('shows the email, else the public label', () => {
		expect(formatUser({ id: 'x', email: 'a@b.com' }, 'public')).toBe('a@b.com');
		expect(formatUser({ id: 'x', email: null }, 'public')).toBe('public');
		expect(formatUser(null, 'public')).toBe('public');
	});
});

describe('shortKey', () => {
	it('truncates long keys', () => {
		expect(shortKey('short')).toBe('short');
		expect(shortKey('0123456789abcdef')).toBe('0123456789ab…');
	});
});

describe('formatQuery', () => {
	it('collapses empty queries to a dash', () => {
		expect(formatQuery('')).toBe('—');
		expect(formatQuery('{}')).toBe('—');
		expect(formatQuery('{"limit":5}')).toBe('{"limit":5}');
	});
});

describe('filterEntries', () => {
	const rows = [
		entry({ key: 'a', path: '/items/x', user: { id: 'u', email: 'ann@co' } }),
		entry({ key: 'b', path: '/items/y', user: null }),
	];

	const map = { user_id: 'user' };

	it('applies the m2o email filter', () => {
		const filter = { user_id: { email: { _contains: 'ann' } } };
		expect(filterEntries(rows, filter, '', map)).toEqual([rows[0]]);
	});

	it('applies the free-text search over path/email', () => {
		expect(filterEntries(rows, null, 'items/y', map)).toEqual([rows[1]]);
		expect(filterEntries(rows, null, 'ann@co', map)).toEqual([rows[0]]);
	});

	it('returns all rows with no filter and no search', () => {
		expect(filterEntries(rows, null, '', map)).toHaveLength(2);
	});
});

describe('splitSections', () => {
	it('splits app vs system groups, ordered app-first', () => {
		const groups = buildGroups([
			entry({ path: '/items/articles' }),
			entry({ path: '/server/info' }),
		]);

		const sections = splitSections(groups, 'App', 'System');
		expect(sections.map((section) => section.key)).toEqual(['app', 'system']);
		expect(sections[0]!.groups[0]!.path).toBe('/items/articles');
	});

	it('drops a section with no groups', () => {
		const groups = buildGroups([entry({ path: '/items/a' })]);
		const sections = splitSections(groups, 'App', 'System');
		expect(sections).toHaveLength(1);
		expect(sections[0]!.key).toBe('app');
	});
});

describe('buildGroups', () => {
	it('buckets by path, totals hits/size, orders by hits', () => {
		const groups = buildGroups([
			entry({ path: '/items/a', hits: 2, size: 10 }),
			entry({ path: '/items/a', hits: 3, size: 20 }),
			entry({ path: '/items/b', hits: 10, size: 5 }),
		]);

		expect(groups).toHaveLength(2);
		expect(groups[0]!.path).toBe('/items/b');
		expect(groups[0]!.totalHits).toBe(10);
		expect(groups[1]!.path).toBe('/items/a');
		expect(groups[1]!.totalHits).toBe(5);
		expect(groups[1]!.totalSize).toBe(30);
		expect(groups[1]!.entryCount).toBe(2);
		// same method+query → one subgroup holding both entries
		expect(groups[1]!.queries).toHaveLength(1);
		expect(groups[1]!.queries[0]!.entries).toHaveLength(2);
	});

	it('splits a path into method+query subgroups, hottest first', () => {
		const groups = buildGroups([
			entry({ path: '/items/a', query: '{"limit":5}', hits: 1 }),
			entry({ path: '/items/a', query: '{"limit":5}', hits: 2 }),
			entry({ path: '/items/a', query: '{"limit":9}', hits: 10 }),
			entry({ path: '/items/a', method: 'HEAD', query: '{"limit":5}', hits: 4 }),
		]);

		const queries = groups[0]!.queries;
		expect(queries).toHaveLength(3);
		expect(queries[0]!.query).toBe('{"limit":9}'); // hottest first
		expect(queries[0]!.entries).toHaveLength(1);
		// method is part of the key: GET vs HEAD on the same query don't merge
		expect(queries[1]!.method).toBe('HEAD');
		expect(queries[2]!.method).toBe('GET');
		expect(queries[2]!.query).toBe('{"limit":5}');
		expect(queries[2]!.entries).toHaveLength(2);
		expect(queries[2]!.totalHits).toBe(3);
	});
});
