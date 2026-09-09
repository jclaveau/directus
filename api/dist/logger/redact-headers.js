import { REDACTED_TEXT } from "@directus/utils";

//#region src/logger/redact-headers.ts
/**
* pino redact `censor` for the HTTP logger.
*
* Scalar paths (authorization / cookie / access_token) are fully replaced with
* {@link REDACTED_TEXT}. For the `res.headers` object only the `set-cookie` entry is
* redacted, leaving the rest of the headers intact.
*
* pino 10 types the censor `value` as `unknown` (it was implicitly `any` before), so
* the object access is guarded before reading/writing `set-cookie`.
*/
function redactHeaders(value, pathParts) {
	if (pathParts.join(".") === "res.headers") {
		if (value && typeof value === "object" && "set-cookie" in value) value["set-cookie"] = REDACTED_TEXT;
		return value;
	}
	return REDACTED_TEXT;
}

//#endregion
export { redactHeaders };