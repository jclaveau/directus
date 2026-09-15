//#region src/database/helpers/number/utils/maybe-stringify-big-int.ts
function maybeStringifyBigInt(value) {
	if (value > Number.MAX_SAFE_INTEGER || value < Number.MIN_SAFE_INTEGER) return String(value);
	return Number(value);
}

//#endregion
export { maybeStringifyBigInt };