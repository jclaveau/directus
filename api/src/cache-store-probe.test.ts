import { oneLine } from '@directus/utils';
import { describe, expect, it } from 'vitest';
import { cacheStoreDropsEntries } from './cache-store-probe.js';

// A store whose reads land a tick later than its writes and deletes, the way a
// round trip does: enough for one probe's delete to slip between another's write
// and read-back.
function slowReadStore() {
	const entries = new Map<string, unknown>();

	return {
		entries,
		set: async (key: string, value: unknown) => {
			entries.set(key, value);
			return true;
		},
		get: async (key: string) => {
			await new Promise((resolve) => setTimeout(resolve, 0));
			return entries.get(key);
		},
		delete: async (key: string) => entries.delete(key),
	} as any;
}

describe('cacheStoreDropsEntries', () => {
	it(oneLine`
		answers true for a store that keeps and drops what it is asked to
	`, async () => {
		const cache = slowReadStore();

		expect(await cacheStoreDropsEntries(cache)).toBe(true);
		expect(cache.entries.size).toBe(0);
	});

	it('answers false for a store that swallows the write', async () => {
		const cache = slowReadStore();
		cache.set = async () => true;

		expect(await cacheStoreDropsEntries(cache)).toBe(false);
	});

	// Every fill-guard eviction probes, so two run at once under any load. With one
	// shared key the first delete made the second read-back come up empty, and a
	// working store was reported as one that swallows (#507).
	it('is not fooled by a concurrent probe deleting its own key', async () => {
		const cache = slowReadStore();

		const answers = await Promise.all([
			cacheStoreDropsEntries(cache),
			cacheStoreDropsEntries(cache),
		]);

		expect(answers).toEqual([true, true]);
	});
});
