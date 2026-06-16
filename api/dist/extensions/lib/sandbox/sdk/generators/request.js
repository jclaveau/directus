import { getAxios } from "../../../../../request/index.js";
import encodeURL from "encodeurl";
import globToRegExp from "glob-to-regexp";

//#region src/extensions/lib/sandbox/sdk/generators/request.ts
function requestGenerator(requestedScopes) {
	return async (url, options) => {
		if (url.typeof !== "string") throw new TypeError("Request url has to be of type string");
		if (options.typeof !== "undefined" && options.typeof !== "object") throw new TypeError("Request options has to be of type object");
		const urlCopied = await url.copy();
		const permissions = requestedScopes.request;
		if (permissions === void 0) throw new Error("No permission to access \"request\"");
		if (permissions.urls.some((urlScope) => {
			return globToRegExp(urlScope).test(urlCopied);
		}) === false) throw new Error(`No permission to request "${urlCopied}"`);
		const method = options.typeof !== "undefined" ? await options.get("method", { reference: true }) : void 0;
		const body = options.typeof !== "undefined" ? await options.get("body", { reference: true }) : void 0;
		const headers = options.typeof !== "undefined" ? await options.get("headers", { reference: true }) : void 0;
		if (method !== void 0 && method.typeof !== "undefined" && method.typeof !== "string") throw new TypeError("Request method has to be of type string");
		if (body !== void 0 && body.typeof !== "undefined" && body.typeof !== "string" && body.typeof !== "object") throw new TypeError("Request body has to be of type string or object");
		if (headers !== void 0 && headers.typeof !== "undefined" && headers.typeof !== "object") throw new TypeError("Request headers has to be of type object");
		const methodCopied = await method?.copy();
		const bodyCopied = await body?.copy();
		const headersCopied = await headers?.copy();
		if (!permissions.methods.includes(methodCopied ?? "GET")) throw new Error(`No permission to use request method "${methodCopied}"`);
		const result = await (await getAxios())({
			url: encodeURL(urlCopied),
			method: methodCopied ?? "GET",
			data: bodyCopied ?? null,
			headers: headersCopied ?? {}
		});
		return {
			status: result.status,
			statusText: result.statusText,
			headers: result.headers,
			data: result.data
		};
	};
}

//#endregion
export { requestGenerator };