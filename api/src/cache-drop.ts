import type Keyv from 'keyv';

/**
 * Drop many cache entries in one command, and report how many were there.
 *
 * A purge deletes every entry a tag names, and there is no small number of those:
 * on the workload this fork exists for a slice holds one entry per user, each with
 * its sidecar. Deleting them one key at a time is one Redis command per key —
 * `Promise.all` over `cache.delete` costs a single round trip, since the client
 * corks its socket, but Redis still parses and dispatches every one. Keyv's own
 * `deleteMany` is no better: it wraps exactly those commands in a MULTI, which is
 * two more, not fewer.
 *
 * `UNLINK` takes the whole list at once and answers with the count, which is also
 * the number this returns — so the caller's eviction figure needs no per-key reply
 * to derive it from.
 *
 * Here rather than in `cache.ts` because the scoped purge is what needs it, and
 * `cache.ts` already imports the purge: the shared step has to sit below both.
 */

/**
 * What `@keyv/redis` exposes that a bulk drop needs. Structural rather than the
 * imported class: `cache.ts` pulls `@keyv/redis` in through `require` at runtime,
 * and a store that is not one (a memory store, a test double) has to be recognised
 * rather than assumed.
 */
type BulkDroppableStore = {
	createKeyPrefix: (key: string, namespace?: string) => string;
	namespace?: string | undefined;
	client: { unlink: (keys: string[]) => Promise<number> };
};

function acceptsBulkDrop(store: unknown): store is BulkDroppableStore {
	const candidate = store as Partial<BulkDroppableStore>;

	return typeof candidate?.createKeyPrefix === 'function'
		&& typeof candidate?.client?.unlink === 'function';
}

export async function dropCacheEntries(
	cache: Keyv,
	keys: readonly string[],
): Promise<number> {
	if (keys.length === 0) {
		return 0;
	}

	const store: unknown = cache.store;

	// Prefixed by the store itself, never by hand: what Redis is really keyed by
	// carries the namespace twice over. Single-node only — a cluster refuses a
	// multi-key UNLINK across slots, which is why scoped purging is refused on one.
	if (acceptsBulkDrop(store)) {
		const prefixed = keys.map((key) => {
			return store.createKeyPrefix(key, store.namespace);
		});

		return Number(await store.client.unlink(prefixed));
	}

	const dropped = await Promise.all(keys.map((key) => cache.delete(key)));

	return dropped.filter(Boolean).length;
}
