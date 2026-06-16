import { isMcpPath } from "../ai/mcp/utils.js";
import { ForbiddenError } from "@directus/errors";

//#region src/middleware/mcp-oauth-guard.ts
/**
* OAuth session route guard. If `accountability.oauth` is set, restrict to MCP endpoints only.
* All other Directus API routes are forbidden. Regular sessions pass through untouched.
*/
function handler(req, _res, next) {
	if (!req.accountability?.oauth) {
		next();
		return;
	}
	if (!isMcpPath(req.path) || req.method !== "GET" && req.method !== "POST") {
		next(new ForbiddenError());
		return;
	}
	next();
}
var mcp_oauth_guard_default = handler;

//#endregion
export { mcp_oauth_guard_default as default, handler };