//#region src/permissions/modules/process-ast/utils/get-info-for-path.ts
function getInfoForPath(fieldMap, group, path, collection) {
	const pathStr = path.join(".");
	if (fieldMap[group].has(pathStr) === false) fieldMap[group].set(pathStr, {
		collection,
		fields: /* @__PURE__ */ new Set()
	});
	return fieldMap[group].get(pathStr);
}

//#endregion
export { getInfoForPath };