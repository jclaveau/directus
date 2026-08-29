import { cloneDeep } from "lodash-es";

//#region src/utils/freeze-schema.ts
function freezeSchema(schema) {
	for (const collectionName of Object.keys(schema.collections)) {
		if (!schema.collections[collectionName]) continue;
		for (const fieldName of Object.keys(schema.collections[collectionName].fields)) Object.freeze(schema.collections[collectionName].fields[fieldName]);
		Object.freeze(schema.collections[collectionName]);
	}
	Object.freeze(schema.collections);
	for (const relation of schema.relations) {
		if (relation.schema) Object.freeze(relation.schema);
		if (relation.meta) Object.freeze(relation.meta);
		Object.freeze(relation);
	}
	Object.freeze(schema.relations);
	return Object.freeze(schema);
}
function unfreezeSchema(schema) {
	if (Object.isFrozen(schema)) return cloneDeep(schema);
	else return schema;
}

//#endregion
export { freezeSchema, unfreezeSchema };