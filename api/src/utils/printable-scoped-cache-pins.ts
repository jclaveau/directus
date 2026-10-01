// The pin stays raw (it IS the Redis key), so percent-encode at the exits: a
// bare NUL or >= U+0100 char otherwise makes res.setHeader / a text column throw.
export function printableScopedCachePin(serialized: string): string {
	return Array.from(serialized)
		.map((char) => {
			const code = char.charCodeAt(0);

			if (code >= 0x20 && code <= 0x7E) {
				return char;
			}

			// Array.from keeps a lone surrogate as its own char, and
			// encodeURIComponent throws URIError on it: encode U+FFFD instead,
			// as String.prototype.toWellFormed would.
			return char.length === 1 && code >= 0xD800 && code <= 0xDFFF
				? '%EF%BF%BD'
				: encodeURIComponent(char);
		})
		.join('');
}

/**
 * Both telemetry pin columns are varchar(255), and the purge side sits in a
 * compressed hypertable's `compress_orderby`, which Timescale refuses to
 * retype in place. One longer pin would fail the batch insert and lose every
 * event beside it.
 */
export const SCOPED_CACHE_PIN_COLUMN_LENGTH = 255;

/**
 * The pin as the telemetry columns hold it. Every side compared with a column
 * — the entry pins, the purge pins, the audit's replay header — cuts through
 * this one function, so a cut pin still joins and still diffs equal.
 */
export function storedScopedCachePin(serialized: string): string {
	return printableScopedCachePin(serialized)
		.slice(0, SCOPED_CACHE_PIN_COLUMN_LENGTH);
}
