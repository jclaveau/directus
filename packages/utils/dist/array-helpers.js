//#region shared/array-helpers.ts
function isIn(value, array) {
	return array.includes(value);
}
function isTypeIn(object, array) {
	if (!object.type) return false;
	return array.includes(object.type);
}

//#endregion
export { isIn, isTypeIn };