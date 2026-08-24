import type { CachePurgeMode } from '@directus/types';
import getDatabase from './database/index.js';
import { useLogger } from './logger/index.js';

const TABLE = 'directus_scoped_cache_pending_purges';

export interface PendingScopedCachePurge {
	mode: CachePurgeMode;
	collection: string | null;
	scopedCacheTags: string[];
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
 * Tags are stored as their display labels, never as Redis keys: a key embeds
 * `CACHE_NAMESPACE`, and a namespace change between the failure and the retry
 * would leave a row aimed at a key nothing reads.
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
	// A coarse purge names no tag, so it is one row carrying only its mode and
	// collection. `namespace` carries neither.
	const scopedCacheTags: (string | null)[] = purge.scopedCacheTags.length > 0
		? purge.scopedCacheTags
		: [null];

	try {
		await getDatabase()(TABLE).insert(scopedCacheTags.map((scopedCacheTag) => {
			return {
				failed_at: new Date(),
				mode: purge.mode,
				collection: purge.collection,
				scoped_cache_tag: scopedCacheTag,
				attempts: 0,
				last_error: errorText(error),
			};
		}));
	}
	catch (recordError: any) {
		useLogger().warn(
			recordError,
			`[scoped-cache] could not record a failed purge for retry: ${recordError}`,
		);
	}
}

/**
 * Every pending purge, oldest first, collapsed to one entry per distinct target:
 * an outage records the same slice once per write that touched it, and retrying
 * one slice N times is wasted round trips rather than a wrong result. Each entry
 * carries the row ids it stands for so the drain can clear all of them together.
 */
export async function listPendingScopedCachePurges(): Promise<
	PendingScopedCachePurgeRow[]
> {
	const rows = await getDatabase()(TABLE)
		.select('id', 'mode', 'collection', 'scoped_cache_tag')
		.orderBy('id', 'asc');

	const byTarget = new Map<string, PendingScopedCachePurgeRow>();

	for (const row of rows) {
		const target =
			`${row.mode} ${row.collection ?? ''} ${row.scoped_cache_tag ?? ''}`;

		const seen = byTarget.get(target);

		if (seen !== undefined) {
			seen.ids.push(row.id);
			continue;
		}

		byTarget.set(target, {
			mode: row.mode,
			collection: row.collection,
			scopedCacheTags: row.scoped_cache_tag === null
				? []
				: [row.scoped_cache_tag],
			ids: [row.id],
		});
	}

	return [...byTarget.values()];
}

/** Drop the rows a retry finished with. */
export async function clearPendingScopedCachePurges(ids: number[]): Promise<void> {
	if (ids.length === 0) {
		return;
	}

	await getDatabase()(TABLE)
		.whereIn('id', ids)
		.delete();
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

	await getDatabase()(TABLE)
		.whereIn('id', ids)
		.update({ last_error: errorText(error) })
		.increment('attempts', 1);
}

function errorText(error: unknown): string {
	const message = error instanceof Error
		? error.message
		: String(error);

	// The column is text, but an ioredis error can carry a whole command dump and
	// this is a diagnostic, not the payload.
	return message.slice(0, 500);
}
