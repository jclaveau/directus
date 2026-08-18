import { SchemaBuilder } from '@directus/schema-builder';
import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	countScopedCacheTagMembers,
	scopedCacheTagLabel,
	serializeScopedCacheTags,
	createScopedCacheCollector,
	dropScopedCacheTagIndex,
	purgeScopedCache,
	retryPendingScopedCachePurges,
	scopedCacheTagKey,
	startScopedCachePurgeRecovery,
} from './scoped-cache.js';
import { redisConfigAvailable, useRedis } from './redis/index.js';
import emitter from './emitter.js';
import { getCache } from './cache.js';
import { useLogger } from './logger/index.js';
import {
	queueCacheAnomaly,
	queueCachePurge,
	readCacheDescriptorForRedisKey,
} from './cache-events.js';
import {
	clearPendingScopedCachePurges,
	countFailedScopedCachePurgeRetry,
	listPendingScopedCachePurges,
	recordPendingScopedCachePurge,
} from './scoped-cache-pending-purges.js';

// hoisted: scoped-cache.ts reads `const env = useEnv()` at module load, before a
// plain `const env` below would be initialised (temporal dead zone).
const env = vi.hoisted(() => {
	return {
		CACHE_AUTO_PURGE_MODE: 'scoped',
		CACHE_STORE: 'redis',
		CACHE_NAMESPACE: 'ns',
	} as Record<string, any>;
});

vi.mock('@directus/env', () => ({ useEnv: () => env }));
vi.mock('./redis/index.js');

vi.mock('./emitter.js', () => {
	return { default: { emitAction: vi.fn(), emitFilter: vi.fn() } };
});

vi.mock('./logger/index.js', () => ({ useLogger: vi.fn() }));
vi.mock('./cache.js', () => ({ getCache: vi.fn() }));

vi.mock('./cache-events.js', () => {
	return {
		queueCacheAnomaly: vi.fn(),
		queueCachePurge: vi.fn(),
		readCacheDescriptorForRedisKey: vi.fn(),
	};
});

vi.mock('./scoped-cache-pending-purges.js', () => {
	return {
		clearPendingScopedCachePurges: vi.fn(),
		countFailedScopedCachePurgeRetry: vi.fn(),
		listPendingScopedCachePurges: vi.fn(),
		recordPendingScopedCachePurge: vi.fn(),
	};
});

const pipeline = {
	scard: vi.fn().mockReturnThis(),
	exec: vi.fn(),
};

beforeEach(() => {
	env['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env['CACHE_STORE'] = 'redis';
	env['CACHE_NAMESPACE'] = 'ns';
	vi.mocked(redisConfigAvailable).mockReturnValue(true);
	vi.mocked(useRedis).mockReturnValue({ pipeline: () => pipeline } as any);
	vi.mocked(useLogger).mockReturnValue({ info: vi.fn(), warn: vi.fn() } as any);
	vi.mocked(listPendingScopedCachePurges).mockResolvedValue([]);
});

afterEach(() => {
	vi.clearAllMocks();
});

// The one spelling of a tag that the entry index, the purge index and the dev
// headers all share — if these two drift, a purge stops matching the entries it
// actually dropped and the attribution silently reads zero.
describe('the tag display form', () => {
	it('renders a bare collection and a pinned slice', () => {
		expect(scopedCacheTagLabel({ collection: 'articles' })).toBe('articles');

		expect(scopedCacheTagLabel({
			collection: 'articles',
			field: 'author',
			value: 7,
		})).toBe('articles:author=7');
	});

	it('canonicalises the value the same way the Redis key does', () => {
		// A filter's `true` and a driver's `1` must resolve one slice, not two.
		expect(scopedCacheTagLabel({
			collection: 'slots',
			field: 'active',
			value: 1,
			type: 'boolean',
		})).toBe('slots:active=true');
	});

	it('joins a set for the header form', () => {
		expect(serializeScopedCacheTags([
			{ collection: 'articles' },
			{ collection: 'articles', field: 'author', value: 7 },
		])).toBe('articles, articles:author=7');
	});
});

describe('countScopedCacheTagMembers', () => {
	it('scards each tag set and maps the reply to per-tag counts', async () => {
		pipeline.exec.mockResolvedValue([
			[null, 3],
			[null, 7],
		]);

		const counts = await countScopedCacheTagMembers([
			'articles',
			'articles:id=5',
		]);

		expect(pipeline.scard).toHaveBeenCalledWith('ns:tag:articles');
		expect(pipeline.scard).toHaveBeenCalledWith('ns:tag:articles:id=5');
		expect(counts).toEqual({ 'articles': 3, 'articles:id=5': 7 });
	});

	it('treats a missing pipeline reply as a zero count', async () => {
		pipeline.exec.mockResolvedValue([undefined]);

		expect(await countScopedCacheTagMembers(['orphan'])).toEqual({ orphan: 0 });
	});

	it('returns {} when scoped purging is disabled', async () => {
		env['CACHE_AUTO_PURGE_MODE'] = 'full';

		expect(await countScopedCacheTagMembers(['articles'])).toEqual({});
		expect(pipeline.scard).not.toHaveBeenCalled();
	});

	it('returns {} for an empty tag list', async () => {
		expect(await countScopedCacheTagMembers([])).toEqual({});
		expect(pipeline.scard).not.toHaveBeenCalled();
	});
});

describe('createScopedCacheCollector', () => {
	// A uuid key is where a missing type bites hardest: `canonicalScopedCacheValue`
	// lowercases a `uuid` and leaves an untyped value alone.
	const notesSchema = new SchemaBuilder()
		.collection('notes', (c) => {
			c.field('id')
				.uuid()
				.primary();
		})
		.build();

	it('scopeTo and purgeBy feed one idempotent tag set', () => {
		const { scope, purge, tags } = createScopedCacheCollector();
		const authorSlice = { collection: 'articles', field: 'author', value: 5 };

		scope.scopeTo(authorSlice);
		purge.purgeBy({ ...authorSlice }); // same slice via the other handle → deduped

		expect(tags).toEqual([authorSlice]);
	});

	it('accepts a batch, deduping within it and against prior tags', () => {
		const { scope, tags } = createScopedCacheCollector();
		const authorSlice = { collection: 'articles', field: 'author', value: 5 };
		const authorsTable = { collection: 'authors' };

		scope.scopeTo(authorSlice);
		scope.scopeTo([{ ...authorSlice }, authorsTable, authorsTable]);

		// authorSlice repeats the prior tag, authorsTable appears twice → each once.
		expect(tags).toEqual([authorSlice, authorsTable]);
	});

	it('dedups on the canonical tag key — field order and value type collapse', () => {
		const { scope, purge, tags } = createScopedCacheCollector();

		scope.scopeTo({ collection: 'articles', field: 'author', value: 7 });
		// Same slice: keys in a different order AND the value as a string. A raw JSON
		// compare would keep both; the canonical key collapses them to one.
		purge.purgeBy({ field: 'author', value: '7', collection: 'articles' });

		expect(tags).toHaveLength(1);
	});

	it(oneLine`
		fills a type-less tag's type from the schema — the type is what canonicalizes
		the value, so an uppercase uuid a hook names would otherwise resolve a
		different key from the lowercase one the purge side emits for the same row
	`, () => {
		const upper = '07D1AF3C-4B4E-4D6E-9C2A-2F1E0B8A5C31';
		const { scope, purge, tags } = createScopedCacheCollector(notesSchema);

		scope.scopeTo({ collection: 'notes', field: 'id', value: upper });
		// The spelling the driver hands the purge side for the very same row.
		purge.purgeBy({ collection: 'notes', field: 'id', value: upper.toLowerCase() });

		expect(tags).toEqual([
			{ collection: 'notes', field: 'id', value: upper, type: 'uuid' },
		]);

		expect(scopedCacheTagKey(tags[0]!)).toBe(
			`ns:tag:notes:id=${upper.toLowerCase()}`,
		);
	});

	it(oneLine`
		leaves a tag whose type the hook DID declare alone, and a bare collection tag
		has no field to look up
	`, () => {
		const { scope, tags } = createScopedCacheCollector(notesSchema);

		scope.scopeTo({ collection: 'notes', field: 'id', value: 7, type: 'integer' });
		scope.scopeTo({ collection: 'notes' });

		expect(tags).toEqual([
			{ collection: 'notes', field: 'id', value: 7, type: 'integer' },
			{ collection: 'notes' },
		]);
	});

	it(oneLine`
		leaves a tag naming a collection or field the schema doesn't know untyped
		rather than inventing one
	`, () => {
		const { scope, tags } = createScopedCacheCollector(notesSchema);

		scope.scopeTo({ collection: 'ghosts', field: 'id', value: 'A' });
		scope.scopeTo({ collection: 'notes', field: 'ghost', value: 'A' });

		expect(tags).toEqual([
			{ collection: 'ghosts', field: 'id', value: 'A' },
			{ collection: 'notes', field: 'ghost', value: 'A' },
		]);
	});

	it('records a manuallyPurged scopeTo tag key (anomaly-exempt)', () => {
		const { scope, manuallyPurgedKeys } = createScopedCacheCollector();
		const slice = { collection: 'articles', field: 'author', value: 5 };

		scope.scopeTo(slice, { manuallyPurged: true });

		expect(manuallyPurgedKeys.has(scopedCacheTagKey(slice))).toBe(true);
	});

	it('leaves a plain scopeTo / purgeBy out of the manuallyPurged set', () => {
		const { scope, purge, manuallyPurgedKeys } = createScopedCacheCollector();

		scope.scopeTo({ collection: 'articles', field: 'author', value: 5 });
		purge.purgeBy({ collection: 'authors' });

		expect(manuallyPurgedKeys.size).toBe(0);
	});
});

describe('dropScopedCacheTagIndex', () => {
	it('scans the tag namespace and deletes every index set', async () => {
		const scan = vi.fn()
			.mockResolvedValueOnce(['4', ['ns:tag:articles', 'ns:tag:authors']])
			.mockResolvedValueOnce(['0', ['ns:tag:articles:id=1']]);

		const del = vi.fn();
		vi.mocked(useRedis).mockReturnValue({ scan, del } as any);

		await dropScopedCacheTagIndex();

		expect(scan).toHaveBeenCalledWith('0', 'MATCH', 'ns:tag:*', 'COUNT', 250);
		expect(scan).toHaveBeenCalledWith('4', 'MATCH', 'ns:tag:*', 'COUNT', 250);

		// ONE array argument, never a spread: the SCAN result is unbounded, and
		// spreading it past the stack's headroom throws RangeError.
		expect(del).toHaveBeenCalledWith([
			'ns:tag:articles',
			'ns:tag:authors',
			'ns:tag:articles:id=1',
		]);
	});

	it('no-ops (never DELs an empty list) when nothing matches', async () => {
		const scan = vi.fn().mockResolvedValue(['0', []]);
		const del = vi.fn();
		vi.mocked(useRedis).mockReturnValue({ scan, del } as any);

		await dropScopedCacheTagIndex();

		expect(del).not.toHaveBeenCalled();
	});

	it('no-ops when Redis is unavailable', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		const scan = vi.fn();
		vi.mocked(useRedis).mockReturnValue({ scan } as any);

		await dropScopedCacheTagIndex();

		expect(scan).not.toHaveBeenCalled();
	});
});

// A purge that failed after its mutation committed is finished later
// (https://github.com/jclaveau/directus/issues/365). What the retry must NOT do is
// as load-bearing as what it does: it drops exactly the targets that were recorded,
// so every slice that was never in doubt stays warm.
describe('retryPendingScopedCachePurges', () => {
	const cache = { clear: vi.fn(), delete: vi.fn().mockResolvedValue(true) };
	const redis = { smembers: vi.fn(), del: vi.fn(), scan: vi.fn() };

	beforeEach(() => {
		vi.mocked(getCache).mockReturnValue({ cache } as any);
		vi.mocked(useRedis).mockReturnValue(redis as any);
		redis.smembers.mockResolvedValue([]);
		redis.scan.mockResolvedValue(['0', []]);

		// The shape a deployment with CACHE_STATS off returns for every entry, so a
		// case has to opt IN to being able to name what it recovered.
		vi.mocked(readCacheDescriptorForRedisKey).mockResolvedValue(null);
	});

	it(oneLine`
		rebuilds a recorded label against the namespace in force AT RETRY TIME, so a
		CACHE_NAMESPACE change between the failure and the retry cannot misaim it
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'slices',
			collection: 'articles',
			scopedCacheTags: ['articles:id=1'],
			ids: [7],
		}]);

		redis.smembers.mockResolvedValue(['ns:entry-a']);

		// The label was recorded under `ns`; the process now runs under `other`.
		env['CACHE_NAMESPACE'] = 'other';

		expect(await retryPendingScopedCachePurges()).toBe(1);

		expect(redis.smembers).toHaveBeenCalledWith('other:tag:articles:id=1');
		expect(cache.delete).toHaveBeenCalledWith('ns:entry-a');
		expect(redis.del).toHaveBeenCalledWith(['other:tag:articles:id=1']);
		expect(clearPendingScopedCachePurges).toHaveBeenCalledWith([7]);
	});

	it(oneLine`
		rescans the collection for a collection-mode record — it named no tag because
		which slices changed was unresolvable when it failed
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'collection',
			collection: 'articles',
			scopedCacheTags: [],
			ids: [7],
		}]);

		redis.scan.mockResolvedValue(['0', ['ns:tag:articles:id=1']]);

		expect(await retryPendingScopedCachePurges()).toBe(1);

		expect(redis.scan)
			.toHaveBeenCalledWith('0', 'MATCH', 'ns:tag:articles:*', 'COUNT', 250);

		expect(redis.del)
			.toHaveBeenCalledWith(['ns:tag:articles', 'ns:tag:articles:id=1']);

		expect(cache.clear).not.toHaveBeenCalled();
	});

	it('flushes the whole namespace for a namespace-mode record', async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'namespace',
			collection: null,
			scopedCacheTags: [],
			ids: [7],
		}]);

		expect(await retryPendingScopedCachePurges()).toBe(1);

		expect(cache.clear).toHaveBeenCalledOnce();
		expect(redis.del).not.toHaveBeenCalled();
		expect(clearPendingScopedCachePurges).toHaveBeenCalledWith([7]);
	});

	it(oneLine`
		keeps a record whose retry failed again and counts the attempt, then carries on
		to the targets behind it
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([
			{
				mode: 'slices',
				collection: 'articles',
				scopedCacheTags: ['articles:id=1'],
				ids: [7],
			},
			{
				mode: 'slices',
				collection: 'articles',
				scopedCacheTags: ['articles:id=2'],
				ids: [8],
			},
		]);

		const closed = new Error('Connection is closed.');
		redis.smembers.mockRejectedValueOnce(closed);

		expect(await retryPendingScopedCachePurges()).toBe(1);

		expect(countFailedScopedCachePurgeRetry).toHaveBeenCalledWith([7], closed);
		expect(clearPendingScopedCachePurges).not.toHaveBeenCalledWith([7]);
		expect(clearPendingScopedCachePurges).toHaveBeenCalledWith([8]);
	});

	it('reads nothing when there is no Redis to retry against', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);

		expect(await retryPendingScopedCachePurges()).toBe(0);
		expect(listPendingScopedCachePurges).not.toHaveBeenCalled();
	});

	it('touches the cache at all only when something is pending', async () => {
		expect(await retryPendingScopedCachePurges()).toBe(0);
		expect(getCache).not.toHaveBeenCalled();
	});

	it('leaves the records in place when the cache itself is off', async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'namespace',
			collection: null,
			scopedCacheTags: [],
			ids: [7],
		}]);

		vi.mocked(getCache).mockReturnValue({ cache: null } as any);

		expect(await retryPendingScopedCachePurges()).toBe(0);
		expect(clearPendingScopedCachePurges).not.toHaveBeenCalled();
	});

	// Reported here rather than when the purge failed, because the anomaly stream is
	// itself Redis-backed: reporting at failure time reports nothing in the one case
	// worth reporting.
	it(oneLine`
		names each entry it found stale, counting the sidecars that ride the same tag as
		the entry they belong to rather than as two more
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'slices',
			collection: 'articles',
			scopedCacheTags: ['articles:id=1'],
			ids: [7],
		}]);

		redis.smembers.mockResolvedValue([
			'ns:entry-a',
			'ns:entry-a__expires_at',
			'ns:entry-a__tags',
		]);

		vi.mocked(readCacheDescriptorForRedisKey)
			.mockResolvedValue({ cacheKey: 'GET /items/articles/1' } as any);

		await retryPendingScopedCachePurges();

		expect(queueCacheAnomaly).toHaveBeenCalledOnce();

		expect(queueCacheAnomaly).toHaveBeenCalledWith({
			cacheKey: 'GET /items/articles/1',
			reason: 'redis_error',
			detail: 'served stale until a failed purge was retried',
		});
	});

	it(oneLine`
		purges an entry whose descriptor is gone all the same — stats were off when it
		was filled, so it can be dropped but not named
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'slices',
			collection: 'articles',
			scopedCacheTags: ['articles:id=1'],
			ids: [7],
		}]);

		redis.smembers.mockResolvedValue(['ns:entry-a']);
		vi.mocked(readCacheDescriptorForRedisKey).mockResolvedValue(null);

		expect(await retryPendingScopedCachePurges()).toBe(1);

		expect(queueCacheAnomaly).not.toHaveBeenCalled();
		expect(cache.delete).toHaveBeenCalledWith('ns:entry-a');
	});
});

describe('startScopedCachePurgeRecovery', () => {
	it(oneLine`
		retries at boot and again on every reconnect — those are the two moments a
		previously unreachable Redis can have come back
	`, async () => {
		const on = vi.fn();
		vi.mocked(useRedis).mockReturnValue({ on } as any);

		startScopedCachePurgeRecovery();

		expect(on).toHaveBeenCalledWith('ready', expect.any(Function));
		await vi.waitFor(() => expect(listPendingScopedCachePurges).toHaveBeenCalled());

		on.mock.calls[0]![1]();

		await vi.waitFor(() => {
			expect(listPendingScopedCachePurges).toHaveBeenCalledTimes(2);
		});
	});

	it('registers no listener when there is no Redis config', () => {
		const on = vi.fn();
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		vi.mocked(useRedis).mockReturnValue({ on } as any);

		startScopedCachePurgeRecovery();

		expect(on).not.toHaveBeenCalled();
	});

	it(oneLine`
		logs a retry that throws rather than leaving the rejection unhandled — nothing
		awaits this, so an unhandled one would take the process down
	`, async () => {
		const warn = vi.fn();
		vi.mocked(useLogger).mockReturnValue({ info: vi.fn(), warn } as any);
		vi.mocked(useRedis).mockReturnValue({ on: vi.fn() } as any);

		vi.mocked(listPendingScopedCachePurges)
			.mockRejectedValue(new Error('Connection is closed.'));

		startScopedCachePurgeRecovery();

		await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
	});

	it('reports the count once there was something to finish', async () => {
		const info = vi.fn();
		vi.mocked(useLogger).mockReturnValue({ info, warn: vi.fn() } as any);
		vi.mocked(useRedis).mockReturnValue({ on: vi.fn() } as any);
		vi.mocked(getCache).mockReturnValue({ cache: { clear: vi.fn() } } as any);

		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'namespace',
			collection: null,
			scopedCacheTags: [],
			ids: [7],
		}]);

		startScopedCachePurgeRecovery();

		await vi.waitFor(() => {
			expect(info)
				.toHaveBeenCalledWith('[scoped-cache] finished 1 pending purge(s)');
		});
	});
});

// A purge runs AFTER its mutation committed, so by the time it can fail the write
// is durable. Answering 500 would have the client retry a mutation that already
// landed, so the request wins and the purge is recorded to be finished later.
describe('a purge that fails after its mutation committed', () => {
	const cache = { clear: vi.fn(), delete: vi.fn().mockResolvedValue(true) };
	const closed = new Error('Connection is closed.');

	beforeEach(() => {
		vi.mocked(useRedis).mockReturnValue({
			smembers: vi.fn().mockResolvedValue([]),
			del: vi.fn(),
			scan: vi.fn().mockResolvedValue(['0', []]),
		} as any);

		vi.mocked(emitter.emitFilter).mockImplementation(async (_e, tags) => tags);
		cache.clear.mockResolvedValue(undefined);
	});

	it(oneLine`
		records the slices it could not drop, and reports no purge it did not run
	`, async () => {
		vi.mocked(useRedis).mockReturnValue({
			smembers: vi.fn().mockRejectedValue(closed),
		} as any);

		const purged = await purgeScopedCache(cache as any, 'articles', [
			{ collection: 'articles', field: 'id', value: 1 },
		]);

		expect(recordPendingScopedCachePurge).toHaveBeenCalledWith(
			{
				mode: 'slices',
				collection: 'articles',
				scopedCacheTags: ['articles', 'articles:id=1'],
			},
			closed,
		);

		// Still answered with the tags the mutation resolved — the caller's dev header
		// names what SHOULD have gone, and the recovery is what makes that true.
		expect(purged).toEqual([
			{ collection: 'articles' },
			{ collection: 'articles', field: 'id', value: 1 },
		]);

		expect(queueCachePurge).not.toHaveBeenCalled();
	});

	it(oneLine`
		records the collection when the slices were unresolvable and the fallback scan
		failed too
	`, async () => {
		vi.mocked(useRedis).mockReturnValue({
			scan: vi.fn().mockRejectedValue(closed),
		} as any);

		expect(await purgeScopedCache(cache as any, 'articles', null))
			.toEqual([{ collection: 'articles' }]);

		expect(recordPendingScopedCachePurge).toHaveBeenCalledWith(
			{ mode: 'collection', collection: 'articles', scopedCacheTags: [] },
			closed,
		);

		expect(queueCachePurge).not.toHaveBeenCalled();
	});

	it(oneLine`
		records the whole namespace when scoped mode is off and the flush failed
	`, async () => {
		env['CACHE_AUTO_PURGE_MODE'] = 'all';
		cache.clear.mockRejectedValue(closed);

		expect(await purgeScopedCache(cache as any, 'articles', [])).toBeNull();

		expect(recordPendingScopedCachePurge).toHaveBeenCalledWith(
			{ mode: 'namespace', collection: null, scopedCacheTags: [] },
			closed,
		);

		expect(queueCachePurge).not.toHaveBeenCalled();
	});

	it('records nothing, and reports the purge, when it went through', async () => {
		await purgeScopedCache(cache as any, 'articles', [
			{ collection: 'articles', field: 'id', value: 1 },
		]);

		expect(recordPendingScopedCachePurge).not.toHaveBeenCalled();
		expect(queueCachePurge).toHaveBeenCalledOnce();
	});
});
