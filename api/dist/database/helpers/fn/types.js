import { DatabaseHelper } from "../types.js";
import { generateRelationalQueryAlias } from "../../run-ast/utils/generate-alias.js";
import { applyFilter } from "../../run-ast/lib/apply-query/filter/index.js";
import { parseJSON } from "@directus/utils";

//#region src/database/helpers/fn/types.ts
var FnHelper = class extends DatabaseHelper {
	constructor(knex, schema) {
		super(knex);
		this.schema = schema;
		this.schema = schema;
	}
	/**
	* Parse a value returned from a json() function query.
	* Most databases return objects/arrays as stringified JSON — override this to skip parsing
	* for drivers that already deserialize the result (e.g. the pg driver for PostgreSQL).
	*/
	parseJsonResult(value) {
		if (typeof value !== "string") return value;
		try {
			const parsed = parseJSON(value);
			if (typeof parsed === "object" && parsed !== null) return parsed;
		} catch {}
		return value;
	}
	_relationalCount(table, column, options) {
		const collectionName = options?.originalCollectionName || table;
		const relation = this.schema.relations.find((relation$1) => relation$1.related_collection === collectionName && relation$1?.meta?.one_field === column);
		const currentPrimary = this.schema.collections[collectionName].primary;
		if (!relation) throw new Error(`Field ${collectionName}.${column} isn't a nested relational collection`);
		const alias = generateRelationalQueryAlias(table, column, collectionName, options);
		let countQuery = this.knex.count("*").from({ [alias]: relation.collection }).where(this.knex.raw(`??.??`, [alias, relation.field]), "=", this.knex.raw(`??.??`, [table, currentPrimary]));
		if (options?.relationalCountOptions?.query.filter) {
			const aliasMap = { "": {
				alias,
				collection: relation.collection
			} };
			countQuery = applyFilter(this.knex, this.schema, countQuery, options.relationalCountOptions.query.filter, relation.collection, aliasMap, options.relationalCountOptions.cases, options.relationalCountOptions.permissions).query;
		}
		const { sql, bindings } = countQuery.toSQL();
		return this.knex.raw(`(${sql})`, bindings);
	}
};

//#endregion
export { FnHelper };