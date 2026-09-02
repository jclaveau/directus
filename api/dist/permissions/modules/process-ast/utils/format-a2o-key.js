//#region src/permissions/modules/process-ast/utils/format-a2o-key.ts
function formatA2oKey(fieldKey, collection) {
	return `${fieldKey}:${collection}`;
}

//#endregion
export { formatA2oKey };