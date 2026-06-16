import { parseJsonFunction } from "../../helpers/fn/json/parse-function.js";
import { extractFunctionName } from "../../../utils/extract-function-name.js";
import { parseFilterKey } from "../../../utils/parse-filter-key.js";

//#region src/database/run-ast/lib/parse-current-level.ts
async function parseCurrentLevel(schema, collection, children, query) {
	const primaryKeyField = schema.collections[collection].primary;
	const columnsInCollection = Object.keys(schema.collections[collection].fields);
	const columnsToSelectInternal = [];
	const nestedCollectionNodes = [];
	for (const child of children) {
		if (child.type === "field" || child.type === "functionField") {
			let fieldName;
			if (child.type === "functionField" && extractFunctionName(child.name) === "json") fieldName = parseJsonFunction(child.name).field;
			else fieldName = parseFilterKey(child.name).fieldName;
			if (columnsInCollection.includes(fieldName)) columnsToSelectInternal.push(child.fieldKey);
			continue;
		}
		if (!child.relation) continue;
		if (child.type === "m2o") columnsToSelectInternal.push(child.relation.field);
		if (child.type === "a2o") {
			columnsToSelectInternal.push(child.relation.field);
			columnsToSelectInternal.push(child.relation.meta.one_collection_field);
		}
		nestedCollectionNodes.push(child);
	}
	/** Always fetch primary key in case there's a nested relation that needs it. Aggregate payloads
	* can't have nested relational fields
	*/
	if (((query.group || query.aggregate && Object.keys(query.aggregate).length > 0) ?? false) === false && columnsToSelectInternal.includes(primaryKeyField) === false) columnsToSelectInternal.push(primaryKeyField);
	return {
		fieldNodes: [...new Set(columnsToSelectInternal)].map((column) => children.find((childNode) => (childNode.type === "field" || childNode.type === "functionField") && childNode.fieldKey === column) ?? {
			type: "field",
			name: column,
			fieldKey: column
		}),
		nestedCollectionNodes,
		primaryKeyField
	};
}

//#endregion
export { parseCurrentLevel };