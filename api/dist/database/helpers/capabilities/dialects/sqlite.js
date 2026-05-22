import { CapabilitiesHelper } from "../types.js";

//#region src/database/helpers/capabilities/dialects/sqlite.ts
/**
* SQLite gained `INSERT … RETURNING` in 3.35.0 (2021-03-12). Below that version the only
* id available after an insert is `last_insert_rowid()` (the last item only), so the
* batch path can't be trusted. We probe the runtime version once per knex client.
* https://www.sqlite.org/lang_returning.html
*/
const MIN_SQLITE_RETURNING_VERSION = [3, 35];
var CapabilitiesHelperSqlite = class extends CapabilitiesHelper {
	preservesOrderCache;
	async preservesInsertOrderInReturning() {
		if (this.preservesOrderCache !== void 0) return this.preservesOrderCache;
		const row = await this.knex.select(this.knex.raw("sqlite_version() as version")).first();
		const [major = 0, minor = 0] = String(row?.version ?? "0").split(".").map(Number);
		const [minMajor, minMinor] = MIN_SQLITE_RETURNING_VERSION;
		this.preservesOrderCache = major > minMajor || major === minMajor && minor >= minMinor;
		return this.preservesOrderCache;
	}
};

//#endregion
export { CapabilitiesHelperSqlite };