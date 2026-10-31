//#region src/utils/parse-numeric-string.ts
function parseNumericString(stringValue) {
	let number = Number(stringValue);
	if (isNaN(number) || !Number.isFinite(number)) return null;
	if (number > Number.MAX_SAFE_INTEGER || number < Number.MIN_SAFE_INTEGER) try {
		number = BigInt(stringValue);
	} catch {
		return null;
	}
	if (String(number) !== stringValue) return null;
	return number;
}

//#endregion
export { parseNumericString };