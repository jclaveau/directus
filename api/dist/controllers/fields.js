import async_handler_default from "../utils/async-handler.js";
import { ALIAS_TYPES } from "../constants.js";
import { respond } from "../middleware/respond.js";
import { FieldsService, systemFieldUpdateSchema } from "../services/fields.js";
import use_collection_default from "../middleware/use-collection.js";
import collection_exists_default from "../middleware/collection-exists.js";
import { ErrorCode, ForbiddenError, InvalidPayloadError, isDirectusError } from "@directus/errors";
import { Router } from "express";
import { TYPES } from "@directus/constants";
import { isSystemField } from "@directus/system-data";
import Joi from "joi";

//#region src/controllers/fields.ts
const router = Router();
router.use(use_collection_default("directus_fields"));
router.get("/", async_handler_default(async (req, res, next) => {
	const fields = await new FieldsService({
		accountability: req.accountability,
		schema: req.schema
	}).readAll();
	res.locals["payload"] = { data: fields || null };
	return next();
}), respond);
router.get("/:collection", collection_exists_default, async_handler_default(async (req, res, next) => {
	const fields = await new FieldsService({
		accountability: req.accountability,
		schema: req.schema
	}).readAll(req.params["collection"]);
	res.locals["payload"] = { data: fields || null };
	return next();
}), respond);
router.get("/:collection/:field", collection_exists_default, async_handler_default(async (req, res, next) => {
	const field = await new FieldsService({
		accountability: req.accountability,
		schema: req.schema
	}).readOne(req.params["collection"], req.params["field"]);
	res.locals["payload"] = { data: field || null };
	return next();
}), respond);
const newFieldSchema = Joi.object({
	collection: Joi.string().optional(),
	field: Joi.string().required(),
	type: Joi.string().valid(...TYPES, ...ALIAS_TYPES).allow(null).optional(),
	schema: Joi.object({
		default_value: Joi.any(),
		max_length: [
			Joi.number(),
			Joi.string(),
			Joi.valid(null)
		],
		is_nullable: Joi.bool()
	}).unknown().allow(null),
	meta: Joi.any()
});
router.post("/:collection", collection_exists_default, async_handler_default(async (req, res, next) => {
	const service = new FieldsService({
		accountability: req.accountability,
		schema: req.schema
	});
	const { error } = newFieldSchema.validate(req.body);
	if (error) throw new InvalidPayloadError({ reason: error.message });
	const field = req.body;
	await service.createField(req.params["collection"], field, void 0, { attemptConcurrentIndex: "concurrentIndexCreation" in req.query && req.query["concurrentIndexCreation"] !== "false" });
	try {
		const createdField = await service.readOne(req.params["collection"], field.field);
		res.locals["payload"] = { data: createdField || null };
	} catch (error$1) {
		if (isDirectusError(error$1, ErrorCode.Forbidden)) return next();
		throw error$1;
	}
	return next();
}), respond);
router.patch("/:collection", collection_exists_default, async_handler_default(async (req, res, next) => {
	const service = new FieldsService({
		accountability: req.accountability,
		schema: req.schema
	});
	if (Array.isArray(req.body) === false) throw new InvalidPayloadError({ reason: "Submitted body has to be an array" });
	for (const fieldData of req.body) if (isSystemField(req.params["collection"], fieldData["field"])) {
		const { error } = systemFieldUpdateSchema.safeParse(fieldData);
		if (error) throw new InvalidPayloadError({ reason: "Only \"schema.is_indexed\" may be modified for system fields" });
	}
	await service.updateFields(req.params["collection"], req.body, { attemptConcurrentIndex: "concurrentIndexCreation" in req.query && req.query["concurrentIndexCreation"] !== "false" });
	try {
		const results = [];
		for (const field of req.body) {
			const updatedField = await service.readOne(req.params["collection"], field.field);
			results.push(updatedField);
			res.locals["payload"] = { data: results || null };
		}
	} catch (error) {
		if (isDirectusError(error, ErrorCode.Forbidden)) return next();
		throw error;
	}
	return next();
}), respond);
const updateSchema = Joi.object({
	type: Joi.string().valid(...TYPES, ...ALIAS_TYPES).allow(null),
	schema: Joi.object({
		default_value: Joi.any(),
		max_length: [
			Joi.number(),
			Joi.string(),
			Joi.valid(null)
		],
		is_nullable: Joi.bool()
	}).unknown().allow(null),
	meta: Joi.any()
}).unknown();
router.patch("/:collection/:field", collection_exists_default, async_handler_default(async (req, res, next) => {
	const service = new FieldsService({
		accountability: req.accountability,
		schema: req.schema
	});
	if (isSystemField(req.params["collection"], req.params["field"])) {
		const { error } = systemFieldUpdateSchema.safeParse(req.body);
		if (error) throw new InvalidPayloadError({ reason: "Only \"schema.is_indexed\" may be modified for system fields" });
	} else {
		const { error } = updateSchema.validate(req.body);
		if (error) throw new InvalidPayloadError({ reason: error.message });
	}
	const fieldData = req.body;
	if (!fieldData.field) fieldData.field = req.params["field"];
	await service.updateField(req.params["collection"], fieldData, { attemptConcurrentIndex: "concurrentIndexCreation" in req.query && req.query["concurrentIndexCreation"] !== "false" });
	try {
		const updatedField = await service.readOne(req.params["collection"], req.params["field"]);
		res.locals["payload"] = { data: updatedField || null };
	} catch (error) {
		if (isDirectusError(error, ErrorCode.Forbidden)) return next();
		throw error;
	}
	return next();
}), respond);
router.delete("/:collection/:field", collection_exists_default, async_handler_default(async (req, _res, next) => {
	const service = new FieldsService({
		accountability: req.accountability,
		schema: req.schema
	});
	if (isSystemField(req.params["collection"], req.params["field"])) throw new ForbiddenError();
	await service.deleteField(req.params["collection"], req.params["field"]);
	return next();
}), respond);
var fields_default = router;

//#endregion
export { fields_default as default };