import { sanitizeCollection, sanitizeField, sanitizeRelation } from "./sanitize-schema.js";
import { DiffKind } from "../types/snapshot.js";
import deepDiff from "deep-diff";

//#region src/utils/get-snapshot-diff.ts
function getSnapshotDiff(current, after) {
	const diffedSnapshot = {
		collections: [...current.collections.map((currentCollection) => {
			const afterCollection = after.collections.find((afterCollection$1) => afterCollection$1.collection === currentCollection.collection);
			return {
				collection: currentCollection.collection,
				diff: deepDiff.diff(sanitizeCollection(currentCollection), sanitizeCollection(afterCollection))
			};
		}), ...after.collections.filter((afterCollection) => {
			return !!current.collections.find((currentCollection) => currentCollection.collection === afterCollection.collection) === false;
		}).map((afterCollection) => ({
			collection: afterCollection.collection,
			diff: deepDiff.diff(void 0, sanitizeCollection(afterCollection))
		}))].filter((obj) => Array.isArray(obj.diff)),
		fields: [...current.fields.map((currentField) => {
			const afterField = after.fields.find((afterField$1) => afterField$1.collection === currentField.collection && afterField$1.field === currentField.field);
			const isAutoIncrementPrimaryKey = !!currentField.schema?.is_primary_key && !!currentField.schema?.has_auto_increment;
			if (afterField && currentField.type !== afterField.type && (currentField.type === "alias" || afterField.type === "alias")) return {
				collection: currentField.collection,
				field: currentField.field,
				diff: deepDiff.diff(sanitizeField(currentField, isAutoIncrementPrimaryKey), sanitizeField(void 0, isAutoIncrementPrimaryKey))
			};
			return {
				collection: currentField.collection,
				field: currentField.field,
				diff: deepDiff.diff(sanitizeField(currentField, isAutoIncrementPrimaryKey), sanitizeField(afterField, isAutoIncrementPrimaryKey))
			};
		}), ...after.fields.filter((afterField) => {
			let currentField = current.fields.find((currentField$1) => currentField$1.collection === afterField.collection && afterField.field === currentField$1.field);
			if (currentField && currentField.type !== afterField.type && (currentField.type === "alias" || afterField.type === "alias")) currentField = void 0;
			return !!currentField === false;
		}).map((afterField) => ({
			collection: afterField.collection,
			field: afterField.field,
			diff: deepDiff.diff(void 0, sanitizeField(afterField))
		}))].filter((obj) => Array.isArray(obj.diff)),
		relations: [...current.relations.map((currentRelation) => {
			const afterRelation = after.relations.find((afterRelation$1) => afterRelation$1.collection === currentRelation.collection && afterRelation$1.field === currentRelation.field);
			return {
				collection: currentRelation.collection,
				field: currentRelation.field,
				related_collection: currentRelation.related_collection,
				diff: deepDiff.diff(sanitizeRelation(currentRelation), sanitizeRelation(afterRelation))
			};
		}), ...after.relations.filter((afterRelation) => {
			return !!current.relations.find((currentRelation) => currentRelation.collection === afterRelation.collection && afterRelation.field === currentRelation.field) === false;
		}).map((afterRelation) => ({
			collection: afterRelation.collection,
			field: afterRelation.field,
			related_collection: afterRelation.related_collection,
			diff: deepDiff.diff(void 0, sanitizeRelation(afterRelation))
		}))].filter((obj) => Array.isArray(obj.diff))
	};
	/**
	* When you delete a collection, we don't have to individually drop all the fields/relations as well
	*/
	const deletedCollections = diffedSnapshot.collections.filter((collection) => collection.diff?.[0]?.kind === DiffKind.DELETE).map(({ collection }) => collection);
	diffedSnapshot.fields = diffedSnapshot.fields.filter((field) => deletedCollections.includes(field.collection) === false);
	diffedSnapshot.relations = diffedSnapshot.relations.filter((relation) => deletedCollections.includes(relation.collection) === false);
	return diffedSnapshot;
}

//#endregion
export { getSnapshotDiff };