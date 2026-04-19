import { useLogger } from "../logger/index.js";
import isUrlAllowed from "./is-url-allowed.js";
import { useEnv } from "@directus/env";
import { toArray } from "@directus/utils";

//#region src/utils/is-login-redirect-allowed.ts
/**
* Checks if the defined redirect after successful SSO login is in the allow list
*/
function isLoginRedirectAllowed(redirect, provider) {
	if (!redirect) return true;
	if (typeof redirect !== "string") return false;
	const env = useEnv();
	const publicUrl = env["PUBLIC_URL"];
	if (URL.canParse(redirect) === false) {
		if (redirect.startsWith("//") === false) return true;
		return false;
	}
	const { protocol: redirectProtocol, hostname: redirectDomain } = new URL(redirect);
	const envKey = `AUTH_${provider.toUpperCase()}_REDIRECT_ALLOW_LIST`;
	if (envKey in env) {
		if (isUrlAllowed(redirect, [...toArray(env[envKey]), publicUrl])) return true;
	}
	if (URL.canParse(publicUrl) === false) {
		useLogger().error("Invalid PUBLIC_URL for login redirect");
		return false;
	}
	const { protocol: publicProtocol, hostname: publicDomain } = new URL(publicUrl);
	return `${redirectProtocol}//${redirectDomain}` === `${publicProtocol}//${publicDomain}`;
}

//#endregion
export { isLoginRedirectAllowed };