import { describe, expect, it } from 'vitest';
import {
	buildGroups,
	carryForward,
	filterAnomalies,
	filterEntries,
	filterLatencyBand,
	formatAge,
	formatExpiry,
	formatLastHit,
	formatQuery,
	formatHitRatio,
	formatTooltipValue,
	formatUser,
	isSystemPath,
	shortKey,
	sortEntries,
	sortGroups,
	splitSections,
	summariseAnomalies,
	ttlVerdict,
	type CacheAnomaly,
	type CacheEntry,
	emptyLatencies,
	type EndpointGroup,
	type LatencyBand,
	type NodeLatencies,
} from './cache-view';

function entry(over: Partial<CacheEntry>): CacheEntry {
	return {
		key: 'k',
		redisKey: 'rk',
		path: '/items/x',
		method: 'GET',
		collection: null,
		user: null,
		query: '{}',
		url: '',
		createdAt: 0,
		expiresAt: null,
		lastHitAt: null,
		size: 0,
		hits: 0,
		misses: 0,
		fills: 0,
		fillMs: null,
		hitMs: null,
		ttlMs: null,
		recommendedTtlMs: null,
		coarse: false,
		...over,
	};
}

function anomaly(over: Partial<CacheAnomaly>): CacheAnomaly {
	return {
		cacheKey: 'ak',
		reason: 'missing_scope',
		path: '/items/x',
		method: 'GET',
		query: '{}',
		url: '',
		count: 1,
		sample: null,
		lastSeen: 0,
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

describe('formatHitRatio', () => {
	it('rounds hits over hits plus fills to a percentage', () => {
		expect(formatHitRatio(90, 10)).toBe('90%');
		expect(formatHitRatio(2, 1)).toBe('67%');
		expect(formatHitRatio(0, 3)).toBe('0%');
		expect(formatHitRatio(4, 0)).toBe('100%');
	});

	it('returns null when nothing was served either way', () => {
		expect(formatHitRatio(0, 0)).toBe(null);
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

describe('sortEntries', () => {
	it('sorts numerically, ascending then descending', () => {
		const rows = [
			entry({ key: 'a', hits: 3, fills: 1, size: 10 }),
			entry({ key: 'b', hits: 1, fills: 3, size: 40 }),
			entry({ key: 'c', hits: 2, fills: 0, size: 20 }),
		];

		expect(sortEntries(rows, { field: 'hits', dir: 1 }).map((r) => r.key))
			.toEqual(['b', 'c', 'a']);

		expect(sortEntries(rows, { field: 'hits', dir: -1 }).map((r) => r.key))
			.toEqual(['a', 'c', 'b']);
	});

	it('sorts by the hit ratio, sinking no-traffic rows last', () => {
		const rows = [
			entry({ key: 'a', hits: 90, fills: 10 }),
			entry({ key: 'b', hits: 0, fills: 0 }),
			entry({ key: 'c', hits: 2, fills: 8 }),
		];

		expect(sortEntries(rows, { field: 'ratio', dir: -1 }).map((r) => r.key))
			.toEqual(['a', 'c', 'b']);
	});

	it('sorts by user email, then size and key', () => {
		const rows = [
			entry({
				key: 'x',
				user: { id: 'u', email: 'bob@co' },
				size: 5,
				redisKey: 'rk-x',
			}),
			entry({
				key: 'y',
				user: { id: 'u', email: 'ann@co' },
				size: 9,
				redisKey: 'rk-y',
			}),
			entry({ key: 'z', size: 9, redisKey: 'rk-z' }),
		];

		expect(sortEntries(rows, { field: 'user', dir: 1 }).map((r) => r.key))
			.toEqual(['y', 'x', 'z']);

		expect(sortEntries(rows, { field: 'size', dir: -1 }).map((r) => r.key))
			.toEqual(['y', 'z', 'x']);

		expect(sortEntries(rows, { field: 'key', dir: 1 }).map((r) => r.key))
			.toEqual(['x', 'y', 'z']);
	});

	it('sinks never-hit and never-expiring rows last', () => {
		const rows = [
			entry({ key: 'a', lastHitAt: 2000, expiresAt: 9000 }),
			entry({ key: 'b', lastHitAt: null, expiresAt: null }),
			entry({ key: 'c', lastHitAt: 1000, expiresAt: 3000 }),
		];

		expect(sortEntries(rows, { field: 'lastHitAt', dir: 1 }).map((r) => r.key))
			.toEqual(['c', 'a', 'b']);

		expect(sortEntries(rows, { field: 'expiresAt', dir: -1 }).map((r) => r.key))
			.toEqual(['a', 'c', 'b']);
	});
});

describe('splitSections', () => {
	it('splits app vs system groups, ordered app-first', () => {
		const groups = buildGroups([
			entry({ path: '/items/articles' }),
			entry({ path: '/server/info' }),
		], []);

		const sections = splitSections(groups, 'App', 'System');
		expect(sections.map((section) => section.key)).toEqual(['app', 'system']);
		expect(sections[0]!.groups[0]!.path).toBe('/items/articles');
	});

	it('drops a section with no groups', () => {
		const groups = buildGroups([entry({ path: '/items/a' })], []);
		const sections = splitSections(groups, 'App', 'System');
		expect(sections).toHaveLength(1);
		expect(sections[0]!.key).toBe('app');
	});
});

describe('ttlVerdict', () => {
	it('recommends lengthen / shorten / ok, null when unknown', () => {
		expect(ttlVerdict(400, 300)).toBe('lengthen'); // >125%
		expect(ttlVerdict(200, 300)).toBe('shorten'); // <75%
		expect(ttlVerdict(310, 300)).toBe('ok'); // within band
		expect(ttlVerdict(null, 300)).toBe(null);
		expect(ttlVerdict(400, null)).toBe(null);
		expect(ttlVerdict(400, 0)).toBe(null);
	});
});

describe('buildGroups', () => {
	it('buckets by path, totals hits/size, orders by hits', () => {
		const groups = buildGroups([
			entry({
				path: '/items/a',
				hits: 2,
				misses: 1,
				fills: 1,
				ttlMs: 300,
				recommendedTtlMs: 100,
			}),
			entry({
				path: '/items/a',
				hits: 3,
				misses: 2,
				fills: 4,
				size: 30,
				ttlMs: 300,
				recommendedTtlMs: 200,
			}),
			entry({ path: '/items/b', hits: 10, size: 5 }),
		], []);

		expect(groups).toHaveLength(2);
		expect(groups[0]!.path).toBe('/items/b');
		expect(groups[0]!.totalHits).toBe(10);
		expect(groups[1]!.path).toBe('/items/a');
		expect(groups[1]!.totalHits).toBe(5);
		expect(groups[1]!.totalMisses).toBe(3);
		expect(groups[1]!.totalFills).toBe(5);
		expect(groups[1]!.totalSize).toBe(30);
		expect(groups[1]!.entryCount).toBe(2);
		// same method+query → one subgroup holding both entries
		expect(groups[1]!.queries).toHaveLength(1);
		expect(groups[1]!.queries[0]!.entries).toHaveLength(2);
		expect(groups[1]!.queries[0]!.totalMisses).toBe(3);
		expect(groups[1]!.queries[0]!.totalFills).toBe(5);
		// group TTL aggregates take the max across siblings
		expect(groups[1]!.queries[0]!.ttlMs).toBe(300);
		expect(groups[1]!.queries[0]!.recommendedTtlMs).toBe(200);
	});

	it('splits a path into method+query subgroups, hottest first', () => {
		const groups = buildGroups([
			entry({ path: '/items/a', query: '{"limit":5}', hits: 1, fills: 1 }),
			entry({ path: '/items/a', query: '{"limit":5}', hits: 2, misses: 2 }),
			entry({ path: '/items/a', query: '{"limit":9}', hits: 10 }),
			entry({ path: '/items/a', method: 'HEAD', query: '{"limit":5}', hits: 4 }),
		], []);

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
		expect(queries[2]!.totalMisses).toBe(2);
		expect(queries[2]!.totalFills).toBe(1);
	});

	it('attaches latency rows to the query node and the endpoint rollup', () => {
		const groups = buildGroups(
			[
				entry({ path: '/items/a', query: '{"limit":5}', hits: 4 }),
				entry({ path: '/items/a', query: '{"limit":9}', hits: 1 }),
			],
			[],
			[
				{
					path: '/items/a',
					method: 'GET',
					query: '{"limit":5}',
					response: { p50: 20, p95: 90, p99: 400 },
					miss: { p50: 110, p95: 240, p99: 900 },
					anomaly: { p50: null, p95: null, p99: null },
					fill: { p50: 120, p95: 250, p99: 910 },
					hit: { p50: 8, p95: 15, p99: 22 },
				},
				{
					// The endpoint row is not a rollup of its queries: a hit p95 of
					// 60 could not come from summing or maxing the rows below it.
					path: '/items/a',
					method: null,
					query: null,
					response: { p50: 21, p95: 95, p99: 380 },
					miss: { p50: 100, p95: 200, p99: 800 },
					anomaly: { p50: null, p95: null, p99: null },
					fill: { p50: 105, p95: 210, p99: 810 },
					hit: { p50: 9, p95: 60, p99: 61 },
				},
			],
		);

		const group = groups[0]!;
		expect(group.latencies.hit.p95).toBe(60);
		expect(group.latencies.miss.p99).toBe(800);
		expect(group.latencies.response.p50).toBe(21);

		const matched = group.queries.find((q) => q.query === '{"limit":5}')!;
		expect(matched.latencies.hit.p95).toBe(15);
		expect(matched.latencies.miss.p50).toBe(110);
		expect(matched.latencies.response.p99).toBe(400);

		// A query with no latency row keeps nulls rather than borrowing its
		// endpoint's — nulls trail in the ranking instead of faking a fast node.
		const unmatched = group.queries.find((q) => q.query === '{"limit":9}')!;
		expect(unmatched.latencies).toEqual(emptyLatencies());
	});

	it('defaults every node to empty latencies when the dialect has none', () => {
		const groups = buildGroups([entry({ path: '/items/a', hits: 1 })], []);

		expect(groups[0]!.latencies).toEqual(emptyLatencies());
		expect(groups[0]!.queries[0]!.latencies).toEqual(emptyLatencies());
	});
});

describe('buildGroups with anomalies', () => {
	it('weaves not-cached anomalies into the tree with occurrence counts', () => {
		const groups = buildGroups(
			[entry({ key: 'c1', path: '/items/a', hits: 5 })],
			[anomaly({
				cacheKey: 'o1',
				path: '/items/a',
				reason: 'missing_scope',
				count: 3,
			})],
		);

		const group = groups.find((candidate) => candidate.path === '/items/a')!;
		expect(group.entryCount).toBe(1);
		expect(group.anomalyCount).toBe(3); // occurrences, not rows
		expect(group.queries[0]!.anomalies).toHaveLength(1);
	});

	it('gives a not-cached-only path its own anomaly node', () => {
		const groups = buildGroups(
			[],
			[anomaly({ path: '/server/info', reason: 'missing_scope', count: 2 })],
		);

		expect(groups).toHaveLength(1);
		expect(groups[0]!.path).toBe('/server/info');
		expect(groups[0]!.entryCount).toBe(0);
		expect(groups[0]!.anomalyCount).toBe(2);
	});

	it('counts coarse entries separately from anomalies', () => {
		const groups = buildGroups(
			[
				entry({ key: 'coarse1', path: '/items/a', query: '{}', coarse: true }),
				entry({ key: 'fine1', path: '/items/a', query: '{}', coarse: false }),
				// a second coarse entry in a distinct query bucket → group must sum the two
				entry({
					key: 'coarse2', path: '/items/a', query: '{"limit":5}', coarse: true,
				}),
			],
			[anomaly({
				cacheKey: 'o1',
				path: '/items/a',
				query: '{}',
				reason: 'missing_scope',
				count: 2,
			})],
		);

		const group = groups[0]!;
		const emptyQuery = group.queries.find((candidate) => candidate.query === '{}')!;

		const limitQuery = group.queries
			.find((candidate) => candidate.query === '{"limit":5}')!;

		// coarse is a per-entry property, not an anomaly row/count
		expect(emptyQuery.coarseCount).toBe(1);
		expect(limitQuery.coarseCount).toBe(1);
		expect(group.coarseCount).toBe(2); // summed across both query buckets
		expect(emptyQuery.anomalyCount).toBe(2); // the missing_scope row only
		expect(emptyQuery.anomalies).toHaveLength(1);
	});
});

describe('summariseAnomalies + filterAnomalies', () => {
	it('sums occurrences per reason, hottest first', () => {
		const summary = summariseAnomalies([
			anomaly({ reason: 'missing_scope', count: 2 }),
			anomaly({ reason: 'redis_error', count: 5 }),
			anomaly({ reason: 'missing_scope', count: 1 }),
		]);

		expect(summary).toEqual([
			{ reason: 'redis_error', count: 5 },
			{ reason: 'missing_scope', count: 3 },
		]);
	});

	it('narrows by path / query / reason, all when blank', () => {
		const list = [
			anomaly({ path: '/items/a', query: '{"limit":5}', reason: 'missing_scope' }),
			anomaly({ path: '/items/b', query: '{}', reason: 'redis_error' }),
		];

		expect(filterAnomalies(list, 'redis')).toHaveLength(1);
		expect(filterAnomalies(list, '/items/b')).toHaveLength(1);
		expect(filterAnomalies(list, 'limit')).toHaveLength(1);
		expect(filterAnomalies(list, '')).toHaveLength(2);
	});
});

describe('formatTooltipValue', () => {
	it('formats a count as a plain rounded integer', () => {
		expect(formatTooltipValue(42.4, 'count')).toBe('42');
	});

	it('formats seconds as a human duration', () => {
		expect(formatTooltipValue(3600, 'seconds')).toBe('1h');
	});

	it('formats a percent with its sign', () => {
		expect(formatTooltipValue(83.6, 'percent')).toBe('84%');
	});

	it('shows an em dash for a null/undefined value', () => {
		expect(formatTooltipValue(null, 'count')).toBe('—');
		expect(formatTooltipValue(undefined, 'seconds')).toBe('—');
	});
});

describe('carryForward', () => {
	it('carries the last known value across null gaps', () => {
		const points: [number, number | null][] = [
			[1, 10],
			[2, null],
			[3, null],
			[4, 20],
			[5, null],
		];

		expect(carryForward(points)).toEqual([
			[1, 10],
			[2, 10],
			[3, 10],
			[4, 20],
			[5, 20],
		]);
	});

	it('back-fills leading nulls with the first known value', () => {
		const points: [number, number | null][] = [
			[1, null],
			[2, null],
			[3, 7],
		];

		expect(carryForward(points)).toEqual([
			[1, 7],
			[2, 7],
			[3, 7],
		]);
	});

	it('leaves an all-null series null', () => {
		const points: [number, number | null][] = [
			[1, null],
			[2, null],
		];

	expect(carryForward(points)).toEqual([
		[1, null],
		[2, null],
	]);
	});
});

describe('filterLatencyBand', () => {
	function timed(path: string, median: number | null): EndpointGroup {
		const latencies = emptyLatencies();
		latencies.miss.p50 = median;

		return {
			path,
			queries: [],
			entryCount: 0,
			anomalyCount: 0,
			coarseCount: 0,
			totalHits: 0,
			totalMisses: 0,
			totalFills: 0,
			totalSize: 0,
			hitRatio: null,
			maxFillMs: null,
			latencies,
		};
	}

	// Forty branches at 10ms..400ms, fastest first. Forty so the three bands land
	// on different counts — at twenty, the worst 5% and the worst 1% are both one
	// branch and the test would pass without distinguishing them.
	const groups = Array.from({ length: 40 }, (_unused, index) => {
		return timed(`/e${index}`, (index + 1) * 10);
	});

	it('keeps every branch when no band is picked', () => {
		expect(filterLatencyBand(groups, 'all', 'miss')).toEqual(groups);
	});

	it('keeps the worst 1% at p99, 5% at p95, half at p50', () => {
		const paths = (band: LatencyBand) => {
			return filterLatencyBand(groups, band, 'miss').map((group) => group.path);
		};

		expect(paths('p99')).toEqual(['/e39']);
		expect(paths('p95')).toEqual(['/e38', '/e39']);
		expect(paths('p50')).toHaveLength(20);
		expect(paths('p50')[0]).toBe('/e20');
	});

	it('returns branches in their input order, not slowest-first', () => {
		const kept = filterLatencyBand(groups, 'p95', 'miss');
		expect(kept.map((group) => group.path)).toEqual(['/e38', '/e39']);
	});

	it('ranks on the chosen metric, so another metric picks another branch', () => {
		const mixed = [timed('/slow-miss', 500), timed('/fast-miss', 10)];
		mixed[1]!.latencies.hit.p50 = 900;
		mixed[0]!.latencies.hit.p50 = 5;

		expect(filterLatencyBand(mixed, 'p99', 'miss')[0]!.path).toBe('/slow-miss');
		expect(filterLatencyBand(mixed, 'p99', 'hit')[0]!.path).toBe('/fast-miss');
	});

	it('drops branches the window has no timing for', () => {
		const mixed = [timed('/untimed', null), timed('/timed', 10)];

		expect(filterLatencyBand(mixed, 'p50', 'miss').map((g) => g.path))
			.toEqual(['/timed']);

		expect(filterLatencyBand([timed('/untimed', null)], 'p50', 'miss')).toEqual([]);
	});

	it('always keeps at least one branch', () => {
		const two = [timed('/a', 10), timed('/b', 20)];
		expect(filterLatencyBand(two, 'p99', 'miss').map((g) => g.path)).toEqual(['/b']);
	});
});

describe('sortGroups', () => {
	function group(over: Partial<EndpointGroup>): EndpointGroup {
		return {
			path: '/items/x',
			queries: [],
			entryCount: 0,
			anomalyCount: 0,
			coarseCount: 0,
			totalHits: 0,
			totalMisses: 0,
			totalFills: 0,
			totalSize: 0,
			hitRatio: null,
			maxFillMs: null,
			latencies: emptyLatencies(),
			...over,
		};
	}

	const groups = [
		group({ path: '/a', totalHits: 10, hitRatio: 90 }),
		group({ path: '/b', totalHits: 5, hitRatio: 40 }),
		group({ path: '/c', totalHits: 20, hitRatio: null }),
	];

	it('sorts descending by default for count fields', () => {
		const sorted = sortGroups(groups, { field: 'hits', dir: -1 });
		expect(sorted.map((g) => g.path)).toEqual(['/c', '/a', '/b']);
	});

	it('sorts ascending (worst first) for ratio', () => {
		const sorted = sortGroups(groups, { field: 'ratio', dir: 1 });
		expect(sorted.map((g) => g.path)).toEqual(['/b', '/a', '/c']);
	});

	it('trails nulls regardless of direction', () => {
		const sorted = sortGroups(groups, { field: 'ratio', dir: -1 });
		expect(sorted.map((g) => g.path)).toEqual(['/a', '/b', '/c']);
	});

	it('does not mutate the input', () => {
		const before = groups.map((g) => g.path);
		sortGroups(groups, { field: 'hits', dir: -1 });
		expect(groups.map((g) => g.path)).toEqual(before);
	});

	it('ranks on a metric + percentile pair, slowest first', () => {
		function latencies(
			miss: [number, number, number],
			hit: [number, number, number],
		): NodeLatencies {
			return {
				response: { p50: miss[0], p95: miss[1], p99: miss[2] },
				miss: { p50: miss[0], p95: miss[1], p99: miss[2] },
				anomaly: { p50: null, p95: null, p99: null },
				fill: { p50: miss[0], p95: miss[1], p99: miss[2] },
				hit: { p50: hit[0], p95: hit[1], p99: hit[2] },
			};
		}

		const timed = [
			group({ path: '/slow', latencies: latencies([90, 400, 900], [1, 2, 3]) }),
			group({ path: '/fast', latencies: latencies([10, 20, 30], [4, 9, 11]) }),
			group({ path: '/mid', latencies: latencies([40, 120, 260], [2, 5, 8]) }),
			group({ path: '/untimed' }),
		];

		expect(sortGroups(timed, { field: 'missP95', dir: -1 }).map((g) => g.path))
			.toEqual(['/slow', '/mid', '/fast', '/untimed']);

		// Each metric ranks independently — the hit side inverts the miss order
		// here, so reading one off the other would be visible.
		expect(sortGroups(timed, { field: 'hitP95', dir: -1 }).map((g) => g.path))
			.toEqual(['/fast', '/mid', '/slow', '/untimed']);

		// And each percentile is its own column.
		expect(sortGroups(timed, { field: 'missP99', dir: 1 }).map((g) => g.path))
			.toEqual(['/fast', '/mid', '/slow', '/untimed']);

		// A metric with no events anywhere leaves every node null, so the ranking
		// keeps its input order instead of inventing one.
		expect(sortGroups(timed, { field: 'anomalyP95', dir: -1 }).map((g) => g.path))
			.toEqual(['/slow', '/fast', '/mid', '/untimed']);
	});
});


