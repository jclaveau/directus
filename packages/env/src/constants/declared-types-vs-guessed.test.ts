import { describe, expect, it } from 'vitest';
import { cast } from '../lib/cast.js';
import { DEFAULTS } from './defaults.js';

/**
 * What every default becomes with its declared type, against what it would become
 * with none. `cast(value)` takes the `guessType` path because there is no key to
 * look up; `cast(value, key)` takes the declared one.
 *
 * Declaring a type is meant to change how a value is PARSED, not what the code
 * downstream sees, so the two agree for almost every default. The ones that do
 * differ are the interesting list: each has been read against its consumer, and a
 * new one appearing here is the signal to go and do that, not to update the list.
 * It is how `AUTH_PROVIDERS` was caught before it shipped — `auth.ts` gates on
 * `!env['AUTH_PROVIDERS']`, and declaring it `array` turns the empty default into
 * `[]`, which is truthy.
 */
const CHANGED_BY_DECLARING: Record<string, string> = {
	// Ports are compared and concatenated as strings.
	PORT: 'number(8055) -> string("8055")',
	// Every consumer of these four reads them through toArray().
	STORAGE_LOCATIONS: 'string("local") -> array(["local"])',
	CACHE_VARY_REQUEST_HEADERS: 'string("") -> array([])',
	CACHE_VARY_REQUEST_HEADERS_EXCLUDED: 'string("") -> array([])',
	SYSTEM_MCP_ALLOWED_ORIGINS: 'string("") -> array([])',
	PGBOUNCER_CONNECTIONS: 'string("") -> array([])',
	FILES_MIME_TYPE_ALLOW_LIST: 'string("*/*") -> array(["*/*"])',
	// cors documents string or array for this option.
	CORS_EXPOSED_HEADERS: 'string("Content-Range") -> array(["Content-Range"])',
	// bytes.parse() reads either.
	TUS_CHUNK_SIZE: 'number(8388608) -> string("8388608")',
};

function shapeOf(value: unknown): string {
	return `${Array.isArray(value)
		? 'array'
		: typeof value}(${JSON.stringify(value)})`;
}

describe('declaring an env type against guessing it', () => {
	it('changes only the defaults whose consumer was read for it', () => {
		const changed: Record<string, string> = {};

		for (const [key, value] of Object.entries(DEFAULTS)) {
			const guessed = shapeOf(cast(value));
			const declared = shapeOf(cast(value, key));

			if (guessed !== declared) {
				changed[key] = `${guessed} -> ${declared}`;
			}
		}

		// A key here that is not in the map above means a declared type moved a
		// value under a consumer nobody checked. Read that consumer before adding
		// it: a changed TYPE is usually fine, a changed TRUTHINESS is a bug.
		expect(changed).toEqual(CHANGED_BY_DECLARING);
	});
});
