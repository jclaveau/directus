//#region src/utils/printable-scoped-cache-pins.ts
function printableScopedCachePin(serialized) {
	return Array.from(serialized).map((char) => {
		const code = char.charCodeAt(0);
		if (code >= 32 && code <= 126) return char;
		return char.length === 1 && code >= 55296 && code <= 57343 ? "%EF%BF%BD" : encodeURIComponent(char);
	}).join("");
}
/**
* Both telemetry pin columns are varchar(255), and the purge side sits in a
* compressed hypertable's `compress_orderby`, which Timescale refuses to
* retype in place. One longer pin would fail the batch insert and lose every
* event beside it.
*/
const SCOPED_CACHE_PIN_COLUMN_LENGTH = 255;
/**
* The pin as the telemetry columns hold it. Every side compared with a column
* — the entry pins, the purge pins, the audit's replay header — cuts through
* this one function, so a cut pin still joins and still diffs equal.
*/
function storedScopedCachePin(serialized) {
	return printableScopedCachePin(serialized).slice(0, SCOPED_CACHE_PIN_COLUMN_LENGTH);
}

//#endregion
export { SCOPED_CACHE_PIN_COLUMN_LENGTH, printableScopedCachePin, storedScopedCachePin };