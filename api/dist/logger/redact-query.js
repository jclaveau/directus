import { REDACTED_TEXT } from "@directus/utils";

//#region src/logger/redact-query.ts
function redactQuery(originalPath) {
	try {
		const url = new URL(originalPath, "http://example.com/");
		if (url.searchParams.has("access_token")) url.searchParams.set("access_token", REDACTED_TEXT);
		return url.pathname + url.search;
	} catch {
		return originalPath;
	}
}

//#endregion
export { redactQuery };