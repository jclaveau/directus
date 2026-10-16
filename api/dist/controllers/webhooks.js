import async_handler_default from "../utils/async-handler.js";
import { sanitizeQuery } from "../utils/sanitize-query.js";
import { MetaService } from "../services/meta.js";
import { WebhooksService } from "../services/webhooks.js";
import { respond } from "../middleware/respond.js";
import use_collection_default from "../middleware/use-collection.js";
import { validateBatch } from "../middleware/validate-batch.js";
import { ErrorCode, createError } from "@directus/errors";
import express from "express";

//#region src/controllers/webhooks.ts
const router = express.Router();
router.use(use_collection_default("directus_webhooks"));
router.post("/", async_handler_default(async (_req, _res, _next) => {
	throw new (createError(ErrorCode.MethodNotAllowed, "Webhooks are deprecated, use Flows instead", 405))();
}), respond);
const readHandler = async_handler_default(async (req, res, next) => {
	const service = new WebhooksService({
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
	const record = await new WebhooksService({
		accountability: req.accountability,
		schema: req.schema
	}).readOne(req.params["pk"], req.sanitizedQuery);
	res.locals["payload"] = { data: record || null };
	return next();
}), respond);
router.patch("/", validateBatch("update"), async_handler_default(async (_req, _res, _next) => {
	throw new (createError(ErrorCode.MethodNotAllowed, "Webhooks are deprecated, use Flows instead", 405))();
}), respond);
router.patch("/:pk", async_handler_default(async (_req, _res, _next) => {
	throw new (createError(ErrorCode.MethodNotAllowed, "Webhooks are deprecated, use Flows instead", 405))();
}), respond);
router.delete("/", async_handler_default(async (req, _res, next) => {
	const service = new WebhooksService({
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
	await new WebhooksService({
		accountability: req.accountability,
		schema: req.schema
	}).deleteOne(req.params["pk"]);
	return next();
}), respond);
var webhooks_default = router;

//#endregion
export { webhooks_default as default };