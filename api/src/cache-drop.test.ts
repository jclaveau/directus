import type { Keyv } from 'keyv';
import { oneLine } from '@directus/utils';
import { describe, expect, test, vi } from 'vitest';
import { dropCacheEntries } from './cache-drop.js';

function redisBackedCache(unlink: ReturnType<typeof vi.fn>) {
	return {
		namespace: 'scalabus_response',
		store: {
			namespace: 'scalabus_response',
			client: { unlink },
			createKeyPrefix: (key: string, namespace?: string) => {
				return `${namespace}::${key}`;
			},
		},
	} as unknown as Keyv;
}

describe('dropCacheEntries', () => {
	test(oneLine`
		sends one UNLINK for the whole list, not one delete per key
	`, async () => {
		const unlink = vi.fn().mockResolvedValue(2);

		const evicted = await dropCacheEntries(
			redisBackedCache(unlink),
			['key-a', 'key-b'],
		);

		// The raw key carries BOTH namespaces — Keyv prefixes its own before
		// handing the key down, and KeyvRedis prefixes the store's on top. Built
		// from one of the two it names a key nothing ever wrote, and UNLINK then
		// reports 0 without failing.
		expect(unlink).toHaveBeenCalledOnce();

		expect(unlink).toHaveBeenCalledWith([
			'scalabus_response::scalabus_response:key-a',
			'scalabus_response::scalabus_response:key-b',
		]);

		// UNLINK replies with how many keys it actually removed, which is what the
		// purge reports as evicted.
		expect(evicted).toBe(2);
	});

	test(oneLine`
		chunks the list, so one purge cannot hold redis parsing arguments
	`, async () => {
		const unlink = vi.fn().mockResolvedValue(500);
		const keys = Array.from({ length: 1001 }, (_, at) => `key-${at}`);

		const evicted = await dropCacheEntries(redisBackedCache(unlink), keys);

		expect(unlink).toHaveBeenCalledTimes(3);
		expect(unlink.mock.calls[0]![0]).toHaveLength(500);
		expect(unlink.mock.calls[2]![0]).toHaveLength(1);

		// Summed across the chunks, not taken from the last one.
		expect(evicted).toBe(1500);
	});

	test('asks redis nothing when there is nothing to drop', async () => {
		const unlink = vi.fn();

		expect(await dropCacheEntries(redisBackedCache(unlink), [])).toBe(0);
		expect(unlink).not.toHaveBeenCalled();
	});

	test(oneLine`
		deletes key by key on a store that is not redis-backed, counting anything
		it was not explicitly told was absent
	`, async () => {
		const cache = {
			delete: vi.fn(async (key: string) => {
				if (key === 'gone') {
					return false;
				}

				// A store that answers `undefined` has told us nothing about whether
				// it held the key, so it counts.
				return key === 'live'
					? true
					: undefined;
			}),
		} as unknown as Keyv;

		const evicted = await dropCacheEntries(cache, ['live', 'gone', 'unknown']);

		expect(cache.delete).toHaveBeenCalledTimes(3);
		expect(evicted).toBe(2);
	});

	test('falls back when the store has a client that cannot UNLINK', async () => {
		const cache = {
			namespace: 'scalabus_response',
			delete: vi.fn().mockResolvedValue(true),
			store: {
				createKeyPrefix: (key: string) => key,
				client: {},
			},
		} as unknown as Keyv;

		expect(await dropCacheEntries(cache, ['key-a'])).toBe(1);
		expect(cache.delete).toHaveBeenCalledWith('key-a');
	});
});
