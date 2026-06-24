import { Url } from "../../utils/url.js";
import { useEnv } from "@directus/env";
import { toArray } from "@directus/utils";

//#region src/auth/utils/generate-callback-url.ts
/**
* Find a matching public URL based on the request origins protocol and host
*
* @param requestOrigin - The origin of the request
* @param allowedPublicUrls - The allowed public URLs from AUTH_ALLOWED_PUBLIC_URLS
* @returns The matching public URL
*/
function findMatchingPublicUrl(requestOrigin, allowedPublicUrls) {
	for (const allowedUrl of allowedPublicUrls) {
		if (!URL.canParse(allowedUrl)) continue;
		const { protocol, host } = new URL(allowedUrl);
		if (requestOrigin === `${protocol}//${host}`) return allowedUrl;
	}
	return null;
}
/**
* Dynamically generate the callback URL for OAuth2/OpenID SSO providers
*
* Uses AUTH_ALLOWED_PUBLIC_URLS to find an alternate PUBLIC_URL based on the origins protocol and host.
* Defaults to the PUBLIC_URL if no match is found.
*
* @param providerName SSO provider name
* @param requestOrigin Origin of the request (protocol + host)
* @returns Callback URL
*/
function generateCallbackUrl(providerName, requestOrigin) {
	const env = useEnv();
	const publicUrl = env["PUBLIC_URL"];
	return new Url(findMatchingPublicUrl(requestOrigin, env["AUTH_ALLOWED_PUBLIC_URLS"] ? toArray(env["AUTH_ALLOWED_PUBLIC_URLS"]) : []) || publicUrl).addPath("auth", "login", providerName, "callback").toString();
}

//#endregion
export { generateCallbackUrl };