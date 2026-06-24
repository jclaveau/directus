import { deepMapFilter } from "@directus/utils";

//#region src/websocket/collab/filter-to-fields.ts
function filterToFields(filter, collection, schema) {
	const fields = /* @__PURE__ */ new Set();
	deepMapFilter(filter, ([key, _value], context) => {
		if (context.leaf && context.field) fields.add([...context.path, key].join("."));
	}, {
		collection,
		schema
	});
	return Array.from(fields);
}

//#endregion
export { filterToFields };