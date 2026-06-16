import { parseFilterKey } from "../../../../utils/parse-filter-key.js";
import { getInfoForPath } from "../utils/get-info-for-path.js";
import { extractPathsFromQuery } from "../utils/extract-paths-from-query.js";
import { findRelatedCollection } from "../utils/find-related-collection.js";

//#region src/permissions/modules/process-ast/lib/extract-fields-from-query.ts
function extractFieldsFromQuery(collection, query, fieldMap, schema, pathPrefix = []) {
	if (!query) return;
	const { paths: otherPaths, readOnlyPaths } = extractPathsFromQuery(query);
	const groupedPaths = {
		other: otherPaths,
		read: readOnlyPaths
	};
	for (const [group, paths] of Object.entries(groupedPaths)) for (const path of paths) {
		/**
		* Current path stack. For each iteration of the path loop this will be appended with the
		* current part we're operating on. So when looping over ['category', 'created_by', 'name']
		* the first iteration it'll be `['category']`, and then `['category', 'created_by']` etc.
		*/
		const stack = [];
		/**
		* Current collection the path part we're operating on lives in. Once we hit a relational
		* field, this will be updated to the related collection, so we can follow the relational path
		* left to right.
		*/
		let collectionContext = collection;
		for (const part of path) {
			const info = getInfoForPath(fieldMap, group, [...pathPrefix, ...stack], collectionContext);
			if (part.includes(":")) {
				const [fieldKey, collection$1] = part.split(":");
				info.fields.add(fieldKey);
				collectionContext = collection$1;
				stack.push(part);
				continue;
			}
			if (part.startsWith("$FOLLOW(") && part.endsWith(")")) {} else {
				const { fieldName } = parseFilterKey(part);
				info.fields.add(fieldName);
			}
			/**
			* Related collection for the current part. Is null when the current field isn't a
			* relational field.
			*/
			const relatedCollection = findRelatedCollection(collectionContext, part, schema);
			if (relatedCollection) {
				collectionContext = relatedCollection;
				stack.push(part);
			}
		}
	}
}

//#endregion
export { extractFieldsFromQuery };