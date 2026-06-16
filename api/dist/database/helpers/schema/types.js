import { DatabaseHelper } from "../types.js";
import { getDefaultIndexName } from "../../../utils/get-default-index-name.js";
import { getDatabaseClient } from "../../index.js";
import { toArray } from "@directus/utils";
import assert from "node:assert";

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
	/**
	* Change a tables primary key
	*
	* @param table - The name of the table
	* @param to - The new primary key column name(s)
	*
	* * @example
	* // Changing a single primary key
	* await changePrimaryKey('users', 'uuid');
	* * // Creating a composite primary key
	* await changePrimaryKey('order_items', ['order_id', 'product_id']);
	*/
	async changePrimaryKey(table, to) {
		const primaryColumns = toArray(to);
		assert(primaryColumns.length > 0, "At least 1 \"to\" column is required");
		assert(primaryColumns[0] && primaryColumns[0].length > 0, "\"to\" column cannot be empty");
		await this.knex.schema.alterTable(table, (builder) => {
			builder.dropPrimary();
			builder.primary(primaryColumns);
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
	async createIndex(collection, field, options = {}) {
		const isUnique = Boolean(options.unique);
		const constraintName = this.generateIndexName(isUnique ? "unique" : "index", collection, field);
		return this.knex.raw(`CREATE ${isUnique ? "UNIQUE " : ""}INDEX ?? ON ?? (??)`, [
			constraintName,
			collection,
			field
		]);
	}
	async parseCollectionName(collection) {
		return collection;
	}
};

//#endregion
export { SchemaHelper };