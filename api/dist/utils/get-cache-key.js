import database_default from "../database/index.js";
import { ipInNetworks } from "./ip-in-networks.js";
import { fetchPoliciesIpAccess } from "../permissions/modules/fetch-policies-ip-access/fetch-policies-ip-access.js";
import { getGraphqlQueryAndVariables } from "./get-graphql-query-and-variables.js";
import { useEnv } from "@directus/env";
import hash from "object-hash";
import url from "url";
import { version } from "directus/version";

//#region src/utils/get-cache-key.ts
function sortNestedKeys(_key, value) {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const entries = Object.entries(value);
		return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
	}
	return value;
}
function normalizePrimaryLanguage(req) {
	const header = req.headers?.["accept-language"];
	if (typeof header !== "string") return null;
	let bestTag = null;
	let bestQuality = 0;
	for (const entry of header.split(",")) {
		const [rawTag, ...params] = entry.trim().split(";");
		const tag = rawTag?.trim();
		if (!tag || tag === "*") continue;
		const qParam = params.find((param) => param.trim().startsWith("q="));
		const quality = qParam ? Number.parseFloat(qParam.split("=")[1] ?? "") : 1;
		if (!Number.isNaN(quality) && quality > bestQuality) {
			bestQuality = quality;
			bestTag = tag;
		}
	}
	return bestTag ? bestTag.split("-")[0].toLowerCase() : null;
}
function varyList(value) {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.map((entry) => String(entry).trim()).filter(Boolean))];
}
function negotiateContentType(req, types) {
	if (types.length === 0) return;
	return req.accepts(types) || null;
}
function varyHeaderValue(raw) {
	if (raw === void 0) return null;
	return Array.isArray(raw) ? raw.join(",") : raw;
}
function varyHeaderPattern(pattern) {
	const escaped = pattern.replace(/\*+/g, "*").replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return /* @__PURE__ */ new RegExp(`^${escaped}$`);
}
const BASE_EXCLUDED_HEADERS = [
	"x-forwarded-*",
	"x-real-ip",
	"x-railway-*",
	"fly-*",
	"cf-*",
	"x-amzn-*",
	"x-amz-cf-*",
	"x-envoy-*",
	"x-b3-*",
	"x-request-id",
	"x-correlation-id",
	"forwarded",
	"via",
	"traceparent",
	"tracestate"
].map(varyHeaderPattern);
function resolveVaryHeaders(req, patterns, excluded) {
	if (patterns.length === 0) return;
	const resolved = {};
	for (const pattern of patterns) {
		const name = pattern.toLowerCase();
		if (!name.includes("*")) {
			resolved[name] = varyHeaderValue(req.headers[name]);
			continue;
		}
		const regex = varyHeaderPattern(name);
		for (const header of Object.keys(req.headers)) {
			if (!regex.test(header)) continue;
			if (excluded.some((denied) => denied.test(header))) continue;
			resolved[header] = varyHeaderValue(req.headers[header]);
		}
	}
	return resolved;
}
async function getCacheKey(req) {
	const path = url.parse(req.originalUrl).pathname;
	const isGraphQl = path?.startsWith("/graphql");
	let includeIp = false;
	if (req.accountability && req.accountability.ip) {
		const ipFilters = await fetchPoliciesIpAccess(req.accountability, database_default());
		includeIp = ipFilters.length > 0 && ipFilters.some((networks) => ipInNetworks(req.accountability.ip, networks));
	}
	const env = useEnv();
	const info = {
		version,
		user: req.accountability?.user || null,
		path,
		query: isGraphQl ? getGraphqlQueryAndVariables(req) : req.sanitizedQuery,
		...includeIp && { ip: req.accountability.ip }
	};
	const language = normalizePrimaryLanguage(req);
	if (language !== null) info["language"] = language;
	const contentType = negotiateContentType(req, varyList(env["CACHE_VARY_CONTENT_TYPES"]));
	if (contentType !== void 0) info["contentType"] = contentType;
	const excludedHeaders = [...BASE_EXCLUDED_HEADERS, ...varyList(env["CACHE_VARY_REQUEST_HEADERS_EXCLUDED"]).map(varyHeaderPattern)];
	const varyHeaders = resolveVaryHeaders(req, varyList(env["CACHE_VARY_REQUEST_HEADERS"]), excludedHeaders);
	if (varyHeaders !== void 0) info["headers"] = varyHeaders;
	const digest = hash(info);
	return {
		redisKey: env["CACHE_KEY_HASH_ENABLED"] === false ? JSON.stringify(info, sortNestedKeys) : digest,
		cacheKey: digest
	};
}

//#endregion
export { getCacheKey };