import { getMilliseconds } from "../utils/get-milliseconds.js";
import { useLogger } from "../logger/index.js";
import { flushCacheRedisDatabase } from "../redis/lib/use-cache-redis.js";
import "../redis/index.js";
import { cacheSetting } from "../cache-settings.js";
import { parseScopedCacheFingerprint, renderScopedCacheFingerprint, scopedCacheDeclaredPins, scopedCacheFingerprintCouldContainPin, scopedCacheFingerprintIsBare, scopedCacheFingerprintOf, scopedCacheFingerprintPurgedBy, scopedCachePinKeys } from "./fingerprint.js";
import { scopedCacheEpochBumpScript, scopedCacheEpochKey } from "./redis-store.js";
import { useScopedCacheStore } from "./store.js";
import { scopedCacheIndexStoreAvailable, scopedCachePurgeEnabled } from "./config.js";
import { bumpScopedCacheEpochs, bumpScopedCacheEpochsInEveryMode, scopedCacheEpochTtlSeconds } from "./fill-guard.js";
import { cacheEntryRawKeyOf, dropCacheEntries } from "../cache-drop.js";
import { requestScopedCacheIndexReap } from "./reap-requests.js";
import { scopedCacheFillPaused } from "./fill-pause.js";
import { scopedCacheHomePinFields, scopedCacheIndexPath } from "./index-path.js";
import emitter_default from "../emitter.js";
import { resolvedCacheTtl } from "../cache-config.js";
import { cacheExpiresAtKey, cacheSidecarOwner } from "../cache-sidecars.js";
import { cacheStoreDropsEntries } from "../cache-store-probe.js";
import { queueCacheAnomaly, queueCachePurge } from "../cache-events.js";
import { clearPendingScopedCachePurges, countFailedScopedCachePurgeRetry, listPendingScopedCachePurges, recordPendingScopedCachePurge, scopedCachePurgeRetryMaxFingerprints } from "../scoped-cache-pending-purges.js";
import { scopedCacheDeclaredIndexPins } from "./declared-index-pins.js";
import { useEnv } from "@directus/env";
import { randomUUID } from "node:crypto";

//#region src/scoped-cache/purge.ts
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
function scopedCacheCollectionsChangedByOnDelete(schema, collection) {
	const changedCollections = /* @__PURE__ */ new Set();
	const walkedCollections = new Set([collection]);
	const pendingCollections = [collection];
	while (pendingCollections.length > 0) {
		const parentCollection = pendingCollections.shift();
		for (const relation of schema.relations) {
			const onDeleteRule = relation.schema?.on_delete;
			const childCollection = relation.collection;
			if (relation.related_collection !== parentCollection || onDeleteRule === void 0 || onDeleteRule === null || [
				"CASCADE",
				"SET NULL",
				"SET DEFAULT"
			].includes(onDeleteRule) === false) continue;
			if (parentCollection === collection && childCollection === collection && onDeleteRule !== "CASCADE") continue;
			changedCollections.add(childCollection);
			if (onDeleteRule === "CASCADE" && !walkedCollections.has(childCollection)) {
				walkedCollections.add(childCollection);
				pendingCollections.push(childCollection);
			}
		}
	}
	return [...changedCollections];
}
/**
* Index a freshly-cached response key under the query case it was read with, so a
* later mutation can drop just the entries that case answers for instead of the
* whole namespace. Both the payload key and its `__expires_at` sibling are indexed.
* When a cache TTL is set, the index self-expires at
* `cache_settings.scoped_index_ttl_factor` (2) times that TTL, as a net for
* filings orphaned by a crash between write and purge; with no TTL the cached
* entries never expire either, so the index is left unbounded to match — a normal
* purge still drains it.
*
* `cacheTtl` is the TTL the caller wrote the entry with, read once for both: the
* settings override can change between two reads of it.
*/
async function indexScopedCacheEntry(key, fingerprints, extraSiblings = [], schema = {
	collections: {},
	relations: []
}, cacheTtl = resolvedCacheTtl()) {
	if (!scopedCachePurgeEnabled() || fingerprints.length === 0) return;
	const ttlSeconds = Math.ceil(getMilliseconds(cacheTtl, 0) * cacheSetting("scoped_index_ttl_factor") / 1e3);
	const filings = fingerprints.map((fingerprint) => {
		return {
			fingerprint,
			keys: [
				key,
				cacheExpiresAtKey(key),
				...extraSiblings
			],
			indexPath: scopedCacheIndexPath(schema, fingerprint.collection),
			homePinFields: scopedCacheHomePinFields(schema, fingerprint.collection)
		};
	});
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
async function countScopedCachePinMembers(pinKeys) {
	if (!scopedCachePurgeEnabled() || pinKeys.length === 0) return {};
	const counts = {};
	const pinKeysByCollection = /* @__PURE__ */ new Map();
	for (const pinKey of pinKeys) {
		counts[pinKey] = 0;
		const declared = scopedCacheFingerprintFromPinKey(pinKey);
		const pinKeyed = pinKeysByCollection.get(declared.collection) ?? [];
		pinKeyed.push({
			pinKey,
			declared
		});
		pinKeysByCollection.set(declared.collection, pinKeyed);
	}
	const store = useScopedCacheStore();
	for (const [collection, pinKeyed] of pinKeysByCollection) {
		const reachedByPin = /* @__PURE__ */ new Map();
		for await (const indexedEntries of store.scanCollectionIndexedEntries(collection)) for (const { fingerprint, key } of indexedEntries) {
			if (key === "" || cacheSidecarOwner(key) !== null) continue;
			for (const { pinKey, declared } of pinKeyed) if (scopedCacheFingerprintReachedByPin(fingerprint, declared)) {
				const reached = reachedByPin.get(pinKey) ?? /* @__PURE__ */ new Set();
				reached.add(key);
				reachedByPin.set(pinKey, reached);
			}
		}
		for (const [pinKey, reached] of reachedByPin) counts[pinKey] = reached.size;
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
function scopedCacheFingerprintFromPinKey(pinKey) {
	const fieldAt = pinKey.indexOf(":");
	if (fieldAt === -1) return { collection: pinKey };
	const pin = pinKey.slice(fieldAt + 1);
	const valueAt = pin.indexOf("=");
	if (valueAt === -1) return { collection: pinKey.slice(0, fieldAt) };
	const pinnedScope = Object.create(null);
	pinnedScope[pin.slice(0, valueAt)] = [pin.slice(valueAt + 1)];
	return {
		collection: pinKey.slice(0, fieldAt),
		pinnedScope
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
* A pin naming a value reaches every entry that could hold a row of that slice,
* which `scopedCacheFingerprintCouldContainPin` answers — the reads that pin
* nothing among them: a global read, or a range read indexed bare, holds the
* slice's rows as much as the entry pinned to it does.
*/
function scopedCacheFingerprintReachedByPin(fingerprint, declared) {
	if (scopedCacheFingerprintIsBare(declared)) return scopedCacheFingerprintIsBare(fingerprint);
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
async function dropSweptScopedCacheEntries(cache, members) {
	const present = new Set(members);
	const entries = members.filter((member) => {
		const owner = cacheSidecarOwner(member);
		return owner === null || present.has(owner) === false;
	});
	const entryKeys = new Set(entries);
	const [evicted] = await Promise.all([dropCacheEntries(cache, entries), dropCacheEntries(cache, members.filter((member) => {
		return entryKeys.has(member) === false;
	}))]);
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
async function purgeScopedCacheFingerprintIndex(cache, collection, rowFingerprints, changed, indexPath, includeBareFingerprint, scanTally) {
	if (rowFingerprints.length === 0) return 0;
	await bumpScopedCacheEpochs([collection]);
	const { evicted } = await purgeScopedCacheIndexWhere(cache, useScopedCacheStore().scanRowIndexedEntries(collection, rowFingerprints, indexPath, scanTally), (fingerprint) => {
		if (includeBareFingerprint === false && scopedCacheFingerprintIsBare(fingerprint)) return false;
		return scopedCacheFingerprintPurgedBy(fingerprint, rowFingerprints, changed);
	}, indexPath, scanTally);
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
async function purgeScopedCacheDeclaredPins(cache, collection, declared, indexPath, context, mutatedCollections, scanTally) {
	const scannedPins = context?.schema && mutatedCollections !== null ? await scopedCacheDeclaredIndexPins(context.schema, context.database, collection, declared, indexPath, mutatedCollections) : null;
	return purgeScopedCacheIndexWhere(cache, useScopedCacheStore().scanDeclaredIndexedEntries(collection, scannedPins ?? declared, indexPath, scanTally), (fingerprint) => {
		return declared.some((declaredFingerprint) => {
			return scopedCacheFingerprintReachedByPin(fingerprint, declaredFingerprint);
		});
	}, indexPath, scanTally);
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
async function purgeScopedCacheDeclaredFingerprints(cache, collection, declaredFingerprints, indexPath, context, changedCollections, scanTally) {
	const schema = context?.schema ?? null;
	if (declaredFingerprints.length === 0) return 0;
	const declaredByCollection = /* @__PURE__ */ new Map();
	for (const fingerprint of declaredFingerprints) {
		const declared = declaredByCollection.get(fingerprint.collection) ?? [];
		declared.push(fingerprint);
		declaredByCollection.set(fingerprint.collection, declared);
	}
	await bumpScopedCacheEpochs([...declaredByCollection.keys()]);
	let evicted = 0;
	for (const [declaredCollection, declared] of declaredByCollection) {
		let declaredIndexPath = indexPath;
		if (declaredCollection !== collection || indexPath === null) declaredIndexPath = schema === null ? null : scopedCacheIndexPath(schema, declaredCollection);
		const sweep = await purgeScopedCacheDeclaredPins(cache, declaredCollection, declared, declaredIndexPath, context, [collection, ...changedCollections], scanTally);
		evicted += sweep.evicted;
	}
	return evicted;
}
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
async function purgeScopedCacheIndexWhere(cache, indexedEntries, purges, indexPath, scanTally) {
	const matched = [];
	const matchedKeys = [];
	const seenKeys = /* @__PURE__ */ new Set();
	for await (const indexedBatch of timedScanPages(indexedEntries, scanTally)) for (const indexedEntry of indexedBatch) {
		if (purges(indexedEntry.fingerprint) === false) continue;
		matched.push(indexedEntry);
		const { key } = indexedEntry;
		if (key !== "" && seenKeys.has(key) === false) {
			seenKeys.add(key);
			matchedKeys.push(key);
		}
	}
	if (matchedKeys.length === 0) return {
		evicted: 0,
		matchedKeys
	};
	const evicted = await dropSweptScopedCacheEntries(cache, matchedKeys);
	await useScopedCacheStore().removeIndexedEntries(matched, indexPath);
	return {
		evicted,
		matchedKeys
	};
}
/** A purge's scan tally before any arm has read anything. */
function emptyScopedCacheScanTally() {
	return {
		scanArms: /* @__PURE__ */ new Set(),
		scannedIndexKeys: 0,
		scannedMembers: 0,
		scanMs: 0
	};
}
const SCOPED_CACHE_SCAN_ARM_ORDER = [
	"row",
	"declared",
	"collection"
];
/** What the purge record says its scans read, or null when none ran. */
function cachePurgeScanOf(scanTally) {
	if (scanTally.scanArms.size === 0) return null;
	return {
		scanArms: SCOPED_CACHE_SCAN_ARM_ORDER.filter((scanArm) => {
			return scanTally.scanArms.has(scanArm);
		}).join("+"),
		scannedIndexKeys: scanTally.scannedIndexKeys,
		scannedMembers: scanTally.scannedMembers,
		scanMs: scanTally.scanMs
	};
}
/**
* The store's pages as they come, adding the time spent waiting on each to the
* tally: the Redis round trips, and whatever held the event loop meanwhile.
*
* Closes the store's generator on the way out, as a `for await` over it would,
* so a consumer that throws mid-scan leaves no scan open behind it.
*/
async function* timedScanPages(scanPages, scanTally) {
	try {
		for (;;) {
			const startedAt = performance.now();
			const scanPage = await scanPages.next();
			scanTally.scanMs += performance.now() - startedAt;
			if (scanPage.done === true) return;
			yield scanPage.value;
		}
	} finally {
		await scanPages.return(void 0);
	}
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
* once the index is gone, in every mode, as the drop runs in every mode. The
* move before the clear cannot catch a fill that took the counter after it,
* filed its fingerprints before the drop below and wrote its entry after it:
* that entry compares equal and is indexed by nothing, reachable to no later
* purge. The move here makes that fill's recheck evict it. A fill that also
* rechecked before this move still keeps its entry
* (https://github.com/jclaveau/directus/issues/547).
*
* The store unlinks only the sets holding members, and keeps the index-key sets
* naming them and their completeness marker: a name whose set is gone reads
* empty, so the collection-wide purges keep reading the index-key sets. The reap
* requested once the drop is over releases those names, marker or none,
* schedule or none. The operator's clear awaits that reap before it answers;
* the flush of a schema change does not. A one-shot command exits before that
* reap runs; the nodes hearing its `cacheCleared` ask for one that the marker
* still turns away, and the names wait for the next reap.
*/
async function dropScopedCacheIndex() {
	if (!scopedCacheIndexStoreAvailable()) return {
		dropped: 0,
		refused: 0
	};
	try {
		return await useScopedCacheStore().dropIndex();
	} finally {
		await bumpScopedCacheEpochsInEveryMode(["*"]);
		requestScopedCacheIndexReap({ forcePass: true });
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
* can; `flushResponseCache` is the two together. With `CACHE_REDIS_DB` set, the
* one FLUSHDB takes the index and the counters too, the wholesale one it just
* moved included — not the recorded build, the index generation, the index's
* completeness marker or the fill pause, which the shared database holds. A
* read that took no counter would compare equal after its fill. So the same
* MULTI moves it again, from the server's clock, and no fill can recheck
* in between. A Redis that refused that move — out of memory — gets it once more
* after the MULTI, which leaves a fill rechecking in between kept. Answers
* whether it was that FLUSHDB.
*/
async function clearResponseCache(cache) {
	await bumpScopedCacheEpochs(["*"]);
	const databaseFlush = await flushCacheRedisDatabase((flushTransaction) => {
		if (scopedCachePurgeEnabled()) flushTransaction.eval(scopedCacheEpochBumpScript, 1, scopedCacheEpochKey("*"), scopedCacheEpochTtlSeconds());
	});
	if (databaseFlush === "flushed-queued-command-failed") await bumpScopedCacheEpochs(["*"]);
	if (databaseFlush !== "not-flushed") return true;
	await cache?.clear();
	return false;
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
* behind name keys that are gone, until the reap drops those members or the
* set's expiry runs out — never, for a set filed while `CACHE_TTL` was unset.
*/
async function flushResponseCache(cache) {
	if (await clearResponseCache(cache) || !scopedCachePurgeEnabled()) return;
	try {
		await dropScopedCacheIndex();
	} catch (error) {
		useLogger().warn(error, `[scoped-cache] could not drop the fingerprint index after a flush: ${error}`);
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
async function purgeScopedCacheCollectionIndex(cache, collection, scanTally) {
	const keys = [];
	const seenKeys = /* @__PURE__ */ new Set();
	const sweptKeys = [];
	let indexKeys = 0;
	scanTally.scanArms.add("collection");
	for await (const taken of timedScanPages(useScopedCacheStore().takeCollectionIndexedKeys(collection), scanTally)) {
		indexKeys += taken.indexKeys;
		scanTally.scannedIndexKeys += taken.indexKeys;
		scanTally.scannedMembers += taken.keys.length;
		for (const sweptKey of taken.sweptKeys) sweptKeys.push(sweptKey);
		for (const key of taken.keys) if (seenKeys.has(key) === false) {
			seenKeys.add(key);
			keys.push(key);
		}
	}
	const evicted = await dropSweptScopedCacheEntries(cache, keys);
	let released;
	try {
		released = await useScopedCacheStore().releaseSweptIndexKeys(sweptKeys);
	} catch (error) {
		useLogger().warn(error, `[scoped-cache] releasing the index sets swept for ${collection} failed; they expire with their entries: ${error}`);
		return {
			evicted,
			indexKeys
		};
	}
	if (released.refused > 0) useLogger().warn(`[scoped-cache] ${released.refused} release(s) of the index sets swept for ${collection} were refused; they expire with their entries`);
	return {
		evicted,
		indexKeys
	};
}
/**
* Purge every cached read of `collection` — its bare collection fingerprint plus all
* its value slices — without full-flushing the namespace. The fallback when a
* mutation's scope values are unresolvable (e.g. an upsert mixing inserts and
* updates): which slices changed is unknown, but only reads touching THIS collection
* can be stale, so scope the flush to its own index and spare every other
* collection's entries.
*/
async function purgeCollectionScopedCache(cache, collection, options = {}) {
	await bumpScopedCacheEpochs([collection]);
	const startedAt = Date.now();
	const scanTally = emptyScopedCacheScanTally();
	const { evicted, indexKeys } = await purgeScopedCacheCollectionIndex(cache, collection, scanTally);
	queueCachePurge({
		purgeId: options.scopedCachePurgeId,
		collection,
		mode: "collection",
		scopedCachePins: null,
		scopedCachePinCount: indexKeys,
		evicted,
		durationMs: options.retried === true ? null : Date.now() - startedAt,
		scopedCacheScan: cachePurgeScanOf(scanTally)
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
async function purgeOrRecord(run, pending) {
	try {
		await run();
		return true;
	} catch (error) {
		useLogger().warn(error, `[scoped-cache] purge failed and was recorded for retry: ${error}`);
		await recordPendingScopedCachePurge(pending, error);
		return false;
	}
}
/**
* What a recorded purge target resolves to: the fingerprints to retry it with,
* grouped by the collection each names, plus the collections it names too many
* of to replay one by one. Those are purged whole: every entry of the collection
* is matched against every fingerprint, so past the limit the precise retry costs
* more than dropping the collection, which is the direction a recovery is allowed
* to miss in.
*/
function recordedScopedCachePurgeTargets(recorded) {
	const declaredByCollection = /* @__PURE__ */ new Map();
	for (const target of recorded) {
		const fingerprint = parseScopedCacheFingerprint(target);
		const declared = declaredByCollection.get(fingerprint.collection) ?? [];
		declared.push(fingerprint);
		declaredByCollection.set(fingerprint.collection, declared);
	}
	const coarsenedCollections = [];
	for (const [collection, declared] of declaredByCollection) if (declared.length > scopedCachePurgeRetryMaxFingerprints()) {
		coarsenedCollections.push(collection);
		declaredByCollection.delete(collection);
	}
	return {
		declaredByCollection,
		coarsenedCollections
	};
}
let pendingScopedCachePurgeDrain = Promise.resolve(0);
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
function retryPendingScopedCachePurges() {
	const drained = pendingScopedCachePurgeDrain.catch(() => 0).then(() => drainPendingScopedCachePurges());
	pendingScopedCachePurgeDrain = drained;
	return drained;
}
/**
* Drop the entries every stranded sweep still names, then release its sets.
* Returns how many entries it dropped.
*
* A collection purge moves its sets aside before it drops their entries, and a
* process that dies in between leaves both behind with no record to retry: the
* failure was never caught. No write's own sets name those entries any more, so
* until a later purge of the same whole collection they stay cached with their
* old value.
*
* Whichever process swept them: one that is still alive only finds its sets gone
* or their entries already dropped, which is where its own sweep was heading.
* Serialized with the drain for the same reason the drain is serialized with
* itself.
*/
function releaseStrandedScopedCacheSweeps() {
	const released = pendingScopedCachePurgeDrain.catch(() => 0).then(() => dropStrandedScopedCacheSweeps());
	pendingScopedCachePurgeDrain = released;
	return released;
}
async function dropStrandedScopedCacheSweeps() {
	if (!scopedCacheIndexStoreAvailable()) return 0;
	const { getCache } = await import("../cache.js");
	const { cache } = getCache();
	if (!cache || await cacheStoreDropsEntries(cache) === false) return 0;
	let evicted = 0;
	for await (const taken of useScopedCacheStore().takeStrandedSweptIndexKeys()) {
		evicted += await dropSweptScopedCacheEntries(cache, taken.keys);
		await useScopedCacheStore().releaseSweptIndexKeys(taken.sweptKeys);
	}
	return evicted;
}
/**
* Remove the index members naming entries the cache no longer holds. Returns how
* many it removed.
*
* An entry expires and its members stay: every read filed into a set pushes the
* set's expiry out, so the set of a collection read all day never expires, and
* each write to that collection tests every read ever cached in it.
*
* Only on a Redis-backed cache: whether an entry is still there is asked of Redis
* directly, one `EXISTS` per member, since asking the cache would read every
* entry's value to learn it exists.
*/
async function reapScopedCacheIndex() {
	if (!scopedCacheIndexStoreAvailable()) return 0;
	const { getCache } = await import("../cache.js");
	const { cache } = getCache();
	const rawKeyOf = cache ? cacheEntryRawKeyOf(cache) : null;
	if (rawKeyOf === null) return 0;
	const { reaped, strandedSweptKeys } = await useScopedCacheStore().reapIndexedEntries(rawKeyOf, scopedCacheEpochTtlSeconds());
	if (strandedSweptKeys > 0) await releaseStrandedScopedCacheSweeps();
	return reaped;
}
/**
* Retries the recorded targets, never the namespace: a failure records what it
* could not drop, so recovery drops exactly that and every other slice stays
* warm. Returns how many recorded rows it cleared — not how many targets they
* collapsed into, since an outage records one slice once per write that touched
* it and the operator reads the table, not the grouping.
*/
async function drainPendingScopedCachePurges() {
	if (!scopedCacheIndexStoreAvailable()) return 0;
	const pending = await listPendingScopedCachePurges();
	if (pending.length === 0) return 0;
	const { getCache } = await import("../cache.js");
	const { cache } = getCache();
	if (!cache) return 0;
	if (await cacheStoreDropsEntries(cache) === false) return 0;
	let cleared = 0;
	const reported = /* @__PURE__ */ new Set();
	const purgeId = randomUUID();
	for (const target of pending) try {
		if (target.mode === "namespace") {
			await cache.clear();
			queueCachePurge({
				purgeId,
				collection: null,
				mode: "namespace",
				scopedCachePins: null,
				scopedCachePinCount: 0,
				evicted: null,
				durationMs: null,
				scopedCacheScan: null
			});
		} else if (target.mode === "collection") {
			if (target.collection === null) throw new Error(`collection-mode pending purge ${target.ids} names no collection`);
			await purgeCollectionScopedCache(cache, target.collection, {
				scopedCachePurgeId: purgeId,
				retried: true
			});
		} else {
			const { declaredByCollection, coarsenedCollections } = recordedScopedCachePurgeTargets(target.scopedCacheFingerprints);
			await bumpScopedCacheEpochs([...declaredByCollection.keys(), ...coarsenedCollections]);
			let evicted = 0;
			const staleKeys = [];
			const scanTally = emptyScopedCacheScanTally();
			for (const [declaredCollection, declared] of declaredByCollection) {
				const sweep = await purgeScopedCacheDeclaredPins(cache, declaredCollection, declared, null, null, null, scanTally);
				evicted += sweep.evicted;
				for (const staleKey of sweep.matchedKeys) staleKeys.push(staleKey);
			}
			for (const coarsenedCollection of coarsenedCollections) await purgeCollectionScopedCache(cache, coarsenedCollection, {
				scopedCachePurgeId: purgeId,
				retried: true
			});
			try {
				await reportRecoveredScopedCacheEntries(staleKeys, reported);
			} catch (error) {
				useLogger().warn(error, `[scoped-cache] could not name the entries a purge left stale: ${error}`);
			}
			if (declaredByCollection.size > 0) {
				const declaredPinKeys = scopedCachePinKeys([...declaredByCollection.values()].flat());
				queueCachePurge({
					purgeId,
					collection: target.collection,
					mode: "slices",
					scopedCachePins: declaredPinKeys,
					scopedCachePinCount: declaredPinKeys.length,
					evicted,
					durationMs: null,
					scopedCacheScan: cachePurgeScanOf(scanTally)
				});
			}
		}
		await clearPendingScopedCachePurges(target.ids);
		cleared += target.ids.length;
	} catch (error) {
		await countFailedScopedCachePurgeRetry(target.ids, error);
	}
	return cleared;
}
async function recordBuildThenRequestReap(buildRecordWanted) {
	if (buildRecordWanted) {
		const { recordScopedCacheBuild } = await import("../cache-build-identity.js");
		await recordScopedCacheBuild();
	}
	await requestScopedCacheIndexReap();
}
function reapOnFlushElsewhere(logger) {
	import("../bus/index.js").then(({ useBus }) => {
		return useBus().subscribe("cacheCleared", ({ targets }) => {
			if (targets.includes("response")) requestScopedCacheIndexReap();
		});
	}).catch((error) => {
		logger.warn(error, `[scoped-cache] could not hear the flushes of other processes: ${error}`);
	});
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
function startScopedCachePurgeRecovery() {
	if (!scopedCacheIndexStoreAvailable()) return;
	const logger = useLogger();
	let firstReady = true;
	const recover = () => {
		retryPendingScopedCachePurges().then((finished) => {
			if (finished > 0) logger.info(`[scoped-cache] finished ${finished} pending purge(s)`);
		}).catch((error) => {
			logger.warn(error, `[scoped-cache] pending purge retry failed: ${error}`);
		});
	};
	useScopedCacheStore().onStoreReady(() => {
		releaseStrandedScopedCacheSweeps().then((evicted) => {
			if (evicted > 0) logger.info(`[scoped-cache] dropped ${evicted} entries a stranded sweep named`);
		}).catch((error) => {
			logger.warn(error, `[scoped-cache] releasing stranded sweeps failed: ${error}`);
		});
		recover();
		if (firstReady) reapOnFlushElsewhere(logger);
		const buildRecordWanted = firstReady || scopedCacheFillPaused();
		firstReady = false;
		recordBuildThenRequestReap(buildRecordWanted).catch((error) => {
			logger.warn(error, `[scoped-cache] boot index reap failed: ${error}`);
		});
	});
	const retryInterval = getMilliseconds(env["CACHE_SCOPED_PURGE_RETRY_INTERVAL"], 0);
	if (retryInterval > 0) setInterval(recover, retryInterval).unref();
	import("../cache.js").then(({ getCache }) => {
		const { cache } = getCache();
		((cache?.store)?.client)?.on?.("ready", recover);
	}).catch((error) => {
		logger.warn(error, `[scoped-cache] could not watch the response cache client: ${error}`);
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
async function reportRecoveredScopedCacheEntries(staleKeys, reported) {
	if (staleKeys.length === 0) return;
	const { readCacheDescriptorForRedisKey } = await import("../cache-events.js");
	const members = [...new Set(staleKeys)].filter((member) => {
		return cacheSidecarOwner(member) === null && !reported.has(member);
	});
	for (const member of members) {
		reported.add(member);
		const descriptor = await readCacheDescriptorForRedisKey(member);
		if (descriptor === null) continue;
		queueCacheAnomaly({
			cacheKey: descriptor.cacheKey,
			reason: "redis_error",
			detail: "served stale until a failed purge was retried"
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
* a cancelled mutation nothing in `collection` changed, so only what the hook
* declared should drop: its (usually foreign) slices, and the global reads of
* the collections those slices name.
*/
async function purgeScopedCache(cache, collection, scopedCacheFingerprints = [], context = null, options = {}) {
	const startedAt = Date.now();
	if (!scopedCachePurgeEnabled()) {
		if (!await purgeOrRecord(() => cache.clear(), {
			mode: "namespace",
			collection: null,
			scopedCacheFingerprints: []
		})) return null;
		queueCachePurge({
			purgeId: options.scopedCachePurgeId,
			collection: null,
			mode: "namespace",
			scopedCachePins: null,
			scopedCachePinCount: 0,
			evicted: null,
			durationMs: Date.now() - startedAt,
			scopedCacheScan: null
		});
		return null;
	}
	if (scopedCacheFingerprints === null) {
		await purgeOrRecord(() => {
			return purgeCollectionScopedCache(cache, collection, { scopedCachePurgeId: options.scopedCachePurgeId });
		}, {
			mode: "collection",
			collection,
			scopedCacheFingerprints: []
		});
		return [scopedCacheFingerprintOf(collection, [])];
	}
	const declaredScopedCacheFingerprints = options.includeBareFingerprint === false ? [...scopedCacheFingerprints] : [scopedCacheFingerprintOf(collection, []), ...scopedCacheFingerprints];
	let resolvedScopedCacheFingerprints = declaredScopedCacheFingerprints;
	try {
		resolvedScopedCacheFingerprints = (await emitter_default.emitFilter("cache.purge", declaredScopedCacheFingerprints, { collection }, context)).map((declared) => {
			return scopedCacheFingerprintOf(declared.collection, scopedCacheDeclaredPins(declared, context?.schema));
		});
	} catch (error) {
		useLogger().warn(error, `[scoped-cache] cache.purge filter failed, purging the slices resolved without it: ${error}`);
	}
	const rowDriven = new Set(declaredScopedCacheFingerprints.map(renderScopedCacheFingerprint));
	const sweptScopedCacheFingerprints = options.rowFingerprints === void 0 ? resolvedScopedCacheFingerprints : resolvedScopedCacheFingerprints.filter((resolved) => {
		return rowDriven.has(renderScopedCacheFingerprint(resolved)) === false;
	});
	const purgedByPin = [...options.declaredFingerprints ?? [], ...sweptScopedCacheFingerprints];
	const purgedScopedCacheFingerprints = [...resolvedScopedCacheFingerprints, ...options.declaredFingerprints ?? []];
	let evicted = null;
	const recordedBareFingerprint = options.rowFingerprints !== void 0 && options.includeBareFingerprint !== false ? [scopedCacheFingerprintOf(collection, [])] : [];
	const recordedFingerprints = [
		...options.rowFingerprints ?? [],
		...recordedBareFingerprint,
		...purgedByPin
	].map(renderScopedCacheFingerprint);
	const scanTally = emptyScopedCacheScanTally();
	if (!await purgeOrRecord(async () => {
		const [bound, swept] = await Promise.all([options.rowFingerprints === void 0 ? 0 : purgeScopedCacheFingerprintIndex(cache, collection, options.rowFingerprints, options.changed ?? null, options.indexPath ?? null, options.includeBareFingerprint !== false, scanTally), purgeScopedCacheDeclaredFingerprints(cache, collection, purgedByPin, options.indexPath ?? null, context, options.changedCollections ?? [], scanTally)]);
		evicted = bound + swept;
	}, {
		mode: "slices",
		collection,
		scopedCacheFingerprints: recordedFingerprints
	})) return purgedScopedCacheFingerprints;
	const purgedPinKeys = scopedCachePinKeys(purgedScopedCacheFingerprints);
	queueCachePurge({
		purgeId: options.scopedCachePurgeId,
		collection,
		mode: "slices",
		scopedCachePins: purgedPinKeys,
		scopedCachePinCount: purgedPinKeys.length,
		evicted,
		durationMs: Date.now() - startedAt,
		scopedCacheScan: cachePurgeScanOf(scanTally)
	});
	return purgedScopedCacheFingerprints;
}

//#endregion
export { clearResponseCache, countScopedCachePinMembers, dropScopedCacheIndex, flushResponseCache, indexScopedCacheEntry, purgeCollectionScopedCache, purgeScopedCache, reapScopedCacheIndex, releaseStrandedScopedCacheSweeps, retryPendingScopedCachePurges, scopedCacheCollectionsChangedByOnDelete, startScopedCachePurgeRecovery, timedScanPages };