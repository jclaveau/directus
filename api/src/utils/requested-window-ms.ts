import { getMilliseconds } from './get-milliseconds.js';

/**
 * The cache-listing `window` range (a duration like 48h) → ms; undefined when
 * absent so the listing falls back to its default. Clamped downstream.
 *
 * Shared by the REST endpoints and the MCP tools, which take the same argument
 * and must read it identically.
 */
export function requestedWindowMs(raw: unknown): number | undefined {
	return raw === undefined
		? undefined
		: getMilliseconds(String(raw), Number.NaN);
}
