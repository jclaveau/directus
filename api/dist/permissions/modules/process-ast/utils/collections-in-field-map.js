//#region src/permissions/modules/process-ast/utils/collections-in-field-map.ts
function collectionsInFieldMap(fieldMap) {
	const collections = /* @__PURE__ */ new Set();
	for (const { collection } of [...fieldMap.other.values(), ...fieldMap.read.values()]) collections.add(collection);
	return Array.from(collections);
}

//#endregion
export { collectionsInFieldMap };