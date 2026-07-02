import { oneLine } from '@directus/utils';
import type { ScopedCacheTag } from '@directus/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Scoped mode requires CACHE_AUTO_PURGE_MODE=scoped + CACHE_STORE=redis + a reachable Redis.
const env: Record<string, any> = {
	CACHE_AUTO_PURGE_MODE: 'scoped',
	CACHE_STORE: 'redis',
	CACHE_NAMESPACE: 'system-cache',
};

vi.mock('@directus/env', () => ({ useEnv: () => env }));

// A minimal in-memory stand-in for the Redis tag index: SADD/SMEMBERS/DEL/SCAN over sets, which
// is all tagScopedCacheKeys + purgeScopedCache touch. Real enough to prove selective purge.
class FakeRedis {
	sets = new Map<string, Set<string>>();
	isCluster = false;

	pipeline() {
		const queued: Array<() => void> = [];

		const chain: any = {
			sadd: (key: string, ...members: string[]) => {
				queued.push(() => {
					const set = this.sets.get(key) ?? new Set<string>();
					members.forEach((member) => set.add(member));
					this.sets.set(key, set);
				});

				return chain;
			},
			expire: () => chain,
			exec: async () => {
				queued.forEach((op) => op());
				return [];
			},
		};

		return chain;
	}

	async smembers(key: string) {
		return [...(this.sets.get(key) ?? [])];
	}

	async del(...keys: string[]) {
		let removed = 0;

		keys.forEach((key) => {
			if (this.sets.delete(key)) {
				removed++;
			}
		});

		return removed;
	}

	async scan(_cursor: string, _match: string, pattern: string) {
		const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
		const rx = new RegExp(`^${escaped}$`);

		return ['0', [...this.sets.keys()].filter((key) => rx.test(key))];
	}
}

// Keyv-shaped cache: the payload keys live here, the tag sets in Redis.
class FakeCache {
	store = new Map<string, unknown>();

	set(key: string, value: unknown) {
		this.store.set(key, value);
	}

	has(key: string) {
		return this.store.has(key);
	}

	async delete(key: string) {
		return this.store.delete(key);
	}

	async clear() {
		this.store.clear();
	}
}

let redis: FakeRedis;

vi.mock('../redis/index.js', () => {
	return {
		useRedis: () => redis,
		redisConfigAvailable: () => true,
	};
});

// emitFilter with no listeners returns the payload unchanged (bare collection tag + scope tags).
vi.mock('../emitter.js', () => {
	return {
		default: {
			emitFilter: async (_event: string, payload: unknown) => payload,
		},
	};
});

const { tagScopedCacheKeys, purgeScopedCache } = await import('../scoped-cache.js');

const collection = 'student_course_note';

function tagKey(value: number) {
	return `system-cache:tag:${collection}:course=${value}`;
}

function scope(value: number): ScopedCacheTag {
	return { collection, field: 'course', value, type: 'integer' };
}

beforeEach(() => {
	redis = new FakeRedis();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('scoped cache — real Redis purge', () => {
	it(oneLine`
		a write to one course's slice purges only that slice and its cached read, retaining a
		sibling course's cached read (the cross-scope HIT)
	`, async () => {
		const cache = new FakeCache();
		cache.set('read:witness', 'témoin 1');
		cache.set('read:witness__expires_at', 1);
		cache.set('read:subject', 'anatomie 1');
		cache.set('read:subject__expires_at', 1);

		// Each read is indexed under its own course slice.
		await tagScopedCacheKeys('read:witness', [scope(10)]);
		await tagScopedCacheKeys('read:subject', [scope(20)]);

		// Non-vacuity: both slices are indexed and both reads are cached before the purge.
		expect(redis.sets.get(tagKey(10))).toEqual(
			new Set(['read:witness', 'read:witness__expires_at']),
		);

		expect(cache.has('read:witness')).toBe(true);
		expect(cache.has('read:subject')).toBe(true);

		// The subject rewrites course 20 → purge only that slice (+ the bare collection tag).
		await purgeScopedCache(cache, collection, [scope(20)]);

		// The subject's slice and its cached read are gone...
		expect(redis.sets.has(tagKey(20))).toBe(false);
		expect(cache.has('read:subject')).toBe(false);
		expect(cache.has('read:subject__expires_at')).toBe(false);

		// ...while the witness's slice and cached read survive untouched — a HIT next read.
		expect(redis.sets.has(tagKey(10))).toBe(true);
		expect(cache.has('read:witness')).toBe(true);
		expect(cache.has('read:witness__expires_at')).toBe(true);
	});

	it(oneLine`
		the bare collection tag (global, unscoped reads) is always purged with the written
		slice, so an unscoped read is never left stale
	`, async () => {
		const cache = new FakeCache();
		cache.set('read:global', 'list');
		cache.set('read:global__expires_at', 1);

		// A global read carries only the bare collection tag (no field/value).
		await tagScopedCacheKeys('read:global', [{ collection }]);

		await purgeScopedCache(cache, collection, [scope(20)]);

		expect(cache.has('read:global')).toBe(false);
	});
});
