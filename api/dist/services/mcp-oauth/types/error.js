//#region src/services/mcp-oauth/types/error.ts
/**
* RFC 6749/7591 error with structured code for JSON serialization.
*
* `code` maps to the OAuth `error` field. `redirectable` controls whether
* the controller can redirect the error back to the client's redirect_uri
* (only safe after redirect_uri is validated against registered URIs).
*/
var OAuthError = class extends Error {
	constructor(status, code, description, redirectable = false, headers = {}) {
		super(description);
		this.status = status;
		this.code = code;
		this.description = description;
		this.redirectable = redirectable;
		this.headers = headers;
		this.name = "OAuthError";
	}
};

//#endregion
export { OAuthError };