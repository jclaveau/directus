//#region src/utils/is-admin.ts
function isAdmin(accountability) {
	if (accountability === null) return true;
	if (accountability?.admin === true) return true;
	return false;
}

//#endregion
export { isAdmin };