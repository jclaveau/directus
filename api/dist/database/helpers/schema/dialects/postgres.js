import { getDefaultIndexName } from "../../../../utils/get-default-index-name.js";
import { SchemaHelper } from "../types.js";
import { useEnv } from "@directus/env";

//#region src/database/helpers/schema/dialects/postgres.ts
const env = useEnv();
/**
* Whether the extension is installed, per connection.
*
* Uncached, the probe answered 26 times over one cursus registration while the size query it
* gates ran 13 — the guard cost twice what it guarded (measured 2026-08-28). Keyed on the knex
* instance rather than held in the module, so it is not process-global state shared by every
* caller and a second connection answers for itself.
*
* An extension installed while the process runs is not seen until it restarts. Installing one
* is a migration, which is a deploy, so that window closes on its own.
*/
const timescalePresence = /* @__PURE__ */ new WeakMap();
var SchemaHelperPostgres = class extends SchemaHelper {
	generateIndexName(type, collection, fields) {
		return getDefaultIndexName(type, collection, fields, { maxLength: 63 });
	}
	async hasTimescale() {
		const answered = timescalePresence.get(this.knex);
		if (answered !== void 0) return answered;
		const { rows } = await this.knex.raw("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') AS has");
		const present = rows[0].has === true;
		timescalePresence.set(this.knex, present);
		return present;
	}
	async isHypertable(table) {
		const { rows } = await this.knex.raw("SELECT EXISTS(SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = ?) AS has", [table]);
		return rows[0].has === true;
	}
	/**
	* `hypertable_size()` for a chunked table — its rows live in chunks the parent
	* relation knows nothing about, so `pg_total_relation_size()` reads near zero
	* there — and `pg_total_relation_size()` for every other table.
	*
	* `to_regclass` answers null for a table this database never created, and SUM
	* skips that row rather than failing the whole measurement.
	*/
	async getTablesSize(tables) {
		try {
			const { rows } = await this.knex.raw(await this.hasTimescale() ? "SELECT COALESCE(SUM(CASE WHEN chunked.hypertable_name IS NOT NULL THEN hypertable_size(named.table_name::regclass) ELSE pg_total_relation_size(to_regclass(named.table_name)) END), 0) AS bytes FROM unnest(?::text[]) AS named(table_name) LEFT JOIN timescaledb_information.hypertables AS chunked ON chunked.hypertable_name = named.table_name" : "SELECT COALESCE(SUM(pg_total_relation_size(to_regclass(named.table_name))), 0) AS bytes FROM unnest(?::text[]) AS named(table_name)", [tables]);
			return Number(rows[0].bytes);
		} catch {
			return null;
		}
	}
	async dropOldestChunk(tables, olderThan) {
		if (!await this.hasTimescale()) return null;
		const { rows } = await this.knex.raw("SELECT hypertable_name, range_end FROM timescaledb_information.chunks WHERE hypertable_name = ANY(?) AND range_end <= ? ORDER BY range_start LIMIT 1", [tables, olderThan]);
		if (rows.length === 0) return null;
		const { hypertable_name: table, range_end: upTo } = rows[0];
		await this.knex.raw(`SELECT drop_chunks(?::regclass, older_than => ?::timestamptz)`, [table, upTo]);
		return {
			table,
			upTo: new Date(upTo)
		};
	}
	async getDatabaseSize() {
		try {
			const result = await this.knex.select(this.knex.raw(`pg_database_size(?) as size;`, [env["DB_DATABASE"]]));
			return result[0]?.["size"] ? Number(result[0]?.["size"]) : null;
		} catch {
			return null;
		}
	}
	addInnerSortFieldsToGroupBy(groupByFields, sortRecords, hasRelationalSort) {
		if (hasRelationalSort) groupByFields.push(...sortRecords.map(({ alias }) => alias));
	}
};

//#endregion
export { SchemaHelperPostgres };