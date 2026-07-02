import { readMeta } from "../utils/read-meta.js";
import { ItemsService } from "../services/items.js";
import async_handler_default from "../utils/async-handler.js";
import { sanitizeQuery } from "../utils/sanitize-query.js";
import { MetaService } from "../services/meta.js";
import { respond } from "../middleware/respond.js";
import { validateBatch } from "../middleware/validate-batch.js";
import collection_exists_default from "../middleware/collection-exists.js";
import { mergeContentVersions } from "../middleware/merge-content-versions.js";
import { ErrorCode, ForbiddenError, RouteNotFoundError, isDirectusError } from "@directus/errors";
import express from "express";
import { isSystemCollection } from "@directus/system-data";

//#region src/controllers/items.ts
const router = express.Router();
router.post("/:collection", collection_exists_default, async_handler_default(async (req, res, next) => {
	if (isSystemCollection(req.params["collection"])) throw new ForbiddenError({ reason: "Forbidden access to directus_* collections" });
	if (req.singleton) throw new RouteNotFoundError({ path: req.path });
	const service = new ItemsService(req.collection, {
		accountability: req.accountability,
		schema: req.schema
	});
	const savedKeys = [];
	if (Array.isArray(req.body)) {
		const keys = await service.createMany(req.body, { allowFilterCancel: true });
		savedKeys.push(...keys.filter((key) => key !== null));
	} else {
		const key = await service.createOne(req.body, { allowFilterCancel: true });
		if (key !== null) savedKeys.push(key);
	}
	try {
		if (Array.isArray(req.body)) {
			const result = await service.readMany(savedKeys, req.sanitizedQuery);
			res.locals["payload"] = { data: result || null };
		} else if (savedKeys.length > 0) {
			const result = await service.readOne(savedKeys[0], req.sanitizedQuery);
			res.locals["payload"] = { data: result || null };
		} else res.locals["payload"] = { data: null };
	} catch (error) {
		if (isDirectusError(error, ErrorCode.Forbidden)) return next();
		throw error;
	}
	return next();
}), respond);
const readHandler = async_handler_default(async (req, res, next) => {
	if (isSystemCollection(req.params["collection"])) throw new ForbiddenError({ reason: "Forbidden access to directus_* collections" });
	const service = new ItemsService(req.collection, {
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
		meta,
		data: result
	};
	res.locals["scopedCacheTags"] = readMeta(result)?.scopedCacheTags;
	return next();
});
router.search("/:collection", collection_exists_default, validateBatch("read"), readHandler, mergeContentVersions, respond);
router.get("/:collection", collection_exists_default, readHandler, mergeContentVersions, respond);
router.get("/:collection/:pk", collection_exists_default, async_handler_default(async (req, res, next) => {
	if (isSystemCollection(req.params["collection"])) throw new ForbiddenError({ reason: "Forbidden access to directus_* collections" });
	const result = await new ItemsService(req.collection, {
		accountability: req.accountability,
		schema: req.schema
	}).readOne(req.params["pk"], req.sanitizedQuery);
	res.locals["payload"] = { data: result || null };
	return next();
}), mergeContentVersions, respond);
router.patch("/:collection", collection_exists_default, validateBatch("update"), async_handler_default(async (req, res, next) => {
	if (isSystemCollection(req.params["collection"])) throw new ForbiddenError({ reason: "Forbidden access to directus_* collections" });
	const service = new ItemsService(req.collection, {
		accountability: req.accountability,
		schema: req.schema
	});
	if (req.singleton === true) {
		await service.upsertSingleton(req.body);
		const item = await service.readSingleton(req.sanitizedQuery);
		res.locals["payload"] = { data: item || null };
		return next();
	}
	let keys = [];
	if (Array.isArray(req.body)) keys = await service.updateBatch(req.body, { allowFilterCancel: true });
	else if (req.body.keys) keys = await service.updateMany(req.body.keys, req.body.data, { allowFilterCancel: true });
	else {
		const sanitizedQuery = await sanitizeQuery(req.body.query, req.schema, req.accountability);
		keys = await service.updateByQuery(sanitizedQuery, req.body.data, { allowFilterCancel: true });
	}
	try {
		const result = await service.readMany(keys.filter((key) => key !== null), req.sanitizedQuery);
		res.locals["payload"] = { data: result };
	} catch (error) {
		if (isDirectusError(error, ErrorCode.Forbidden)) return next();
		throw error;
	}
	return next();
}), respond);
router.patch("/:collection/:pk", collection_exists_default, async_handler_default(async (req, res, next) => {
	if (isSystemCollection(req.params["collection"])) throw new ForbiddenError({ reason: "Forbidden access to directus_* collections" });
	if (req.singleton) throw new RouteNotFoundError({ path: req.path });
	const service = new ItemsService(req.collection, {
		accountability: req.accountability,
		schema: req.schema
	});
	const updatedPrimaryKey = await service.updateOne(req.params["pk"], req.body, { allowFilterCancel: true });
	try {
		const result = await service.readOne(updatedPrimaryKey, req.sanitizedQuery);
		res.locals["payload"] = { data: result || null };
	} catch (error) {
		if (isDirectusError(error, ErrorCode.Forbidden)) return next();
		throw error;
	}
	return next();
}), respond);
router.delete("/:collection", collection_exists_default, validateBatch("delete"), async_handler_default(async (req, _res, next) => {
	if (isSystemCollection(req.params["collection"])) throw new ForbiddenError({ reason: "Forbidden access to directus_* collections" });
	const service = new ItemsService(req.collection, {
		accountability: req.accountability,
		schema: req.schema
	});
	if (Array.isArray(req.body)) await service.deleteMany(req.body, { allowFilterCancel: true });
	else if (req.body.keys) await service.deleteMany(req.body.keys, { allowFilterCancel: true });
	else {
		const sanitizedQuery = await sanitizeQuery(req.body.query, req.schema, req.accountability);
		await service.deleteByQuery(sanitizedQuery, { allowFilterCancel: true });
	}
	return next();
}), respond);
router.delete("/:collection/:pk", collection_exists_default, async_handler_default(async (req, _res, next) => {
	if (isSystemCollection(req.params["collection"])) throw new ForbiddenError({ reason: "Forbidden access to directus_* collections" });
	await new ItemsService(req.collection, {
		accountability: req.accountability,
		schema: req.schema
	}).deleteOne(req.params["pk"], { allowFilterCancel: true });
	return next();
}), respond);
var items_default = router;

//#endregion
export { items_default as default };