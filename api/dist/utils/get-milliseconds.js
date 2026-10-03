import ms from "ms";

//#region src/utils/get-milliseconds.ts
/**
* Safely parse human readable time format into milliseconds
*/
function getMilliseconds(value, fallback) {
	if (typeof value !== "string" && typeof value !== "number" || value === "") return fallback;
	return ms(String(value)) ?? fallback;
}
/**
* Whether `value` parses to a strictly-positive number of milliseconds. Gates a
* malformed `cache_ttl` override before it reaches the write path, where
* `getMilliseconds` would silently fall back and desync the `__expires_at` sidecar
* from the entry's real lifetime. Rejects unparseable input, zero, and negatives
* (ms parses `"-5m"` to a negative). Empty is guarded first — ms throws on it.
*/
function isPositiveDuration(value) {
	if (value.trim() === "") return false;
	const parsed = ms(value);
	return typeof parsed === "number" && parsed > 0;
}

//#endregion
export { getMilliseconds, isPositiveDuration };