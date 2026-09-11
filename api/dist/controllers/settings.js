import { SettingsService } from "../services/settings.js";
import async_handler_default from "../utils/async-handler.js";
import { respond } from "../middleware/respond.js";
import use_collection_default from "../middleware/use-collection.js";
import { ErrorCode, isDirectusError } from "@directus/errors";
import express from "express";

//#region src/controllers/settings.ts
const router = express.Router();
router.use(use_collection_default("directus_settings"));
router.get("/", async_handler_default(async (req, res, next) => {
	const records = await new SettingsService({
		accountability: req.accountability,
		schema: req.schema
	}).readSingleton(req.sanitizedQuery);
	res.locals["payload"] = { data: records || null };
	return next();
}), respond);
router.patch("/", async_handler_default(async (req, res, next) => {
	const service = new SettingsService({
		accountability: req.accountability,
		schema: req.schema
	});
	await service.upsertSingleton(req.body);
	try {
		const record = await service.readSingleton(req.sanitizedQuery);
		res.locals["payload"] = { data: record || null };
	} catch (error) {
		if (isDirectusError(error, ErrorCode.Forbidden)) return next();
		throw error;
	}
	return next();
}), respond);
var settings_default = router;

//#endregion
export { settings_default as default };