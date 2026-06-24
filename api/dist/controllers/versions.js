import async_handler_default from "../utils/async-handler.js";
import { respond } from "../middleware/respond.js";
import { sanitizeQuery } from "../utils/sanitize-query.js";
import { MetaService } from "../services/meta.js";
import { VersionsService } from "../services/versions.js";
import use_collection_default from "../middleware/use-collection.js";
import { validateBatch } from "../middleware/validate-batch.js";
import { ErrorCode, ForbiddenError, isDirectusError } from "@directus/errors";
import express from "express";
import { assign } from "lodash-es";

//#region src/controllers/versions.ts
const router = express.Router();
router.use(use_collection_default("directus_versions"));
router.post("/", async_handler_default(async (req, res, next) => {
	const service = new VersionsService({
		accountability: req.accountability,
		schema: req.schema
	});
	const savedKeys = [];
	if (Array.isArray(req.body)) {
		const keys = await service.createMany(req.body);
		savedKeys.push(...keys);
	} else {
		const primaryKey = await service.createOne(req.body);
		savedKeys.push(primaryKey);
	}
	try {
		if (Array.isArray(req.body)) {
			const records = await service.readMany(savedKeys, req.sanitizedQuery);
			res.locals["payload"] = { data: records };
		} else {
			const record = await service.readOne(savedKeys[0], req.sanitizedQuery);
			res.locals["payload"] = { data: record };
		}
	} catch (error) {
		if (isDirectusError(error, ErrorCode.Forbidden)) return next();
		throw error;
	}
	return next();
}), respond);
const readHandler = async_handler_default(async (req, res, next) => {
	const service = new VersionsService({
		accountability: req.accountability,
		schema: req.schema
	});
	const metaService = new MetaService({
		accountability: req.accountability,
		schema: req.schema
	});
	let result;
	if (req.singleton) result = await service.readSingleton(req.sanitizedQuery);
	else if (req.body.keys) result = await service.readMany(req.body.keys, req.sanitizedQuery);
	else result = await service.readByQuery(req.sanitizedQuery);
	const meta = await metaService.getMetaForQuery(req.collection, req.sanitizedQuery);
	res.locals["payload"] = {
		data: result,
		meta
	};
	return next();
});
router.get("/", validateBatch("read"), readHandler, respond);
router.search("/", validateBatch("read"), readHandler, respond);
router.get("/:pk", async_handler_default(async (req, res, next) => {
	const record = await new VersionsService({
		accountability: req.accountability,
		schema: req.schema
	}).readOne(req.params["pk"], req.sanitizedQuery);
	res.locals["payload"] = { data: record || null };
	return next();
}), respond);
router.patch("/", validateBatch("update"), async_handler_default(async (req, res, next) => {
	const service = new VersionsService({
		accountability: req.accountability,
		schema: req.schema
	});
	let keys = [];
	if (Array.isArray(req.body)) keys = await service.updateBatch(req.body);
	else if (req.body.keys) keys = await service.updateMany(req.body.keys, req.body.data);
	else {
		const sanitizedQuery = await sanitizeQuery(req.body.query, req.schema, req.accountability);
		keys = await service.updateByQuery(sanitizedQuery, req.body.data);
	}
	try {
		const result = await service.readMany(keys, req.sanitizedQuery);
		res.locals["payload"] = { data: result || null };
	} catch (error) {
		if (isDirectusError(error, ErrorCode.Forbidden)) return next();
		throw error;
	}
	return next();
}), respond);
router.patch("/:pk", async_handler_default(async (req, res, next) => {
	const service = new VersionsService({
		accountability: req.accountability,
		schema: req.schema
	});
	const primaryKey = await service.updateOne(req.params["pk"], req.body);
	try {
		const record = await service.readOne(primaryKey, req.sanitizedQuery);
		res.locals["payload"] = { data: record || null };
	} catch (error) {
		if (isDirectusError(error, ErrorCode.Forbidden)) return next();
		throw error;
	}
	return next();
}), respond);
router.delete("/", validateBatch("delete"), async_handler_default(async (req, _res, next) => {
	const service = new VersionsService({
		accountability: req.accountability,
		schema: req.schema
	});
	if (Array.isArray(req.body)) await service.deleteMany(req.body);
	else if (req.body.keys) await service.deleteMany(req.body.keys);
	else {
		const sanitizedQuery = await sanitizeQuery(req.body.query, req.schema, req.accountability);
		await service.deleteByQuery(sanitizedQuery);
	}
	return next();
}), respond);
router.delete("/:pk", async_handler_default(async (req, _res, next) => {
	await new VersionsService({
		accountability: req.accountability,
		schema: req.schema
	}).deleteOne(req.params["pk"]);
	return next();
}), respond);
router.get("/:pk/compare", async_handler_default(async (req, res, next) => {
	const service = new VersionsService({
		accountability: req.accountability,
		schema: req.schema
	});
	const version = await service.readOne(req.params["pk"]);
	if (!version.item) throw new ForbiddenError({ reason: `Version with key ${req.params["pk"]} does not have an associated item` });
	const { outdated, mainHash } = await service.verifyHash(version["collection"], version["item"], version["hash"]);
	const delta = version.delta ?? {};
	delta[req.schema.collections[version.collection].primary] = version.item;
	const main = await service.getMainItem(version["collection"], version["item"]);
	res.locals["payload"] = { data: {
		outdated,
		mainHash,
		current: delta,
		main
	} };
	return next();
}), respond);
router.post("/:pk/save", async_handler_default(async (req, res, next) => {
	const service = new VersionsService({
		accountability: req.accountability,
		schema: req.schema
	});
	const version = await service.readOne(req.params["pk"]);
	let mainItem = {};
	if (version.item) mainItem = await service.getMainItem(version["collection"], version["item"]);
	const patchRevision = req.query["patchRevision"] !== void 0 && req.query["patchRevision"] !== "false";
	const updatedVersion = await service.save(req.params["pk"], req.body, { patchRevision });
	const result = assign(mainItem, updatedVersion);
	res.locals["payload"] = { data: result || null };
	return next();
}), respond);
router.post("/:pk/promote", async_handler_default(async (req, res, next) => {
	const updatedItemKey = await new VersionsService({
		accountability: req.accountability,
		schema: req.schema
	}).promote(req.params["pk"], {
		mainHash: req.body?.mainHash,
		fields: req.body?.["fields"]
	});
	res.locals["payload"] = { data: updatedItemKey || null };
	return next();
}), respond);
var versions_default = router;

//#endregion
export { versions_default as default };