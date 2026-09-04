import { isString } from "lodash-es";

//#region src/database/helpers/schema/utils/prep-query-params.ts
/**
* Preprocess a SQL query, such that repeated binding values are bound to the same binding index.
**/
function prepQueryParams(queryParams, options) {
	const query = {
		bindings: [],
		...isString(queryParams) ? { sql: queryParams } : queryParams
	};
	const bindingIndices = /* @__PURE__ */ new Map();
	const bindings = [];
	let matchIndex = 0;
	let nextBindingIndex = 0;
	const sql = query.sql.replace(/(\\*)(\?)/g, (_, escapes) => {
		if (escapes.length % 2) return `${"\\".repeat(escapes.length)}?`;
		const binding = query.bindings[matchIndex];
		let bindingIndex;
		if (bindingIndices.has(binding)) bindingIndex = bindingIndices.get(binding);
		else {
			bindingIndex = nextBindingIndex++;
			bindingIndices.set(binding, bindingIndex);
			bindings.push(binding);
		}
		matchIndex++;
		return options.format(bindingIndex);
	});
	return {
		...query,
		sql,
		bindings
	};
}

//#endregion
export { prepQueryParams };