import { useLogger } from "./logger/index.js";
import database_default from "./database/index.js";

//#region src/scoped-cache-pending-purges.ts
const TABLE = "directus_scoped_cache_pending_purges";
/**
* Record a purge that failed AFTER its mutation committed, so a later drain can
* finish it.
*
* Its own file for the seam, not for the module graph: `scoped-cache.ts` imports
* it statically, so knex is in that graph either way. What the split buys is that
* the four functions below are the whole of this feature's database access, which
* is what `scoped-cache.test.ts` mocks to drive the drain — folded into
* `scoped-cache.ts` those tests would have to mock knex instead.
*
* A target is stored as its rendered fingerprint, never as a Redis key: a key
* embeds `CACHE_NAMESPACE`, and a namespace change between the failure and the
* retry would leave a row aimed at a key nothing reads.
*
* Best-effort by construction, and its own failure is swallowed for the reason
* the caller's was: the mutation has already committed, so throwing here would
* turn a stale cache entry into a 500 for a write that succeeded. A record lost
* this way leaves the entry stale until its TTL, which is what happened for every
* failure before this table existed.
*/
async function recordPendingScopedCachePurge(purge, error) {
	const recorded = purge.scopedCacheFingerprints.length > 0 ? purge.scopedCacheFingerprints : [null];
	try {
		await database_default()(TABLE).insert(recorded.map((fingerprint) => {
			return {
				failed_at: /* @__PURE__ */ new Date(),
				mode: purge.mode,
				collection: purge.collection,
				scoped_cache_fingerprint: fingerprint,
				attempts: 0,
				last_error: errorText(error)
			};
		}));
	} catch (recordError) {
		useLogger().warn(recordError, `[scoped-cache] could not record a failed purge for retry: ${recordError}`);
	}
}
/**
* Every pending purge, oldest first, collapsed to one entry per mode and
* collection: an outage records the same slice once per write that touched it,
* and retrying one slice N times is wasted round trips rather than a wrong
* result. Each entry carries the row ids it stands for so the drain can clear all
* of them together.
*
* Slices of one collection share an entry rather than each taking its own: the
* retry cannot tell which sets the schema filed a fingerprint under, so it scans
* every set of the collection, and one scan per recorded slice repeated that
* keyspace-wide scan for each.
*/
async function listPendingScopedCachePurges() {
	const rows = await database_default()(TABLE).select("id", "mode", "collection", "scoped_cache_fingerprint").orderBy("id", "asc");
	const byTarget = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const target = `${row.mode} ${row.collection ?? ""}`;
		const fingerprint = row.scoped_cache_fingerprint;
		const seen = byTarget.get(target);
		if (seen !== void 0) {
			seen.ids.push(row.id);
			if (fingerprint !== null && seen.scopedCacheFingerprints.includes(fingerprint) === false) seen.scopedCacheFingerprints.push(fingerprint);
			continue;
		}
		byTarget.set(target, {
			mode: row.mode,
			collection: row.collection,
			scopedCacheFingerprints: fingerprint === null ? [] : [fingerprint],
			ids: [row.id]
		});
	}
	return [...byTarget.values()];
}
/** Drop the rows a retry finished with. */
async function clearPendingScopedCachePurges(ids) {
	if (ids.length === 0) return;
	await database_default()(TABLE).whereIn("id", ids).delete();
}
/**
* Count a failed retry against the rows it could not finish. A diagnostic, never
* a give-up counter: a purge is idempotent, and the alternative to retrying it
* forever is an entry that stays stale forever.
*/
async function countFailedScopedCachePurgeRetry(ids, error) {
	if (ids.length === 0) return;
	await database_default()(TABLE).whereIn("id", ids).update({ last_error: errorText(error) }).increment("attempts", 1);
}
function errorText(error) {
	return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

//#endregion
export { clearPendingScopedCachePurges, countFailedScopedCachePurgeRetry, listPendingScopedCachePurges, recordPendingScopedCachePurge };