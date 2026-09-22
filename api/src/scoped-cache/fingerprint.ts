import type { ScopedCacheFingerprint, ScopedCacheTag } from '@directus/types';
import { canonicalScopedCacheValue, scopedCacheTagKey } from './tags.js';

export type { ScopedCacheFingerprint } from '@directus/types';

/** The pair naming what the read selected, sorted or filtered on. */
export const SCOPED_CACHE_FINGERPRINT_FIELDS = 'fields';

/** The `fields` value a read of every column carries: any write touches it. */
export const SCOPED_CACHE_ANY_FIELD = '*';

// In the serialised form `&` separates pairs, `,` wraps and separates a pair's
// values, `|` joins a fingerprint to its cache key inside an index member, and `\`
// escapes them all. A value carrying one raw would end its pair early — or, worse,
// read as two values, which widens the OR and purges entries no write reached.
//
// `*`, `?` and `[` are escaped for the search rather than for the grammar: the
// serialised form is what Redis glob-matches, so a value spelling one raw would
// make a pattern built around it match slices it never named.
const RESERVED = /[\\,&|*?[\]]/g;

export function escapeScopedCacheFingerprintToken(token: string): string {
	return token.replace(RESERVED, (reservedCharacter) => `\\${reservedCharacter}`);
}

export function unescapeScopedCacheFingerprintToken(token: string): string {
	return token.replace(/\\(.)/g, '$1');
}

// What Redis reads as a pattern rather than as text. A rendered token carries its
// own escapes — `a,b` is stored as `a\,b` — and a glob eats a backslash instead of
// matching it, so every one of them has to be doubled before the token can be
// dropped into a pattern.
const GLOB_RESERVED = /[\\*?[\]]/g;

function escapeScopedCacheFingerprintGlob(rendered: string): string {
	return rendered.replace(GLOB_RESERVED, (globCharacter) => `\\${globCharacter}`);
}

/**
 * Split on a separator the escapes do not cover, keeping the escapes in the parts
 * so each can be unescaped on its own. A plain `String.split` cannot: it cuts at an
 * escaped separator too, and a value carrying `&` would come back as two pairs.
 */
function splitUnescaped(input: string, separator: string): string[] {
	const splitParts: string[] = [];
	let currentPart = '';
	let escapePending = false;

	for (const reservedCharacter of input) {
		if (escapePending) {
			currentPart += `\\${reservedCharacter}`;
			escapePending = false;
			continue;
		}

		if (reservedCharacter === '\\') {
			escapePending = true;
			continue;
		}

		if (reservedCharacter === separator) {
			splitParts.push(currentPart);
			currentPart = '';
			continue;
		}

		currentPart += reservedCharacter;
	}

	splitParts.push(currentPart);

	return splitParts;
}

/**
 * A query case as the rest of the api holds it: the collection, the pairs that had
 * to hold together, and the fields the read is bound to.
 *
 * Every consumer but Redis reads it open like this — a pair is a map lookup, not a
 * substring search over a rendered string — so the serialiser below runs once, at
 * the index write, and the parser once, at the index read.
 */
export function scopedCacheFingerprint(
	collection: string,
	pairs: ReadonlyMap<string, readonly string[]> = new Map(),
	fields: readonly string[] = [],
): ScopedCacheFingerprint {
	return {
		collection,
		pairs: new Map(
			[...pairs].map(([field, values]) => [field, [...values]]),
		),
		fields: [...fields],
	};
}

/**
 * The fingerprint of a read bound to nothing of a collection: no pair and no
 * field, so every write to it matches. What a tag naming only a collection said.
 */
export function bareScopedCacheFingerprint(
	collection: string,
): ScopedCacheFingerprint {
	return scopedCacheFingerprint(collection);
}

/**
 * The form Redis holds: `<collection>:&<key>=,<v1>,<v2>,&…&`.
 *
 * Pairs are sorted and every token is wrapped in commas, which is what makes a
 * PARTIAL fingerprint a well-formed glob — `*&course_part=,4821,*` names every
 * entry pinned to that one value without naming `48210`. `fields` rides as a pair
 * of its own so the write side reads it back the way it reads a pin, and is left
 * out entirely when the read names none — a serialised ROW has pairs and no
 * fields.
 */
export function renderScopedCacheFingerprint(
	fingerprint: ScopedCacheFingerprint,
): string {
	const renderedPairs = new Map<string, readonly string[]>(fingerprint.pairs);

	if (fingerprint.fields.length > 0) {
		renderedPairs.set(SCOPED_CACHE_FINGERPRINT_FIELDS, fingerprint.fields);
	}

	let renderedFingerprint = `${fingerprint.collection}:`;

	for (const key of [...renderedPairs.keys()].sort()) {
		const sortedValues = [
			...new Set(renderedPairs.get(key)!.map(escapeScopedCacheFingerprintToken)),
		].sort();

		renderedFingerprint += `&${escapeScopedCacheFingerprintToken(key)}=,`
			+ `${sortedValues.join(',')},`;
	}

	return `${renderedFingerprint}&`;
}

export function parseScopedCacheFingerprint(
	serialized: string,
): ScopedCacheFingerprint {
	// On the FIRST colon: a collection name carries none, and a value may.
	const colonAt = serialized.indexOf(':');

	const parsedCollection = colonAt === -1
		? serialized
		: serialized.slice(0, colonAt);

	const parsedPairs = new Map<string, string[]>();
	let parsedFields: string[] = [];

	const fingerprintBody = colonAt === -1
		? ''
		: serialized.slice(colonAt + 1);

	for (const pair of splitUnescaped(fingerprintBody, '&')) {
		if (pair === '') {
			continue;
		}

		// On the FIRST `=`, for the same reason the collection splits on the first
		// colon: a key never carries one, a value can.
		const assignAt = pair.indexOf('=');

		if (assignAt === -1) {
			continue;
		}

		const pairKey = unescapeScopedCacheFingerprintToken(pair.slice(0, assignAt));

		// The wrapping commas are separators, not values: `,a,b,` is two values.
		const pairValues = splitUnescaped(pair.slice(assignAt + 1), ',')
			.slice(1, -1)
			.map(unescapeScopedCacheFingerprintToken);

		if (pairKey === SCOPED_CACHE_FINGERPRINT_FIELDS) {
			parsedFields = pairValues;
			continue;
		}

		parsedPairs.set(pairKey, pairValues);
	}

	return { collection: parsedCollection, pairs: parsedPairs, fields: parsedFields };
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
	const taggedPairs = new Map<string, string[]>();

	for (const tag of tags) {
		if (tag.field === undefined) {
			continue;
		}

		const fieldValues = taggedPairs.get(tag.field) ?? [];
		fieldValues.push(canonicalScopedCacheValue(tag.value, tag.type));
		taggedPairs.set(tag.field, fieldValues);
	}

	return scopedCacheFingerprint(collection, taggedPairs, fields);
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
	const tagLabels: string[] = [];

	for (const [field, values] of fingerprint.pairs) {
		for (const value of values) {
			tagLabels.push(`${fingerprint.collection}:${field}=${value}`);
		}
	}

	return tagLabels.length === 0
		? [fingerprint.collection]
		: tagLabels;
}

/**
 * The tags a set of fingerprints composes, one per value, `fields` dropped, and
 * the bare collection for a fingerprint that pins nothing.
 *
 * What the round trip loses is the AND — which is the whole point of the
 * fingerprint — so this is for the consumers that never had it: the legacy tag
 * sets, the dev headers, the telemetry, and the `scopedCacheTags` a hook reads
 * off `getMeta()` to hand to `purgeBy`. A token is already canonical, so the tag
 * it yields keys the same slice a write emits.
 */
export function scopedCacheTagsOfFingerprints(
	fingerprints: readonly ScopedCacheFingerprint[],
): ScopedCacheTag[] {
	const derivedTags: ScopedCacheTag[] = [];
	const seenTagKeys = new Set<string>();

	const pushTag = (tag: ScopedCacheTag): void => {
		const derivedTagKey = scopedCacheTagKey(tag);

		if (seenTagKeys.has(derivedTagKey)) {
			return;
		}

		seenTagKeys.add(derivedTagKey);
		derivedTags.push(tag);
	};

	for (const { collection, pairs } of fingerprints) {
		if (pairs.size === 0) {
			pushTag({ collection });
			continue;
		}

		for (const [field, values] of pairs) {
			for (const value of values) {
				pushTag({ collection, field, value });
			}
		}
	}

	return derivedTags;
}

/**
 * Whether every pair of the fingerprint holds on one row.
 *
 * The row is a fingerprint of its own — one value per pair, no `fields` — so the
 * test is a map lookup per pair: the read is dropped when the row carries one of
 * the values it pinned, on every field it pinned.
 */
export function scopedCacheFingerprintMatchesRow(
	fingerprint: ScopedCacheFingerprint,
	rowFingerprint: ScopedCacheFingerprint,
): boolean {
	for (const [field, values] of fingerprint.pairs) {
		const rowValues = rowFingerprint.pairs.get(field);

		if (rowValues === undefined) {
			return false;
		}

		if (!values.some((value) => rowValues.includes(value))) {
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

		const fieldSegments = field.split('.');

		for (
			let segmentDepth = fieldSegments.length - 1;
			segmentDepth > 0;
			segmentDepth--
		) {
			if (queryCase.has(`${fieldSegments.slice(0, segmentDepth).join('.')}.*`)) {
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
 * Query cases are kept in the order they come in, deduplicated on the form Redis
 * files them under, so a read's fingerprints come back stable without sorting what
 * the caller may have ordered on purpose.
 */
export function scopedCacheFingerprintsByCollection(
	queryCases: readonly (readonly ScopedCacheTag[])[],
	fieldsByCollection: ReadonlyMap<string, readonly string[]> = new Map(),
): ScopedCacheFingerprint[] {
	const composedFingerprints: ScopedCacheFingerprint[] = [];
	const seenFingerprints = new Set<string>();

	for (const queryCase of queryCases) {
		const queryCaseCollection = queryCase[0]?.collection;

		if (queryCaseCollection === undefined) {
			continue;
		}

		const composed = scopedCacheFingerprintFromTags(
			queryCaseCollection,
			queryCase,
			fieldsByCollection.get(queryCaseCollection) ?? [],
		);

		const rendered = renderScopedCacheFingerprint(composed);

		if (seenFingerprints.has(rendered)) {
			continue;
		}

		seenFingerprints.add(rendered);
		composedFingerprints.push(composed);
	}

	return composedFingerprints;
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
	// Every field the read pinned to a value is a field it is bound to, whether or
	// not it also selected it: a write moving a row across one of them moves it in
	// or out of the result set, which is a changed response by itself. Added only
	// beside declared fields, since naming none already means every field.
	const queryCase = fingerprint.fields.length === 0
		? fingerprint.fields
		: [...fingerprint.fields, ...fingerprint.pairs.keys()];

	if (scopedCacheFingerprintFieldsTouched(queryCase, changed) === false) {
		return false;
	}

	return rowFingerprints.some((rowFingerprint) => {
		return scopedCacheFingerprintMatchesRow(fingerprint, rowFingerprint);
	});
}

/**
 * How many patterns a purge will ask Redis to filter its index sets by before it
 * gives up and reads them whole. #531's match-side bound.
 *
 * Each pattern is one pass over the set, so a batch writing hundreds of distinct
 * slices would otherwise trade the bytes it saves for passes it cannot afford. The
 * fallback reads every member and tests it here, which is the exact same answer —
 * only wider on the wire.
 */
export const SCOPED_CACHE_MAX_INDEX_GLOBS = 64;

/**
 * The Redis glob patterns naming every indexed fingerprint the written rows can
 * drop, or `null` when there are too many to be worth filtering by.
 *
 * `SSCAN … MATCH` filters server-side, so the purge reads back the members it may
 * have to drop rather than every member of the bucket. The filter is a SUPERSET on
 * purpose: a glob cannot say "and no other pair", so the purge test above still
 * decides, and a pattern letting a non-match through costs one compare.
 *
 * One pattern per pair the rows pin, plus the two shapes a fingerprint pinning
 * nothing renders as. A read the rows can drop pins only pairs the rows carry, so
 * one of its own pairs names it — which is why the patterns are a union over
 * single pairs and not the 2^n subsets an exact filter would need.
 */
export function scopedCacheRowIndexGlobs(
	collection: string,
	rowFingerprints: readonly ScopedCacheFingerprint[],
): string[] | null {
	const collectionToken = escapeScopedCacheFingerprintGlob(collection);

	const globPatterns = new Set<string>([
		// Pins nothing at all, and pins nothing but its fields — the two ways a
		// fingerprint every row matches comes out of the serialiser.
		`${collectionToken}:&|*`,
		`${collectionToken}:&${SCOPED_CACHE_FINGERPRINT_FIELDS}=,*`,
	]);

	for (const rowFingerprint of rowFingerprints) {
		for (const [field, values] of rowFingerprint.pairs) {
			const pairKey = escapeScopedCacheFingerprintGlob(
				escapeScopedCacheFingerprintToken(field),
			);

			for (const value of values) {
				const valueToken = escapeScopedCacheFingerprintGlob(
					escapeScopedCacheFingerprintToken(value),
				);

				globPatterns.add(`${collectionToken}:*&${pairKey}=*,${valueToken},*`);
			}

			if (globPatterns.size > SCOPED_CACHE_MAX_INDEX_GLOBS) {
				return null;
			}
		}
	}

	return [...globPatterns];
}
