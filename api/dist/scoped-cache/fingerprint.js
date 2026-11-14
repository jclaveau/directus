import { canonicalizeScopedCachePinValue, scopedCachePinKey } from "./pins.js";
import { resolveScopedCacheM2oJoinChainFromPath } from "./paths.js";

//#region src/scoped-cache/fingerprint.ts
/**
* The pin naming what the read selected, sorted or filtered on. It is the one key
* rendered raw: a field of that name renders as `\view`, which unescapes to the
* same field and never reads back as the view.
*/
const SCOPED_CACHE_FINGERPRINT_VIEW = "view";
/** The `view` value a read of every column carries: any write touches it. */
const SCOPED_CACHE_ANY_FIELD = "*";
const RESERVED = /[\\,&|*?[\]]/g;
function escapeScopedCacheFingerprintToken(token) {
	return token.replace(RESERVED, (reservedCharacter) => `\\${reservedCharacter}`);
}
function escapeScopedCacheFingerprintPinKey(field) {
	const escapedField = escapeScopedCacheFingerprintToken(field);
	return escapedField === SCOPED_CACHE_FINGERPRINT_VIEW ? `\\${escapedField}` : escapedField;
}
function unescapeScopedCacheFingerprintToken(token) {
	return token.replace(/\\(.)/g, "$1");
}
const GLOB_RESERVED = /[\\*?[\]]/g;
function escapeScopedCacheFingerprintGlob(rendered) {
	return rendered.replace(GLOB_RESERVED, (globCharacter) => `\\${globCharacter}`);
}
/**
* Where the first `separator` the escapes do not cover sits, or `-1`. An escaped
* one still spells the character raw — `\|` — so a plain `indexOf` would stop at
* it and cut a value carrying one in two.
*/
function indexOfUnescaped(input, separator) {
	for (let characterAt = 0; characterAt < input.length; characterAt++) {
		if (input[characterAt] === "\\") {
			characterAt++;
			continue;
		}
		if (input[characterAt] === separator) return characterAt;
	}
	return -1;
}
/**
* Split on a separator the escapes do not cover, keeping the escapes in the parts
* so each can be unescaped on its own. A plain `String.split` cannot: it cuts at an
* escaped separator too, and a value carrying `&` would come back as two pins.
*/
function splitUnescaped(input, separator) {
	const splitParts = [];
	let currentPart = "";
	let escapePending = false;
	for (const reservedCharacter of input) {
		if (escapePending) {
			currentPart += `\\${reservedCharacter}`;
			escapePending = false;
			continue;
		}
		if (reservedCharacter === "\\") {
			escapePending = true;
			continue;
		}
		if (reservedCharacter === separator) {
			splitParts.push(currentPart);
			currentPart = "";
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
function renderScopedCacheFingerprint(fingerprint) {
	const renderedPins = /* @__PURE__ */ new Map();
	for (const [field, values] of Object.entries(fingerprint.pinnedScope ?? {})) renderedPins.set(escapeScopedCacheFingerprintPinKey(field), values);
	const viewFields = fingerprint.viewFields ?? [];
	if (viewFields.length > 0) renderedPins.set(SCOPED_CACHE_FINGERPRINT_VIEW, viewFields);
	let renderedFingerprint = `${escapeScopedCacheFingerprintToken(fingerprint.collection)}:`;
	for (const key of [...renderedPins.keys()].sort()) {
		const sortedValues = [...new Set(renderedPins.get(key).map(escapeScopedCacheFingerprintToken))].sort();
		renderedFingerprint += `&${key}=,${sortedValues.join(",")},`;
	}
	return `${renderedFingerprint}&`;
}
function parseScopedCacheFingerprint(serialized) {
	const colonAt = serialized.includes(":&") ? serialized.indexOf(":&") : serialized.indexOf(":");
	const parsedCollection = unescapeScopedCacheFingerprintToken(colonAt === -1 ? serialized : serialized.slice(0, colonAt));
	const parsedScope = Object.create(null);
	let parsedFields = [];
	const fingerprintBody = colonAt === -1 ? "" : serialized.slice(colonAt + 1);
	for (const serialisedPin of splitUnescaped(fingerprintBody, "&")) {
		if (serialisedPin === "") continue;
		const assignAt = indexOfUnescaped(serialisedPin, ",") - 1;
		if (assignAt < 0 || serialisedPin[assignAt] !== "=") continue;
		const renderedKey = serialisedPin.slice(0, assignAt);
		const pinValues = splitUnescaped(serialisedPin.slice(assignAt + 1), ",").slice(1, -1).map(unescapeScopedCacheFingerprintToken);
		if (renderedKey === SCOPED_CACHE_FINGERPRINT_VIEW) {
			parsedFields = pinValues;
			continue;
		}
		parsedScope[unescapeScopedCacheFingerprintToken(renderedKey)] = pinValues;
	}
	return {
		collection: parsedCollection,
		...Object.keys(parsedScope).length > 0 ? { pinnedScope: parsedScope } : {},
		...parsedFields.length > 0 ? { viewFields: parsedFields } : {}
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
function scopedCacheFingerprintOf(collection, pins, viewFields = []) {
	const pinnedScope = Object.create(null);
	for (const pin of pins) {
		if (pin.field === void 0) continue;
		const fieldValues = pinnedScope[pin.field] ?? [];
		fieldValues.push(canonicalizeScopedCachePinValue(pin.value, pin.type));
		pinnedScope[pin.field] = fieldValues;
	}
	return {
		collection,
		...Object.keys(pinnedScope).length > 0 ? { pinnedScope } : {},
		...viewFields.length > 0 ? { viewFields } : {}
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
function scopedCacheDeclaredPins(declared, schema) {
	const pinnedScope = declared.pinnedScope ?? {};
	const declaredPins = Object.entries(pinnedScope).flatMap(([field, values]) => {
		const type = declaredPinType(schema, declared.collection, field);
		return values.map((value) => {
			return {
				field,
				value,
				type
			};
		});
	});
	const legacyPin = declared;
	if (typeof legacyPin.field !== "string") return declaredPins;
	return [...declaredPins, {
		field: legacyPin.field,
		value: legacyPin.value,
		type: declaredPinType(schema, declared.collection, legacyPin.field) ?? legacyPin.type
	}];
}
/**
* The type of the column a declared pin's field names. A dotted scope path
* (`zone.region.owner`) is no column of the collection itself: its value is the
* terminal column's, and the read types it off that column, so a declaration
* typed any other way spells the value as a token the entry never carries.
*/
function declaredPinType(schema, collection, field) {
	const ownType = schema?.collections[collection]?.fields[field]?.type;
	if (ownType !== void 0 || !schema || !field.includes(".")) return ownType;
	const pathSegments = field.split(".");
	const terminalCollection = resolveScopedCacheM2oJoinChainFromPath(schema, collection, pathSegments.slice(0, -1))?.at(-1)?.relatedCollection;
	if (terminalCollection === void 0) return;
	return schema.collections[terminalCollection]?.fields[pathSegments.at(-1)]?.type;
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
function scopedCachePinKeys(fingerprints) {
	const pinKeys = [];
	const seenPinKeys = /* @__PURE__ */ new Set();
	const pushPinKey = (pin) => {
		const pinKey = scopedCachePinKey(pin);
		if (seenPinKeys.has(pinKey)) return;
		seenPinKeys.add(pinKey);
		pinKeys.push(pinKey);
	};
	for (const { collection, pinnedScope = {} } of fingerprints) {
		if (Object.keys(pinnedScope).length === 0) {
			pushPinKey({ collection });
			continue;
		}
		for (const [field, values] of Object.entries(pinnedScope)) for (const value of values) pushPinKey({
			collection,
			field,
			value
		});
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
function scopedCacheFingerprintIsBare(fingerprint) {
	return Object.keys(fingerprint.pinnedScope ?? {}).length === 0;
}
/**
* Whether the whole pinned scope of the fingerprint holds on one row.
*
* The row is a fingerprint of its own — one value per field, no view fields — so
* the test is a lookup per pinned field: the read is dropped when the row carries
* one of the values it pinned, on every field it pinned.
*/
function scopedCacheFingerprintMatchesRow(fingerprint, rowFingerprint) {
	for (const [field, values] of Object.entries(fingerprint.pinnedScope ?? {})) {
		const rowValues = rowFingerprint.pinnedScope?.[field];
		if (rowValues === void 0) return false;
		if (!values.some((value) => rowValues.includes(value))) return false;
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
function scopedCacheViewFieldsAreTouched(viewFields, changed) {
	if (changed === null || viewFields.length === 0) return true;
	const viewedFields = new Set(viewFields);
	if (viewedFields.has(SCOPED_CACHE_ANY_FIELD)) return true;
	for (const field of changed) {
		if (viewedFields.has(field)) return true;
		const fieldSegments = field.split(".");
		for (let segmentDepth = fieldSegments.length - 1; segmentDepth > 0; segmentDepth--) if (viewedFields.has(`${fieldSegments.slice(0, segmentDepth).join(".")}.*`)) return true;
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
function scopedCacheFingerprintsByCollection(queryCases, fieldsByCollection = /* @__PURE__ */ new Map()) {
	const composedFingerprints = [];
	const seenFingerprints = /* @__PURE__ */ new Set();
	for (const queryCase of queryCases) {
		const queryCaseCollection = queryCase[0]?.collection;
		if (queryCaseCollection === void 0) continue;
		const composed = scopedCacheFingerprintOf(queryCaseCollection, queryCase, fieldsByCollection.get(queryCaseCollection) ?? []);
		const rendered = renderScopedCacheFingerprint(composed);
		if (seenFingerprints.has(rendered)) continue;
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
function scopedCacheFingerprintCouldContainPin(entry, declared) {
	return Object.entries(declared.pinnedScope ?? {}).every(([field, declaredTokens]) => {
		const pinnedTokens = entry.pinnedScope?.[field];
		return pinnedTokens === void 0 || pinnedTokens.some((token) => declaredTokens.includes(token));
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
function scopedCacheFingerprintPurgedBy(fingerprint, rowFingerprints, changed) {
	const viewFields = fingerprint.viewFields ?? [];
	if (scopedCacheViewFieldsAreTouched(viewFields.length === 0 ? viewFields : [...viewFields, ...Object.keys(fingerprint.pinnedScope ?? {})], changed) === false) return false;
	return rowFingerprints.some((rowFingerprint) => {
		return scopedCacheFingerprintMatchesRow(fingerprint, rowFingerprint);
	});
}

//#endregion
export { SCOPED_CACHE_ANY_FIELD, SCOPED_CACHE_FINGERPRINT_VIEW, escapeScopedCacheFingerprintGlob, escapeScopedCacheFingerprintPinKey, escapeScopedCacheFingerprintToken, indexOfUnescaped, parseScopedCacheFingerprint, renderScopedCacheFingerprint, scopedCacheDeclaredPins, scopedCacheFingerprintCouldContainPin, scopedCacheFingerprintIsBare, scopedCacheFingerprintMatchesRow, scopedCacheFingerprintOf, scopedCacheFingerprintPurgedBy, scopedCacheFingerprintsByCollection, scopedCachePinKeys, scopedCacheViewFieldsAreTouched, unescapeScopedCacheFingerprintToken };