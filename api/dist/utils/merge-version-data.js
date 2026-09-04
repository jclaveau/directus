import { cloneDeep } from "lodash-es";
import { isObject as isObject$1 } from "@directus/utils";
import Joi from "joi";

//#region src/utils/merge-version-data.ts
const alterationSchema = Joi.object({
	create: Joi.array().items(Joi.object().unknown()),
	update: Joi.array().items(Joi.object().unknown()),
	delete: Joi.array().items(Joi.string(), Joi.number())
});
function mergeVersionsRaw(item, versionData) {
	const result = cloneDeep(item);
	for (const versionRecord of versionData) for (const key of Object.keys(versionRecord)) result[key] = versionRecord[key];
	return result;
}
function mergeVersionsRecursive(item, versionData, collection, schema) {
	if (versionData.length === 0) return item;
	return recursiveMerging(item, versionData, collection, schema);
}
function recursiveMerging(data, versionData, collection, schema) {
	const result = cloneDeep(data);
	const relations = getRelations$1(collection, schema);
	for (const versionRecord of versionData) {
		if (!isObject$1(versionRecord)) continue;
		for (const key of Object.keys(data)) {
			if (key in versionRecord === false) continue;
			const currentValue = data[key];
			const newValue = versionRecord[key];
			if (typeof newValue !== "object" || newValue === null) {
				result[key] = newValue;
				continue;
			}
			if (key in relations === false) {
				if (isManyToAnyCollection(collection, schema) && key === "item") result[key] = recursiveMerging(addMissingKeys(isObject$1(currentValue) ? currentValue : {}, newValue), [newValue], data["collection"], schema);
				else result[key] = newValue;
				continue;
			}
			const { error } = alterationSchema.validate(newValue);
			if (error) {
				if (typeof newValue === "object" && key in relations) result[key] = recursiveMerging(!currentValue || typeof currentValue !== "object" ? newValue : currentValue, [newValue], relations[key], schema);
				continue;
			}
			const alterations = newValue;
			const currentPrimaryKeyField = schema.collections[collection].primary;
			const relatedPrimaryKeyField = schema.collections[relations[key]].primary;
			const mergedRelation = [];
			if (Array.isArray(currentValue)) {
				if (alterations.delete.length > 0) for (const currentItem of currentValue) {
					const currentId = typeof currentItem === "object" ? currentItem[currentPrimaryKeyField] : currentItem;
					if (alterations.delete.includes(currentId) === false) mergedRelation.push(currentItem);
				}
				else mergedRelation.push(...currentValue);
				if (alterations.update.length > 0) for (const updatedItem of alterations.update) {
					const itemIndex = mergedRelation.findIndex((currentItem) => currentItem[relatedPrimaryKeyField] === updatedItem[currentPrimaryKeyField]);
					if (itemIndex === -1) {
						const pkIndex = mergedRelation.findIndex((currentItem) => currentItem === updatedItem[currentPrimaryKeyField]);
						if (pkIndex === -1) mergedRelation.push(updatedItem);
						else mergedRelation[pkIndex] = updatedItem;
						continue;
					}
					mergedRelation[itemIndex] = recursiveMerging(addMissingKeys(mergedRelation[itemIndex], updatedItem), [updatedItem], relations[key], schema);
				}
			}
			if (alterations.create.length > 0) for (const createdItem of alterations.create) {
				const item = addMissingKeys({}, createdItem);
				mergedRelation.push(recursiveMerging(item, [createdItem], relations[key], schema));
			}
			result[key] = mergedRelation;
		}
	}
	return result;
}
function addMissingKeys(item, edits) {
	const result = { ...item };
	for (const key of Object.keys(edits)) if (key in item === false) result[key] = null;
	return result;
}
function isManyToAnyCollection(collection, schema) {
	const relation = schema.relations.find((relation$1) => relation$1.collection === collection && relation$1.meta?.many_collection === collection);
	if (!relation || !relation.meta?.one_field || !relation.related_collection) return false;
	return Boolean(schema.collections[relation.related_collection]?.fields[relation.meta.one_field]?.special.includes("m2a"));
}
function getRelations$1(collection, schema) {
	return schema.relations.reduce((result, relation) => {
		if (relation.related_collection === collection && relation.meta?.one_field) result[relation.meta.one_field] = relation.collection;
		if (relation.collection === collection && relation.related_collection) result[relation.field] = relation.related_collection;
		return result;
	}, {});
}

//#endregion
export { mergeVersionsRaw, mergeVersionsRecursive };