import isUrlAllowed from "../../utils/is-url-allowed.js";
import { useEnv } from "@directus/env";
import { toArray } from "@directus/utils";

//#region src/auth/utils/resolve-login-redirect.ts
/**
* Resolves and validates the redirect URL after a successful SSO login.
* Returns a safe redirect path or URL, or throws if the redirect is invalid or not allowed.
* @param redirect URL or relative path to redirect to after login
* @param opts.provider SSO provider name, used to check provider-specific allow lists
* @returns Resolved redirect path or URL string
* @throws If the redirect is not a string, PUBLIC_URL is not defined, or the redirect is not allowed
*/
function resolveLoginRedirect(redirect, opts = {}) {
	const env = useEnv();
	const publicURL = env["PUBLIC_URL"];
	if (!redirect) return "/";
	if (typeof redirect !== "string") throw new Error("\"redirect\" must be a string");
	if (!publicURL) throw new Error("\"PUBLIC_URL\" must be defined");
	if (URL.canParse(redirect) === false) try {
		const dummyDomain = "http://dummy.local";
		const { protocol: dummyProtocol, host: dummyHost } = new URL(dummyDomain);
		const parsedRelativeURL = new URL(redirect, dummyDomain);
		if (dummyProtocol !== parsedRelativeURL.protocol || dummyHost !== parsedRelativeURL.host) throw new Error("Relative URL mismatch");
		return parsedRelativeURL.toString().replace(dummyDomain, "");
	} catch {
		throw new Error("Invalid relative URL");
	}
	const parsedAbsoluteURL = new URL(redirect);
	if (!["http:", "https:"].includes(parsedAbsoluteURL.protocol)) throw new Error("Only http/https redirect protocols are allowed");
	if (opts.provider) {
		const envKey = `AUTH_${opts.provider.toUpperCase()}_REDIRECT_ALLOW_LIST`;
		if (envKey in env) {
			const allowedList = toArray(String(env[envKey]));
			allowedList.push(publicURL);
			if (isUrlAllowed(redirect, allowedList)) return parsedAbsoluteURL.toString();
		}
	}
	if (URL.canParse(publicURL) === false) throw new Error("PUBLIC_URL must be a valid URL");
	const { protocol: publicProtocol, host: publicHost } = new URL(publicURL);
	if (publicProtocol !== parsedAbsoluteURL.protocol || publicHost !== parsedAbsoluteURL.host) throw new Error("App \"redirect\" must match PUBLIC_URL");
	return parsedAbsoluteURL.toString();
}

//#endregion
export { resolveLoginRedirect };