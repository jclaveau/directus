import type { CachePurgeMode } from '@directus/types';
import { cacheSetting } from './cache-settings.js';
import getDatabase from './database/index.js';
import { useLogger } from './logger/index.js';
import { parseScopedCacheFingerprint } from './scoped-cache/fingerprint.js';

const TABLE = 'directus_scoped_cache_pending_purges';

/**
 * How many fingerprints of one collection a retry replays one by one. Past it,
 * the retry purges the collection whole: every cached entry of the collection is
 * matched against every recorded fingerprint, so a precise retry costs entries
 * times fingerprints, while a collection purge costs the entries alone.
 *
 * Measured by `tests/perf/pending-retry.perf.test.ts`: both costs grow with the
 * entries cached, and they cross at about 35 fingerprints whatever that number.
 * Over 10 000 entries, 101 fingerprints drained in 771 ms holding the event loop
 * 40 ms at most, and 1001 in 5.1 s holding it 273 ms, where a collection purge
 * took 352 ms holding it 15 ms. Over 100 000 entries, 101 held it 68 ms and 1001
 * held it 400 ms; the collection purge was not measured there. The default is
 * set by that loop block, not by the crossover.
 *
 * A write records one fingerprint per key plus the bare one, so the default
 * keeps a write of up to 99 keys precise: a full batch of 100 is retried as its
 * whole collection.
 */
export function scopedCachePurgeRetryMaxFingerprints(): number {
	return cacheSetting('scoped_purge_retry_max_fingerprints');
}

// Ids per statement, well under Postgres' 65535 bind parameters.
const ID_CHUNK_SIZE = 10_000;

export interface PendingScopedCachePurge {
	mode: CachePurgeMode;
	collection: string | null;
	scopedCacheFingerprints: string[];
}

export interface PendingScopedCachePurgeRow extends PendingScopedCachePurge {
	ids: number[];
}

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
export async function recordPendingScopedCachePurge(
	purge: PendingScopedCachePurge,
	error: unknown,
): Promise<void> {
	try {
		const recordedRows = pendingScopedCachePurgeRows(purge)
			.map((pendingRow) => {
				return {
					failed_at: new Date(),
					mode: pendingRow.mode,
					collection: pendingRow.collection,
					// Serialized by hand: the pg driver sends a JS array as a Postgres
					// array literal, which a json column refuses.
					scoped_cache_fingerprints:
						pendingRow.scopedCacheFingerprints.length > 0
							? JSON.stringify(pendingRow.scopedCacheFingerprints)
							: null,
					attempts: 0,
					last_error: errorText(error),
				};
			});

		await getDatabase()(TABLE).insert(recordedRows);
	}
	catch (recordError: any) {
		// An error, not a warning: the entries this record stood for stay stale
		// until their TTL, with nothing else coming for them.
		useLogger().error(
			recordError,
			`[scoped-cache] could not record a failed purge for retry: ${recordError}`,
		);
	}
}

/**
 * The rows one failed purge is recorded as: one, holding every fingerprint it
 * named, plus one collection-mode row per collection it named more fingerprints
 * of than a retry replays one by one. A coarse purge names no fingerprint, so it
 * is one row carrying only its mode and collection; `namespace` carries neither.
 */
function pendingScopedCachePurgeRows(
	purge: PendingScopedCachePurge,
): PendingScopedCachePurge[] {
	if (purge.mode !== 'slices') {
		return [{ ...purge, scopedCacheFingerprints: [] }];
	}

	const fingerprintsByCollection = new Map<string, string[]>();

	for (const fingerprint of new Set(purge.scopedCacheFingerprints)) {
		const { collection } = parseScopedCacheFingerprint(fingerprint);
		const collectionFingerprints = fingerprintsByCollection.get(collection) ?? [];

		collectionFingerprints.push(fingerprint);
		fingerprintsByCollection.set(collection, collectionFingerprints);
	}

	const keptFingerprints: string[] = [];
	const coarsenedRows: PendingScopedCachePurge[] = [];

	for (const [collection, fingerprints] of fingerprintsByCollection) {
		if (fingerprints.length > scopedCachePurgeRetryMaxFingerprints()) {
			coarsenedRows.push({
				mode: 'collection',
				collection,
				scopedCacheFingerprints: [],
			});

			continue;
		}

		keptFingerprints.push(...fingerprints);
	}

	if (keptFingerprints.length === 0 && coarsenedRows.length > 0) {
		return coarsenedRows;
	}

	return [
		{ ...purge, scopedCacheFingerprints: keptFingerprints },
		...coarsenedRows,
	];
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
export async function listPendingScopedCachePurges(): Promise<
	PendingScopedCachePurgeRow[]
> {
	const rows = await getDatabase()(TABLE)
		.select('id', 'mode', 'collection', 'scoped_cache_fingerprints')
		.orderBy('id', 'asc');

	const byTarget = new Map<string, {
		mode: CachePurgeMode;
		collection: string | null;
		fingerprints: Set<string>;
		ids: number[];
	}>();

	for (const row of rows) {
		const target = `${row.mode} ${row.collection ?? ''}`;

		const seen = byTarget.get(target) ?? {
			mode: row.mode,
			collection: row.collection,
			fingerprints: new Set<string>(),
			ids: [] as number[],
		};

		seen.ids.push(row.id);

		const stored: string[] | string | null = row.scoped_cache_fingerprints;

		// Postgres hands a json column back parsed, SQLite as its text.
		const fingerprints: string[] = typeof stored === 'string'
			? JSON.parse(stored)
			: stored ?? [];

		for (const fingerprint of fingerprints) {
			seen.fingerprints.add(fingerprint);
		}

		byTarget.set(target, seen);
	}

	return [...byTarget.values()].map((pendingTarget) => {
		return {
			mode: pendingTarget.mode,
			collection: pendingTarget.collection,
			scopedCacheFingerprints: [...pendingTarget.fingerprints],
			ids: pendingTarget.ids,
		};
	});
}

/** Drop the rows a retry finished with. */
export async function clearPendingScopedCachePurges(ids: number[]): Promise<void> {
	if (ids.length === 0) {
		return;
	}

	for (let at = 0; at < ids.length; at += ID_CHUNK_SIZE) {
		await getDatabase()(TABLE)
			.whereIn('id', ids.slice(at, at + ID_CHUNK_SIZE))
			.delete();
	}
}

/**
 * Count a failed retry against the rows it could not finish. A diagnostic, never
 * a give-up counter: a purge is idempotent, and the alternative to retrying it
 * forever is an entry that stays stale forever.
 */
export async function countFailedScopedCachePurgeRetry(
	ids: number[],
	error: unknown,
): Promise<void> {
	if (ids.length === 0) {
		return;
	}

	for (let at = 0; at < ids.length; at += ID_CHUNK_SIZE) {
		await getDatabase()(TABLE)
			.whereIn('id', ids.slice(at, at + ID_CHUNK_SIZE))
			.update({ last_error: errorText(error) })
			.increment('attempts', 1);
	}
}

function errorText(error: unknown): string {
	const message = error instanceof Error
		? error.message
		: String(error);

	// The column is text, but an ioredis error can carry a whole command dump and
	// this is a diagnostic, not the payload.
	return message.slice(0, 500);
}
