import { useLogger } from "../logger/index.js";
import database_default from "../database/index.js";
import { extractRequiredDynamicVariableContext } from "../permissions/utils/extract-required-dynamic-variable-context.js";
import { fetchDynamicVariableData } from "../permissions/utils/fetch-dynamic-variable-data.js";
import { fetchPolicies } from "../permissions/lib/fetch-policies.js";
import { contextHasDynamicVariables } from "../permissions/modules/process-ast/utils/context-has-dynamic-variables.js";
import { Meta } from "../types/meta.js";
import { splitFields } from "./split-fields.js";
import { useEnv } from "@directus/env";
import { InvalidQueryError } from "@directus/errors";
import { parseFilter, parseJSON } from "@directus/utils";
import { flatten, get, isPlainObject, merge, set } from "lodash-es";

//#region src/utils/sanitize-query.ts
/**
* Sanitize the query parameters and parse them where necessary.
*/
async function sanitizeQuery(rawQuery, schema, accountability) {
	const env = useEnv();
	const query = {};
	const hasMaxLimit = "QUERY_LIMIT_MAX" in env && Number(env["QUERY_LIMIT_MAX"]) >= 0 && !Number.isNaN(Number(env["QUERY_LIMIT_MAX"])) && Number.isFinite(Number(env["QUERY_LIMIT_MAX"]));
	if (rawQuery["limit"] !== void 0) {
		const limit = sanitizeLimit(rawQuery["limit"]);
		if (typeof limit === "number") query.limit = limit === -1 && hasMaxLimit ? Number(env["QUERY_LIMIT_MAX"]) : limit;
	} else if (hasMaxLimit) query.limit = Math.min(Number(env["QUERY_LIMIT_DEFAULT"]), Number(env["QUERY_LIMIT_MAX"]));
	if (rawQuery["fields"]) query.fields = sanitizeFields(rawQuery["fields"]);
	if (rawQuery["groupBy"]) query.group = sanitizeFields(rawQuery["groupBy"]);
	if (rawQuery["aggregate"]) query.aggregate = sanitizeAggregate(rawQuery["aggregate"]);
	if (rawQuery["sort"]) query.sort = sanitizeSort(rawQuery["sort"]);
	if (rawQuery["filter"]) query.filter = await sanitizeFilter(rawQuery["filter"], schema, accountability || null);
	if (rawQuery["offset"] !== void 0) query.offset = sanitizeOffset(rawQuery["offset"]);
	if (rawQuery["page"]) query.page = sanitizePage(rawQuery["page"]);
	if (rawQuery["meta"]) query.meta = sanitizeMeta(rawQuery["meta"]);
	if (rawQuery["search"] && typeof rawQuery["search"] === "string") {
		const trimmed = rawQuery["search"].trim();
		if (trimmed) query.search = trimmed;
		else query.search = rawQuery["search"];
	}
	if (rawQuery["version"]) {
		query.version = rawQuery["version"];
		query.versionRaw = Boolean("versionRaw" in rawQuery && (rawQuery["versionRaw"] === "" || rawQuery["versionRaw"] === "true"));
	}
	if (rawQuery["export"]) query.export = rawQuery["export"];
	if (rawQuery["deep"]) {
		if (!query.deep) query.deep = {};
		query.deep = await sanitizeDeep(rawQuery["deep"], schema, accountability);
	}
	if (rawQuery["alias"]) query.alias = sanitizeAlias(rawQuery["alias"]);
	if ("backlink" in rawQuery) query.backlink = sanitizeBacklink(rawQuery["backlink"]);
	return query;
}
function sanitizeFields(rawFields) {
	if (!rawFields) return null;
	let fields = [];
	if (typeof rawFields === "string") fields = splitFields(rawFields);
	else if (Array.isArray(rawFields)) fields = rawFields;
	else throw new InvalidQueryError({ reason: "\"fields\" must be a string or array" });
	fields = flatten(fields.map((field) => field.includes(",") ? splitFields(field) : field));
	fields = fields.map((field) => field.trim());
	return fields;
}
function sanitizeSort(rawSort) {
	let fields = [];
	if (typeof rawSort === "string") fields = splitFields(rawSort);
	else if (Array.isArray(rawSort)) fields = rawSort;
	fields = fields.map((field) => field.trim());
	return fields;
}
function sanitizeAggregate(rawAggregate) {
	const logger = useLogger();
	let aggregate = rawAggregate;
	if (typeof rawAggregate === "string") try {
		aggregate = parseJSON(rawAggregate);
	} catch {
		logger.warn("Invalid value passed for aggregate query parameter.");
	}
	for (const [operation, fields] of Object.entries(aggregate)) if (typeof fields === "string") aggregate[operation] = fields.split(",");
	else if (Array.isArray(fields)) aggregate[operation] = fields;
	return aggregate;
}
async function sanitizeFilter(rawFilter, schema, accountability) {
	let filters = rawFilter;
	if (typeof filters === "string") try {
		filters = parseJSON(filters);
	} catch {
		throw new InvalidQueryError({ reason: "Invalid JSON for filter object" });
	}
	try {
		let filterContext;
		if (accountability) {
			const dynamicVariableContext = extractRequiredDynamicVariableContext(filters);
			if (contextHasDynamicVariables(dynamicVariableContext)) {
				const context = {
					schema,
					knex: database_default()
				};
				const policies = await fetchPolicies(accountability, context);
				context.accountability = accountability;
				filterContext = await fetchDynamicVariableData({
					dynamicVariableContext,
					accountability,
					policies
				}, context);
			}
		}
		return parseFilter(filters, accountability, filterContext);
	} catch {
		throw new InvalidQueryError({ reason: "Invalid filter object" });
	}
}
function sanitizeLimit(rawLimit) {
	if (rawLimit === void 0 || rawLimit === null) return null;
	return Number(rawLimit);
}
function sanitizeOffset(rawOffset) {
	return Number(rawOffset);
}
function sanitizePage(rawPage) {
	return Number(rawPage);
}
function sanitizeMeta(rawMeta) {
	if (rawMeta === "*") return Object.values(Meta);
	if (rawMeta.includes(",")) return rawMeta.split(",");
	if (Array.isArray(rawMeta)) return rawMeta;
	return [rawMeta];
}
function sanitizeBacklink(rawBacklink) {
	return rawBacklink !== false && rawBacklink !== "false";
}
async function sanitizeDeep(deep, schema, accountability) {
	const logger = useLogger();
	const result = {};
	if (typeof deep === "string") try {
		deep = parseJSON(deep);
	} catch {
		logger.warn("Invalid value passed for deep query parameter.");
	}
	await parse(deep);
	return result;
	async function parse(level, path = []) {
		const subQuery = {};
		const parsedLevel = {};
		for (const [key, value] of Object.entries(level)) {
			if (!key) break;
			if (key.startsWith("_")) subQuery[key.substring(1)] = value;
			else if (isPlainObject(value)) await parse(value, [...path, key]);
		}
		if (Object.keys(subQuery).length > 0) {
			const parsedSubQuery = await sanitizeQuery(subQuery, schema, accountability);
			for (const [parsedKey, parsedValue] of Object.entries(parsedSubQuery)) parsedLevel[`_${parsedKey}`] = parsedValue;
		}
		if (Object.keys(parsedLevel).length > 0) set(result, path, merge({}, get(result, path, {}), parsedLevel));
	}
}
function sanitizeAlias(rawAlias) {
	const logger = useLogger();
	let alias = rawAlias;
	if (typeof rawAlias === "string") try {
		alias = parseJSON(rawAlias);
	} catch {
		logger.warn("Invalid value passed for alias query parameter.");
	}
	return alias;
}

//#endregion
export { sanitizeQuery };