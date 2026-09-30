//#region src/permissions/modules/process-ast/utils/stringify-query-path.ts
function stringifyQueryPath(queryPath) {
	return queryPath.join(".");
}

//#endregion
export { stringifyQueryPath };