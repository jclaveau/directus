//#region src/utils/is-primary-key.ts
function isPrimaryKey(it) {
	return typeof it === "number" || typeof it === "string";
}
function isNotPrimaryKey(it) {
	return !isPrimaryKey(it);
}

//#endregion
export { isNotPrimaryKey, isPrimaryKey };