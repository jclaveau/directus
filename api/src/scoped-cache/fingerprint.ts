import type { ScopedCacheFingerprint, ScopedCacheTag } from '@directus/types';
import { canonicalScopedCacheValue } from './tags.js';

export type { ScopedCacheFingerprint } from '@directus/types';

/** The pair naming what the read selected, sorted or filtered on. */
export const SCOPED_CACHE_FINGERPRINT_FIELDS = 'fields';

/** The `fields` value a read of every column carries: any write touches it. */
export const SCOPED_CACHE_ANY_FIELD = '*';

// `&` separates pairs, `,` wraps and separates a pair's values, `|` joins a
// fingerprint to its cache key inside an index member, and `\` escapes all four. A
// value carrying one raw would end its pair early — or, worse, read as two values,
// which widens the OR and purges entries no write reached.
const RESERVED = /[\\,&|]/g;

export function escapeScopedCacheFingerprintToken(token: string): string {
	return token.replace(RESERVED, (character) => `\\${character}`);
}

export function unescapeScopedCacheFingerprintToken(token: string): string {
	return token.replace(/\\(.)/g, '$1');
}

/**
 * Split on a separator the escapes do not cover, keeping the escapes in the parts
 * so each can be unescaped on its own. A plain `String.split` cannot: it cuts at an
 * escaped separator too, and a value carrying `&` would come back as two pairs.
 */
function splitUnescaped(input: string, separator: string): string[] {
	const parts: string[] = [];
	let current = '';
	let escaped = false;

	for (const character of input) {
		if (escaped) {
			current += `\\${character}`;
			escaped = false;
			continue;
		}

		if (character === '\\') {
			escaped = true;
			continue;
		}

		if (character === separator) {
			parts.push(current);
			current = '';
			continue;
		}

		current += character;
	}

	parts.push(current);

	return parts;
}

/**
 * Render a query case as a fingerprint. `fields` rides as a pair of its own so the
 * write side reads it back the same way it reads a pin, and is left out entirely
 * when the caller names none — a serialised ROW has pairs and no fields.
 */
export function renderScopedCacheFingerprint(
	collection: string,
	pairs: ReadonlyMap<string, readonly string[]>,
	fields: readonly string[] = [],
): ScopedCacheFingerprint {
	const rendered = new Map<string, readonly string[]>(pairs);

	if (fields.length > 0) {
		rendered.set(SCOPED_CACHE_FINGERPRINT_FIELDS, fields);
	}

	let fingerprint = `${collection}:`;

	for (const key of [...rendered.keys()].sort()) {
		const values = [
			...new Set(rendered.get(key)!.map(escapeScopedCacheFingerprintToken)),
		].sort();

		fingerprint += `&${escapeScopedCacheFingerprintToken(key)}=,`
			+ `${values.join(',')},`;
	}

	return `${fingerprint}&`;
}

export type ParsedScopedCacheFingerprint = {
	collection: string;
	/** Every pair but `fields`, values unescaped. */
	pairs: Map<string, string[]>;
	fields: string[];
};

export function parseScopedCacheFingerprint(
	fingerprint: ScopedCacheFingerprint,
): ParsedScopedCacheFingerprint {
	// On the FIRST colon: a collection name carries none, and a value may.
	const colonAt = fingerprint.indexOf(':');

	const collection = colonAt === -1
		? fingerprint
		: fingerprint.slice(0, colonAt);

	const pairs = new Map<string, string[]>();
	let fields: string[] = [];

	const body = colonAt === -1
		? ''
		: fingerprint.slice(colonAt + 1);

	for (const pair of splitUnescaped(body, '&')) {
		if (pair === '') {
			continue;
		}

		// On the FIRST `=`, for the same reason the collection splits on the first
		// colon: a key never carries one, a value can.
		const assignAt = pair.indexOf('=');

		if (assignAt === -1) {
			continue;
		}

		const key = unescapeScopedCacheFingerprintToken(pair.slice(0, assignAt));

		// The wrapping commas are separators, not values: `,a,b,` is two values.
		const values = splitUnescaped(pair.slice(assignAt + 1), ',')
			.slice(1, -1)
			.map(unescapeScopedCacheFingerprintToken);

		if (key === SCOPED_CACHE_FINGERPRINT_FIELDS) {
			fields = values;
			continue;
		}

		pairs.set(key, values);
	}

	return { collection, pairs, fields };
}

export function scopedCacheFingerprintCollection(
	fingerprint: ScopedCacheFingerprint,
): string {
	const colonAt = fingerprint.indexOf(':');

	return colonAt === -1
		? fingerprint
		: fingerprint.slice(0, colonAt);
}

/**
 * The fingerprint a set of one collection's tags composes to.
 *
 * The pinners still derive tags — a read's query case is assembled from a dozen
 * different places, each of which knows one slice — and this is where those
 * slices stop being an OR and become the AND they always described. Several tags
 * on the SAME field are one pair listing both values, which is what an `_in`
 * filter and a set of nested parent keys both mean.
 */
export function scopedCacheFingerprintFromTags(
	collection: string,
	tags: readonly ScopedCacheTag[],
	fields: readonly string[] = [],
): ScopedCacheFingerprint {
	const pairs = new Map<string, string[]>();

	for (const tag of tags) {
		if (tag.field === undefined) {
			continue;
		}

		const values = pairs.get(tag.field) ?? [];
		values.push(canonicalScopedCacheValue(tag.value, tag.type));
		pairs.set(tag.field, values);
	}

	return renderScopedCacheFingerprint(collection, pairs, fields);
}

/**
 * The fingerprint rendered back into the tag labels the dev headers carried before
 * composite tags — `collection:field=value`, one per value, `fields` dropped, and
 * the bare collection when the fingerprint pins nothing.
 *
 * Kept so the behaviour this refactor preserves can be asserted by the blackbox
 * tests that already assert it, byte for byte. Moving the headers to the composite
 * form is a separate change.
 */
export function scopedCacheFingerprintLabels(
	fingerprint: ScopedCacheFingerprint,
): string[] {
	const { collection, pairs } = parseScopedCacheFingerprint(fingerprint);
	const labels: string[] = [];

	for (const [field, values] of pairs) {
		for (const value of values) {
			labels.push(`${collection}:${field}=${value}`);
		}
	}

	return labels.length === 0
		? [collection]
		: labels;
}

/**
 * Whether every pair of the fingerprint holds on one row.
 *
 * The row is serialised as a fingerprint of its own (one value per pair, no
 * `fields`), so the test is a plain substring search per value: the wrapping
 * commas make `&owner=,alpha,` unable to match a row whose owner is `alphabet`,
 * and the leading `&` makes it unable to match a `parent.owner` pair. Which is
 * why the purge needs no globs and no cap over them: the compare is exact, so
 * there is nothing to widen and nothing to bound.
 */
export function scopedCacheFingerprintMatchesRow(
	fingerprint: ScopedCacheFingerprint,
	rowFingerprint: ScopedCacheFingerprint,
): boolean {
	const { pairs } = parseScopedCacheFingerprint(fingerprint);
	const row = rowFingerprint.slice(rowFingerprint.indexOf(':') + 1);

	for (const [field, values] of pairs) {
		const key = escapeScopedCacheFingerprintToken(field);

		const holds = values.some((value) => {
			const token = escapeScopedCacheFingerprintToken(value);
			return row.includes(`&${key}=,${token},`);
		});

		if (!holds) {
			return false;
		}
	}

	return true;
}

/**
 * Whether the write touched a field the read is bound to.
 *
 * `changed === null` is an insert or a delete: the row entered or left the result
 * set, whichever columns it carries. An update only reaches a read that selected,
 * sorted or filtered on one of the columns it rewrote.
 *
 * A nested change (`method_range.method`) is named by an exact entry, by the
 * wildcard of any of its prefixes (`method_range.*`), or by `*`; a bare
 * `method_range` — the fk column alone — is not it.
 */
export function scopedCacheFingerprintFieldsTouched(
	fields: readonly string[],
	changed: readonly string[] | null,
): boolean {
	// A read naming no field is bound to all of them: the fail-safe direction is
	// the over-purge, never the stale hit.
	if (changed === null || fields.length === 0) {
		return true;
	}

	const queryCase = new Set(fields);

	if (queryCase.has(SCOPED_CACHE_ANY_FIELD)) {
		return true;
	}

	for (const field of changed) {
		if (queryCase.has(field)) {
			return true;
		}

		const segments = field.split('.');

		for (let depth = segments.length - 1; depth > 0; depth--) {
			if (queryCase.has(`${segments.slice(0, depth).join('.')}.*`)) {
				return true;
			}
		}
	}

	return false;
}

/**
 * One fingerprint per way the read matches — per query case, not per collection.
 *
 * A query case holds the tags that had to hold TOGETHER on one collection: a
 * filter of `owner=alpha AND method=spaced` is one query case of two pairs, and
 * the entry it files is dropped only by a write satisfying both. An `_or` across
 * two fields is two query cases instead, since a row matching either changes the
 * response, and one fingerprint ANDing them would match neither.
 *
 * The tags a collection carries from anywhere else — a nested node's slice, an
 * ancestor's key, a hook's own tag — each stand alone the way a tag sweep reads
 * them, so each is a query case of its own.
 *
 * A query case naming no field pins nothing, so its fingerprint carries no pair
 * and every row of that collection matches — which is what a bare tag means. Its
 * fields still narrow it: a write touching none of them cannot change the
 * response, whether or not the read could say which rows it depends on.
 *
 * Query cases are rendered in the order they come in, deduplicated, so a read's
 * fingerprints come back stable without sorting what the caller may have ordered
 * on purpose.
 */
export function scopedCacheFingerprintsByCollection(
	queryCases: readonly (readonly ScopedCacheTag[])[],
	fieldsByCollection: ReadonlyMap<string, readonly string[]> = new Map(),
): ScopedCacheFingerprint[] {
	const rendered = new Set<ScopedCacheFingerprint>();

	for (const queryCase of queryCases) {
		const collection = queryCase[0]?.collection;

		if (collection === undefined) {
			continue;
		}

		rendered.add(scopedCacheFingerprintFromTags(
			collection,
			queryCase,
			fieldsByCollection.get(collection) ?? [],
		));
	}

	return [...rendered];
}

/**
 * A flat tag list read as query cases: each tag on its own, which is how a tag
 * sweep reads them — any one of them reproduced by a write drops the entry.
 *
 * What a caller with no query cases of its own hands over, and the fail-safe
 * direction: a conjunction read this way over-purges, while query cases read as a
 * conjunction that was never one serves stale.
 */
export function scopedCacheQueryCasesFromTags(
	tags: readonly ScopedCacheTag[],
): ScopedCacheTag[][] {
	return tags.map((tag) => [tag]);
}

/**
 * Whether a write purges a read: the whole write-side rule, in one call.
 *
 * Two tests, both of which have to hold.
 *
 * The write touched a field the read is bound to — an insert or a delete always
 * does, since the row entered or left the result set whichever columns it
 * carries, and an update only when it rewrote a column the read selected, sorted
 * or filtered on.
 *
 * And one of the rows it wrote satisfies the read's whole query case.
 * `rowFingerprints` carries the row as it was AND as it became, so a row moving
 * INTO the read's slice purges it on its new values and one moving OUT on its old
 * ones — each of them changes the response, and neither is visible from the other
 * side alone.
 */
export function scopedCacheFingerprintPurgedBy(
	fingerprint: ScopedCacheFingerprint,
	rowFingerprints: readonly ScopedCacheFingerprint[],
	changed: readonly string[] | null,
): boolean {
	const { pairs, fields } = parseScopedCacheFingerprint(fingerprint);

	// Every field the read pinned to a value is a field it is bound to, whether or
	// not it also selected it: a write moving a row across one of them moves it in
	// or out of the result set, which is a changed response by itself. Added only
	// beside declared fields, since naming none already means every field.
	const queryCase = fields.length === 0
		? fields
		: [...fields, ...pairs.keys()];

	if (scopedCacheFingerprintFieldsTouched(queryCase, changed) === false) {
		return false;
	}

	// Escaped once for every row rather than once per row: a purge tests one
	// fingerprint against every row of a batch, and the needles do not vary.
	const needles = [...pairs].map(([field, values]) => {
		const key = escapeScopedCacheFingerprintToken(field);

		return values.map((value) => {
			return `&${key}=,${escapeScopedCacheFingerprintToken(value)},`;
		});
	});

	return rowFingerprints.some((rowFingerprint) => {
		const row = rowFingerprint.slice(rowFingerprint.indexOf(':') + 1);

		return needles.every((alternatives) => {
			return alternatives.some((needle) => row.includes(needle));
		});
	});
}
