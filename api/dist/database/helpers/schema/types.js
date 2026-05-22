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
};

//#endregion
export { SchemaHelper };