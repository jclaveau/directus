import { DatabaseHelper } from "../types.js";
import { getDefaultIndexName } from "../../../utils/get-default-index-name.js";
import { getDatabaseClient } from "../../index.js";

//#region src/database/helpers/schema/types.ts
var SchemaHelper = class extends DatabaseHelper {
	isOneOfClients(clients) {
		return clients.includes(getDatabaseClient(this.knex));
	}
	async changeNullable(table, column, nullable) {
		await this.knex.schema.alterTable(table, (builder) => {
			if (nullable) builder.setNullable(column);
			else builder.dropNullable(column);
		});
	}
	generateIndexName(type, collection, fields) {
		return getDefaultIndexName(type, collection, fields);
	}
	async changeToType(table, column, type, options = {}) {
		await this.knex.schema.alterTable(table, (builder) => {
			const b = type === "string" ? builder.string(column, options.length) : builder[type](column);
			if (options.nullable === true) b.nullable();
			if (options.nullable === false) b.notNullable();
			if (options.default !== void 0) b.defaultTo(options.default);
			b.alter();
		});
	}
	async changeToTypeByCopy(table, column, type, options) {
		const tempName = `${column}__temp`;
		await this.knex.schema.alterTable(table, (builder) => {
			const col = type === "string" ? builder.string(tempName, options.length) : builder[type](tempName);
			if (options.default !== void 0) col.defaultTo(options.default);
			col.nullable();
		});
		await this.knex(table).update(tempName, this.knex.ref(column));
		await this.knex.schema.alterTable(table, (builder) => {
			builder.dropColumn(column);
		});
		await this.knex.schema.alterTable(table, (builder) => {
			builder.renameColumn(tempName, column);
		});
		if (options.nullable === false) await this.changeNullable(table, column, options.nullable);
	}
	async preColumnChange() {
		return false;
	}
	async postColumnChange() {}
	preRelationChange(_relation) {}
	setNullable(column, field, existing) {
		if (field.schema?.is_nullable ?? existing?.is_nullable ?? true) column.nullable();
		else column.notNullable();
	}
	processFieldType(field) {
		return field.type;
	}
	constraintName(existingName) {
		return existingName;
	}
	applyLimit(rootQuery, limit) {
		if (limit !== -1) rootQuery.limit(limit);
	}
	applyOffset(rootQuery, offset) {
		rootQuery.offset(offset);
	}
	castA2oPrimaryKey() {
		return "CAST(?? AS CHAR(255))";
	}
	formatUUID(uuid) {
		return uuid;
	}
	/**
	* @returns Size of the database in bytes
	*/
	async getDatabaseSize() {
		return null;
	}
	/**
	* Whether the TimescaleDB extension is installed here. False everywhere it
	* cannot be: the cache telemetry's chunking, compression and retention are
	* gated on this, and the calls behind that gate throw on a database without
	* the extension rather than answering no.
	*/
	async hasTimescale() {
		return false;
	}
	/**
	* Whether `table` stores its rows in Timescale chunks. The extension being
	* installed does not make a table a hypertable — one created before it
	* arrived stayed plain — so this is the other half of the gate above.
	*/
	async isHypertable(_table) {
		return false;
	}
	/**
	* What `tables` occupy together, in bytes, or null where there is no cheap
	* measure to be had. Null rather than zero: a caller sizing them against a
	* budget must be able to tell "nothing there" from "cannot see".
	*/
	async getTablesSize(_tables) {
		return null;
	}
	/**
	* Drop the oldest time chunk among `tables`, if its range ends no later than
	* `olderThan`, and say which table it came from and where it ended. Null when
	* nothing is that old, or where rows are not stored in chunks at all — on a
	* plain table there is nothing whose disk a drop would return.
	*/
	async dropOldestChunk(_tables, _olderThan) {
		return null;
	}
	prepQueryParams(queryParams) {
		return queryParams;
	}
	prepBindings(bindings) {
		return bindings;
	}
	addInnerSortFieldsToGroupBy(_groupByFields, _sortRecords, _hasRelationalSort) {}
	getColumnNameMaxLength() {
		return 64;
	}
	getTableNameMaxLength() {
		return 64;
	}
	async dropUniqueIfExists(knex, collection, field) {
		const constraintName = this.generateIndexName("unique", collection, field);
		await knex.raw("ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??", [collection, constraintName]);
	}
	async dropIndexIfExists(knex, collection, field) {
		const indexName = this.generateIndexName("index", collection, field);
		await knex.raw("DROP INDEX IF EXISTS ??", [indexName]);
	}
	async getColumnsWithInvalidCollation(schema, collation) {
		return this.knex("information_schema.columns").select({
			table_name: "TABLE_NAME",
			name: "COLUMN_NAME",
			collation: "COLLATION_NAME"
		}).where({ TABLE_SCHEMA: schema }).whereNot({ COLLATION_NAME: collation });
	}
};

//#endregion
export { SchemaHelper };