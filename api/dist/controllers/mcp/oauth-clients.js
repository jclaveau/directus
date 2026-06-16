import async_handler_default from "../../utils/async-handler.js";
import { ItemsService } from "../../services/items.js";
import { respond } from "../../middleware/respond.js";
import { sanitizeQuery } from "../../utils/sanitize-query.js";
import { MetaService } from "../../services/meta.js";
import use_collection_default from "../../middleware/use-collection.js";
import { validateBatch } from "../../middleware/validate-batch.js";
import { ForbiddenError } from "@directus/errors";
import { Router } from "express";

//#region src/controllers/mcp/oauth-clients.ts
const router = Router();
router.use(use_collection_default("directus_oauth_clients"));
router.use((req, _res, next) => {
	if (!req.accountability?.admin) throw new ForbiddenError();
	next();
});
const readHandler = async_handler_default(async (req, res, next) => {
	const service = new ItemsService("directus_oauth_clients", {
		accountability: req.accountability,
		schema: req.schema
	});
	const metaService = new MetaService({
		accountability: req.accountability,
		schema: req.schema
	});
	const records = await service.readByQuery(req.sanitizedQuery);
	const meta = await metaService.getMetaForQuery("directus_oauth_clients", req.sanitizedQuery);
	res.locals["payload"] = {
		data: records || null,
		meta
	};
	return next();
});
router.get("/", validateBatch("read"), readHandler, respond);
router.search("/", validateBatch("read"), readHandler, respond);
router.get("/:id", async_handler_default(async (req, res, next) => {
	const record = await new ItemsService("directus_oauth_clients", {
		accountability: req.accountability,
		schema: req.schema
	}).readOne(req.params["id"], req.sanitizedQuery);
	res.locals["payload"] = { data: record || null };
	return next();
}), respond);
router.delete("/", validateBatch("delete"), async_handler_default(async (req, _res, next) => {
	const service = new ItemsService("directus_oauth_clients", {
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
router.delete("/:id", async_handler_default(async (req, _res, next) => {
	await new ItemsService("directus_oauth_clients", {
		accountability: req.accountability,
		schema: req.schema
	}).deleteOne(req.params["id"]);
	return next();
}), respond);
var oauth_clients_default = router;

//#endregion
export { oauth_clients_default as default };