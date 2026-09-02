import { RevisionsService } from "../services/revisions.js";
import async_handler_default from "../utils/async-handler.js";
import { MetaService } from "../services/meta.js";
import { respond } from "../middleware/respond.js";
import use_collection_default from "../middleware/use-collection.js";
import { validateBatch } from "../middleware/validate-batch.js";
import express from "express";

//#region src/controllers/revisions.ts
const router = express.Router();
router.use(use_collection_default("directus_revisions"));
const readHandler = async_handler_default(async (req, res, next) => {
	const service = new RevisionsService({
		accountability: req.accountability,
		schema: req.schema
	});
	const metaService = new MetaService({
		accountability: req.accountability,
		schema: req.schema
	});
	const records = await service.readByQuery(req.sanitizedQuery);
	const meta = await metaService.getMetaForQuery("directus_revisions", req.sanitizedQuery);
	res.locals["payload"] = {
		data: records || null,
		meta
	};
	return next();
});
router.get("/", validateBatch("read"), readHandler, respond);
router.search("/", validateBatch("read"), readHandler, respond);
router.get("/:pk", async_handler_default(async (req, res, next) => {
	const record = await new RevisionsService({
		accountability: req.accountability,
		schema: req.schema
	}).readOne(req.params["pk"], req.sanitizedQuery);
	res.locals["payload"] = { data: record || null };
	return next();
}), respond);
var revisions_default = router;

//#endregion
export { revisions_default as default };