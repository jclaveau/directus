import { getRelationInfo } from "../../../../utils/get-relation-info.js";

//#region src/permissions/modules/process-ast/utils/find-related-collection.ts
function findRelatedCollection(collection, field, schema) {
	const { relation } = getRelationInfo(schema.relations, collection, field);
	if (!relation) return null;
	return relation.related_collection === collection ? relation.collection : relation.related_collection;
}

//#endregion
export { findRelatedCollection };