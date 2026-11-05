import { CapabilitiesHelper } from "../types.js";

//#region src/database/helpers/capabilities/dialects/mysql.ts
var CapabilitiesHelperMySQL = class extends CapabilitiesHelper {
	supportsColumnPositionInGroupBy() {
		return true;
	}
	/**
	* MySQL: no native `INSERT … RETURNING`.
	*
	* - MariaDB does support RETURNING since 10.5 (2020-06)
	*   (https://mariadb.com/kb/en/insertreturning/), but:
	*   - knex treats `.returning()` as a no-op for the mysql dialect and logs
	*     `".returning() is not supported by mysql and will not have any effect."`
	*   - Tracked upstream at https://github.com/knex/knex/issues/6254.
	*   - Both MariaDB and MySQL route through `Client_MySQL2` and surface as
	*     `'mysql'` in `getDatabaseClient()`, so we can't dispatch them separately
	*     at this layer either.
	*
	* - Future enablement path: when knex grows MariaDB-aware RETURNING emission
	*   and Directus exposes MariaDB as its own `DatabaseClient` value, this method
	*   can probe `SELECT VERSION()` for the `-MariaDB` suffix and return `true`
	*   for ≥ 10.5.
	*/
	async preservesInsertOrderInReturning() {
		return false;
	}
};

//#endregion
export { CapabilitiesHelperMySQL };