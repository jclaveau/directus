//#region src/utils/parse-oauth-scope.ts
/**
* Parse an OAuth scope string into a deduplicated array of scope tokens.
* Per RFC 6749 Section 3.3, scope is a space-separated list of case-sensitive strings.
*/
function parseOAuthScope(scope) {
	if (typeof scope !== "string" || scope.trim() === "") return [];
	return [...new Set(scope.trim().split(/\s+/))];
}

//#endregion
export { parseOAuthScope };