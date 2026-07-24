import ms, { type StringValue } from 'ms';

/**
 * Safely parse human readable time format into milliseconds
 */
export function getMilliseconds<T = undefined>(value: unknown, fallback?: T): number | T {
	if ((typeof value !== 'string' && typeof value !== 'number') || value === '') {
		return fallback as T;
	}

	return ms(String(value) as StringValue) ?? fallback;
}

/**
 * Whether `value` parses to a strictly-positive number of milliseconds. Gates a
 * malformed `cache_ttl` override before it reaches the write path, where
 * `getMilliseconds` would silently fall back and desync the `__expires_at` sidecar
 * from the entry's real lifetime. Rejects unparseable input, zero, and negatives
 * (ms parses `"-5m"` to a negative). Empty is guarded first — ms throws on it.
 */
export function isPositiveDuration(value: string): boolean {
	if (value.trim() === '') {
		return false;
	}

	const parsed = ms(value as StringValue);

	return typeof parsed === 'number' && parsed > 0;
}
