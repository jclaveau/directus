//#region src/cache-envelope.ts
/**
* The envelope every Keyv tier stores its entries in: `{ value, expires }` as
* one JSON document, with a Buffer value carried as base64 under its own key.
*
* Replaces `@keyv/serialize`, whose reader runs a reviver on EVERY value in the
* document to undo the escapes its writer put on strings (`:base64:` for a
* Buffer, one extra `:` on any string that starts with one). On a 1.4 MB
* payload that reviver is the whole cost of a HIT — ~13x a plain `JSON.parse`,
* 250 ms on a Railway vCPU where the GET itself takes 8 — and its writer, a
* hand-rolled recursive concat, costs a fill 70 ms more than `JSON.stringify`.
*
* The only Buffer a tier is ever handed is the whole value (a snappy-compressed
* payload from `compress.ts`), so the envelope marks that one place instead of
* escaping every string. A Buffer nested inside a value goes through
* `JSON.stringify` as its own `toJSON` (`{ type: 'Buffer', data }`), which is
* what `res.json` would send for it anyway.
*
* `envelope` leads the document so a reader tells this shape from the old one on
* the first bytes, without parsing. Entries written by `@keyv/serialize` are
* still read for the deploy window in which both shapes coexist; the boot flush
* (`CACHE_AUTO_FLUSH_ON_DEPLOY`) drops them everywhere else.
*/
const ENVELOPE_VERSION = 2;
const ENVELOPE_HEAD = `{"envelope":${ENVELOPE_VERSION},`;
function serializeCacheEnvelope(data) {
	if (Buffer.isBuffer(data.value)) return JSON.stringify({
		envelope: ENVELOPE_VERSION,
		base64: data.value.toString("base64"),
		expires: data.expires
	});
	return JSON.stringify({
		envelope: ENVELOPE_VERSION,
		value: data.value,
		expires: data.expires
	});
}
function deserializeCacheEnvelope(raw) {
	if (!raw.startsWith(ENVELOPE_HEAD)) return deserializeLegacyEnvelope(raw);
	const parsed = JSON.parse(raw);
	if (typeof parsed.base64 === "string") return {
		value: Buffer.from(parsed.base64, "base64"),
		expires: parsed.expires
	};
	return {
		value: parsed.value,
		expires: parsed.expires
	};
}
/**
* What `@keyv/serialize@1` wrote, read the way it read it: a string that starts
* with `:base64:` is a Buffer, and any other leading `:` was an escape.
*/
function deserializeLegacyEnvelope(raw) {
	return JSON.parse(raw, (_key, value) => {
		if (typeof value !== "string") return value;
		if (value.startsWith(":base64:")) return Buffer.from(value.slice(8), "base64");
		return value.startsWith(":") ? value.slice(1) : value;
	});
}

//#endregion
export { deserializeCacheEnvelope, serializeCacheEnvelope };