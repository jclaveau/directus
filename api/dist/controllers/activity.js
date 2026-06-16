import async_handler_default from "../utils/async-handler.js";
import { ActivityService } from "../services/activity.js";
import { respond } from "../middleware/respond.js";
import { MetaService } from "../services/meta.js";
import use_collection_default from "../middleware/use-collection.js";
import { validateBatch } from "../middleware/validate-batch.js";
import express from "express";

//#region src/controllers/activity.ts
const router = express.Router();
router.use(use_collection_default("directus_activity"));
const readHandler = async_handler_default(async (req, res, next) => {
	const service = new ActivityService({
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
	const historyQuery = service.getLimitedHistoryQuery(req.sanitizedQuery);
	const meta = await metaService.getMetaForQuery("directus_activity", historyQuery);
	res.locals["payload"] = {
		data: result,
		meta
	};
	return next();
});
router.search("/", validateBatch("read"), readHandler, respond);
router.get("/", readHandler, respond);
router.get("/:pk", async_handler_default(async (req, res, next) => {
	const record = await new ActivityService({
		accountability: req.accountability,
		schema: req.schema
	}).readOne(req.params["pk"], req.sanitizedQuery);
	res.locals["payload"] = { data: record || null };
	return next();
}), respond);
var activity_default = router;

//#endregion
export { activity_default as default };