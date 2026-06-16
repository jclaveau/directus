import { useEnv } from "@directus/env";

//#region src/ai/mcp/utils.ts
/** The only OAuth scope for MCP access. Used in JWT claims, discovery metadata, and scope validation. */
const MCP_ACCESS_SCOPE = "mcp:access";
/**
* Canonical MCP resource and discovery URLs derived from PUBLIC_URL.
*/
function getMcpUrls() {
	const base = useEnv()["PUBLIC_URL"].replace(/\/+$/, "");
	return {
		issuerUrl: base || "/",
		resourceUrl: `${base}/mcp`,
		metadataUrl: `${base}/.well-known/oauth-protected-resource/mcp`
	};
}
/** Check if a request path targets the concrete MCP endpoint. */
function isMcpPath(path) {
	return path === "/mcp" || path === "/mcp/";
}
/**
* RFC 6750 / RFC 9728 WWW-Authenticate header for MCP OAuth responses.
*/
function buildMcpWWWAuthenticateHeader(metadataUrl, error) {
	let header = `Bearer resource_metadata="${metadataUrl}", scope="${MCP_ACCESS_SCOPE}"`;
	if (error) header += `, error="${error}"`;
	return header;
}

//#endregion
export { MCP_ACCESS_SCOPE, buildMcpWWWAuthenticateHeader, getMcpUrls, isMcpPath };