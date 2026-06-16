import { getAllowedSort } from "./utils/get-allowed-sort.js";
import { parseFields } from "./lib/parse-fields.js";
import { cloneDeep, uniq } from "lodash-es";

//#region src/database/get-ast-from-query/get-ast-from-query.ts
async function getAstFromQuery(options, context) {
	options.query = cloneDeep(options.query);
	const ast = {
		type: "root",
		name: options.collection,
		query: options.query,
		children: [],
		cases: []
	};
	let fields = ["*"];
	if (options.query.fields) fields = options.query.fields;
	/**
	* When using aggregate functions, you can't have any other regular fields
	* selected. This makes sure you never end up in a non-aggregate fields selection error
	*/
	if (Object.keys(options.query.aggregate || {}).length > 0) fields = [];
	/**
	* Similarly, when grouping on a specific field, you can't have other non-aggregated fields.
	* The group query will override the fields query
	*/
	if (options.query.group) fields = options.query.group;
	fields = uniq(fields);
	const deep = options.query.deep || {};
	delete options.query.fields;
	delete options.query.deep;
	options.query.sort ??= await getAllowedSort(options, context);
	if (options.query.aggregate && Object.keys(options.query.aggregate).length && !options.query.group?.[0]) delete options.query.sort;
	ast.children = await parseFields({
		parentCollection: options.collection,
		fields,
		query: options.query,
		deep,
		accountability: options.accountability
	}, context);
	return ast;
}

//#endregion
export { getAstFromQuery };