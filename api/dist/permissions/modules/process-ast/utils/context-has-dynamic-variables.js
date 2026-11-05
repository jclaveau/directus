//#region src/permissions/modules/process-ast/utils/context-has-dynamic-variables.ts
function contextHasDynamicVariables(context) {
	return Object.values(context).some((v) => v.size > 0);
}

//#endregion
export { contextHasDynamicVariables };