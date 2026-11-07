import { parseJSON } from "@directus/utils";

//#region src/utils/parse-json-field-list.ts
/**
* Read a JSON-column field list off a raw `directus_collections` row. The column comes
* back parsed on Postgres but as a JSON string on MySQL/SQLite, so accept both and
* degrade to an empty list on anything unexpected. The string branch goes through
* `parseJSON` (prototype-pollution hardened), since a raw `knex.select` bypasses the
* `cast-json` items pipeline that would normally apply it.
*/
function parseJsonFieldList(raw) {
	let parsed = raw;
	if (typeof raw === "string" && raw.length > 0) try {
		parsed = parseJSON(raw);
	} catch {
		return [];
	}
	return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
}

//#endregion
export { parseJsonFieldList };