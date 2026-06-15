import database_default from "../index.js";
import emitter_default from "../../emitter.js";
import { fetchPolicies } from "../../permissions/lib/fetch-policies.js";
import { fetchPermissions } from "../../permissions/lib/fetch-permissions.js";
import { getDBQuery } from "./lib/get-db-query.js";
import { parseCurrentLevel } from "./lib/parse-current-level.js";
import { PayloadService } from "../../services/payload.js";
import { applyParentFilters } from "./utils/apply-parent-filters.js";
import { mergeWithParentItems } from "./utils/merge-with-parent-items.js";
import { removeTemporaryFields } from "./utils/remove-temporary-fields.js";
import { useEnv } from "@directus/env";
import { cloneDeep, merge } from "lodash-es";

//#region src/database/run-ast/run-ast.ts
/**
* Execute a given AST using Knex. Returns array of items based on requested AST.
*/
async function runAst(originalAST, schema, accountability, options) {
	const ast = cloneDeep(originalAST);
	const knex = options?.knex || database_default();
	if (ast.type === "a2o") {
		const results = {};
		for (const collection of ast.names) results[collection] = await run(collection, ast.children[collection], ast.query[collection], ast.cases[collection] ?? [], accountability);
		return results;
	} else return await run(ast.name, ast.children, options?.query || ast.query, ast.cases, accountability);
	async function run(collection, children, query, cases, accountability$1) {
		const env = useEnv();
		const { fieldNodes, primaryKeyField, nestedCollectionNodes } = await parseCurrentLevel(schema, collection, children, query);
		const o2mNodes = nestedCollectionNodes.filter((node) => node.type === "o2m");
		let permissions = [];
		if (accountability$1 && !accountability$1.admin) permissions = await fetchPermissions({
			action: "read",
			accountability: accountability$1,
			policies: await fetchPolicies(accountability$1, {
				schema,
				knex
			})
		}, {
			schema,
			knex
		});
		let dbQuery = getDBQuery({
			table: collection,
			fieldNodes,
			o2mNodes,
			query,
			cases,
			permissions
		}, {
			schema,
			knex
		});
		dbQuery = await emitter_default.emitFilter(["items.db.select", `${collection}.db.select`], dbQuery, {
			query,
			collection
		}, {
			database: knex,
			schema,
			accountability: accountability$1
		});
		let rawItems = await dbQuery;
		rawItems = await emitter_default.emitFilter(["items.db.selected", `${collection}.db.selected`], rawItems, {
			query,
			collection
		}, {
			database: knex,
			schema,
			accountability: accountability$1
		});
		if (!rawItems) return null;
		let items = await new PayloadService(collection, {
			knex,
			schema
		}).processValues("read", rawItems, query.alias ?? {}, query.aggregate ?? {});
		if (!items || Array.isArray(items) && items.length === 0) return items;
		const nestedNodes = applyParentFilters(schema, nestedCollectionNodes, items);
		for (const nestedNode of nestedNodes) {
			let nestedItems = [];
			if (nestedNode.type === "o2m") {
				let hasMore = true;
				let batchCount = 0;
				const hasWhenCase = nestedNode.whenCase && nestedNode.whenCase.length > 0;
				let fieldAllowed = true;
				if (hasWhenCase) if (Array.isArray(items)) {
					fieldAllowed = [];
					for (const item of items) {
						fieldAllowed.push(!!item[nestedNode.fieldKey]);
						delete item[nestedNode.fieldKey];
					}
				} else {
					fieldAllowed = !!items[nestedNode.fieldKey];
					delete items[nestedNode.fieldKey];
				}
				while (hasMore) {
					nestedItems = await runAst(merge({}, nestedNode, { query: {
						limit: env["RELATIONAL_BATCH_SIZE"],
						offset: batchCount * env["RELATIONAL_BATCH_SIZE"],
						page: null
					} }), schema, accountability$1, {
						knex,
						nested: true
					});
					if (nestedItems) items = mergeWithParentItems(schema, nestedItems, items, nestedNode, fieldAllowed);
					if (!nestedItems || nestedItems.length < env["RELATIONAL_BATCH_SIZE"]) hasMore = false;
					batchCount++;
				}
			} else {
				nestedItems = await runAst(merge({}, nestedNode, { query: { limit: -1 } }), schema, accountability$1, {
					knex,
					nested: true
				});
				if (nestedItems) items = mergeWithParentItems(schema, nestedItems, items, nestedNode, true);
			}
		}
		if (options?.nested !== true && options?.stripNonRequested !== false) items = removeTemporaryFields(schema, items, originalAST, primaryKeyField);
		return items;
	}
}

//#endregion
export { runAst };