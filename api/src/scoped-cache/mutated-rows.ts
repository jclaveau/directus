import type {
	Item,
	PrimaryKey,
	ScopedCacheFingerprint,
	ScopedCacheTag,
} from '@directus/types';

/**
 * A row a mutation wrote, read from the database rather than from the payload.
 *
 * The fingerprint holds the axes a read can pin itself to — the primary key and
 * the scope fields — and the row holds every column, which is what the `changed`
 * diff below is computed from: a read binds the fields it selected, sorted and
 * filtered on, and any of them can be a column no scope ever names.
 *
 * `row: null` is a row whose columns were never read — a collection scoping on
 * nothing, whose fingerprint its primary key alone completes. Its pairs are
 * whole, so the purge still matches it exactly; only the `changed` diff is
 * unavailable, and an unknown diff reads as every field.
 */
export type ScopedCacheMutatedRow = {
	key: PrimaryKey;
	row: Item | null;
	fingerprint: ScopedCacheFingerprint;
};

/**
 * One read of the rows a mutation touches: the scope tags they sit in, and the
 * rows themselves. `tags: null` means their scope is unresolvable, so their
 * collection is purged whole.
 */
export type ScopedCacheCapture = {
	tags: ScopedCacheTag[] | null;
	rows: ScopedCacheMutatedRow[];
};

/**
 * A write, as the purge of its own collection reads it: every row it touched —
 * as it was, and as it became — and the fields it rewrote.
 *
 * Both sides are carried because a row moving INTO a read's slice changes the
 * response on its new values and one moving OUT of it on its old ones, and
 * neither is visible from the other side alone.
 */
export type ScopedCacheMutatedWrite = {
	fingerprints: ScopedCacheFingerprint[];
	/** `null` for an insert or a delete: the row entered or left the result set. */
	changed: string[] | null;
};

/**
 * The columns a write rewrote: the fields whose stored value differs between the
 * read taken before it and the one taken after it commits.
 *
 * Read from the rows and not from the payload on purpose. A payload is partial, a
 * hook can rewrite it, a column left out can still move on a database default or
 * a trigger, and a stored value can diverge from what was sent by coercion alone
 * (#363). The two reads say what actually changed; the payload says what was asked.
 *
 * `null` means "every field": a row present on one side only entered or left the
 * result set whichever columns it carries, so does a batch whose two sides do not
 * even hold the same number of rows, and so does a row whose columns were never
 * read — an unknown diff has to read as every field, never as none.
 */
export function scopedCacheChangedFields(
	before: readonly ScopedCacheMutatedRow[],
	after: readonly ScopedCacheMutatedRow[],
): string[] | null {
	if (before.length !== after.length) {
		return null;
	}

	const rowsBefore = new Map(before.map(({ key, row }) => [String(key), row]));
	const changedKeys = new Set<string>();

	for (const { key, row } of after) {
		const previousRow = rowsBefore.get(String(key));

		if (previousRow === undefined || previousRow === null || row === null) {
			return null;
		}

		const columnNames = new Set([...Object.keys(previousRow), ...Object.keys(row)]);

		for (const column of columnNames) {
			if (sameStoredValue(previousRow[column], row[column]) === false) {
				changedKeys.add(column);
			}
		}
	}

	return [...changedKeys].sort();
}

/**
 * Whether the two stored values are the same one.
 *
 * `===` alone cannot say it: a driver hands a timestamp back as a fresh `Date`
 * and a json column as a fresh object, so the same stored value compares
 * different on identity and every such column would read as rewritten.
 */
function sameStoredValue(before: unknown, after: unknown): boolean {
	if (before instanceof Date || after instanceof Date) {
		return before instanceof Date
			&& after instanceof Date
			&& before.getTime() === after.getTime();
	}

	if (
		typeof before === 'object' && before !== null
		&& typeof after === 'object' && after !== null
	) {
		return JSON.stringify(before) === JSON.stringify(after);
	}

	return before === after;
}

/**
 * What an insert or a delete shows the purge for itself: the rows it wrote, and
 * no `changed` — the row entered or left the result set whichever columns it
 * carries, so every read whose query case it satisfies is stale.
 *
 * Nothing when the capture could not resolve the rows' scope: that purge is the
 * collection-wide one, which has no use for them.
 */
export function scopedCacheWrittenRows(
	capture: ScopedCacheCapture,
): ScopedCacheMutatedWrite | undefined {
	if (capture.tags === null || capture.rows.length === 0) {
		return undefined;
	}

	return {
		fingerprints: capture.rows.map(({ fingerprint }) => fingerprint),
		changed: null,
	};
}

/**
 * What an update shows it: both sides of every row it rewrote, and the columns
 * that actually moved between them.
 */
export function scopedCacheUpdatedRows(
	before: ScopedCacheCapture,
	after: ScopedCacheCapture,
): ScopedCacheMutatedWrite | undefined {
	if (before.tags === null || after.tags === null) {
		return undefined;
	}

	if (before.rows.length === 0 && after.rows.length === 0) {
		return undefined;
	}

	return {
		fingerprints: [
			...before.rows.map(({ fingerprint }) => fingerprint),
			...after.rows.map(({ fingerprint }) => fingerprint),
		],
		changed: scopedCacheChangedFields(before.rows, after.rows),
	};
}
