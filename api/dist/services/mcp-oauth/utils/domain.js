//#region src/services/mcp-oauth/utils/domain.ts
/**
* Check if a hostname matches any of the provided domain patterns.
* Supports exact match and `*.example.com` wildcard prefix (matches subdomains, not base).
* Case-insensitive. Whitespace in patterns is trimmed.
*/
function isDomainAllowed(hostname, patterns) {
	const lower = hostname.toLowerCase();
	for (const pattern of patterns) {
		const p = pattern.toLowerCase().trim();
		if (!p) continue;
		if (p.startsWith("*.")) {
			const suffix = p.slice(1);
			if (lower.endsWith(suffix) && lower.length > suffix.length) return true;
		} else if (lower === p) return true;
	}
	return false;
}

//#endregion
export { isDomainAllowed };