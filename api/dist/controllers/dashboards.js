import { DashboardsService } from "../services/dashboards.js";
import async_handler_default from "../utils/async-handler.js";
import { sanitizeQuery } from "../utils/sanitize-query.js";
import { MetaService } from "../services/meta.js";
import { respond } from "../middleware/respond.js";
import use_collection_default from "../middleware/use-collection.js";
import { validateBatch } from "../middleware/validate-batch.js";
import { ErrorCode, isDirectusError } from "@directus/errors";
import express from "express";

//#region src/controllers/dashboards.ts
const router = express.Router();
router.use(use_collection_default("directus_dashboards"));
router.post("/", async_handler_default(async (req, res, next) => {
	const service = new DashboardsService({
		accountability: req.accountability,
		schema: req.schema
	});
	const savedKeys = [];
	if (Array.isArray(req.body)) {
		const keys = await service.createMany(req.body);
		savedKeys.push(...keys);
	} else {
		const key = await service.createOne(req.body);
		savedKeys.push(key);
	}
	try {
		if (Array.isArray(req.body)) {
			const items = await service.readMany(savedKeys, req.sanitizedQuery);
			res.locals["payload"] = { data: items };
		} else {
			const item = await service.readOne(savedKeys[0], req.sanitizedQuery);
			res.locals["payload"] = { data: item };
		}
	} catch (error) {
		if (isDirectusError(error, ErrorCode.Forbidden)) return next();
		throw error;
	}
	return next();
}), respond);
const readHandler = async_handler_default(async (req, res, next) => {
	const service = new DashboardsService({
		accountability: req.accountability,
		schema: req.schema
	});
	const metaService = new MetaService({
		accountability: req.accountability,
		schema: req.schema
	});
	const records = await service.readByQuery(req.sanitizedQuery);
	const meta = await metaService.getMetaForQuery(req.collection, req.sanitizedQuery);
	res.locals["payload"] = {
		data: records || null,
		meta
	};
	return next();
});
router.get("/", validateBatch("read"), readHandler, respond);
router.search("/", validateBatch("read"), readHandler, respond);
router.get("/:pk", async_handler_default(async (req, res, next) => {
	const record = await new DashboardsService({
		accountability: req.accountability,
		schema: req.schema
	}).readOne(req.params["pk"], req.sanitizedQuery);
	res.locals["payload"] = { data: record || null };
	return next();
}), respond);
router.patch("/", validateBatch("update"), async_handler_default(async (req, res, next) => {
	const service = new DashboardsService({
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
		res.locals["payload"] = { data: result };
	} catch (error) {
		if (isDirectusError(error, ErrorCode.Forbidden)) return next();
		throw error;
	}
	return next();
}), respond);
router.patch("/:pk", async_handler_default(async (req, res, next) => {
	const service = new DashboardsService({
		accountability: req.accountability,
		schema: req.schema
	});
	const primaryKey = await service.updateOne(req.params["pk"], req.body);
	try {
		const item = await service.readOne(primaryKey, req.sanitizedQuery);
		res.locals["payload"] = { data: item || null };
	} catch (error) {
		if (isDirectusError(error, ErrorCode.Forbidden)) return next();
		throw error;
	}
	return next();
}), respond);
router.delete("/", async_handler_default(async (req, _res, next) => {
	const service = new DashboardsService({
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
	await new DashboardsService({
		accountability: req.accountability,
		schema: req.schema
	}).deleteOne(req.params["pk"]);
	return next();
}), respond);
var dashboards_default = router;

//#endregion
export { dashboards_default as default };