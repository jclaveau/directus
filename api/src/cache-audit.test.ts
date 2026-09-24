import { oneLine } from '@directus/utils';
import jwt from 'jsonwebtoken';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getCache, getCacheValue } from './cache.js';
import {
	auditCache,
	type CacheAuditReplayer,
	type CacheAuditReplayResponse,
	loopbackReplayer,
	loopbackTarget,
} from './cache-audit.js';
import {
	advanceCacheAuditQueue,
	type CacheAuditDescriptor,
	cacheStatsConfigured,
	claimCacheAnomalyThrottleSlot,
	evictCacheEntry,
	listPurgesCoveringEntry,
	queueCacheAnomaly,
	readCacheAuditQueue,
	readScopedCacheEntryTags,
	retireCacheAuditQueue,
} from './cache-events.js';
import getDatabase from './database/index.js';
import {
	CACHE_AUDIT_REPLAY_HEADER,
	CACHE_AUDIT_TAGS_HEADER,
	cacheAuditReplayToken,
} from './utils/cache-audit-replay.js';
import { decompress } from './utils/compress.js';

// A factory rather than an automock: `./cache.js` reads the env while it loads.
const envRef = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('@directus/env', () => ({ useEnv: () => envRef.current }));
vi.mock('./cache.js');
vi.mock('./cache-events.js');
vi.mock('./database/index.js');
vi.mock('./utils/compress.js');

vi.mock('./utils/get-secret.js', () => {
	return { getSecret: () => 'audit-secret' };
});

// A Keyv as the audit sees it: whether a page of keys is held, the bodies of
// the ones it takes, plus `get`/`has` for the re-reads the race guard makes.
class FakeCache {
	store = new Map<string, unknown>();
	listeners = new Set<(error: unknown) => void>();
	getMany = vi.fn(async (keys: string[]): Promise<unknown[]> => {
		return keys.map((key) => this.store.get(key));
	});

	// As @keyv/redis answers: a store that could not be reached is an 'error'
	// event and every key absent.
	hasMany = vi.fn(async (keys: string[]): Promise<boolean[]> => {
		return keys.map((key) => this.store.has(key));
	});

	on(_event: 'error', listener: (error: unknown) => void): void {
		this.listeners.add(listener);
	}

	off(_event: 'error', listener: (error: unknown) => void): void {
		this.listeners.delete(listener);
	}

	emit(error: unknown): void {
		for (const listener of this.listeners) {
			listener(error);
		}
	}

	async get(key: string): Promise<unknown> {
		return this.store.get(key);
	}

	async has(key: string): Promise<boolean> {
		return this.store.has(key);
	}
}

let cache: FakeCache;
// The descriptor table as the queue reads it: what was described, minus what
// a run has advanced past, in the order it was described.
let queue: CacheAuditDescriptor[];
const users = new Map<string, { id: string; role: string | null }>();
const userLookups = vi.fn();

function descriptor(
	overrides: Partial<CacheAuditDescriptor> = {},
): CacheAuditDescriptor {
	return {
		cacheKey: 'ck',
		redisKey: 'rk',
		method: 'GET',
		path: '/items/articles',
		collection: 'articles',
		userId: 'user-1',
		query: 'filter[owner][_eq]=acme',
		lastFilled: new Date('2026-09-16T10:00:00Z'),
		scopedCacheTags: ['articles:owner=acme'],
		...overrides,
	};
}

function fill(
	redisKey: string,
	body: unknown,
	createdAt: number | null = 1_000,
): void {
	cache.store.set(redisKey, body);

	if (createdAt !== null) {
		cache.store.set(`${redisKey}__expires_at`, {
			exp: Date.now() + 60_000,
			createdAt,
			ttlMs: 60_000,
		});
	}
}

function answer(
	body: unknown,
	overrides: Partial<CacheAuditReplayResponse> & { tags?: string } = {},
): CacheAuditReplayResponse {
	const { tags, ...rest } = overrides;

	return {
		status: 200,
		headers: { [CACHE_AUDIT_TAGS_HEADER]: tags ?? 'articles:owner=acme' },
		body: JSON.stringify(body),
		...rest,
	};
}

function replayer(
	...answers: CacheAuditReplayResponse[]
): ReturnType<typeof vi.fn> & CacheAuditReplayer {
	const replay = vi.fn();

	for (const each of answers) {
		replay.mockResolvedValueOnce(each);
	}

	return replay as ReturnType<typeof vi.fn> & CacheAuditReplayer;
}

function described(...descriptors: CacheAuditDescriptor[]): void {
	queue = descriptors;
}

function advancedPast(): string[] {
	return vi.mocked(advanceCacheAuditQueue).mock.calls.flatMap(([keys]) => keys);
}

function retired(): string[] {
	return vi.mocked(retireCacheAuditQueue).mock.calls.flatMap(([keys]) => keys);
}

beforeEach(() => {
	cache = new FakeCache();
	envRef.current = { CACHE_AUDIT_IGNORE_PATHS: [] };
	users.clear();
	users.set('user-1', { id: 'user-1', role: 'role-1' });

	vi.mocked(getCache).mockReturnValue({ cache } as any);

	vi.mocked(getCacheValue).mockImplementation(async (_cache, key) => {
		return cache.store.get(key);
	});

	vi.mocked(decompress).mockImplementation(async (value) => value);
	vi.mocked(cacheStatsConfigured).mockReturnValue(true);
	queue = [];

	vi.mocked(readCacheAuditQueue).mockImplementation(async (count, _at, filter) => {
		const stamped = new Set([...advancedPast(), ...retired()]);

		return queue
			.filter((each) => !stamped.has(each.cacheKey))
			.filter((each) => filter?.user === undefined || each.userId === filter.user)
			.filter((each) => {
				return filter?.collection === undefined
					|| each.collection === filter.collection;
			})
			.slice(0, count);
	});

	vi.mocked(readScopedCacheEntryTags).mockImplementation(async (cacheKeys) => {
		return new Map(
			queue
				.filter((each) => cacheKeys.includes(each.cacheKey))
				.map((each) => [each.cacheKey, each.scopedCacheTags]),
		);
	});

	vi.mocked(listPurgesCoveringEntry).mockResolvedValue([]);
	vi.mocked(claimCacheAnomalyThrottleSlot).mockResolvedValue(true);

	vi.mocked(getDatabase).mockReturnValue(((table: string) => {
		return {
			where: (clause: { id: string }) => {
				return {
					first: async () => {
						userLookups(table, clause.id);

						return users.get(clause.id);
					},
				};
			},
		};
	}) as any);
});

afterEach(() => {
	vi.restoreAllMocks();
	userLookups.mockReset();
});

test('answers an empty report where there is no cache', async () => {
	vi.mocked(getCache).mockReturnValue({ cache: null } as any);

	const report = await auditCache({ replay: replayer() });

	expect(report.scanned).toBe(0);
	expect(report.findings).toEqual([]);
	expect(readCacheAuditQueue).not.toHaveBeenCalled();
});

test('refuses where no descriptor can have been written', async () => {
	vi.mocked(cacheStatsConfigured).mockReturnValue(false);

	await expect(auditCache({ replay: replayer() })).rejects.toThrowError(
		'CACHE_STATS_ENABLED is off',
	);
});

describe('the queue', () => {
	test(oneLine`
		is read a page at a time, bounded by when the run began, and advanced past
		what each page held
	`, async () => {
		fill('rk1', { data: [] });
		fill('rk2', { data: [] });

		described(
			descriptor({ redisKey: 'rk1', cacheKey: 'ck1' }),
			descriptor({ redisKey: 'rk2', cacheKey: 'ck2' }),
		);

		const startedAt = Date.now();

		const report = await auditCache({
			replay: replayer(answer({ data: [] }), answer({ data: [] })),
		});

		expect(report.scanned).toBe(2);

		const [count, before, filter] = vi.mocked(readCacheAuditQueue).mock.calls[0]!;
		expect(count).toBe(500);
		expect(before.getTime()).toBeGreaterThanOrEqual(startedAt);
		expect(before.getTime()).toBeLessThanOrEqual(Date.now());
		expect(filter).toEqual({ user: undefined, collection: undefined });

		// One page held both; the second read found the queue empty.
		expect(readCacheAuditQueue).toHaveBeenCalledTimes(2);
		expect(advancedPast()).toEqual(['ck1', 'ck2']);
	});

	test(oneLine`
		retires a descriptor whose entry is gone, as of when the cache was asked,
		without examining it
	`, async () => {
		fill('rk2', { data: [] });

		described(
			descriptor({ redisKey: 'rk1', cacheKey: 'ck1' }),
			descriptor({ redisKey: 'rk2', cacheKey: 'ck2' }),
		);

		const replay = replayer(answer({ data: [] }));
		const startedAt = Date.now();

		const report = await auditCache({ replay });

		expect(report.scanned).toBe(1);
		expect(replay).toHaveBeenCalledTimes(1);
		// Out of the queue until its next fill, not merely behind the rest.
		expect(retired()).toEqual(['ck1']);
		expect(advancedPast()).toEqual(['ck2']);

		const [, askedAt] = vi.mocked(retireCacheAuditQueue).mock.calls[0]!;
		expect(askedAt.getTime()).toBeGreaterThanOrEqual(startedAt);
		expect(askedAt.getTime()).toBeLessThanOrEqual(Date.now());

		// Neither its body nor its tags were asked for: the cache said it was
		// gone before either.
		expect(cache.getMany).toHaveBeenCalledWith(['rk2', 'rk2__expires_at']);
		expect(readScopedCacheEntryTags).toHaveBeenCalledWith(['ck2']);
	});

	test(oneLine`
		retires nothing, and stops, when the cache could not say what it holds
	`, async () => {
		fill('rk', { data: [] });
		described(descriptor());

		cache.hasMany.mockImplementation(async (keys: string[]) => {
			cache.emit(new Error('ECONNREFUSED'));

			return keys.map(() => false);
		});

		const replay = replayer();

		await expect(auditCache({ replay })).rejects.toThrow(
			'The cache could not be asked what it holds: ECONNREFUSED',
		);

		expect(retireCacheAuditQueue).not.toHaveBeenCalled();
		expect(advanceCacheAuditQueue).not.toHaveBeenCalled();
		expect(replay).not.toHaveBeenCalled();
		// Nothing left listening on the cache once the run is over.
		expect(cache.listeners.size).toBe(0);
	});

	test('the same for a cache that throws, as one never reached does', async () => {
		fill('rk', { data: [] });
		described(descriptor());

		cache.hasMany.mockRejectedValue(
			new Error('Redis client is not connected or has failed to connect.'),
		);

		await expect(auditCache({ replay: replayer() })).rejects.toThrow(
			'The cache could not be asked what it holds: Redis client is not connected',
		);

		expect(retireCacheAuditQueue).not.toHaveBeenCalled();
		expect(cache.listeners.size).toBe(0);
	});

	test('names the attempt behind a bare AggregateError', async () => {
		fill('rk', { data: [] });
		described(descriptor());

		cache.hasMany.mockRejectedValue(
			new AggregateError([new Error('connect ECONNREFUSED 127.0.0.1:6379')]),
		);

		await expect(auditCache({ replay: replayer() })).rejects.toThrow(
			'The cache could not be asked what it holds: connect ECONNREFUSED',
		);
	});

	test('stops once its time is up, after the page it began', async () => {
		fill('rk1', { data: [] });
		fill('rk2', { data: [] });

		described(
			descriptor({ redisKey: 'rk1', cacheKey: 'ck1' }),
			descriptor({ redisKey: 'rk2', cacheKey: 'ck2' }),
		);

		vi.mocked(readCacheAuditQueue).mockImplementation(async () => {
			return queue.filter((each) => !advancedPast().includes(each.cacheKey))
				.slice(0, 1);
		});

		const report = await auditCache({
			maxDurationMs: 0,
			replay: replayer(answer({ data: [] })),
		});

		// The first page was examined whole; the second was never read.
		expect(report.scanned).toBe(1);
		expect(report.timedOut).toBe(true);
		expect(readCacheAuditQueue).toHaveBeenCalledTimes(1);
		expect(advancedPast()).toEqual(['ck1']);
	});

	test('is not timed out where the budget outlasts the queue', async () => {
		fill('rk1', { data: [] });
		described(descriptor({ redisKey: 'rk1', cacheKey: 'ck1' }));

		const report = await auditCache({
			maxDurationMs: 600_000,
			replay: replayer(answer({ data: [] })),
		});

		expect(report.scanned).toBe(1);
		expect(report.timedOut).toBe(false);
		expect(readCacheAuditQueue).toHaveBeenCalledTimes(2);
	});

	test(oneLine`
		reads the bodies of what the limit has room for, not of the whole page
	`, async () => {
		fill('rk1', { data: [] });
		fill('rk2', { data: [] });
		fill('rk3', { data: [] });

		described(
			descriptor({ redisKey: 'rk1', cacheKey: 'ck1' }),
			descriptor({ redisKey: 'rk2', cacheKey: 'ck2' }),
			descriptor({ redisKey: 'rk3', cacheKey: 'ck3' }),
		);

		const report = await auditCache({
			limit: 2,
			replay: replayer(answer({ data: [] }), answer({ data: [] })),
		});

		expect(report.scanned).toBe(2);
		expect(cache.getMany).toHaveBeenCalledTimes(1);

		expect(cache.getMany).toHaveBeenCalledWith([
			'rk1',
			'rk1__expires_at',
			'rk2',
			'rk2__expires_at',
		]);

		expect(readScopedCacheEntryTags).toHaveBeenCalledWith(['ck1', 'ck2']);
		// The third stays unstamped for the next run.
		expect(advancedPast()).toEqual(['ck1', 'ck2']);
	});

	test('an entry gone between the ask and the read is raced', async () => {
		fill('rk', { data: [] });
		described(descriptor());

		cache.getMany.mockImplementationOnce(async () => {
			cache.store.delete('rk');

			return [undefined];
		});

		const replay = replayer();
		const report = await auditCache({ replay });

		expect(report.counts.raced).toBe(1);
		expect(replay).not.toHaveBeenCalled();
	});

	test('an entry with no descriptor is not the audit\'s to see', async () => {
		fill('rk', { data: [] });
		const replay = replayer();

		const report = await auditCache({ replay });

		expect(report.scanned).toBe(0);
		expect(replay).not.toHaveBeenCalled();
		expect(advanceCacheAuditQueue).not.toHaveBeenCalled();
		expect(retireCacheAuditQueue).not.toHaveBeenCalled();
	});

	test('is advanced before the replay, not after it', async () => {
		fill('rk', { data: [] });
		described(descriptor());

		const replay = vi.fn(async () => {
			expect(advancedPast()).toEqual(['ck']);

			return answer({ data: [] });
		});

		await auditCache({ replay });

		expect(replay).toHaveBeenCalledTimes(1);
	});
});

describe('a fresh entry', () => {
	test(oneLine`
		is replayed as it was sent, as its user, and stays out of the findings
	`, async () => {
		const body = { data: [{ id: 1, amount: '5' }] };
		fill('rk', body);
		described(descriptor());
		const replay = replayer(answer(body));

		const report = await auditCache({ replay });

		expect(report.scanned).toBe(1);
		expect(report.counts.fresh).toBe(1);
		expect(report.findings).toEqual([]);
		expect(replay).toHaveBeenCalledTimes(1);
		// Its expiry sidecar came with the body, in the page's one read.
		expect(cache.getMany).toHaveBeenCalledWith(['rk', 'rk__expires_at']);
		expect(getCacheValue).not.toHaveBeenCalled();

		const request = replay.mock.calls[0]![0];
		expect(request.method).toBe('GET');
		expect(request.path).toBe('/items/articles?filter[owner][_eq]=acme');
		expect(request.body).toBeUndefined();
		expect(request.headers['accept']).toBe('application/json');
		expect(request.headers[CACHE_AUDIT_REPLAY_HEADER]).toBe(cacheAuditReplayToken());

		const token = String(request.headers['authorization']).replace('Bearer ', '');
		const claims = jwt.verify(token, 'audit-secret') as Record<string, unknown>;
		expect(claims['id']).toBe('user-1');
		expect(claims['role']).toBe('role-1');
		expect(claims['iss']).toBe('directus');
		expect(claims['exp']).toBeGreaterThan(Date.now() / 1000);
		// Present because the verifier refuses a token without them; false
		// because the verifier reads the real grants back from the database.
		expect(claims['app_access']).toBe(false);
		expect(claims['admin_access']).toBe(false);
	});

	test('filled for nobody is replayed with no authorization at all', async () => {
		fill('rk', { data: [] });
		described(descriptor({ userId: null }));
		const replay = replayer(answer({ data: [] }));

		await auditCache({ replay });

		expect(replay.mock.calls[0]![0].headers['authorization']).toBeUndefined();
		expect(userLookups).not.toHaveBeenCalled();
	});

	test('skips the sidecars beside it rather than replaying them', async () => {
		fill('rk', { data: [] });
		cache.store.set('rk__tags', { tags: 'articles' });
		described(descriptor());
		const replay = replayer(answer({ data: [] }));

		const report = await auditCache({ replay });

		expect(report.scanned).toBe(1);
		expect(replay).toHaveBeenCalledTimes(1);
	});

	test(oneLine`
		compares the body as JSON, so key order and dates do not count
	`, async () => {
		fill('rk', { data: [{ b: new Date('2026-01-01T00:00:00Z'), a: 1 }] });
		described(descriptor());

		const report = await auditCache({
			replay: replayer(answer({ data: [{ a: 1, b: '2026-01-01T00:00:00.000Z' }] })),
		});

		expect(report.counts.fresh).toBe(1);
	});

	test(oneLine`
		looks a user up once however many entries were filled for them
	`, async () => {
		fill('rk1', { data: [] });
		fill('rk2', { data: [] });

		described(
			descriptor({ redisKey: 'rk1', cacheKey: 'ck1' }),
			descriptor({ redisKey: 'rk2', cacheKey: 'ck2' }),
		);

		await auditCache({
			replay: replayer(answer({ data: [] }), answer({ data: [] })),
		});

		expect(userLookups).toHaveBeenCalledTimes(1);
		expect(userLookups).toHaveBeenCalledWith('directus_users', 'user-1');
	});
});

describe('a stale entry', () => {
	test('is one whose diff holds across two fresh reads', async () => {
		fill('rk', { data: [{ id: 1, amount: '5' }] });
		described(descriptor());
		const fresh = { data: [{ id: 1, amount: '7' }] };
		const replay = replayer(answer(fresh), answer(fresh));

		const purges = [{
			time: 1,
			mode: 'slices' as const,
			collection: 'articles',
			scopedCacheTag: 'articles:owner=acme',
			evicted: 0,
		}];

		vi.mocked(listPurgesCoveringEntry).mockResolvedValue(purges);

		const report = await auditCache({ replay });

		expect(report.counts.stale).toBe(1);
		expect(replay).toHaveBeenCalledTimes(2);

		expect(report.findings).toEqual([expect.objectContaining({
			verdict: 'stale',
			reason: null,
			redisKey: 'rk',
			cacheKey: 'ck',
			method: 'GET',
			url: '/items/articles?filter[owner][_eq]=acme',
			user: 'user-1',
			collection: 'articles',
			filledAt: new Date('2026-09-16T10:00:00Z').getTime(),
			tags: ['articles:owner=acme'],
			replayTags: ['articles:owner=acme'],
			diff: ['/data/0/amount'],
			purgesSinceFilled: purges,
		})]);

		expect(listPurgesCoveringEntry).toHaveBeenCalledWith(
			'ck',
			new Date('2026-09-16T10:00:00Z'),
		);

		expect(queueCacheAnomaly).toHaveBeenCalledWith({
			cacheKey: 'ck',
			reason: 'stale_entry',
			detail: '/data/0/amount',
		});
	});

	test(oneLine`
		is not reported as an anomaly again inside the throttle window
	`, async () => {
		fill('rk', { data: [{ amount: '5' }] });
		described(descriptor());
		vi.mocked(claimCacheAnomalyThrottleSlot).mockResolvedValue(false);
		const fresh = { data: [{ amount: '7' }] };

		const report = await auditCache({
			replay: replayer(answer(fresh), answer(fresh)),
		});

		expect(report.counts.stale).toBe(1);
		expect(queueCacheAnomaly).not.toHaveBeenCalled();
	});

	test(oneLine`
		names the first differences as JSON pointers, whatever their shape
	`, async () => {
		fill('rk', { data: [{ a: 1 }, { a: 2 }], meta: { total: 2 }, gone: true });
		described(descriptor());

		const fresh = { data: [{ a: 1 }], meta: { total: 1, extra: 1 } };

		const report = await auditCache({
			replay: replayer(answer(fresh), answer(fresh)),
		});

		expect(report.findings[0]!.diff).toEqual([
			'/data/1',
			'/meta/total',
			'/meta/extra',
			'/gone',
		]);
	});

	test('a root that is not an object still diffs at its root', async () => {
		fill('rk', [1, 2]);
		described(descriptor());

		const report = await auditCache({ replay: replayer(answer('x'), answer('x')) });

		expect(report.findings[0]!.diff).toEqual(['/']);
	});

	test('reports at most twenty pointers', async () => {
		fill('rk', { data: Array.from({ length: 30 }, (_, i) => ({ v: i })) });
		described(descriptor());
		const fresh = { data: Array.from({ length: 30 }, () => ({ v: -1 })) };

		const report = await auditCache({
			replay: replayer(answer(fresh), answer(fresh)),
		});

		expect(report.findings[0]!.diff).toHaveLength(20);
	});

	test('is what a user now refused the read would be served', async () => {
		fill('rk', { data: [] });
		described(descriptor());

		const report = await auditCache({
			replay: replayer({ status: 403, headers: {}, body: '{"errors":[]}' }),
		});

		expect(report.findings).toEqual([expect.objectContaining({
			verdict: 'stale',
			reason: 'replay_status_403',
			diff: null,
			replayTags: null,
		})]);

		expect(queueCacheAnomaly).toHaveBeenCalledWith({
			cacheKey: 'ck',
			reason: 'stale_entry',
			detail: 'replay_status_403',
		});
	});
});

describe('the diff ignore list', () => {
	test(oneLine`
		drops the pointers CACHE_AUDIT_IGNORE_PATHS and the call name, one segment per *
	`, async () => {
		envRef.current['CACHE_AUDIT_IGNORE_PATHS'] = ['/data/*/served_at'];
		fill('rk', { data: [{ served_at: 1, nonce: 'a' }], meta: { at: 1 } });
		described(descriptor());
		const fresh = { data: [{ served_at: 2, nonce: 'b' }], meta: { at: 2 } };

		const report = await auditCache({
			replay: replayer(answer(fresh), answer(fresh)),
			ignore: ['/meta/at'],
		});

		expect(report.findings[0]!.diff).toEqual(['/data/0/nonce']);
	});

	test('a fully ignored diff is a fresh entry', async () => {
		fill('rk', { data: [{ deep: { served_at: 1 } }] });
		described(descriptor());

		const report = await auditCache({
			replay: replayer(answer({ data: [{ deep: { served_at: 2 } }] })),
			ignore: ['/data/**'],
		});

		expect(report.counts.fresh).toBe(1);
	});

	test('a glob matches whole pointers only', async () => {
		fill('rk', { data: [{ x: 1 }] });
		described(descriptor());
		const fresh = { data: [{ x: 2 }] };

		const report = await auditCache({
			replay: replayer(answer(fresh), answer(fresh)),
			ignore: ['/data/*', '/data/*/x/*'],
		});

		expect(report.findings[0]!.diff).toEqual(['/data/0/x']);
	});
});

describe('a time-varying entry', () => {
	test('is one whose two fresh reads disagree with each other', async () => {
		fill('rk', { data: [{ nonce: 'a' }] });
		described(descriptor());

		const report = await auditCache({
			replay: replayer(
				answer({ data: [{ nonce: 'b' }] }),
				answer({ data: [{ nonce: 'c' }] }),
			),
		});

		expect(report.counts.time_varying).toBe(1);

		expect(report.findings).toEqual([expect.objectContaining({
			verdict: 'time_varying',
			diff: ['/data/0/nonce'],
			purgesSinceFilled: null,
		})]);

		expect(queueCacheAnomaly).not.toHaveBeenCalled();
	});
});

describe('tag drift', () => {
	test('is the same body pinned under other tags', async () => {
		fill('rk', { data: [] });
		described(descriptor({ scopedCacheTags: ['articles:owner=acme', 'authors'] }));

		const report = await auditCache({
			replay: replayer(
				answer({ data: [] }, { tags: 'articles:owner=acme,authors:id=2' }),
			),
		});

		expect(report.counts.tag_drift).toBe(1);

		expect(report.findings).toEqual([expect.objectContaining({
			verdict: 'tag_drift',
			tags: ['articles:owner=acme', 'authors'],
			replayTags: ['articles:owner=acme', 'authors:id=2'],
			diff: null,
		})]);

		expect(queueCacheAnomaly).toHaveBeenCalledWith({
			cacheKey: 'ck',
			reason: 'tag_drift',
			detail: 'filled under articles:owner=acme,authors, '
				+ 'replay pinned articles:owner=acme,authors:id=2',
		});
	});

	test('does not care about tag order or repeats', async () => {
		fill('rk', { data: [] });
		described(descriptor({ scopedCacheTags: ['b', 'a', 'a'] }));

		const report = await auditCache({
			replay: replayer(answer({ data: [] }, { tags: 'a,b' })),
		});

		expect(report.counts.fresh).toBe(1);
	});

	test(oneLine`
		an entry filled under no tag at all drifts once the replay pins one
	`, async () => {
		fill('rk', { data: [] });
		described(descriptor({ scopedCacheTags: [] }));

		const report = await auditCache({
			replay: replayer(answer({ data: [] }, { tags: 'articles' })),
		});

		expect(report.findings[0]!.verdict).toBe('tag_drift');

		expect(queueCacheAnomaly).toHaveBeenCalledWith(expect.objectContaining({
			detail: 'filled under (none), replay pinned articles',
		}));
	});

	test(oneLine`
		an entry refilled since the drain described it is raced: its tags are the
		refill's, which the drain has yet to see
	`, async () => {
		fill('rk', { data: [] }, new Date('2026-09-16T10:00:05Z').getTime());

		described(descriptor({
			scopedCacheTags: ['articles:owner=acme', 'authors'],
		}));

		const report = await auditCache({
			replay: replayer(
				answer({ data: [] }, { tags: 'articles:owner=acme,authors:id=2' }),
			),
		});

		expect(report.counts.raced).toBe(1);
		expect(report.counts.tag_drift).toBe(0);
		expect(queueCacheAnomaly).not.toHaveBeenCalled();
	});

	test('a sidecar stamped when the descriptor was is the same fill', async () => {
		fill('rk', { data: [] }, new Date('2026-09-16T10:00:00Z').getTime());

		described(descriptor({
			scopedCacheTags: ['articles:owner=acme', 'authors'],
		}));

		const report = await auditCache({
			replay: replayer(
				answer({ data: [] }, { tags: 'articles:owner=acme,authors:id=2' }),
			),
		});

		expect(report.counts.tag_drift).toBe(1);
	});
});

describe('the race guard', () => {
	test('a diff on an entry purged meanwhile is the purge working', async () => {
		fill('rk', { data: [{ amount: '5' }] });
		described(descriptor());

		const replay: CacheAuditReplayer = async () => {
			cache.store.delete('rk');

			return answer({ data: [{ amount: '7' }] });
		};

		const report = await auditCache({ replay });

		expect(report.counts.raced).toBe(1);
		expect(report.findings[0]!.verdict).toBe('raced');
		expect(queueCacheAnomaly).not.toHaveBeenCalled();
	});

	test(oneLine`
		a diff on an entry refilled meanwhile is judged again on the refill
	`, async () => {
		fill('rk', { data: [{ amount: '5' }] });
		described(descriptor());
		const fresh = { data: [{ amount: '7' }] };

		const replay = vi.fn(async () => {
			if (replay.mock.calls.length === 1) {
				fill('rk', fresh, 2_000);
			}

			return answer(fresh);
		});

		const report = await auditCache({ replay });

		expect(replay).toHaveBeenCalledTimes(2);
		expect(report.counts.fresh).toBe(1);
	});

	test(oneLine`
		a refill between the page read and the replay is told from the sidecar
		the page read with the body, and judged again on the refill
	`, async () => {
		fill('rk', { data: [{ amount: '5' }] });
		described(descriptor());
		const fresh = { data: [{ amount: '7' }] };

		cache.getMany.mockImplementationOnce(async (keys: string[]) => {
			const page = keys.map((key) => cache.store.get(key));
			fill('rk', fresh, 2_000);

			return page;
		});

		const report = await auditCache({
			replay: replayer(answer(fresh), answer(fresh)),
		});

		expect(report.counts.fresh).toBe(1);
		expect(report.counts.stale).toBe(0);
	});

	test('an entry refilled under every replay is raced, not stale', async () => {
		fill('rk', { data: [{ amount: '5' }] });
		described(descriptor());

		const replay = vi.fn(async () => {
			const refills = replay.mock.calls.length;
			fill('rk', { data: [{ amount: String(refills) }] }, 2_000 + refills);

			return answer({ data: [{ amount: 'x' }] });
		});

		const report = await auditCache({ replay });

		expect(report.counts.raced).toBe(1);
	});

	test('a refill gone before it could be re-read is raced', async () => {
		fill('rk', { data: [{ amount: '5' }] });
		described(descriptor());

		const replay = vi.fn(async () => {
			fill('rk', { data: [] }, 2_000);

			vi.mocked(getCacheValue).mockImplementationOnce(async () => {
				cache.store.delete('rk');

				return { exp: Date.now() + 60_000, createdAt: 2_000, ttlMs: 60_000 };
			});

			return answer({ data: [{ amount: '7' }] });
		});

		const report = await auditCache({ replay });

		expect(report.counts.raced).toBe(1);
	});

	test(oneLine`
		an entry with no fill time cannot be told to have moved, and is judged on its
		diff
	`, async () => {
		fill('rk', { data: [{ amount: '5' }] }, null);
		described(descriptor());
		const fresh = { data: [{ amount: '7' }] };

		const report = await auditCache({
			replay: replayer(answer(fresh), answer(fresh)),
		});

		expect(report.counts.stale).toBe(1);
	});
});

describe('an entry nothing can be replayed from', () => {
	test.each([
		['user_gone', () => descriptor({ userId: 'user-9' }), answer({ data: [] })],
		['method', () => descriptor({ method: 'POST' }), answer({ data: [] })],
		['query', () => descriptor({ query: '{"filter":{}}' }), answer({ data: [] })],
		[
			'document',
			() => descriptor({ path: '/graphql', query: 'not json' }),
			answer({ data: [] }),
		],
		[
			'document',
			() => descriptor({ path: '/graphql', query: '"a string"' }),
			answer({ data: [] }),
		],
		['status_500', () => descriptor(), { status: 500, headers: {}, body: '' }],
		[
			'status_503',
			() => descriptor(),
			{
				status: 503,
				headers: {},
				body: JSON.stringify({
					errors: [{ extensions: { reason: 'WebSocket server is disabled' } }],
				}),
			},
		],
		[
			'status_503',
			() => descriptor(),
			{ status: 503, headers: {}, body: '<html>Bad Gateway</html>' },
		],
		['status_503', () => descriptor(), { status: 503, headers: {}, body: 'null' }],
		[
			'status_503_under_pressure',
			() => descriptor(),
			{
				status: 503,
				headers: {},
				body: JSON.stringify({
					errors: [{ extensions: { reason: 'Under pressure' } }],
				}),
			},
		],
		[
			'replay_unrecognized',
			() => descriptor(),
			{ status: 200, headers: {}, body: '{}' },
		],
		['body', () => descriptor(), answer({}, { body: 'not json' })],
	])('%s', async (reason, describe, reply) => {
		fill('rk', { data: [] });
		described(describe());

		const report = await auditCache({ replay: replayer(reply) });

		expect(report.counts.unreplayable).toBe(1);
		expect(report.findings[0]).toMatchObject({ verdict: 'unreplayable', reason });
		expect(queueCacheAnomaly).not.toHaveBeenCalled();
	});

	test.each([
		['transport', new Error('socket hang up')],
		[
			'transport_econnreset',
			Object.assign(new Error('read'), { code: 'ECONNRESET' }),
		],
		[
			'transport_hpe_header_overflow',
			Object.assign(new Error('Parse Error: Header overflow'), {
				code: 'HPE_HEADER_OVERFLOW',
			}),
		],
		// Cut to what the findings table stores: 64 characters.
		[
			`transport_${'x'.repeat(54)}`,
			Object.assign(new Error('a userland code'), { code: 'X'.repeat(80) }),
		],
		['transport', Object.assign(new Error('a numeric code'), { code: 7 })],
	])('%s: a replay that never got an answer', async (reason, error) => {
		fill('rk', { data: [] });
		described(descriptor());
		const replay = vi.fn().mockRejectedValue(error);

		const report = await auditCache({ replay });

		expect(report.scanned).toBe(1);
		expect(report.findings[0]).toMatchObject({ verdict: 'unreplayable', reason });
	});

	test('unreadable: a stored value that does not decompress', async () => {
		fill('rk', Buffer.from('garbage'));
		described(descriptor());
		vi.mocked(decompress).mockRejectedValue(new Error('not snappy'));

		const report = await auditCache({ replay: replayer(answer({})) });

		expect(report.findings[0]).toMatchObject({
			verdict: 'unreplayable',
			reason: 'unreadable',
		});
	});
});

test('an entry past its expiry is expired, and never replayed', async () => {
	fill('rk', { data: [] });
	cache.store.set('rk__expires_at', { exp: Date.now() - 1, createdAt: 1, ttlMs: 1 });
	described(descriptor());
	const replay = replayer();

	const report = await auditCache({ replay });

	expect(report.counts.expired).toBe(1);
	expect(replay).not.toHaveBeenCalled();
});

describe('a GraphQL entry', () => {
	test(oneLine`
		is replayed as a POST of its stored document, whichever method filled it
	`, async () => {
		fill('rk', { data: { articles: [] } });

		described(descriptor({
			method: 'GET',
			path: '/graphql',
			collection: null,
			query: '{"query":"{ articles { id } }","variables":{"a":1}}',
		}));

		const replay = replayer(answer({ data: { articles: [] } }));

		const report = await auditCache({ replay });

		expect(report.counts.fresh).toBe(1);

		expect(replay.mock.calls[0]![0]).toMatchObject({
			method: 'POST',
			path: '/graphql',
			body: '{"query":"{ articles { id } }","variables":{"a":1}}',
			headers: { 'content-type': 'application/json' },
		});
	});

	test(oneLine`
		reports its path as the url and keeps the document in the query
	`, async () => {
		fill('rk', { data: {} });

		described(descriptor({
			path: '/graphql/system',
			query: '{"query":"{ __typename }"}',
		}));

		const fresh = { data: { other: 1 } };

		const report = await auditCache({
			replay: replayer(answer(fresh), answer(fresh)),
		});

		expect(report.findings[0]).toMatchObject({
			url: '/graphql/system',
			query: '{"query":"{ __typename }"}',
		});
	});
});

describe('narrowing the sweep', () => {
	beforeEach(() => {
		fill('rk1', { data: [] });
		fill('rk2', { data: [] });
		fill('rk3', { data: [] });
		fill('rk4', { data: [] });

		described(
			descriptor({ redisKey: 'rk1', cacheKey: 'ck1' }),
			descriptor({ redisKey: 'rk2', cacheKey: 'ck2', userId: 'user-2' }),
			descriptor({ redisKey: 'rk3', cacheKey: 'ck3', collection: 'authors' }),
		);

		users.set('user-2', { id: 'user-2', role: null });
	});

	test(oneLine`
		to one user is the queue's to narrow, and the others stay unexamined
	`, async () => {
		const replay = replayer(answer({ data: [] }));

		const report = await auditCache({ replay, user: 'user-2' });

		expect(report.scanned).toBe(1);
		expect(replay.mock.calls[0]![0].headers['authorization']).toMatch(/^Bearer /);

		expect(readCacheAuditQueue).toHaveBeenCalledWith(
			500,
			expect.any(Date),
			{ user: 'user-2', collection: undefined },
		);
	});

	test('to one collection', async () => {
		const replay = replayer(answer({ data: [] }));

		const report = await auditCache({ replay, collection: 'authors' });

		expect(report.scanned).toBe(1);

		expect(readCacheAuditQueue).toHaveBeenCalledWith(
			500,
			expect.any(Date),
			{ user: undefined, collection: 'authors' },
		);
	});

	test(oneLine`
		to a limit stops there and leaves the rest of the page unstamped, so the next
		run resumes behind the examined ones
	`, async () => {
		const replay = replayer(answer({ data: [] }), answer({ data: [] }));

		const report = await auditCache({ replay, limit: 2 });

		expect(report.scanned).toBe(2);
		expect(replay).toHaveBeenCalledTimes(2);
		expect(advancedPast()).toEqual(['ck1', 'ck2']);

		const resumed = await auditCache({ replay: replayer(answer({ data: [] })) });

		expect(resumed.scanned).toBe(1);
		expect(advancedPast()).toEqual(['ck1', 'ck2', 'ck3']);
	});

	test('a limit wider than the cache reports the whole cache', async () => {
		const answers = Array.from({ length: 3 }, () => answer({ data: [] }));

		const report = await auditCache({ replay: replayer(...answers), limit: 50 });

		expect(report.scanned).toBe(3);
		expect(report.counts.fresh).toBe(3);
	});
});

describe('--purge', () => {
	test('evicts what is stale or drifted, and nothing else', async () => {
		fill('rk1', { data: [{ v: 1 }] });
		fill('rk2', { data: [] });
		fill('rk3', { data: [] });

		described(
			descriptor({ redisKey: 'rk1', cacheKey: 'ck1', path: '/items/a' }),
			descriptor({ redisKey: 'rk2', cacheKey: 'ck2', path: '/items/b' }),
			descriptor({ redisKey: 'rk3', cacheKey: 'ck3', path: '/items/c' }),
		);

		// Entries replay concurrently, so answer by path rather than in order.
		const answers: Record<string, CacheAuditReplayResponse> = {
			'/items/a': answer({ data: [{ v: 2 }] }),
			'/items/b': answer({ data: [] }, { tags: 'articles' }),
			'/items/c': answer({ data: [] }),
		};

		const report = await auditCache({
			replay: async ({ path }) => answers[path.split('?')[0]!]!,
			purge: true,
		});

		expect(report.evicted).toBe(2);
		const evicted = vi.mocked(evictCacheEntry).mock.calls.map(([, key]) => key);
		expect(evicted).toEqual(['rk1', 'rk2']);
	});

	test('is off by default', async () => {
		fill('rk', { data: [{ v: 1 }] });
		described(descriptor());
		const changed = { data: [{ v: 2 }] };

		const report = await auditCache({
			replay: replayer(answer(changed), answer(changed)),
		});

		expect(report.evicted).toBe(0);
		expect(evictCacheEntry).not.toHaveBeenCalled();
	});
});

describe('the loopback replayer', () => {
	let server: http.Server;
	let port: number;
	let seen: http.IncomingMessage | undefined;
	let received = '';

	beforeEach(async () => {
		server = http.createServer((req, res) => {
			seen = req;
			received = '';
			req.on('data', (chunk) => (received += chunk));

			req.on('end', () => {
				res.setHeader('x-one', 'a');
				res.setHeader('set-cookie', ['c1=1', 'c2=2']);
				res.statusCode = 201;
				res.end('{"ok":true}');
			});
		});

		port = await new Promise<number>((resolve) => {
			server.listen({ host: '127.0.0.1', port: 0 }, () => {
				resolve((server.address() as AddressInfo).port);
			});
		});
	});

	afterEach(() => {
		server.close();
	});

	test(oneLine`
		speaks to the given listener and hands back status, headers and body
	`, async () => {
		const response = await loopbackReplayer({ host: '127.0.0.1', port })({
			method: 'POST',
			path: '/graphql?x=1',
			headers: { 'content-type': 'application/json', 'x-two': 'b' },
			body: '{"query":"{ __typename }"}',
		});

		expect(response.status).toBe(201);
		expect(response.body).toBe('{"ok":true}');
		expect(response.headers['x-one']).toBe('a');
		expect(response.headers['set-cookie']).toBe('c1=1, c2=2');

		expect(seen?.method).toBe('POST');
		expect(seen?.url).toBe('/graphql?x=1');
		expect(seen?.headers['x-two']).toBe('b');
		expect(received).toBe('{"query":"{ __typename }"}');
	});

	test('targets where this process listens by default', async () => {
		envRef.current['HOST'] = '0.0.0.0';
		envRef.current['PORT'] = String(port);

		const response = await loopbackReplayer()({
			method: 'GET',
			path: '/items/a',
			headers: {},
		});

		expect(response.status).toBe(201);
	});

	test(oneLine`
		reads a tags header past node's 16KB default: a deep read pins one tag per
		related key, and 370 of them ended every audit of that entry in a header
		overflow
	`, async () => {
		const tags = Array.from({ length: 370 }, (_, index) => {
			return `student_course_part:teaching_unit.course=${6986500 + index}`;
		}).join(',');

		expect(Buffer.byteLength(tags)).toBeGreaterThan(16 * 1024);

		server.removeAllListeners('request');

		server.on('request', (_req, res) => {
			res.setHeader('x-cache-audit-tags', tags);
			res.end('{"data":[]}');
		});

		const response = await loopbackReplayer({ host: '127.0.0.1', port })({
			method: 'GET',
			path: '/items/student_discipline',
			headers: {},
		});

		expect(response.headers['x-cache-audit-tags']).toBe(tags);
	});

	test('rejects when nothing listens there', async () => {
		server.close();

		await expect(loopbackReplayer({ host: '127.0.0.1', port })({
			method: 'GET',
			path: '/',
			headers: {},
		})).rejects.toThrowError();
	});
});

describe('the loopback target', () => {
	test.each([
		[{ HOST: '0.0.0.0', PORT: '8055' }, { host: '127.0.0.1', port: 8055 }],
		[{ PORT: 8055 }, { host: '127.0.0.1', port: 8055 }],
		[{ HOST: '::', PORT: '8055' }, { host: '::1', port: 8055 }],
		[{ HOST: '10.0.0.4', PORT: '8055' }, { host: '10.0.0.4', port: 8055 }],
		[
			{ UNIX_SOCKET_PATH: '/run/directus.sock', PORT: '8055' },
			{ socketPath: '/run/directus.sock' },
		],
	])('%o', (given, expected) => {
		envRef.current = given;

		expect(loopbackTarget()).toEqual(expected);
	});
});
