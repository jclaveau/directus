import { parseJSON } from '@directus/utils';

/**
 * Read a JSON-column field list off a raw `directus_collections` row. The column comes
 * back parsed on Postgres but as a JSON string on MySQL/SQLite, so accept both and
 * degrade to an empty list on anything unexpected. The string branch goes through
 * `parseJSON` (prototype-pollution hardened), since a raw `knex.select` bypasses the
 * `cast-json` items pipeline that would normally apply it.
 */
export function parseJsonFieldList(raw: unknown): string[] {
	let parsed: unknown = raw;

	if (typeof raw === 'string' && raw.length > 0) {
		try {
			parsed = parseJSON(raw);
		}
		catch {
			return [];
		}
	}

	return Array.isArray(parsed)
		? parsed.filter((entry): entry is string => typeof entry === 'string')
		: [];
}
