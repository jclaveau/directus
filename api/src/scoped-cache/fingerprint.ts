import type {
	ScopedCacheDeclaredFingerprint,
	ScopedCacheDeclaredScope,
	ScopedCacheFingerprint,
	ScopedCacheCollectionPin,
	ScopedCachePin,
	SchemaOverview,
} from '@directus/types';
import {
	canonicalizeScopedCachePinValue,
	scopedCachePinKey,
} from './pins.js';

export type { ScopedCacheFingerprint } from '@directus/types';

/** The pin naming what the read selected, sorted or filtered on. */
export const SCOPED_CACHE_FINGERPRINT_VIEW = 'view';

/** The `view` value a read of every column carries: any write touches it. */
export const SCOPED_CACHE_ANY_FIELD = '*';

// In the serialised form `&` separates pins, `,` wraps and separates a pin's
// values, `|` joins a fingerprint to its cache key inside an index member, and `\`
// escapes them all. A value carrying one raw would end its pin early — or, worse,
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
 * Where the first `separator` the escapes do not cover sits, or `-1`. An escaped
 * one still spells the character raw — `\|` — so a plain `indexOf` would stop at
 * it and cut a value carrying one in two.
 */
export function indexOfUnescaped(input: string, separator: string): number {
	for (let characterAt = 0; characterAt < input.length; characterAt++) {
		if (input[characterAt] === '\\') {
			characterAt++;
			continue;
		}

		if (input[characterAt] === separator) {
			return characterAt;
		}
	}

	return -1;
}

/**
 * Split on a separator the escapes do not cover, keeping the escapes in the parts
 * so each can be unescaped on its own. A plain `String.split` cannot: it cuts at an
 * escaped separator too, and a value carrying `&` would come back as two pins.
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
 * Pins are sorted and every token is wrapped in commas, which is what makes a
 * PARTIAL fingerprint a well-formed glob — `*&course_part=,4821,*` names every
 * entry pinned to that one value without naming `48210`. `view` rides as a pin
 * of its own so the write side reads it back the way it reads any other, and
 * is left out entirely when the read names none — a serialised ROW has pins
 * and no view.
 */
export function renderScopedCacheFingerprint(
	fingerprint: ScopedCacheFingerprint,
): string {
	const renderedPins = new Map<string, readonly string[]>(
		Object.entries(fingerprint.pinnedScope ?? {}),
	);

	const viewFields = fingerprint.viewFields ?? [];

	if (viewFields.length > 0) {
		renderedPins.set(SCOPED_CACHE_FINGERPRINT_VIEW, viewFields);
	}

	let renderedFingerprint = `${fingerprint.collection}:`;

	for (const key of [...renderedPins.keys()].sort()) {
		const sortedValues = [
			...new Set(renderedPins.get(key)!.map(escapeScopedCacheFingerprintToken)),
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

	for (const serialisedPin of splitUnescaped(fingerprintBody, '&')) {
		if (serialisedPin === '') {
			continue;
		}

		// On the FIRST `=`, for the same reason the collection splits on the first
		// colon: a key never carries one, a value can.
		const assignAt = serialisedPin.indexOf('=');

		if (assignAt === -1) {
			continue;
		}

		const pinKey = unescapeScopedCacheFingerprintToken(
			serialisedPin.slice(0, assignAt),
		);

		// The wrapping commas are separators, not values: `,a,b,` is two values.
		const pinValues = splitUnescaped(serialisedPin.slice(assignAt + 1), ',')
			.slice(1, -1)
			.map(unescapeScopedCacheFingerprintToken);

		if (pinKey === SCOPED_CACHE_FINGERPRINT_VIEW) {
			parsedFields = pinValues;
			continue;
		}

		parsedScope[pinKey] = pinValues;
	}

	// Only what it carries: an absent member is how every other fingerprint spells
	// pins nothing, and a decode that wrote the empty ones would be the one shape
	// no declaration has.
	return {
		collection: parsedCollection,
		...Object.keys(parsedScope).length > 0
			? { pinnedScope: parsedScope }
			: {},
		...parsedFields.length > 0
			? { viewFields: parsedFields }
			: {},
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
	pins: readonly ScopedCachePin[],
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
		fieldValues.push(canonicalizeScopedCachePinValue(pin.value, pin.type));
		pinnedScope[pin.field] = fieldValues;
	}

	return {
		collection,
		...Object.keys(pinnedScope).length > 0
			? { pinnedScope }
			: {},
		...viewFields.length > 0
			? { viewFields }
			: {},
	};
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
): ScopedCachePin[] {
	const fields = schema?.collections[declared.collection]?.fields;

	const pinnedScope: ScopedCacheDeclaredScope = declared.pinnedScope ?? {};

	return Object.entries(pinnedScope).flatMap(([field, values]) => {
		return values.map((value) => {
			return { field, value, type: fields?.[field]?.type };
		});
	});
}

/**
 * The pin keys of a set of fingerprints: one `collection[:field=value]` per pinned
 * value, `viewFields` dropped, and the bare collection for a fingerprint pinning
 * nothing.
 *
 * The AND does not survive it, which is why nothing invalidates by a pin. It is
 * the form of every surface beside the index — the dev `X-Scoped-Cache-*` headers,
 * and the pins the telemetry stores, where the two sides could not be compared as
 * fingerprints at all: only a read's carries the `viewFields` its response was
 * projected on, and a write cannot know them, while their pins are the same
 * strings.
 */
export function scopedCachePinKeys(
	fingerprints: readonly ScopedCacheFingerprint[],
): string[] {
	const pinKeys: string[] = [];
	const seenPinKeys = new Set<string>();

	const pushPinKey = (pin: ScopedCacheCollectionPin): void => {
		const pinKey = scopedCachePinKey(pin);

		if (seenPinKeys.has(pinKey)) {
			return;
		}

		seenPinKeys.add(pinKey);
		pinKeys.push(pinKey);
	};

	for (const { collection, pinnedScope = {} } of fingerprints) {
		if (Object.keys(pinnedScope).length === 0) {
			pushPinKey({ collection });
			continue;
		}

		for (const [field, values] of Object.entries(pinnedScope)) {
			for (const value of values) {
				pushPinKey({ collection, field, value });
			}
		}
	}

	return pinKeys;
}

/**
 * Whether the fingerprint pins nothing: the bare collection, which every write to
 * it reaches.
 *
 * Two shapes say it — no `pinnedScope` at all, and an empty one — because a pin
 * has to name a field before it can rule a row out. Asking here rather than at
 * each caller is what keeps the two from ever answering differently.
 */
export function scopedCacheFingerprintIsBare(
	fingerprint: ScopedCacheFingerprint,
): boolean {
	return Object.keys(fingerprint.pinnedScope ?? {}).length === 0;
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
	for (const [field, values] of Object.entries(fingerprint.pinnedScope ?? {})) {
		const rowValues = rowFingerprint.pinnedScope?.[field];

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
 * Whether the write touched a field the read's view names.
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
	// A read naming no field means its view is every field: the fail-safe
	// direction is the over-purge, never the stale hit.
	if (changed === null || viewFields.length === 0) {
		return true;
	}

	const viewedFields = new Set(viewFields);

	if (viewedFields.has(SCOPED_CACHE_ANY_FIELD)) {
		return true;
	}

	for (const field of changed) {
		if (viewedFields.has(field)) {
			return true;
		}

		const fieldSegments = field.split('.');

		for (
			let segmentDepth = fieldSegments.length - 1;
			segmentDepth > 0;
			segmentDepth--
		) {
			if (viewedFields.has(`${fieldSegments.slice(0, segmentDepth).join('.')}.*`)) {
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
 * Whether `entry` could contain a row carrying every pin `declared` names.
 *
 * The question a purge asks when it holds a pin rather than a row — a hook's own
 * `purgeBy`, which says "anything pinned to tenant=acme" and knows nothing of what
 * was written. It is the row test read the other way round: there, the row has to
 * answer every pin the entry carries; here, the entry only has to leave room for
 * the row.
 *
 * So an entry pinned to other values at that field stands — no row of this pin is
 * in it — while an entry that never pinned the field goes, since nothing about its
 * query case rules the row out. Pins the entry carries at OTHER fields say nothing
 * either way: the declared pin is silent about them, and silence is not exclusion.
 */
export function scopedCacheFingerprintCouldContainPin(
	entry: ScopedCacheFingerprint,
	declared: ScopedCacheFingerprint,
): boolean {
	return Object.entries(declared.pinnedScope ?? {})
		.every(([field, declaredTokens]) => {
			const pinnedTokens = entry.pinnedScope?.[field];

			return pinnedTokens === undefined
				|| pinnedTokens.some((token) => declaredTokens.includes(token));
		});
}

/**
 * Whether a write purges a read: the whole write-side rule, in one call.
 *
 * Two tests, both of which have to hold.
 *
 * The write touched a field the read's view names — an insert or a delete always
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
	// Every field the read pinned to a value is a field its view names, whether or
	// not it also selected it: a write moving a row across one of them moves it in
	// or out of the result set, which is a changed response by itself. Added only
	// beside declared fields, since naming none already means every field.
	const viewFields = fingerprint.viewFields ?? [];

	const queryCase = viewFields.length === 0
		? viewFields
		: [...viewFields, ...Object.keys(fingerprint.pinnedScope ?? {})];

	if (scopedCacheViewFieldsAreTouched(queryCase, changed) === false) {
		return false;
	}

	return rowFingerprints.some((rowFingerprint) => {
		return scopedCacheFingerprintMatchesRow(fingerprint, rowFingerprint);
	});
}

