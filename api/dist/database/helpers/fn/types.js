import { DatabaseHelper } from "../types.js";
import { applyFilter } from "../../run-ast/lib/apply-query/filter/index.js";
import { generateAlias } from "../../run-ast/lib/apply-query/index.js";

//#region src/database/helpers/fn/types.ts
var FnHelper = class extends DatabaseHelper {
	constructor(knex, schema) {
		super(knex);
		this.schema = schema;
		this.schema = schema;
	}
	_relationalCount(table, column, options) {
		const collectionName = options?.originalCollectionName || table;
		const relation = this.schema.relations.find((relation$1) => relation$1.related_collection === collectionName && relation$1?.meta?.one_field === column);
		const currentPrimary = this.schema.collections[collectionName].primary;
		if (!relation) throw new Error(`Field ${collectionName}.${column} isn't a nested relational collection`);
		const alias = generateAlias();
		let countQuery = this.knex.count("*").from({ [alias]: relation.collection }).where(this.knex.raw(`??.??`, [alias, relation.field]), "=", this.knex.raw(`??.??`, [table, currentPrimary]));
		if (options?.relationalCountOptions?.query.filter) {
			const aliasMap = { "": {
				alias,
				collection: relation.collection
			} };
			countQuery = applyFilter(this.knex, this.schema, countQuery, options.relationalCountOptions.query.filter, relation.collection, aliasMap, options.relationalCountOptions.cases, options.relationalCountOptions.permissions).query;
		}
		return this.knex.raw("(" + countQuery.toQuery() + ")");
	}
};

//#endregion
export { FnHelper };