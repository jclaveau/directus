import { useEnv } from '@directus/env';
import { randomUUID } from 'node:crypto';
import emitter from '../emitter.js';
import {
	resolvedCacheTtl,
} from '../cache-config.js';
import {
	cacheExpiresAtKey,
	cacheSidecarOwner,
} from '../cache-sidecars.js';
import {
	queueCacheAnomaly,
	queueCachePurge,
} from '../cache-events.js';
import { cacheStoreDropsEntries } from '../cache-store-probe.js';
import {
	useLogger,
} from '../logger/index.js';
import {
	type PendingScopedCachePurge,
	clearPendingScopedCachePurges,
	countFailedScopedCachePurgeRetry,
	listPendingScopedCachePurges,
	recordPendingScopedCachePurge,
} from '../scoped-cache-pending-purges.js';
import {
	getMilliseconds,
} from '../utils/get-milliseconds.js';
import type {
	EventContext,
	SchemaOverview,
	ScopedCacheDeclaredFingerprint,
} from '@directus/types';
import type { Keyv } from 'keyv';
import { dropCacheEntries } from '../cache-drop.js';
import {
	scopedCachePurgeEnabled,
	scopedCacheIndexStoreAvailable,
} from './config.js';
import {
	useScopedCacheStore,
	type ScopedCacheIndexedEntry,
	type ScopedCacheIndexFiling,
	type ScopedCacheUnlinkTally,
} from './store.js';
import {
	parseScopedCacheFingerprint,
	renderScopedCacheFingerprint,
	scopedCacheDeclaredPins,
	scopedCacheFingerprintCouldContainPin,
	scopedCacheFingerprintIsBare,
	scopedCachePinKeys,
	scopedCacheFingerprintOf,
	scopedCacheFingerprintPurgedBy,
	type ScopedCacheFingerprint,
} from './fingerprint.js';
import {
	bumpScopedCacheEpochs,
} from './fill-guard.js';
import { scopedCacheIndexPath } from './index-path.js';

const env = useEnv();

/**
 * The collections a delete on `collection` also changes through the database's own
 * `ON DELETE` rules. It applies them itself, so nothing else ever purges them.
 *   - `CASCADE` deletes the rows, so the walk carries on into their own children.
 *   - `SET NULL` and `SET DEFAULT` leave the rows in place carrying a changed
 *     foreign key — a slice they have left — and stop there, since nothing below
 *     a surviving row changes.
 *   - a rule reaching back into `collection` reports it like any other: the rows
 *     the database changes there are ones the caller never named, so the snapshot
 *     taken from its keys does not cover them.
 *   - a DIRECT self-relation that only rewrites a foreign key is left out: the
 *     surviving children stay in place, and the delete snapshots them by key like
 *     an update's rows instead — see the collaborator's `selfRelationSurvivorKeys`.
 */
export function scopedCacheCollectionsChangedByOnDelete(
	schema: Pick<SchemaOverview, 'relations'>,
	collection: string,
): string[] {
	const changedCollections = new Set<string>();
	// Separate from the reported set: a collection reached by a non-propagating rule
	// first and a cascade later must still be walked into on the cascading path.
	// Seeded with the root, which terminates a collection cascading into itself.
	const walkedCollections = new Set<string>([collection]);
	const pendingCollections = [collection];

	while (pendingCollections.length > 0) {
		const parentCollection = pendingCollections.shift()!;

		for (const relation of schema.relations) {
			// A relation's `collection` holds the FK; `related_collection` is its parent.
			const onDeleteRule = relation.schema?.on_delete;
			const childCollection = relation.collection;

			if (
				relation.related_collection !== parentCollection
				|| onDeleteRule === undefined
				|| onDeleteRule === null
				// NO ACTION and RESTRICT make the database refuse the delete
				// instead, so they leave nothing to purge.
				|| ['CASCADE', 'SET NULL', 'SET DEFAULT'].includes(onDeleteRule) === false
			) {
				continue;
			}

			// Only a DIRECT self-relation is exempt, and only when it rewrites rather
			// than deletes: its survivors are snapshotted by key like an update's rows
			// (`selfRelationSurvivorKeys`), so their slices purge precisely.
			if (
				parentCollection === collection
				&& childCollection === collection
				&& onDeleteRule !== 'CASCADE'
			) {
				continue;
			}

			changedCollections.add(childCollection);

			// CASCADE removes the rows, so their own children follow. The other rules
			// leave them in place, and nothing below a surviving row changes.
			if (onDeleteRule === 'CASCADE' && ! walkedCollections.has(childCollection)) {
				walkedCollections.add(childCollection);
				pendingCollections.push(childCollection);
			}
		}
	}

	return [...changedCollections];
}

/**
 * How much longer the index lives than the entries it indexes. Every write that
 * files a key into it moves that expiry out, so at 1 it would already outlive its
 * newest filing; the doubling is slack, not arithmetic — for an entry orphaned by
 * a crash between the write and its purge, and for siblings written outside this
 * pipeline. The index holds keys, not payloads, so the slack is nearly free.
 */
const SCOPED_CACHE_INDEX_TTL_FACTOR = 2;

/**
 * Index a freshly-cached response key under the query case it was read with, so a
 * later mutation can drop just the entries that case answers for instead of the
 * whole namespace. Both the payload key and its `__expires_at` sibling are indexed.
 * When a cache TTL is set, the index self-expires at
 * `SCOPED_CACHE_INDEX_TTL_FACTOR` times that TTL, as a net for filings orphaned by a
 * crash between write and purge; with no TTL the cached entries never expire
 * either, so the index is left unbounded to match — a normal purge still drains it.
 *
 * `cacheTtl` is the TTL the caller wrote the entry with, read once for both: the
 * settings override can change between two reads of it.
 */
export async function indexScopedCacheEntry(
	key: string,
	fingerprints: readonly ScopedCacheFingerprint[],
	extraSiblings: string[] = [],
	schema: SchemaOverview = { collections: {}, relations: [] },
	cacheTtl: unknown = resolvedCacheTtl(),
): Promise<void> {
	if (!scopedCachePurgeEnabled() || fingerprints.length === 0) {
		return;
	}

	const ttlSeconds = Math.ceil(getMilliseconds(cacheTtl, 0) / 1000)
		* SCOPED_CACHE_INDEX_TTL_FACTOR;

	// One filing per collection the read touched, holding the entry and its
	// siblings under the whole query case the read was bound to. A purge tests that
	// case rather than matching any one pin of it, which is what #531 is: a read
	// files ONE fingerprint per collection, so a shared column cannot act as a
	// global pin.
	const filings: ScopedCacheIndexFiling[] = fingerprints.map((fingerprint) => {
		return {
			fingerprint,
			keys: [key, cacheExpiresAtKey(key), ...extraSiblings],
			// What the store may split its index by, read off the collection the
			// fingerprint names: derived from the schema, never from the read, so a
			// fill and the write that has to find it hand the store the same one.
			indexPath: scopedCacheIndexPath(schema, fingerprint.collection),
		};
	});

	// Throws when the store refuses any of it, so the caller skips the write rather
	// than storing an entry indexed under nothing — no purge could ever reach it.
	await useScopedCacheStore().fileIndexedEntries(filings, ttlSeconds);
}

/**
 * How many cache entries each legacy pin would purge — the blast radius the cache
 * page's drawer reports beside the pins an entry carries. Keyed by the pin's
 * display string (`collection` or `collection:field=value`).
 *
 * Read the way the purge that answers for that pin reads: a pin names a pin, not a
 * set, so the count is the entries of its collection whose fingerprint that pin
 * reaches. One pass over the collection's sets answers every pin naming it, since
 * a member is parsed once and tested against each.
 *
 * Counts entries rather than members: an entry is named alongside its
 * `__expires_at` and `__pins` siblings, so counting members reported the same
 * entry two or three times over — the inflation the `SCARD` this replaced carried.
 */
export async function countScopedCachePinMembers(
	pinKeys: readonly string[],
): Promise<Record<string, number>> {
	if (!scopedCachePurgeEnabled() || pinKeys.length === 0) {
		return {};
	}

	const counts: Record<string, number> = {};

	const pinKeysByCollection = new Map<string, {
		pinKey: string;
		declared: ScopedCacheFingerprint;
	}[]>();

	for (const pinKey of pinKeys) {
		counts[pinKey] = 0;

		const declared = scopedCacheFingerprintFromPinKey(pinKey);
		const pinKeyed = pinKeysByCollection.get(declared.collection) ?? [];

		pinKeyed.push({ pinKey, declared });
		pinKeysByCollection.set(declared.collection, pinKeyed);
	}

	const store = useScopedCacheStore();

	for (const [collection, pinKeyed] of pinKeysByCollection) {
		// The keys each pin reached, not a running total: an entry bound to a list
		// of index values is named by one set per value, and a blast radius counting
		// it once per set would claim a purge frees more than it can.
		const reachedByTag = new Map<string, Set<string>>();

		for await (
			const indexedEntries of store.scanCollectionIndexedEntries(collection)
		) {
			for (const { fingerprint, key } of indexedEntries) {
				if (key === '' || cacheSidecarOwner(key) !== null) {
					continue;
				}

				for (const { pinKey, declared } of pinKeyed) {
					if (scopedCacheFingerprintReachedByPin(fingerprint, declared)) {
						const reached = reachedByTag.get(pinKey) ?? new Set();
						reached.add(key);
						reachedByTag.set(pinKey, reached);
					}
				}
			}
		}

		for (const [pinKey, reached] of reachedByTag) {
			counts[pinKey] = reached.size;
		}
	}

	return counts;
}

/**
 * The fingerprint a legacy pin stands for. The pin is namespace-free on purpose,
 * so it resolves against whatever the collection's index holds now rather than
 * against the set key it named when the pin was written.
 *
 * Its value is already canonical — the pin is rendered from a canonical token — so
 * it is taken as written rather than canonicalised a second time.
 */
function scopedCacheFingerprintFromPinKey(
	pinKey: string,
): ScopedCacheFingerprint {
	const fieldAt = pinKey.indexOf(':');

	if (fieldAt === -1) {
		return { collection: pinKey };
	}

	const pin = pinKey.slice(fieldAt + 1);
	const valueAt = pin.indexOf('=');

	if (valueAt === -1) {
		return { collection: pinKey.slice(0, fieldAt) };
	}

	// Null-prototyped for the reason the parser is: the field is a column name,
	// and `__proto__` is a legal one.
	const pinnedScope: Record<string, string[]> = Object.create(null);
	pinnedScope[pin.slice(0, valueAt)] = [pin.slice(valueAt + 1)];

	return {
		collection: pinKey.slice(0, fieldAt),
		pinnedScope,
	};
}

/**
 * Whether a declared pin — a hook's `purgeBy`, a `cache.purge` addition, a legacy
 * pin the drawer is sizing — reaches an entry.
 *
 * Two arms, because a pin naming nothing and a pin naming a value are different
 * claims. The bare one is the bare collection fingerprint, and it keeps the reach
 * it always had: the reads that could not be narrowed, and only those — read as
 * a constraint holding of every entry it would be the collection purge, a
 * different operation with its own mode and its own record.
 *
 * A pin naming a value is the converse. `scopedCacheFingerprintCouldContainPin`
 * is vacuously true of an entry that pins nothing, so without this it would drop
 * the global reads too — exactly what a declaring cancel states did NOT change
 * (#292).
 */
function scopedCacheFingerprintReachedByPin(
	fingerprint: ScopedCacheFingerprint,
	declared: ScopedCacheFingerprint,
): boolean {
	if (scopedCacheFingerprintIsBare(declared)) {
		return scopedCacheFingerprintIsBare(fingerprint);
	}

	if (scopedCacheFingerprintIsBare(fingerprint)) {
		return false;
	}

	return scopedCacheFingerprintCouldContainPin(fingerprint, declared);
}

/**
 * Drop the cache keys a swept index named, and report how many ENTRIES went — which
 * is neither how many keys were deleted nor how many the index named.
 *
 * Not the key count, because the index holds each entry alongside its
 * `__expires_at` sibling and any extra sibling (`__pins`), so counting keys would
 * report every entry twice over. A sidecar is recognisable by its base key being
 * filed beside it — they are filed together — which stays right as siblings are
 * added.
 *
 * Not what the index named either, because nothing prunes it on the way out: an
 * entry that expired by TTL stays named until its filing is dropped.
 * On the workload this fork exists for — per-user keys, so high cardinality, TTLs
 * shorter than the gap between mutations — most of a set can be entries that were
 * already gone, and counting them would inflate every purge figure on the page. So
 * what the store freed decides; `dropCacheEntries` is where that answer comes from.
 */
async function dropSweptScopedCacheEntries(
	cache: Keyv,
	members: readonly string[],
): Promise<number> {
	const present = new Set(members);

	const entries = members.filter((member) => {
		const owner = cacheSidecarOwner(member);

		return owner === null || present.has(owner) === false;
	});

	const entryKeys = new Set(entries);

	const [evicted] = await Promise.all([
		dropCacheEntries(cache, entries),
		dropCacheEntries(cache, members.filter((member) => {
			return entryKeys.has(member) === false;
		})),
	]);

	return evicted;
}

/**
 * Drop the entries whose whole query case the written rows satisfy, and nothing
 * else.
 *
 * This is the purge #531 exists for. A per-pin purge asks "is this entry filed
 * under a slice I wrote", and an entry bounded to `owner=alpha AND
 * method=spaced` answers yes to every write carrying `method=spaced`. This one
 * asks the read's own
 * question — does one of the rows I wrote satisfy everything this entry depends on
 * — so the answer is no for every owner but alpha.
 *
 * How much of the index that costs is the store's own answer: it is asked for the
 * entries these rows could reach, and how narrowly it can answer depends on how it
 * split what it holds.
 *
 * Matched entries are dropped from the index wherever it found them, since nothing
 * else prunes it and a purged entry left named would be re-tested by every later
 * write for as long as it lives.
 */
async function purgeScopedCacheFingerprintIndex(
	cache: Keyv,
	collection: string,
	rowFingerprints: readonly ScopedCacheFingerprint[],
	changed: readonly string[] | null,
	indexPath: string | null,
	includeBareFingerprint: boolean,
): Promise<number> {
	if (rowFingerprints.length === 0) {
		return 0;
	}

	// Before anything is read, for the reason the fingerprint sweep bumps them
	// first: a read in flight has to decline rather than cache under an index this
	// purge is about to prune.
	await bumpScopedCacheEpochs([collection]);

	const { evicted } = await purgeScopedCacheIndexWhere(
		cache,
		// The entries these rows could drop something in, which is the store's own
		// question: it knows what it split its index by and what it can filter on.
		useScopedCacheStore().scanRowIndexedEntries(
			collection,
			rowFingerprints,
			indexPath,
		),
		(fingerprint) => {
			// A fingerprint pinning nothing is what the bare collection fingerprint
			// covers, so a mutation keeping that fingerprint warm keeps these
			// entries too — the global reads a write that opted out of the bare
			// collection fingerprint means to leave standing.
			if (
				includeBareFingerprint === false
				&& scopedCacheFingerprintIsBare(fingerprint)
			) {
				return false;
			}

			return scopedCacheFingerprintPurgedBy(
				fingerprint,
				rowFingerprints,
				changed,
			);
		},
		indexPath,
	);

	return evicted;
}

/**
 * Drop every entry of a collection that a declared pin could have changed.
 *
 * What a hook's own `purgeBy` resolves to, and the one purge driven by no rows: it
 * holds a pin, not a row, so `scopedCacheFingerprintCouldContainPin` is the test
 * rather than `scopedCacheFingerprintPurgedBy`.
 *
 * How wide the store has to read for it is the store's own answer — a declared
 * pin matches entries by what they do NOT pin as much as by what they do, so what
 * can be narrowed on depends on how the index is split.
 */
function purgeScopedCacheDeclaredPins(
	cache: Keyv,
	collection: string,
	declared: readonly ScopedCacheFingerprint[],
	indexPath: string | null,
): Promise<ScopedCachePurgeSweep> {
	return purgeScopedCacheIndexWhere(
		cache,
		useScopedCacheStore().scanDeclaredIndexedEntries(
			collection,
			declared,
			indexPath,
		),
		(fingerprint) => {
			return declared.some((declaredFingerprint) => {
				return scopedCacheFingerprintReachedByPin(
					fingerprint,
					declaredFingerprint,
				);
			});
		},
		indexPath,
	);
}

/**
 * Purge what a mutation could not resolve off the rows it wrote — a hook's own
 * `purgeBy`, and whatever the `cache.purge` filter added to what it declared.
 *
 * Grouped by the collection each fingerprint names, because a hook is free to
 * declare one on another collection entirely and the index is per collection. A
 * foreign one's index path is read off the schema, as its fills were filed, and
 * only without a schema is it read whole.
 */
async function purgeScopedCacheDeclaredFingerprints(
	cache: Keyv,
	collection: string,
	declaredFingerprints: readonly ScopedCacheFingerprint[],
	indexPath: string | null,
	schema: SchemaOverview | null,
): Promise<number> {
	if (declaredFingerprints.length === 0) {
		return 0;
	}

	const declaredByCollection = new Map<string, ScopedCacheFingerprint[]>();

	for (const fingerprint of declaredFingerprints) {
		const declared = declaredByCollection.get(fingerprint.collection) ?? [];

		declared.push(fingerprint);
		declaredByCollection.set(fingerprint.collection, declared);
	}

	// Before anything is read, and in a call of its own rather than inside the
	// scans: a purge that is refused still has to leave the counters moved, so a
	// read in flight declines instead of caching under an index this purge was about
	// to prune and will prune on retry.
	await bumpScopedCacheEpochs([...declaredByCollection.keys()]);

	let evicted = 0;

	for (const [declaredCollection, declared] of declaredByCollection) {
		let declaredIndexPath = indexPath;

		if (declaredCollection !== collection) {
			declaredIndexPath = schema === null
				? null
				: scopedCacheIndexPath(schema, declaredCollection);
		}

		const sweep = await purgeScopedCacheDeclaredPins(
			cache,
			declaredCollection,
			declared,
			declaredIndexPath,
		);

		evicted += sweep.evicted;
	}

	return evicted;
}

/**
 * What an index purge freed, and the entries it named on the way there — which the
 * recovery drain reports as having served stale, and nothing else reads.
 */
type ScopedCachePurgeSweep = {
	evicted: number;
	matchedKeys: string[];
};

/**
 * Read what the store answered with, keep the entries whose fingerprint `purges`
 * accepts, and drop the cache entries they name.
 *
 * Matched entries are dropped from the index too: nothing else prunes them, and a
 * purged entry left in the index would be re-tested by every later write for as
 * long as it lives.
 *
 * The counter bump is the caller's: what has to precede the reads here is one move
 * per collection, and only the caller knows which collections it is about to touch.
 */
async function purgeScopedCacheIndexWhere(
	cache: Keyv,
	indexedEntries: AsyncGenerator<ScopedCacheIndexedEntry[]>,
	purges: (fingerprint: ScopedCacheFingerprint) => boolean,
	indexPath: string | null,
): Promise<ScopedCachePurgeSweep> {
	const matched: ScopedCacheIndexedEntry[] = [];
	const matchedKeys: string[] = [];
	const seenKeys = new Set<string>();

	for await (const indexedBatch of indexedEntries) {
		for (const indexedEntry of indexedBatch) {
			if (purges(indexedEntry.fingerprint) === false) {
				continue;
			}

			matched.push(indexedEntry);

			const { key } = indexedEntry;

			if (key !== '' && seenKeys.has(key) === false) {
				seenKeys.add(key);
				matchedKeys.push(key);
			}
		}
	}

	if (matchedKeys.length === 0) {
		return { evicted: 0, matchedKeys };
	}

	const [evicted] = await Promise.all([
		dropSweptScopedCacheEntries(cache, matchedKeys),
		useScopedCacheStore().removeIndexedEntries(matched, indexPath),
	]);

	return { evicted, matchedKeys };
}


/**
 * Drop the whole fingerprint index. It is written outside any Keyv namespace, so a
 * response `cache.clear()` never reaches it — it would linger as orphan pointers
 * until its `ttl*2` self-expiry, or forever when `CACHE_TTL` is unset and it is
 * deliberately unbounded. The `Response cache` flush calls this alongside
 * `cache.clear()` for a clean wipe. Only the index goes; the entries it pointed at
 * are already gone with the namespace clear.
 *
 * Reports how much the store removed and how many commands it refused, so the
 * flush that called it can say what it cost, and say so honestly when the index is
 * still there (https://github.com/jclaveau/directus/issues/468).
 *
 * Runs AFTER `clearResponseCache`, always, and moves the wholesale counter again
 * once the index is gone. The move before the clear cannot catch a fill that took
 * the counter after it, filed its fingerprints before the drop below and wrote its
 * entry after it: that entry compares equal and is indexed by nothing, reachable
 * to no later purge. The move here makes that fill's recheck evict it. A fill that
 * also rechecked before this move still keeps its entry
 * (https://github.com/jclaveau/directus/issues/547).
 */
export async function dropScopedCacheIndex(): Promise<ScopedCacheUnlinkTally> {
	if (!scopedCacheIndexStoreAvailable()) {
		return { dropped: 0, refused: 0 };
	}

	try {
		return await useScopedCacheStore().dropIndex();
	}
	finally {
		// On a failed drop too: whatever part of the index did go took the filings
		// of the fills in flight with it.
		await bumpScopedCacheEpochs(['*']);
	}
}

/**
 * Drop every cached response, the way a read in flight can notice. The wholesale
 * counter — the one every read takes, named for no collection — moves BEFORE
 * the clear, as every purge's counters move before its sweep: a fill that rechecks
 * after the move declines, and one that rechecked before it had written its entry
 * before the clear, which takes it. A clear that moved the counter after itself
 * left a fill rechecking in between kept — stale for its TTL, and once the index
 * drop that follows took its filings with it, reachable to no later purge. Moved
 * whether or not the clear finds anything, since the reads in flight are what it
 * is for.
 *
 * The entries only, so a flush that reports the index drop apart from the clear
 * can; `flushResponseCache` is the two together.
 */
export async function clearResponseCache(cache: Keyv | null): Promise<void> {
	await bumpScopedCacheEpochs(['*']);
	await cache?.clear();
}

/**
 * The flush a system service runs after a change that invalidates every read — a
 * permission, policy, role, access or user change, a field or collection edit, a
 * manual sort. Nothing sweeps the fingerprint index after a raw `clear()`, and its
 * sets would point at keys that no longer exist until their own expiry, or
 * forever when `CACHE_TTL` is unset.
 *
 * Never throws: every caller runs it in a `finally` after its write committed, and
 * Keyv already swallows the clear's own failure, so a scan Redis refuses must not
 * be the one thing that turns a committed change into a failed request. The
 * counter moved and the entries went, or will when Redis is back; sets left
 * behind name keys that are gone and expire on their own.
 */
export async function flushResponseCache(cache: Keyv | null): Promise<void> {
	await clearResponseCache(cache);

	// Gated here, not in the drop: the flush command drops the index whatever the
	// mode, so a store switched out of scoped purging leaves no sets behind — while
	// this runs on every permission, field or collection change, and a scan that
	// walks the whole keyspace for an index that cannot exist is a cost per write.
	if (!scopedCachePurgeEnabled()) {
		return;
	}

	try {
		await dropScopedCacheIndex();
	}
	catch (error: any) {
		useLogger().warn(
			error,
			`[scoped-cache] could not drop the fingerprint index after a flush: ${error}`,
		);
	}
}

/**
 * Drop every entry the collection owns, whatever it is bound to, and the index that
 * named them.
 *
 * The fallback, so it asks no question: a purge reaching here has no rows to match
 * against — an upsert mixing inserts and updates, a write whose rows could not be
 * read back — and cannot tell a stale entry from a warm one. Every other
 * collection's entries still stand, which is the whole of what it is scoped to.
 *
 * Reports the entries it freed and how much index it dropped apart: the first is
 * how wide the purge reached, the second is how split the collection's index was,
 * and only the first is comparable to a row-driven purge's figure.
 */
async function purgeScopedCacheCollectionIndex(
	cache: Keyv,
	collection: string,
): Promise<{ evicted: number; indexKeys: number }> {
	const keys: string[] = [];
	const seenKeys = new Set<string>();
	let indexKeys = 0;

	// Taken rather than read then dropped: a read filing its key in between would
	// otherwise have its filing deleted underneath it.
	for await (
		const taken of useScopedCacheStore().takeCollectionIndexedKeys(collection)
	) {
		indexKeys += taken.indexKeys;

		// One at a time rather than spread: a take is free to answer with more than
		// one page's worth, and a spread long enough throws before the array is
		// touched (https://github.com/jclaveau/directus/issues/397). The two entries
		// a key cached under two query cases has collapse to one key here.
		for (const key of taken.keys) {
			if (seenKeys.has(key) === false) {
				seenKeys.add(key);
				keys.push(key);
			}
		}
	}

	return { evicted: await dropSweptScopedCacheEntries(cache, keys), indexKeys };
}

/**
 * Purge every cached read of `collection` — its bare collection fingerprint plus all
 * its value slices — without full-flushing the namespace. The fallback when a
 * mutation's scope values are unresolvable (e.g. an upsert mixing inserts and
 * updates): which slices changed is unknown, but only reads touching THIS collection
 * can be stale, so scope the flush to its own index and spare every other
 * collection's entries.
 */
export async function purgeCollectionScopedCache(
	cache: Keyv,
	collection: string,
	options: {
		scopedCachePurgeId?: string | undefined;
		// A retried purge is nothing's latency: no write waits on the drain.
		retried?: boolean;
	} = {},
): Promise<void> {
	// Not the sweep's own bump repeated: this one has to precede the fingerprint
	// index read below, which the sweep never sees. A read filing a NEW slice between
	// that read and the sweep is missed by this purge either way — bumped first, it
	// declines to cache instead of surviving under an index set nothing swept.
	await bumpScopedCacheEpochs([collection]);

	const startedAt = Date.now();

	const { evicted, indexKeys } = await purgeScopedCacheCollectionIndex(
		cache,
		collection,
	);

	// The expensive mode, and the one nothing else records: every slice of the
	// collection went, because which slices actually changed was unresolvable.
	// No pin list: every slice the index happened to name is derived rather than
	// chosen, and unbounded. `collection` plus the mode already state the reach.
	queueCachePurge({
		purgeId: options.scopedCachePurgeId,
		collection,
		mode: 'collection',
		scopedCachePins: null,
		scopedCachePinCount: indexKeys,
		evicted,
		durationMs: options.retried === true
			? null
			: Date.now() - startedAt,
	});
}

/**
 * Run a purge, and on failure record it for a later retry instead of throwing.
 *
 * A purge is awaited by its mutation but runs after the transaction, so by the
 * time it can fail the write is durable. Propagating the error would answer 500
 * for a write that succeeded, and the client's natural response — retry — turns a
 * stale cache entry into a duplicate row on any non-idempotent mutation. The
 * entry is the smaller harm, so the request wins and the purge is finished later.
 *
 * Nothing is lost meanwhile: a cache read fails open (`cache.ts` catches and
 * treats a Redis error as a MISS), so while Redis is unreachable no stale entry
 * can be SERVED. The recorded purge only has to beat Redis coming back.
 *
 * Returns whether the purge ran, so the caller can skip the telemetry that would
 * otherwise report a purge that did not happen.
 */
async function purgeOrRecord(
	run: () => Promise<void>,
	pending: PendingScopedCachePurge,
): Promise<boolean> {
	try {
		await run();
		return true;
	}
	catch (error: any) {
		useLogger().warn(
			error,
			`[scoped-cache] purge failed and was recorded for retry: ${error}`,
		);

		await recordPendingScopedCachePurge(pending, error);
		return false;
	}
}

/**
 * What a recorded purge target resolves to: the fingerprints to retry it with,
 * grouped by the collection each names, plus the collections whose record is a
 * legacy pin from before this table held fingerprints.
 *
 * A rendered fingerprint always ends on its `&` terminator and a pin never does,
 * which is what tells the two apart. A pin cannot be replayed against the
 * fingerprint index — it names a slice the index no longer files anything under —
 * so its collection is purged whole instead: wider than the record asked for,
 * which is the direction a recovery is allowed to miss in.
 */
function recordedScopedCachePurgeTargets(recorded: readonly string[]): {
	declaredByCollection: Map<string, ScopedCacheFingerprint[]>;
	pinKeyedCollections: Set<string>;
} {
	const declaredByCollection = new Map<string, ScopedCacheFingerprint[]>();
	const pinKeyedCollections = new Set<string>();

	for (const target of recorded) {
		if (target.endsWith('&') === false) {
			const fieldAt = target.indexOf(':');

			pinKeyedCollections.add(
				fieldAt === -1
					? target
					: target.slice(0, fieldAt),
			);

			continue;
		}

		const fingerprint = parseScopedCacheFingerprint(target);
		const declared = declaredByCollection.get(fingerprint.collection) ?? [];

		declared.push(fingerprint);
		declaredByCollection.set(fingerprint.collection, declared);
	}

	return { declaredByCollection, pinKeyedCollections };
}

// The drain in flight, so the next trigger queues behind it rather than beside it.
let pendingScopedCachePurgeDrain: Promise<number> = Promise.resolve(0);

/**
 * Finish the purges that failed after their mutation committed. Called at boot
 * and whenever the shared Redis client reports ready, which are the two moments a
 * previously unreachable Redis can have come back.
 *
 * Serialized, never overlapped: `ready` can fire while a drain is still running,
 * and two of them read the same rows and report the same stale entry to the
 * anomaly stream twice. Chaining rather than sharing the in-flight promise, so a
 * purge recorded mid-drain still gets its own pass instead of being answered by a
 * run that started before it existed.
 */
export function retryPendingScopedCachePurges(): Promise<number> {
	const drained = pendingScopedCachePurgeDrain
		.catch(() => 0)
		.then(() => drainPendingScopedCachePurges());

	pendingScopedCachePurgeDrain = drained;

	return drained;
}

/**
 * Retries the recorded targets, never the namespace: a failure records what it
 * could not drop, so recovery drops exactly that and every other slice stays
 * warm. Returns how many recorded rows it cleared — not how many targets they
 * collapsed into, since an outage records one slice once per write that touched
 * it and the operator reads the table, not the grouping.
 */
async function drainPendingScopedCachePurges(): Promise<number> {
	if (!scopedCacheIndexStoreAvailable()) {
		return 0;
	}

	const pending = await listPendingScopedCachePurges();

	if (pending.length === 0) {
		return 0;
	}

	// Imported lazily so the module graph stays acyclic: `cache.js` imports this
	// module for `dropScopedCacheIndex`, so a static import back would close
	// the loop. Same reason `cache-config.ts` defers its database import.
	const { getCache } = await import('../cache.js');
	const { cache } = getCache();

	if (!cache) {
		return 0;
	}

	// The index and the entries sit behind two different clients — ioredis carries
	// the index, the response cache is a Keyv over node-redis — and only the
	// first one's `ready` starts this drain. The store rejects a command issued
	// while it is offline (`disableOfflineQueue`) and `@keyv/redis` swallows that
	// into `undefined`, so a drain in that window deletes no entry, reports every
	// purge a success and clears the records that are the only thing left pointing
	// at them.
	//
	// Written and read back rather than asked: `isReady` is false both while the
	// client is offline AND before it has ever dialed, and node-redis dials on its
	// first command — so reading it would retire the boot drain, which is the pass
	// that exists for a process that restarted while Redis was away. A round-trip
	// answers the question that actually matters, and dials the client on the way.
	if (await cacheStoreDropsEntries(cache) === false) {
		return 0;
	}

	let cleared = 0;
	const reported = new Set<string>();

	// Recorded like the purges it finishes, or the page would show the entries
	// they evicted as never purged at all (#507). One id for the drain: what it
	// drops, it drops in one pass, whatever the number of writes that recorded it.
	const purgeId = randomUUID();

	for (const target of pending) {
		try {
			if (target.mode === 'namespace') {
				await cache.clear();

				queueCachePurge({
					purgeId,
					collection: null,
					mode: 'namespace',
					scopedCachePins: null,
					scopedCachePinCount: 0,
					evicted: null,
					durationMs: null,
				});
			}
			else if (target.mode === 'collection') {
				if (target.collection === null) {
					// Nothing here can purge it: `collection` mode IS a collection scan and
					// the column is nullable. Raising drops into the catch below, which
					// keeps the row and counts the attempt — the safe direction, since the
					// alternative silently deletes a record whose entries are still stale.
					throw new Error(
						`collection-mode pending purge ${target.ids} names no collection`,
					);
				}

				await purgeCollectionScopedCache(cache, target.collection, {
					scopedCachePurgeId: purgeId,
					retried: true,
				});
			}
			else {
				const { declaredByCollection, pinKeyedCollections } =
					recordedScopedCachePurgeTargets(target.scopedCacheFingerprints);

				// Every collection the record reaches, before any of them is read: a
				// retry owes the same guarantee the purge it finishes owed, and a read
				// in flight has to decline rather than file itself under an index this
				// drain is about to prune.
				await bumpScopedCacheEpochs([
					...declaredByCollection.keys(),
					...pinKeyedCollections,
				]);

				let evicted = 0;
				const staleKeys: string[] = [];

				for (const [declaredCollection, declared] of declaredByCollection) {
					// No index path: the schema the record was written under is not this
					// drain's to read, so every set the collection owns is scanned.
					const sweep = await purgeScopedCacheDeclaredPins(
						cache,
						declaredCollection,
						declared,
						null,
					);

					evicted += sweep.evicted;

					for (const staleKey of sweep.matchedKeys) {
						staleKeys.push(staleKey);
					}
				}

				// Records its own collection-mode purge, as it does everywhere else:
				// it is the one that knows how many sets its scan turned up.
				for (const pinKeyedCollection of pinKeyedCollections) {
					await purgeCollectionScopedCache(cache, pinKeyedCollection, {
						scopedCachePurgeId: purgeId,
						retried: true,
					});
				}

				// Guarded on its own: naming the stale entries is best-effort telemetry
				// and reads Postgres, so its failure must not abort the purge — the
				// purge is what makes the cache correct again, and a blocked one stays
				// blocked for every later retry too.
				try {
					await reportRecoveredScopedCacheEntries(staleKeys, reported);
				}
				catch (error: any) {
					useLogger().warn(
						error,
						`[scoped-cache] could not name the entries a purge left stale: `
						+ `${error}`,
					);
				}

				// Only for what the fingerprints took: a legacy pin's collection purge
				// records itself, and counting it here would show its entries evicted
				// twice.
				if (declaredByCollection.size > 0) {
					// Legacy pins, though the record holds fingerprints: the stats
					// stream joins its pin list with a comma, which a rendered
					// fingerprint carries raw, and the entry-pins table this one is
					// joined against is written in pins too.
					const declaredPinKeys = scopedCachePinKeys(
						[...declaredByCollection.values()].flat(),
					);

					queueCachePurge({
						purgeId,
						collection: target.collection,
						mode: 'slices',
						scopedCachePins: declaredPinKeys,
						scopedCachePinCount: declaredPinKeys.length,
						evicted,
						durationMs: null,
					});
				}
			}

			await clearPendingScopedCachePurges(target.ids);
			cleared += target.ids.length;
		}
		catch (error: any) {
			// Left in place deliberately — the next ready/boot tries again. A purge is
			// idempotent, so retrying forever is safe, and giving up would leave the
			// entry stale with nothing else coming for it.
			await countFailedScopedCachePurgeRetry(target.ids, error);
		}
	}

	return cleared;
}

/**
 * Start finishing purges that failed after their mutation committed.
 *
 * Two triggers, because there are two ways a recorded purge becomes runnable
 * again: the process restarted (boot) and the client reconnected (`ready`).
 * ioredis emits `ready` on the first connect too, so the boot call only matters
 * when the client was already up before this listener existed.
 *
 * Not awaited by the caller — recovery is bounded by how much failed, and a boot
 * that blocked on it would be held up by the same Redis that is still down.
 */
export function startScopedCachePurgeRecovery(): void {
	if (!scopedCacheIndexStoreAvailable()) {
		return;
	}

	const logger = useLogger();

	const recover = () => {
		retryPendingScopedCachePurges()
			.then((finished) => {
				if (finished > 0) {
					logger.info(`[scoped-cache] finished ${finished} pending purge(s)`);
				}
			})
			.catch((error: any) => {
				logger.warn(error, `[scoped-cache] pending purge retry failed: ${error}`);
			});
	};

	useScopedCacheStore().onStoreReady(recover);

	// A purge can also fail with the link UP — `OOM command not allowed` under
	// maxmemory/noeviction, a WRONGTYPE, a LOADING replica — and then no `ready`
	// will ever fire again, leaving the recorded rows (and the stale entries they
	// name) until the next reconnect or a restart. A timer is the only trigger that
	// does not assume the failure was the connection. Unref'd so it cannot hold the
	// process open, and cheap when idle: the drain leaves after one indexed lookup
	// with nothing pending.
	const retryInterval = getMilliseconds(
		env['CACHE_SCOPED_PURGE_RETRY_INTERVAL'],
		0,
	);

	if (retryInterval > 0) {
		setInterval(recover, retryInterval).unref();
	}

	// And again when the response cache's own client comes back: it reconnects on its
	// own schedule, so the drain above can find it still offline and bail, leaving
	// this the only thing that finishes those records.
	void import('../cache.js')
		.then(({ getCache }) => {
			const { cache } = getCache();

			const storeClient = (cache?.store as {
				client?: { on?: (event: string, listener: () => void) => void };
			} | undefined)?.client;

			storeClient?.on?.('ready', recover);
		})
		// `getCache` builds the store on first call, so it can throw here — on a
		// boot path, where an unhandled rejection is the process's problem rather
		// than this listener's. The other two triggers still cover the drain.
		.catch((error: any) => {
			logger.warn(
				error,
				`[scoped-cache] could not watch the response cache client: ${error}`,
			);
		});

	recover();
}

/**
 * Name the entries a failed purge left stale, once it has finally dropped them.
 * Emitted HERE rather than at failure time because the anomaly stream is itself
 * Redis-backed — reporting when the purge failed would report nothing in the one
 * case worth reporting, a Redis outage.
 *
 * Read off what the purge matched rather than off the index: the index no longer
 * holds a set per slice to take the members of, and the purge scanned exactly
 * those entries on its way to deleting them.
 *
 * Best-effort: an entry with no descriptor (stats were off when it was filled)
 * is purged all the same, it just cannot be named on the admin page.
 *
 * `reported` spans the drain: an entry is filed under every index value it was
 * filled under, and a drain that retries several of them names it once, not once
 * per target.
 */
async function reportRecoveredScopedCacheEntries(
	staleKeys: readonly string[],
	reported: Set<string>,
): Promise<void> {
	if (staleKeys.length === 0) {
		return;
	}

	const { readCacheDescriptorForRedisKey } = await import('../cache-events.js');

	// A sidecar is the same stale entry counted once more, and the purge deletes
	// it alongside the entry it belongs to.
	const members = [...new Set(staleKeys)].filter((member) => {
		return cacheSidecarOwner(member) === null && !reported.has(member);
	});

	for (const member of members) {
		reported.add(member);
		const descriptor = await readCacheDescriptorForRedisKey(member);

		if (descriptor === null) {
			continue;
		}

		queueCacheAnomaly({
			cacheKey: descriptor.cacheKey,
			reason: 'redis_error',
			detail: 'served stale until a failed purge was retried',
		});
	}
}

/**
 * Purge cached responses affected by a mutation on `collection`. Outside scoped mode
 * the whole data cache is flushed (legacy `cache.clear()` behavior). In scoped mode
 * the bare collection fingerprint (global reads) is always purged alongside the
 * resolved `scopedCacheFingerprints` (the slices the mutation touched), leaving
 * every other slice untouched. A `null` list means "the scope couldn't be
 * resolved" → fall back to a collection-wide purge (bare fingerprint + every
 * slice) rather than risk leaving a slice stale; still narrower than nuking the
 * whole namespace.
 *
 * To purge EVERY entry of a collection, pass `null` — it dispatches to
 * `purgeCollectionScopedCache`, which reads the collection's own fingerprint index
 * and drops the bare fingerprint plus every slice key it names. A bare fingerprint
 * in the list is NOT that: this function deletes exactly the keys it is handed, and
 * a read pinned to a slice (an owner, or its primary key) is filed under that slice
 * alone, so it survives.
 *
 * `includeBareFingerprint: false` drops the bare fingerprint from the purge — for
 * a cancelled mutation nothing in `collection` changed, so only the hook's own
 * declared (usually foreign) slices should drop, not this collection's global
 * reads.
 */
export async function purgeScopedCache(
	cache: Keyv,
	collection: string,
	scopedCacheFingerprints: ScopedCacheFingerprint[] | null = [],
	context: EventContext | null = null,
	options: {
		includeBareFingerprint?: boolean;
		// One mutation can need more than one purge operation — the coarse
		// collection fallback plus the fingerprints a hook declared. Sharing an id
		// across them is what keeps `COUNT(DISTINCT purge_id)` reporting one purge per
		// mutation instead of one per operation. Absent, each operation gets its
		// own id, which is right when it IS its own purge.
		scopedCachePurgeId?: string;
		// The rows the mutation wrote, as they were AND as they became, each
		// serialised as a fingerprint of its own. Given them, the purge asks each
		// cached read its own question — does one of these rows satisfy everything
		// I depend on — instead of dropping every entry filed under any slice the
		// write touched. Absent, it falls back to the fingerprint sweep, which is what a
		// purge that knows no rows can do: a hook's own `purgeBy`, a collection-wide
		// fallback, a write whose rows could not be read back.
		rowFingerprints?: readonly ScopedCacheFingerprint[];
		// The columns an update rewrote, `null` for an insert or a delete. A read
		// bound to none of them cannot have changed, whichever slice the row is in.
		changed?: readonly string[] | null;
		// The path the collection's index may be split by, so the store can answer
		// with what its rows own instead of everything the collection holds.
		indexPath?: string | null;
		// What a hook's `purgeBy` declared, and anything else purged by pin rather
		// than by row. Each names a query case the mutation's own rows cannot answer
		// for — a slice on another collection, a slice the write never touched — so
		// it is purged by what it pins, not by what was written.
		declaredFingerprints?: readonly ScopedCacheFingerprint[];
	} = {},
): Promise<ScopedCacheFingerprint[] | null> {
	// Returns what the purge reached so a caller can surface it (dev-only debug
	// header): `null` = whole namespace flushed (non-scoped mode); a lone bare
	// fingerprint = a collection-wide purge; otherwise the resolved slices.
	const startedAt = Date.now();

	if (!scopedCachePurgeEnabled()) {
		const cleared = await purgeOrRecord(
			() => cache.clear(),
			{ mode: 'namespace', collection: null, scopedCacheFingerprints: [] },
		);

		if (!cleared) {
			return null;
		}

		// Not folded into the `flush` config-event marker, though both mean "the
		// whole cache went": that marker is a direct, unbuffered INSERT, which is
		// fine for an operator flushing by hand and ruinous here, where this fires
		// on every mutation. They stay distinct events on purpose — `flush` is an
		// operator acting, this is a mutation invalidating everything because
		// scoped mode is off.
		//
		// No index sets and no member list to count here: the clear takes the whole
		// namespace, so the row records the reach and leaves the size unknown.
		// Zero would draw the most destructive event here as one that took nothing.
		queueCachePurge({
			purgeId: options.scopedCachePurgeId,
			collection: null,
			mode: 'namespace',
			scopedCachePins: null,
			scopedCachePinCount: 0,
			evicted: null,
			durationMs: Date.now() - startedAt,
		});

		return null;
	}

	if (scopedCacheFingerprints === null) {
		// Records its own purge — it is the one that knows how many slices the
		// scan turned up.
		await purgeOrRecord(
			() => {
				return purgeCollectionScopedCache(cache, collection, {
					scopedCachePurgeId: options.scopedCachePurgeId,
				});
			},
			{ mode: 'collection', collection, scopedCacheFingerprints: [] },
		);

		return [scopedCacheFingerprintOf(collection, [])];
	}

	const declaredScopedCacheFingerprints = options.includeBareFingerprint === false
		? [...scopedCacheFingerprints]
		: [scopedCacheFingerprintOf(collection, []), ...scopedCacheFingerprints];

	let resolvedScopedCacheFingerprints = declaredScopedCacheFingerprints;

	// The filter runs after the mutation committed, so an extension that throws
	// here would answer 500 for a durable write — and, being outside
	// `purgeOrRecord`, would record nothing either, leaving the entries it was
	// about to drop stale with nothing coming for them. Purging what was already
	// resolved loses whatever the extension would have added, which is the smaller
	// harm and the visible one: its own `purgeBy` is what that declaration is for.
	try {
		const resolved = (await emitter.emitFilter(
			'cache.purge',
			declaredScopedCacheFingerprints,
			{ collection },
			context,
		)) as ScopedCacheDeclaredFingerprint[];

		// Re-canonicalized rather than taken as given: an extension holds its values
		// the way its own code does, and only the column's type says which slice a
		// `7`, a `Date` or an uppercase uuid names. What the host built passes through
		// unchanged — canonicalizing a token again returns it.
		resolvedScopedCacheFingerprints = resolved.map((declared) => {
			return scopedCacheFingerprintOf(
				declared.collection,
				scopedCacheDeclaredPins(declared, context?.schema),
			);
		});
	}
	catch (error: any) {
		useLogger().warn(
			error,
			`[scoped-cache] cache.purge filter failed, purging the slices resolved `
			+ `without it: ${error}`,
		);
	}

	// Row-driven: the rows answer for every slice the mutation itself resolved, so
	// only what the `cache.purge` filter ADDED is still swept by pin — that one names
	// a slice, not the rows the mutation wrote, and nothing else can resolve it.
	const rowDriven = new Set(
		declaredScopedCacheFingerprints.map(renderScopedCacheFingerprint),
	);

	const sweptScopedCacheFingerprints = options.rowFingerprints === undefined
		? resolvedScopedCacheFingerprints
		: resolvedScopedCacheFingerprints.filter((resolved) => {
			return rowDriven.has(renderScopedCacheFingerprint(resolved)) === false;
		});

	// Everything purged by pin: what a hook declared, plus the slices left to sweep.
	const purgedByPin = [
		...(options.declaredFingerprints ?? []),
		...sweptScopedCacheFingerprints,
	];

	// What the purge reached: the mutation's own slices, plus the ones a hook
	// declared.
	const purgedScopedCacheFingerprints = [
		...resolvedScopedCacheFingerprints,
		...(options.declaredFingerprints ?? []),
	];

	const renderedFingerprints = [
		...new Set(purgedByPin.map(renderScopedCacheFingerprint)),
	];

	let evicted: number | null = null;

	// What a retry has to be able to run again, in the one grammar the index reads:
	// the rows this purge was bound to, and the pins it was handed. A legacy pin
	// would name a slice the index files nothing under, and a retry aimed at one
	// would report success having dropped nothing.
	// The bare fingerprint rides with the rows rather than in the swept list, so a
	// retry driven by the record alone would leave the global reads warm: a row
	// fingerprint names a value, and a pin naming a value cannot reach an entry
	// bound to none.
	const recordedBareFingerprint =
		options.rowFingerprints !== undefined && options.includeBareFingerprint !== false
			? [scopedCacheFingerprintOf(collection, [])]
			: [];

	const recordedFingerprints = [
		...(options.rowFingerprints ?? []),
		...recordedBareFingerprint,
		...purgedByPin,
	].map(renderScopedCacheFingerprint);

	const purged = await purgeOrRecord(
		async () => {
			const [bound, swept] = await Promise.all([
				options.rowFingerprints === undefined
					? 0
					: purgeScopedCacheFingerprintIndex(
						cache,
						collection,
						options.rowFingerprints,
						options.changed ?? null,
						options.indexPath ?? null,
						options.includeBareFingerprint !== false,
					),
				purgeScopedCacheDeclaredFingerprints(
					cache,
					collection,
					purgedByPin,
					options.indexPath ?? null,
					context?.schema ?? null,
				),
			]);

			evicted = bound + swept;
		},
		{
			mode: 'slices',
			collection,
			scopedCacheFingerprints: recordedFingerprints,
		},
	);

	if (!purged) {
		return purgedScopedCacheFingerprints;
	}

	// The legacy pins a mutation actually resolved, in the same form the entry
	// sidecar stores — so "this entry carries pin X, and pin X was purged at T" is
	// a join rather than a guess.
	queueCachePurge({
		purgeId: options.scopedCachePurgeId,
		collection,
		mode: 'slices',
		scopedCachePins: scopedCachePinKeys(purgedScopedCacheFingerprints),
		scopedCachePinCount: renderedFingerprints.length,
		evicted,
		// Awaited inside the mutation, so this time is ADDED to the write's own
		// latency — a slow purge slows the request that triggered it.
		durationMs: Date.now() - startedAt,
	});

	return purgedScopedCacheFingerprints;
}
