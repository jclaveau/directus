import { DiffKind } from "../packages/types/dist/index.js";
import { sanitizeCollection, sanitizeField, sanitizeRelation, sanitizeSystemField } from "./sanitize-schema.js";
import deepDiff from "deep-diff";

//#region src/utils/get-snapshot-diff.ts
function getSnapshotDiff(current, after) {
	const diffedSnapshot = {
		collections: [...current.collections.map((currentCollection) => {
			const afterCollection = after.collections.find((afterCollection$1) => afterCollection$1.collection === currentCollection.collection);
			const afterCollectionSanitized = afterCollection ? sanitizeCollection(afterCollection) : void 0;
			return {
				collection: currentCollection.collection,
				diff: deepDiff.diff(sanitizeCollection(currentCollection), afterCollectionSanitized)
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
				diff: deepDiff.diff(sanitizeField(currentField, isAutoIncrementPrimaryKey), void 0)
			};
			const afterFieldSanitized = afterField ? sanitizeField(afterField, isAutoIncrementPrimaryKey) : void 0;
			return {
				collection: currentField.collection,
				field: currentField.field,
				diff: deepDiff.diff(sanitizeField(currentField, isAutoIncrementPrimaryKey), afterFieldSanitized)
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
		systemFields: [...(current.systemFields ?? []).map((currentSystemField) => {
			const afterSystemField = (after.systemFields ?? []).find((afterSystemField$1) => afterSystemField$1.collection === currentSystemField.collection && afterSystemField$1.field === currentSystemField.field);
			const afterSystemFieldSanitized = afterSystemField ? sanitizeSystemField(afterSystemField) : invertIndexed(currentSystemField);
			return {
				collection: currentSystemField.collection,
				field: currentSystemField.field,
				diff: deepDiff.diff(sanitizeSystemField(currentSystemField), afterSystemFieldSanitized)
			};
		}), ...(after.systemFields ?? []).filter((afterSystemField) => {
			if (!afterSystemField.schema.is_indexed) return false;
			const currentSystemField = (current.systemFields ?? []).find((currentSystemField$1) => currentSystemField$1.collection === afterSystemField.collection && afterSystemField.field === currentSystemField$1.field);
			return Boolean(currentSystemField) === false;
		}).map((afterSystemField) => {
			const currentSystemField = (current.systemFields ?? []).find((currentSystemField$1) => currentSystemField$1.collection === afterSystemField.collection && currentSystemField$1.field === afterSystemField.field);
			const currentSystemFieldSanitized = currentSystemField ? sanitizeSystemField(currentSystemField) : invertIndexed(afterSystemField);
			return {
				collection: afterSystemField.collection,
				field: afterSystemField.field,
				diff: deepDiff.diff(currentSystemFieldSanitized, sanitizeSystemField(afterSystemField))
			};
		})].filter((obj) => Array.isArray(obj.diff)),
		relations: [...current.relations.map((currentRelation) => {
			const afterRelation = after.relations.find((afterRelation$1) => afterRelation$1.collection === currentRelation.collection && afterRelation$1.field === currentRelation.field);
			const afterRelationSanitized = afterRelation ? sanitizeRelation(afterRelation) : void 0;
			return {
				collection: currentRelation.collection,
				field: currentRelation.field,
				related_collection: currentRelation.related_collection,
				diff: deepDiff.diff(sanitizeRelation(currentRelation), afterRelationSanitized)
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
function invertIndexed(field) {
	const newSchema = { ...field.schema };
	if ("is_indexed" in field.schema) newSchema.is_indexed = !field.schema.is_indexed;
	return {
		...field,
		schema: newSchema
	};
}

//#endregion
export { getSnapshotDiff };