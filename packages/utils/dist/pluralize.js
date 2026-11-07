//#region shared/pluralize.ts
function pluralize(str) {
	return `${str}s`;
}
function depluralize(str) {
	return str.slice(0, -1);
}

//#endregion
export { depluralize, pluralize };