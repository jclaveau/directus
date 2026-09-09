//#region browser/css-var.ts
/**
* Get the value of a globally registered CSS variable
*/
function cssVar(name, element = document.body) {
	return getComputedStyle(element ?? document.body).getPropertyValue(name).trim();
}

//#endregion
export { cssVar };