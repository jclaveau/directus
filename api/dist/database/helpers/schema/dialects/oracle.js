import { getDefaultIndexName } from "../../../../utils/get-default-index-name.js";
import { SchemaHelper } from "../types.js";
import { prepQueryParams } from "../utils/prep-query-params.js";
import crypto from "node:crypto";

//#region src/database/helpers/schema/dialects/oracle.ts
var SchemaHelperOracle = class extends SchemaHelper {
	generateIndexName(type, collection, fields) {
		let indexName = getDefaultIndexName(type, collection, fields, { maxLength: Infinity });
		if (indexName.length > 128) indexName = crypto.createHash("sha1").update(indexName).digest("base64").replace("=", "");
		return indexName;
	}
	async changeToType(table, column, type, options = {}) {
		await this.changeToTypeByCopy(table, column, type, options);
	}
	castA2oPrimaryKey() {
		return "CAST(?? AS VARCHAR2(255))";
	}
	preRelationChange(relation) {
		if (relation.collection === relation.related_collection) {
			if (relation.schema?.on_delete) relation.schema.on_delete = null;
		}
	}
	processFieldType(field) {
		if (field.type === "integer") {
			if (field.schema?.numeric_precision === 20) return "bigInteger";
			else if (field.schema?.numeric_precision === 1) return "boolean";
			else if (field.schema?.numeric_precision || field.schema?.numeric_scale) return "decimal";
		}
		return field.type;
	}
	async getDatabaseSize() {
		try {
			const result = await this.knex.raw("select SUM(bytes) from dba_segments");
			return result[0]?.["SUM(BYTES)"] ? Number(result[0]?.["SUM(BYTES)"]) : null;
		} catch {
			return null;
		}
	}
	/**
	* Oracle throws an error when overwriting the nullable option for an existing column with the same value.
	*/
	setNullable(column, field, existing) {
		if (!existing) {
			super.setNullable(column, field, existing);
			return;
		}
		if (field.schema?.is_nullable === false && existing.is_nullable === true) column.notNullable();
		else if (field.schema?.is_nullable === true && existing.is_nullable === false) column.nullable();
	}
	prepQueryParams(queryParams) {
		return prepQueryParams(queryParams, { format: (index) => `:${index + 1}` });
	}
	prepBindings(bindings) {
		return Object.fromEntries(bindings.map((binding, index) => [index + 1, binding]));
	}
	addInnerSortFieldsToGroupBy(groupByFields, sortRecords, _hasRelationalSort) {
		if (sortRecords.length > 0) groupByFields.push(...sortRecords.map(({ column }) => column));
	}
	getColumnNameMaxLength() {
		return 128;
	}
	getTableNameMaxLength() {
		return 128;
	}
	async createIndex(collection, field, options = {}) {
		const isUnique = Boolean(options.unique);
		const constraintName = this.generateIndexName(isUnique ? "unique" : "index", collection, field);
		if (options.attemptConcurrentIndex) return this.knex.raw(`CREATE ${isUnique ? "UNIQUE " : ""}INDEX ?? ON ?? (??) ONLINE`, [
			constraintName,
			collection,
			field
		]);
		return this.knex.raw(`CREATE ${isUnique ? "UNIQUE " : ""}INDEX ?? ON ?? (??)`, [
			constraintName,
			collection,
			field
		]);
	}
};

//#endregion
export { SchemaHelperOracle };