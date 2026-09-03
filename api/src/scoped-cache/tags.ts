import { useEnv } from '@directus/env';
import type {
	SchemaOverview,
	ScopedCacheCollector,
	ScopedCacheTag,
	Type,
} from '@directus/types';

const env = useEnv();

/**
 * A per-operation collector backing the `context.scopedCache` hook handle. The
 * service wires ONE of `scope`/`purge` as `context.scopedCache` per the filter event
 * (read → `scope.scopeTo`, mutation → `purge.purgeBy`); the hook pushes via it and
 * the service drains `tags` into the read's scope or the mutation's purge tags. Both
 * are the same idempotent sink. Safe with purging off (then `tags` is unread).
 */
export function createScopedCacheCollector(
	schema: SchemaOverview,
): ScopedCacheCollector {
	const tags: ScopedCacheTag[] = [];
	const seen = new Set<string>();
	const manuallyPurgedKeys = new Set<string>();
	const purgeSkippedKeys = new Set<string>();

	// A hook names a slice by collection/field/value and rarely knows the column's
	// type, but the type is what canonicalizes the value: `uuid` lowercases and
	// `integer` strips a leading zero, so a type-less tag and the schema-typed one
	// the purge side emits resolve DIFFERENT keys for the SAME row — a pin nothing
	// ever purges. Fill it from the schema so both sides agree.
	function withSchemaType(tag: ScopedCacheTag): ScopedCacheTag {
		if (tag.type !== undefined || tag.field === undefined) {
			return tag;
		}

		const schemaType = schema.collections[tag.collection]?.fields[tag.field]?.type;

		return schemaType === undefined
			? tag
			: { ...tag, type: schemaType };
	}

	function add(
		input: ScopedCacheTag | readonly ScopedCacheTag[],
		manuallyPurged = false,
	): void {
		const batch = Array.isArray(input)
			? input
			: [input];

		for (const declaredTag of batch) {
			const tag = withSchemaType(declaredTag);

			// Idempotent: a hook looping over rows that resolve the same slice — or a
			// batch/upsert parent's shared collector fed by many children — must not
			// inflate the set. Key on the canonical tag key (the same one the purge side
			// dedups on), so field order and value/type variants (7 vs '7') can't slip a
			// duplicate past a raw JSON compare.
			const key = scopedCacheTagKey(tag);

			// Record the accept regardless of dedup: if ANY scopeTo of this tag marked it
			// manuallyPurged, it's exempt from the unautopurgeable-scope anomaly.
			if (manuallyPurged) {
				manuallyPurgedKeys.add(key);
			}

			if (seen.has(key)) {
				continue;
			}

			seen.add(key);
			tags.push(tag);
		}
	}

	return {
		tags,
		manuallyPurgedKeys,
		purgeSkippedKeys,
		scope: { scopeTo: (input, options) => add(input, options?.manuallyPurged) },
		purge: {
			purgeBy: (input) => add(input),
			// Deliberately not a tag: the take-over check reads the tag count, and
			// declaring nothing to purge must not read as declaring a purge.
			skipPurgeFor: (key) => {
				purgeSkippedKeys.add(String(key));
			},
		},
	};
}

// Canonicalize a scope value to a driver-stable token so a REST/GraphQL filter value
// and the native DB row value resolve the SAME slice. `String()` alone collapses the
// common case (number 7 vs string "7"), but diverges for non-string scalars — a
// boolean is `true` from a parsed filter but `1`/`0` (mysql/sqlite) or `'t'` (pg)
// from a stored row; a datetime is an ISO string from a filter but a `Date` from the
// driver; a decimal is `1.5` vs `'1.50'`. NULL gets a null-byte sentinel rather than
// String(null)='null', so it can't collide with a literal "null" value.
export function canonicalScopedCacheValue(
	value: unknown,
	type: Type | undefined,
): string {
	if (value === null || value === undefined) {
		return '\x00null';
	}

	if (type === 'boolean') {
		const truthy = value === true || value === 1 || value === '1'
			|| value === 't' || value === 'true';

		return truthy
			? 'true'
			: 'false';
	}

	// `time` has no date component, so it stays a plain string (both sides give
	// `HH:MM:SS`).
	if (type === 'date' || type === 'dateTime' || type === 'timestamp') {
		const ms = value instanceof Date
			? value.getTime()
			: Date.parse(String(value));

		return Number.isNaN(ms)
			? String(value)
			: String(ms);
	}

	// A uuid is compared case-insensitively by the DB, so both spellings name one row
	// and must name one slice. Neither side normalizes for us — `validateKeys` accepts
	// either case without rewriting it — so the token would otherwise be whatever the
	// caller sent: an iOS client reading `UUID().uuidString` (uppercase) against a
	// web client writing lowercase would pin and purge different keys → stale HIT.
	if (type === 'uuid') {
		return String(value).toLowerCase();
	}

	// integer/bigInteger normalize the SPELLING but never go through `Number`: past
	// MAX_SAFE_INTEGER a numeric pass corrupts the value, so leading zeros and a
	// leading `+` are stripped as string surgery. `01`, `+1`, `0001` and a driver's
	// `1` are one key to the DB, so they must not resolve different slices. Anything
	// that isn't a plain integer keeps its string form rather than becoming empty.
	if (type === 'integer' || type === 'bigInteger') {
		const raw = String(value).trim();
		const digits = /^([+-]?)0*(\d+)$/.exec(raw);

		if (digits === null) {
			// Spellings `validateKeys` still lets through, since it only asks
			// `Number.isInteger(Number(key))`: `1e3`, `0x10`, `1.0`. Normalize through
			// `Number` when it round-trips safely; past MAX_SAFE_INTEGER no token can be
			// right, and such a key cannot have matched a row either, so keep it raw.
			const num = Number(raw);

			return raw !== '' && Number.isSafeInteger(num)
				? String(num)
				: raw;
		}

		// `-0` is zero; only a non-zero magnitude keeps the sign.
		const sign = digits[1] === '-' && digits[2] !== '0'
			? '-'
			: '';

		return `${sign}${digits[2]}`;
	}

	// Only fixed-scale types need the numeric pass (`'1.50'` vs `1.5`).
	if (type === 'decimal' || type === 'float') {
		const num = Number(value);

		return Number.isFinite(num)
			? String(num)
			: String(value);
	}

	return String(value);
}

/** Each field of a collection mapped to its schema type, or undefined when the
 * schema does not carry it. What canonicalizes a tag value on both sides. */
export type FieldTypesByField = Record<string, Type | undefined>;

// Types whose filter value and stored row value are NOT guaranteed to canonicalize
// to the same token across drivers/timezones: a naive `dateTime`/`timestamp` column
// comes back as a local `Date` from the driver but as an ISO string (possibly with
// an explicit `Z`) from a filter, so the epoch-ms canonical can diverge. The read
// side never pins these — it falls back to the bare collection tag so any write to
// the collection invalidates the read (over-purge, never stale).
export const PIN_UNSAFE_SCOPE_TYPES = new Set<Type>([
	'date',
	'dateTime',
	'timestamp',
]);

export function isPinnableScopeType(type: Type | undefined): boolean {
	return !PIN_UNSAFE_SCOPE_TYPES.has(type as Type);
}

export function scopedCacheTagKey(tag: ScopedCacheTag): string {
	const base = `${env['CACHE_NAMESPACE']}:tag:${tag.collection}`;
	return tag.field === undefined
		? base
		: `${base}:${tag.field}=${canonicalScopedCacheValue(tag.value, tag.type)}`;
}

// Render scope tags for the dev-only `X-Scoped-Cache-*` headers: each tag as its
// key suffix (no `<namespace>:tag:` prefix) — `collection`, or `collection:field=
// value` for a pinned slice (same canonical value as the Redis key). Comma-joined.
export function scopedCacheTagLabel(tag: ScopedCacheTag): string {
	if (tag.field === undefined) {
		return tag.collection;
	}

	return `${tag.collection}:${tag.field}=${
		canonicalScopedCacheValue(tag.value, tag.type)
	}`;
}

export function serializeScopedCacheTags(tags: readonly ScopedCacheTag[]): string {
	return tags
		.map(scopedCacheTagLabel)
		.join(', ');
}

/**
 * Build scoped cache tags from the distinct scope values present across `rows` — the
 * purge side.
 *
 * - `onUnresolvable`: what to do when a row is missing a scoped-cache-field *key*.
 * `'coarse'` returns `null` so the caller can fall back to a collection-wide purge
 * rather than leave a slice stale; `'skip'` best-effort skips just that row's
 * contribution. - The `'coarse'` path triggers for a caller feeding *unprojected*
 * rows. The purge side (`snapshotScopedCacheTags`) reads rows via an explicit
 * projected `select`, so every field key is always present and it never returns
 * `null` there — an update/delete/create snapshot always resolves. A create whose
 * committed rows can't be trusted is caught upstream by the row-count check
 * (`someRowTakenOver`), not here. - The read side
 * (`pinnedScopedCacheTagsFromM2oParents`) is the caller that depends on the `null`:
 * one parent row missing its key has to take its whole collection down to the bare
 * tag, since pinning the rest would leave that row covered by nothing. -
 * `fieldTypes`: each field's schema type, so the tag value canonicalizes the same
 * way the read side's filter value does.
 */
export function scopedCacheTagsFromRows(
	collection: string,
	fields: string[],
	rows: Record<string, any>[],
	onUnresolvable: 'skip',
	fieldTypes?: FieldTypesByField,
): ScopedCacheTag[];
export function scopedCacheTagsFromRows(
	collection: string,
	fields: string[],
	rows: Record<string, any>[],
	onUnresolvable: 'coarse',
	fieldTypes?: FieldTypesByField,
): ScopedCacheTag[] | null;
export function scopedCacheTagsFromRows(
	collection: string,
	fields: string[],
	rows: Record<string, any>[],
	onUnresolvable: 'coarse' | 'skip',
	fieldTypes: FieldTypesByField = {},
): ScopedCacheTag[] | null {
	const tags: ScopedCacheTag[] = [];

	for (const field of fields) {
		// Dedup on the canonical token, not the raw value, so `7` and `'7'` (or a
		// boolean stored as `1`/`'t'`) collapse to one tag instead of emitting redundant
		// slices.
		const seen = new Set<string>();

		for (const row of rows) {
			if (!(field in row)) {
				if (onUnresolvable === 'coarse') {
					return null;
				}

				continue;
			}

			const value = row[field];
			const token = canonicalScopedCacheValue(value, fieldTypes[field]);

			if (seen.has(token)) {
				continue;
			}

			seen.add(token);
			tags.push({ collection, field, value, type: fieldTypes[field] });
		}
	}

	return tags;
}

/**
 * How many slices one nested collection may pin on a single read. Every tag costs
 * a Redis set plus a slice-index member, and the write side deletes them one by one.
 *
 * Sized above a default page of nested parents (the default `limit` is 100), below
 * an import-sized one. NOT the bound
 * https://github.com/jclaveau/directus/issues/392 is deciding, though both coarsen
 * rather than fan out and both fail toward over-purge:
 *
 * - #392 bounds what a WRITE emits, forced by Postgres's 65 535 bind parameters,
 *   and picks its number from the purge crossover. Above it a whole collection's
 *   cache goes.
 * - This bounds what a READ attaches. Nothing structural forces it, and a read
 *   never purges — so the crossover #392 measures does not apply. Above it this
 *   one response loses its pin and is still cached.
 *
 * Operator-tunable because the right number is deployment-specific — it weighs
 * Redis memory against the hit ratio the pin buys, and a pin costs a tag set plus a
 * member of the collection's slice index (130 B measured, on a TTL every write
 * refreshes). No setting of it can serve a stale row.
 */
export function scopedCacheMaxPinsPerCollection(): number {
	return env['CACHE_SCOPED_MAX_PINS_PER_COLLECTION'] as number;
}
