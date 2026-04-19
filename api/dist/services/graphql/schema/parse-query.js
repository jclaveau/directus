import { sanitizeQuery } from "../../../utils/sanitize-query.js";
import { validateQuery } from "../../../utils/validate-query.js";
import { replaceFuncs } from "../utils/replace-funcs.js";
import { parseArgs } from "./parse-args.js";
import { filterReplaceM2A, filterReplaceM2ADeep } from "../utils/filter-replace-m2a.js";
import { get, mapKeys, merge, set, uniq } from "lodash-es";

//#region src/services/graphql/schema/parse-query.ts
/**
* Get a Directus Query object from the parsed arguments (rawQuery) and GraphQL AST selectionSet. Converts SelectionSet into
* Directus' `fields` query for use in the resolver. Also applies variables where appropriate.
*/
async function getQuery(rawQuery, schema, selections, variableValues, accountability, collection) {
	const query = await sanitizeQuery(rawQuery, schema, accountability);
	const parseAliases = (selections$1) => {
		const aliases = {};
		for (const selection of selections$1) {
			if (selection.kind !== "Field") continue;
			if (selection.alias?.value) aliases[selection.alias.value] = selection.name.value;
		}
		return aliases;
	};
	const parseFields = async (selections$1, parent) => {
		const fields = [];
		for (let selection of selections$1) {
			if ((selection.kind === "Field" || selection.kind === "InlineFragment") !== true) continue;
			selection = selection;
			let current;
			let currentAlias = null;
			if (selection.kind === "InlineFragment") {
				if (selection.typeCondition.name.value.startsWith("__")) continue;
				current = `${parent}:${selection.typeCondition.name.value}`;
			} else {
				if (selection.name.value.startsWith("__")) continue;
				current = selection.name.value;
				if (selection.alias) currentAlias = selection.alias.value;
				if (parent) {
					current = `${parent}.${current}`;
					if (currentAlias) {
						currentAlias = `${parent}.${currentAlias}`;
						if (selection.selectionSet) {
							if (!query.deep) query.deep = {};
							set(query.deep, parent, merge({}, get(query.deep, parent), { _alias: { [selection.alias.value]: selection.name.value } }));
						}
					}
				}
			}
			if (selection.selectionSet) {
				let children;
				if (current.endsWith("_func")) {
					children = [];
					const rootField = current.slice(0, -5);
					for (const subSelection of selection.selectionSet.selections) {
						if (subSelection.kind !== "Field") continue;
						if (subSelection.name.value.startsWith("__")) continue;
						children.push(`${subSelection.name.value}(${rootField})`);
					}
				} else children = await parseFields(selection.selectionSet.selections, currentAlias ?? current);
				fields.push(...children);
			} else fields.push(current);
			if (selection.kind === "Field" && selection.arguments && selection.arguments.length > 0) {
				if (selection.arguments && selection.arguments.length > 0) {
					if (!query.deep) query.deep = {};
					const args = parseArgs(selection.arguments, variableValues);
					set(query.deep, currentAlias ?? current, merge({}, get(query.deep, currentAlias ?? current), mapKeys(await sanitizeQuery(args, schema, accountability), (_value, key) => `_${key}`)));
				}
			}
		}
		return uniq(fields);
	};
	query.alias = parseAliases(selections);
	query.fields = await parseFields(selections);
	if (query.filter) query.filter = replaceFuncs(query.filter);
	query.deep = replaceFuncs(query.deep);
	if (collection) {
		if (query.filter) query.filter = filterReplaceM2A(query.filter, collection, schema);
		query.deep = filterReplaceM2ADeep(query.deep, collection, schema);
	}
	validateQuery(query);
	return query;
}

//#endregion
export { getQuery };