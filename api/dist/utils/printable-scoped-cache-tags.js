//#region src/utils/printable-scoped-cache-tags.ts
function printableScopedCacheTags(serialized) {
	return Array.from(serialized).map((char) => {
		const code = char.charCodeAt(0);
		return code >= 32 && code <= 126 ? char : encodeURIComponent(char);
	}).join("");
}

//#endregion
export { printableScopedCacheTags };