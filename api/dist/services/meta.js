import database_default from "../database/index.js";
import { processAst } from "../permissions/modules/process-ast/process-ast.js";
import { getAstFromQuery } from "../database/get-ast-from-query/get-ast-from-query.js";
import { runAst } from "../database/run-ast/run-ast.js";
import { isArray } from "lodash-es";

//#region src/services/meta.ts
var MetaService = class {
	knex;
	accountability;
	schema;
	constructor(options) {
		this.knex = options.knex || database_default();
		this.accountability = options.accountability || null;
		this.schema = options.schema;
	}
	async getMetaForQuery(collection, query) {
		if (!query || !query.meta) return;
		return (await Promise.all(query.meta.map((metaVal) => {
			if (metaVal === "total_count") return this.totalCount(collection);
			if (metaVal === "filter_count") return this.filterCount(collection, query);
		}))).reduce((metaObject, value, index) => {
			return {
				...metaObject,
				[query.meta[index]]: value
			};
		}, {});
	}
	async totalCount(collection) {
		return this.filterCount(collection, {});
	}
	async filterCount(collection, query) {
		const primaryKeyName = this.schema.collections[collection].primary;
		let ast = await getAstFromQuery({
			collection,
			query: {
				aggregate: { countDistinct: [primaryKeyName] },
				search: query.search ?? null,
				filter: query.filter ?? null
			},
			accountability: this.accountability
		}, {
			schema: this.schema,
			knex: this.knex
		});
		ast = await processAst({
			ast,
			action: "read",
			accountability: this.accountability
		}, {
			knex: this.knex,
			schema: this.schema
		});
		const records = await runAst(ast, this.schema, this.accountability, { knex: this.knex });
		return Number((isArray(records) ? records[0]?.["countDistinct"][primaryKeyName] : records?.["countDistinct"][primaryKeyName]) ?? 0);
	}
};

//#endregion
export { MetaService };