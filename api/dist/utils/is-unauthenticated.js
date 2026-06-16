//#region src/utils/is-unauthenticated.ts
/**
* Checks if the given accountability is unauthenticated
*
* @param accountability
* @returns True if the user is unauthenticated, false otherwise.
*/
function isUnauthenticated(accountability) {
	if (accountability === null) return false;
	if (accountability === void 0) return true;
	return accountability?.role === null && accountability?.user === null;
}

//#endregion
export { isUnauthenticated };