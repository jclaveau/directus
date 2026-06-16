import async_handler_default from "../utils/async-handler.js";
import { getMilliseconds } from "../utils/get-milliseconds.js";
import { UUID_REGEX } from "../constants.js";
import { getExtensionManager } from "../extensions/index.js";
import { ExtensionReadError, ExtensionsService } from "../services/extensions.js";
import { getCacheControlHeader } from "../utils/get-cache-headers.js";
import { respond } from "../middleware/respond.js";
import use_collection_default from "../middleware/use-collection.js";
import { handleRegistryError } from "./utils/handle-registry-error.js";
import { useEnv } from "@directus/env";
import { ErrorCode, ForbiddenError, RouteNotFoundError, isDirectusError } from "@directus/errors";
import { isIn } from "@directus/utils";
import express from "express";
import { isNil } from "lodash-es";
import { EXTENSION_TYPES } from "@directus/constants";
import { account, describe, list } from "@directus/extensions-registry";

//#region src/controllers/extensions.ts
const router = express.Router();
const env = useEnv();
router.use(use_collection_default("directus_extensions"));
router.get("/", async_handler_default(async (req, res, next) => {
	const extensions = await new ExtensionsService({
		accountability: req.accountability,
		schema: req.schema
	}).readAll();
	res.locals["payload"] = { data: extensions || null };
	return next();
}), respond);
router.get("/registry", async_handler_default(async (req, res, next) => {
	if (req.accountability && req.accountability.admin !== true) throw new ForbiddenError();
	const { search, limit, offset, sort, filter } = req.sanitizedQuery;
	const query = {};
	if (!isNil(search)) query.search = search;
	if (!isNil(limit)) query.limit = limit;
	if (!isNil(offset)) query.offset = offset;
	if (filter) {
		const getFilterValue = (key) => {
			const field = filter[key];
			if (!field || !("_eq" in field) || typeof field._eq !== "string") return;
			return field._eq;
		};
		const by = getFilterValue("by");
		const type = getFilterValue("type");
		if (by) query.by = by;
		if (type) {
			if (isIn(type, EXTENSION_TYPES) === false) throw new ForbiddenError();
			query.type = type;
		}
	}
	if (!isNil(sort) && sort[0] && isIn(sort[0], [
		"popular",
		"recent",
		"downloads"
	])) query.sort = sort[0];
	if (env["MARKETPLACE_TRUST"] === "sandbox") query.sandbox = true;
	const options = {};
	if (env["MARKETPLACE_REGISTRY"] && typeof env["MARKETPLACE_REGISTRY"] === "string") options.registry = env["MARKETPLACE_REGISTRY"];
	let payload;
	try {
		payload = await list(query, options);
	} catch (error) {
		handleRegistryError(error);
	}
	res.locals["payload"] = payload;
	return next();
}), respond);
router.get(`/registry/account/:pk(${UUID_REGEX})`, async_handler_default(async (req, res, next) => {
	if (req.accountability && req.accountability.admin !== true) throw new ForbiddenError();
	if (typeof req.params["pk"] !== "string") throw new ForbiddenError();
	const options = {};
	if (env["MARKETPLACE_REGISTRY"] && typeof env["MARKETPLACE_REGISTRY"] === "string") options.registry = env["MARKETPLACE_REGISTRY"];
	let payload;
	try {
		payload = await account(req.params["pk"], options);
	} catch (error) {
		handleRegistryError(error);
	}
	res.locals["payload"] = payload;
	return next();
}), respond);
router.get(`/registry/extension/:pk(${UUID_REGEX})`, async_handler_default(async (req, res, next) => {
	if (req.accountability && req.accountability.admin !== true) throw new ForbiddenError();
	if (typeof req.params["pk"] !== "string") throw new ForbiddenError();
	const options = {};
	if (env["MARKETPLACE_REGISTRY"] && typeof env["MARKETPLACE_REGISTRY"] === "string") options.registry = env["MARKETPLACE_REGISTRY"];
	let payload;
	try {
		payload = await describe(req.params["pk"], options);
	} catch (error) {
		handleRegistryError(error);
	}
	res.locals["payload"] = payload;
	return next();
}), respond);
router.post("/registry/install", async_handler_default(async (req, _res, next) => {
	if (req.accountability && req.accountability.admin !== true) throw new ForbiddenError();
	const { version, extension } = req.body;
	if (!version || !extension) throw new ForbiddenError();
	await new ExtensionsService({
		accountability: req.accountability,
		schema: req.schema
	}).install(extension, version);
	return next();
}), respond);
router.post("/registry/reinstall", async_handler_default(async (req, _res, next) => {
	if (req.accountability && req.accountability.admin !== true) throw new ForbiddenError();
	const { extension } = req.body;
	if (!extension) throw new ForbiddenError();
	await new ExtensionsService({
		accountability: req.accountability,
		schema: req.schema
	}).reinstall(extension);
	return next();
}), respond);
router.delete(`/registry/uninstall/:pk(${UUID_REGEX})`, async_handler_default(async (req, _res, next) => {
	if (req.accountability && req.accountability.admin !== true) throw new ForbiddenError();
	const pk = req.params["pk"];
	if (typeof pk !== "string") throw new ForbiddenError();
	await new ExtensionsService({
		accountability: req.accountability,
		schema: req.schema
	}).uninstall(pk);
	return next();
}), respond);
router.patch(`/:pk(${UUID_REGEX})`, async_handler_default(async (req, res, next) => {
	if (req.accountability && req.accountability.admin !== true) throw new ForbiddenError();
	if (typeof req.params["pk"] !== "string") throw new ForbiddenError();
	const service = new ExtensionsService({
		accountability: req.accountability,
		schema: req.schema
	});
	try {
		const result = await service.updateOne(req.params["pk"], req.body);
		res.locals["payload"] = { data: result || null };
	} catch (error) {
		let finalError = error;
		if (error instanceof ExtensionReadError) {
			finalError = error.originalError;
			if (isDirectusError(finalError, ErrorCode.Forbidden)) return next();
		}
		throw finalError;
	}
	return next();
}), respond);
router.delete(`/:pk(${UUID_REGEX})`, async_handler_default(async (req, _res, next) => {
	if (req.accountability && req.accountability.admin !== true) throw new ForbiddenError();
	const service = new ExtensionsService({
		accountability: req.accountability,
		schema: req.schema
	});
	const pk = req.params["pk"];
	if (typeof pk !== "string") throw new ForbiddenError();
	await service.deleteOne(pk);
	return next();
}), respond);
router.get("/sources/:chunk", async_handler_default(async (req, res) => {
	const chunk$1 = req.params["chunk"];
	const extensionManager = getExtensionManager();
	let source;
	if (chunk$1 === "index.js") source = await extensionManager.getAppExtensionChunk();
	else source = await extensionManager.getAppExtensionChunk(chunk$1);
	if (source === null) throw new RouteNotFoundError({ path: req.path });
	res.setHeader("Content-Type", "application/javascript; charset=UTF-8");
	res.setHeader("Cache-Control", getCacheControlHeader(req, getMilliseconds(env["EXTENSIONS_CACHE_TTL"]), false, false));
	res.setHeader("Vary", "Origin, Cache-Control");
	source.pipe(res);
}));
var extensions_default = router;

//#endregion
export { extensions_default as default };