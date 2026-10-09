import async_handler_default from "../utils/async-handler.js";
import { sanitizeQuery } from "../utils/sanitize-query.js";
import { validateQuery } from "../utils/validate-query.js";
import { InvalidPayloadError } from "@directus/errors";
import Joi from "joi";

//#region src/middleware/validate-batch.ts
const validateBatch = (scope) => async_handler_default(async (req, _res, next) => {
	if (req.method.toLowerCase() === "get") {
		req.body = {};
		return next();
	}
	if (req.method.toLowerCase() !== "search" && scope !== "read" && req.singleton) return next();
	if (!req.body) throw new InvalidPayloadError({ reason: "Payload in body is required" });
	if (["update", "delete"].includes(scope) && Array.isArray(req.body)) return next();
	if (scope === "read" && req.body.query) {
		req.sanitizedQuery = await sanitizeQuery(req.body.query, req.schema, req.accountability);
		validateQuery(req.sanitizedQuery);
	}
	let batchSchema = Joi.object().keys({
		keys: Joi.array().items(Joi.alternatives(Joi.string(), Joi.number())),
		query: Joi.object().unknown()
	});
	if (["update", "delete"].includes(scope)) batchSchema = batchSchema.xor("query", "keys");
	if (scope === "update") batchSchema = batchSchema.keys({ data: Joi.object().unknown().required() });
	const { error } = batchSchema.validate(req.body);
	if (error) throw new InvalidPayloadError({ reason: error.details[0].message });
	return next();
});

//#endregion
export { validateBatch };