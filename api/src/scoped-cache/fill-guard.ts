import { useEnv } from '@directus/env';
import {
	redisConfigAvailable,
	useRedis,
} from '../redis/index.js';
import type { ScopedCacheTag } from '@directus/types';
import { scopedCachePurgeEnabled } from './config.js';
import { earlierScopedCacheEpoch } from './tags.js';

const env = useEnv();

/**
 * The purge counters a read captured, by collection. `*` is the wholesale entry,
 * and its presence is what says a capture was taken at all.
 */
export type ScopedCacheEpochs = Record<string, string | null>;

// Long enough that no read outlives its own capture, short enough that a
// collection nobody writes to stops holding a key.
const SCOPED_CACHE_EPOCH_TTL_SECONDS = 24 * 60 * 60;

/**
 * A per-collection purge counter, bumped every time that collection's tags are
 * dropped. `*` is the wholesale entry, bumped by a flush that names no collection.
 */
function scopedCacheEpochKey(collection: string): string {
	return `${env['CACHE_NAMESPACE']}:epoch:${collection}`;
}

/**
 * Read the purge counters of the collections a read depends on.
 *
 * A read's tags reach the index only in `respond`, long after the rows were fetched:
 * a purge landing in between finds nothing to drop, and the fill then stores rows it
 * already superseded — stale for the whole TTL, and (its tag sets having just been
 * deleted) unreachable to every later purge. Comparing the counter captured before
 * the query against the one at fill time is what closes that window.
 */
export async function readScopedCacheEpochs(
	collections: Iterable<string>,
): Promise<ScopedCacheEpochs> {
	// Every read pays this round trip, so it is skipped wherever its answer cannot
	// matter: nothing is filled with the response cache off.
	if (
		!env['CACHE_ENABLED'] ||
		!scopedCachePurgeEnabled() ||
		!redisConfigAvailable()
	) {
		return {};
	}

	// `*` rides along so a wholesale flush invalidates an in-flight read too.
	const names = [...new Set([...collections, '*'])];

	// A read that cannot reach the counters still has to answer. Capturing nothing
	// leaves the fill unguarded, exactly as it is with no redis at all — the same
	// trade the response cache makes everywhere else.
	const values = await useRedis()
		.mget(names.map(scopedCacheEpochKey))
		.catch((): (string | null)[] => []);

	return Object.fromEntries(
		names.map((name, index) => [name, values[index] ?? null]),
	);
}

/**
 * Bump the counters of the collections a purge just dropped tags for. Expiring, so
 * a collection nothing writes to stops costing a key; a read whose counter expired
 * between capture and fill reads `null` on both sides and caches, which is right —
 * nothing purged it in between.
 */
export async function bumpScopedCacheEpochs(
	collections: Iterable<string>,
): Promise<void> {
	if (!scopedCachePurgeEnabled() || !redisConfigAvailable()) {
		return;
	}

	const names = [...new Set(collections)];

	if (names.length === 0) {
		return;
	}

	// Best effort, and the whole of it: this runs BEFORE the sweep, so letting a
	// client that cannot take the command through would abort the purge itself —
	// trading every entry it was about to drop for the one racing fill the counter
	// would have refused.
	try {
		const pipeline = useRedis().pipeline();

		for (const name of names) {
			pipeline.incr(scopedCacheEpochKey(name));

			pipeline.expire(
				scopedCacheEpochKey(name),
				SCOPED_CACHE_EPOCH_TTL_SECONDS,
			);
		}

		await pipeline.exec();
	}
	catch {
		// See above: the sweep behind this is what makes the cache correct.
	}
}

/**
 * Fold in the counters a read hook handed over, keeping the read's OWN capture
 * wherever it has one.
 *
 * Not the rule the collector uses to merge two DECLARED counters, and it does not
 * need to be: the read's capture was taken before its query, so it is earlier than
 * anything a hook could hand over, with no comparison required. A collection the
 * capture never named has no such guarantee, which is why the hook's value is taken
 * there and compared where two of them meet.
 */
export function foldHandedOverScopedCacheEpochs(
	captured: ScopedCacheEpochs,
	handedOver: ScopedCacheEpochs,
): ScopedCacheEpochs {
	const folded = { ...captured };

	for (const [collection, epoch] of Object.entries(handedOver)) {
		if (collection in folded === false) {
			folded[collection] = epoch;
		}
	}

	return folded;
}

/**
 * Merge the captures of two reads whose results become ONE cached entry — the roots
 * of a GraphQL query, say. The EARLIER reading wins per collection: a root reading
 * `E+1` where another read `E` means a purge landed between them, and only the
 * earlier value makes the post-fill comparison notice.
 */
export function mergeScopedCacheEpochs(
	into: ScopedCacheEpochs,
	from: ScopedCacheEpochs,
): void {
	for (const [collection, epoch] of Object.entries(from)) {
		into[collection] = collection in into
			? earlierScopedCacheEpoch(into[collection], epoch)
			: epoch;
	}
}

/**
 * The collections a response is tagged with that its capture never covered — so a
 * purge of them landing mid-read passes the post-fill comparison unnoticed, and the
 * entry would be stored already stale under an index that purge has swept.
 *
 * A read hook's `scopeTo` is how one gets there: it names any collection it likes,
 * and it runs after the capture was taken. There is no capturing it late, since the
 * check needs a value from BEFORE the query — so the caller refuses the fill.
 *
 * `*` rides every capture, so its presence is what says the guard ran at all.
 * Without it (no redis, purging off, a read that opted out) nothing is guarded
 * anyway, and refusing the whole cache over that would be a far worse trade.
 */
export function scopedCacheCollectionsWithoutGuard(
	captured: ScopedCacheEpochs | undefined,
	tags: readonly ScopedCacheTag[],
): string[] {
	if (captured === undefined || '*' in captured === false) {
		return [];
	}

	return [...new Set(tags.map((tag) => tag.collection))].filter(
		(collection) => collection in captured === false,
	);
}

/**
 * The collection whose counter moved between a read's capture and now, or
 * `undefined` when none did.
 *
 * Called AFTER the entry is written, which is the comparison that closes the
 * window: a purge that started after the pre-fill check either read the tag sets
 * before this key was filed, or deleted the key between the value and its sidecar,
 * and either way the entry outlives it. A purge bumps the counters BEFORE it
 * sweeps, so re-reading them here catches every such interleaving.
 */
export async function scopedCacheSweptDuringFill(
	captured: ScopedCacheEpochs,
): Promise<string | undefined> {
	const afterFill = await readScopedCacheEpochs(Object.keys(captured));

	return Object.entries(captured).find(([collection, epoch]) => {
		return afterFill[collection] !== epoch;
	})?.[0];
}
