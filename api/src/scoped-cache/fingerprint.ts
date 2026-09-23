import type {
	ScopedCacheDeclaredFingerprint,
	ScopedCacheFingerprint,
	ScopedCacheCollectionPin,
	ScopedCacheScopePin,
	SchemaOverview,
} from '@directus/types';
import {
	canonicalScopedCacheValue,
	scopedCachePinKey,
} from './pins.js';

export type { ScopedCacheFingerprint } from '@directus/types';

/** The pair naming what the read selected, sorted or filtered on. */
export const SCOPED_CACHE_FINGERPRINT_VIEW = 'view';

/** The `view` value a read of every column carries: any write touches it. */
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

export function escapeScopedCacheFingerprintGlob(rendered: string): string {
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
 * The form Redis holds: `<collection>:&<key>=,<v1>,<v2>,&…&`.
 *
 * Pairs are sorted and every token is wrapped in commas, which is what makes a
 * PARTIAL fingerprint a well-formed glob — `*&course_part=,4821,*` names every
 * entry pinned to that one value without naming `48210`. `view` rides as a pair
 * of its own so the write side reads it back the way it reads a pin, and is left
 * out entirely when the read names none — a serialised ROW has pairs and no
 * view.
 */
export function renderScopedCacheFingerprint(
	fingerprint: ScopedCacheFingerprint,
): string {
	const renderedPairs = new Map<string, readonly string[]>(
		Object.entries(fingerprint.pinnedScope),
	);

	if (fingerprint.viewFields.length > 0) {
		renderedPairs.set(SCOPED_CACHE_FINGERPRINT_VIEW, fingerprint.viewFields);
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

	// Null-prototyped: the keys come off the wire, and a collection may declare a
	// field named `__proto__` — an own key here, the object's prototype anywhere
	// else, which would drop the pin rather than fail the match.
	const parsedScope: Record<string, string[]> = Object.create(null);
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

		if (pairKey === SCOPED_CACHE_FINGERPRINT_VIEW) {
			parsedFields = pairValues;
			continue;
		}

		parsedScope[pairKey] = pairValues;
	}

	return {
		collection: parsedCollection,
		pinnedScope: parsedScope,
		viewFields: parsedFields,
	};
}

/**
 * The fingerprint one collection's pins compose to.
 *
 * The pinners still work an axis at a time — a read's query case is assembled from
 * a dozen different places, each of which knows one slice — and this is where those
 * slices stop being an OR and become the AND they always described. Several pins on
 * the SAME field are one pin listing both values, which is what an `_in` filter and
 * a set of nested parent keys both mean.
 *
 * This is also the one place a raw value becomes a token. A pin carries what the
 * filter or the driver handed over, spelled its own way; everything downstream —
 * the index key, the glob, the serialised member — reads the token and never
 * canonicalizes again.
 */
export function scopedCacheFingerprintOf(
	collection: string,
	pins: readonly ScopedCacheScopePin[],
	viewFields: readonly string[] = [],
): ScopedCacheFingerprint {
	// Null-prototyped for the reason the parser is: a pin's field is a column name,
	// and `__proto__` is a legal one.
	const pinnedScope: Record<string, string[]> = Object.create(null);

	for (const pin of pins) {
		if (pin.field === undefined) {
			continue;
		}

		const fieldValues = pinnedScope[pin.field] ?? [];
		fieldValues.push(canonicalScopedCacheValue(pin.value, pin.type));
		pinnedScope[pin.field] = fieldValues;
	}

	return { collection, pinnedScope, viewFields };
}

/**
 * The pins a declared fingerprint spells, typed off the schema.
 *
 * A declaration holds its values the way the code that wrote it does — a number,
 * a `Date`, an uppercase uuid — and only the column's type says which slice that
 * is. A fingerprint off `getMeta()` arrives already canonical, and canonicalizing
 * a token again returns it unchanged.
 */
export function scopedCacheDeclaredPins(
	declared: ScopedCacheDeclaredFingerprint,
	schema: SchemaOverview | null | undefined,
): ScopedCacheScopePin[] {
	const fields = schema?.collections[declared.collection]?.fields;

	const pinnedScope: Readonly<Record<string, readonly unknown[]>> =
		declared.pinnedScope ?? {};

	return Object.entries(pinnedScope).flatMap(([field, values]) => {
		return values.map((value) => {
			return { field, value, type: fields?.[field]?.type };
		});
	});
}

/**
 * The tag form of a set of fingerprints — what the layer spoke before #531, kept
 * where a fingerprint cannot be written: the dev `X-Scoped-Cache-*` headers, and
 * the tag lists the telemetry stores.
 *
 * One tag per pinned value, `viewFields` dropped, and the bare collection for a
 * fingerprint pinning nothing — `collection` or `collection:field=value`. The AND
 * does not survive it, which is why nothing invalidates by a tag: the stats stream
 * joins them with a comma, and a rendered fingerprint's own grammar is built on
 * commas, so this is the one form that can go there.
 */
export function scopedCacheLegacyTags(
	fingerprints: readonly ScopedCacheFingerprint[],
): string[] {
	const legacyTags: string[] = [];
	const seenTags = new Set<string>();

	const pushLegacyTag = (pin: ScopedCacheCollectionPin): void => {
		const legacyTag = scopedCachePinKey(pin);

		if (seenTags.has(legacyTag)) {
			return;
		}

		seenTags.add(legacyTag);
		legacyTags.push(legacyTag);
	};

	for (const { collection, pinnedScope } of fingerprints) {
		if (Object.keys(pinnedScope).length === 0) {
			pushLegacyTag({ collection });
			continue;
		}

		for (const [field, values] of Object.entries(pinnedScope)) {
			for (const value of values) {
				pushLegacyTag({ collection, field, value });
			}
		}
	}

	return legacyTags;
}

/**
 * Whether the whole pinned scope of the fingerprint holds on one row.
 *
 * The row is a fingerprint of its own — one value per field, no view fields — so
 * the test is a lookup per pinned field: the read is dropped when the row carries
 * one of the values it pinned, on every field it pinned.
 */
export function scopedCacheFingerprintMatchesRow(
	fingerprint: ScopedCacheFingerprint,
	rowFingerprint: ScopedCacheFingerprint,
): boolean {
	for (const [field, values] of Object.entries(fingerprint.pinnedScope)) {
		const rowValues = Object.hasOwn(rowFingerprint.pinnedScope, field)
			? rowFingerprint.pinnedScope[field]
			: undefined;

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
export function scopedCacheViewFieldsAreTouched(
	viewFields: readonly string[],
	changed: readonly string[] | null,
): boolean {
	// A read naming no field is bound to all of them: the fail-safe direction is
	// the over-purge, never the stale hit.
	if (changed === null || viewFields.length === 0) {
		return true;
	}

	const boundFields = new Set(viewFields);

	if (boundFields.has(SCOPED_CACHE_ANY_FIELD)) {
		return true;
	}

	for (const field of changed) {
		if (boundFields.has(field)) {
			return true;
		}

		const fieldSegments = field.split('.');

		for (
			let segmentDepth = fieldSegments.length - 1;
			segmentDepth > 0;
			segmentDepth--
		) {
			if (boundFields.has(`${fieldSegments.slice(0, segmentDepth).join('.')}.*`)) {
				return true;
			}
		}
	}

	return false;
}

/**
 * One fingerprint per way the read matches — per query case, not per collection.
 *
 * A query case holds the pins that had to hold TOGETHER on one collection: a
 * filter of `owner=alpha AND method=spaced` is one query case of two pins, and
 * the entry it files is dropped only by a write satisfying both. An `_or` across
 * two fields is two query cases instead, since a row matching either changes the
 * response, and one fingerprint ANDing them would match neither.
 *
 * The pins a collection carries from anywhere else — a nested node's slice, an
 * ancestor's key, a hook's own declaration — each stand alone the way a fingerprint
 * sweep reads them, so each is a query case of its own.
 *
 * A query case naming no field pins nothing, so its fingerprint carries an empty
 * scope and every row of that collection matches — which is what a bare fingerprint
 * means. Its view fields still narrow it: a write touching none of them cannot
 * change the response, whether or not the read could say which rows it depends
 * on.
 *
 * Query cases are kept in the order they come in, deduplicated on the form Redis
 * files them under, so a read's fingerprints come back stable without sorting what
 * the caller may have ordered on purpose.
 */
export function scopedCacheFingerprintsByCollection(
	queryCases: readonly (readonly ScopedCacheCollectionPin[])[],
	fieldsByCollection: ReadonlyMap<string, readonly string[]> = new Map(),
): ScopedCacheFingerprint[] {
	const composedFingerprints: ScopedCacheFingerprint[] = [];
	const seenFingerprints = new Set<string>();

	for (const queryCase of queryCases) {
		const queryCaseCollection = queryCase[0]?.collection;

		if (queryCaseCollection === undefined) {
			continue;
		}

		const composed = scopedCacheFingerprintOf(
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
 * Whether a row carrying every pin `declared` names could be inside `entry`.
 *
 * The question a purge asks when it holds a pin rather than a row — a hook's own
 * `purgeBy`, which says "anything bound to tenant=acme" and knows nothing of what
 * was written. It is the row test read the other way round: there, the row has to
 * answer every pin the entry carries; here, the entry only has to leave room for
 * the row.
 *
 * So an entry bound to other values at that field stands — no row of this pin is
 * in it — while an entry that never pinned the field goes, since nothing about its
 * query case rules the row out. Pins the entry carries at OTHER fields say nothing
 * either way: the declared pin is silent about them, and silence is not exclusion.
 */
export function scopedCacheFingerprintHolds(
	entry: ScopedCacheFingerprint,
	declared: ScopedCacheFingerprint,
): boolean {
	return Object.entries(declared.pinnedScope).every(([field, declaredTokens]) => {
		const boundTokens = entry.pinnedScope[field];

		return boundTokens === undefined
			|| boundTokens.some((token) => declaredTokens.includes(token));
	});
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
	const queryCase = fingerprint.viewFields.length === 0
		? fingerprint.viewFields
		: [...fingerprint.viewFields, ...Object.keys(fingerprint.pinnedScope)];

	if (scopedCacheViewFieldsAreTouched(queryCase, changed) === false) {
		return false;
	}

	return rowFingerprints.some((rowFingerprint) => {
		return scopedCacheFingerprintMatchesRow(fingerprint, rowFingerprint);
	});
}

