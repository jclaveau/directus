import { isSystemCollection } from "@directus/system-data";

//#region src/services/fields/get-collection-relation-list.ts
/**
* Returns a list of all related collections for a given collection.
* Or in math terms, returns the [strongly connected component](https://en.wikipedia.org/wiki/Strongly_connected_component) that a given node belongs to.
*/
function getCollectionRelationList(collection, collectionRelationTree) {
	const collectionRelationList = /* @__PURE__ */ new Set();
	traverseCollectionRelationTree(collection);
	return collectionRelationList;
	function traverseCollectionRelationTree(root) {
		const relationTree = collectionRelationTree.get(root);
		if (!relationTree) return;
		for (const relationNode of relationTree) addRelationNode(relationNode);
	}
	function addRelationNode(node) {
		if (isSystemCollection(node)) return;
		if (node === collection || collectionRelationList.has(node)) return;
		collectionRelationList.add(node);
		traverseCollectionRelationTree(node);
	}
}

//#endregion
export { getCollectionRelationList };