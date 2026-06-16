//#region src/services/fields/build-collection-and-field-relations.ts
/**
* Builds two maps where collectionRelationTree is a map of collection to related collections
* and fieldToCollectionList is a map of field:collection to related collection.
*
* @example
* returns {
* 		collectionRelationTree: new Map([
* 			['B', new Set(['A'])],
* 			['A', new Set(['B'])],
* 		]),
* 		fieldToCollectionList: new Map([
* 			['B:b', 'A'],
* 			['A:a', 'B'],
* 		]),
* }
*/
function buildCollectionAndFieldRelations(relations) {
	const collectionRelationTree = /* @__PURE__ */ new Map();
	const fieldToCollectionList = /* @__PURE__ */ new Map();
	for (const relation of relations) {
		let relatedCollections = [];
		if (relation.related_collection) relatedCollections.push(relation.related_collection);
		else if (relation.meta?.one_collection_field && relation.meta?.one_allowed_collections) relatedCollections = relation.meta?.one_allowed_collections;
		else continue;
		for (const relatedCollection of relatedCollections) {
			let fieldToCollectionListKey = relation.collection + ":" + relation.field;
			const collectionList = collectionRelationTree.get(relatedCollection) ?? /* @__PURE__ */ new Set();
			collectionList.add(relation.collection);
			if (relation.meta?.one_field) {
				const relatedfieldToCollectionListKey = relatedCollection + ":" + relation.meta.one_field;
				const realatedCollectionList = collectionRelationTree.get(relation.collection) ?? /* @__PURE__ */ new Set();
				realatedCollectionList.add(relatedCollection);
				fieldToCollectionList.set(relatedfieldToCollectionListKey, relation.collection);
				collectionRelationTree.set(relation.collection, realatedCollectionList);
			}
			if (relation.meta?.one_allowed_collections) fieldToCollectionListKey += ":" + relatedCollection;
			fieldToCollectionList.set(fieldToCollectionListKey, relatedCollection);
			collectionRelationTree.set(relatedCollection, collectionList);
		}
	}
	return {
		collectionRelationTree,
		fieldToCollectionList
	};
}

//#endregion
export { buildCollectionAndFieldRelations };