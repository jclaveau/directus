import { parseJSON } from "@directus/utils";

//#region src/services/fields/get-collection-meta-updates.ts
function getCollectionMetaUpdates(collection, field, collectionMetas, collections, fieldToCollectionList) {
	const collectionMetaUpdates = [];
	for (const collectionMeta of collectionMetas) {
		let hasUpdates = false;
		const meta = {
			collection: collectionMeta.collection,
			updates: {}
		};
		if (collectionMeta.collection === collection) {
			if (collectionMeta?.archive_field === field) {
				meta.updates["archive_field"] = null;
				hasUpdates = true;
			}
			if (collectionMeta?.sort_field === field) {
				meta.updates["sort_field"] = null;
				hasUpdates = true;
			}
		}
		if (collectionMeta?.item_duplication_fields) {
			const itemDuplicationPaths = typeof collectionMeta.item_duplication_fields === "string" ? parseJSON(collectionMeta.item_duplication_fields) : collectionMeta.item_duplication_fields;
			const updatedPaths = [];
			for (const path of itemDuplicationPaths) {
				const updatedPath = updateItemDuplicationPath(path, collectionMeta.collection, field, collection, collections, fieldToCollectionList);
				if (updatedPath && updatedPath.length !== 0) updatedPaths.push(updatedPath.join("."));
			}
			if (updatedPaths.length !== itemDuplicationPaths.length) {
				meta.updates["item_duplication_fields"] = updatedPaths.length !== 0 ? JSON.stringify(updatedPaths) : null;
				hasUpdates = true;
			}
		}
		if (hasUpdates) collectionMetaUpdates.push(meta);
	}
	return collectionMetaUpdates;
}
function updateItemDuplicationPath(path, root, field, collection, collections, fieldToCollectionList) {
	let currentCollection = root;
	const parts = path.split(".");
	if ([
		field,
		`.${field}`,
		`.${field}.`,
		`${field}.`
	].some((fieldPart) => path.includes(fieldPart)) === false) return parts;
	const updatedParts = [];
	for (let index = 0; index < parts.length; index++) {
		const part = parts[index];
		if (currentCollection === collection && part === field) return;
		const isLastPart = index === parts.length - 1;
		const isLocalField = typeof collections[currentCollection]?.["fields"][part] !== "undefined";
		const nextCollectionNode = fieldToCollectionList.get(`${currentCollection}:${part}`);
		if (!nextCollectionNode && !isLastPart) return;
		if (!nextCollectionNode && isLastPart && !isLocalField) return;
		if (nextCollectionNode) currentCollection = nextCollectionNode;
		updatedParts.push(part);
	}
	return updatedParts;
}

//#endregion
export { getCollectionMetaUpdates };