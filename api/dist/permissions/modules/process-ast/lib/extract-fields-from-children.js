import { getUnaliasedFieldKey } from "../../../utils/get-unaliased-field-key.js";
import { formatA2oKey } from "../utils/format-a2o-key.js";
import { getInfoForPath } from "../utils/get-info-for-path.js";
import { extractFieldsFromQuery } from "./extract-fields-from-query.js";

//#region src/permissions/modules/process-ast/lib/extract-fields-from-children.ts
function extractFieldsFromChildren(collection, children, fieldMap, schema, path = []) {
	const info = getInfoForPath(fieldMap, "other", path, collection);
	for (const child of children) {
		info.fields.add(getUnaliasedFieldKey(child));
		if (child.type === "a2o") {
			for (const [collection$1, children$1] of Object.entries(child.children)) extractFieldsFromChildren(collection$1, children$1, fieldMap, schema, [...path, formatA2oKey(child.fieldKey, collection$1)]);
			if (child.query) for (const [collection$1, query] of Object.entries(child.query)) extractFieldsFromQuery(collection$1, query, fieldMap, schema, [...path, formatA2oKey(child.fieldKey, collection$1)]);
		} else if (child.type === "m2o") {
			extractFieldsFromChildren(child.relation.related_collection, child.children, fieldMap, schema, [...path, child.fieldKey]);
			extractFieldsFromQuery(child.relation.related_collection, child.query, fieldMap, schema, [...path, child.fieldKey]);
		} else if (child.type === "o2m") {
			extractFieldsFromChildren(child.relation.collection, child.children, fieldMap, schema, [...path, child.fieldKey]);
			extractFieldsFromQuery(child.relation.collection, child.query, fieldMap, schema, [...path, child.fieldKey]);
		} else if (child.type === "functionField") {
			extractFieldsFromChildren(child.relatedCollection, [], fieldMap, schema, [...path, child.fieldKey]);
			extractFieldsFromQuery(child.relatedCollection, child.query, fieldMap, schema, [...path, child.fieldKey]);
		}
	}
}

//#endregion
export { extractFieldsFromChildren };