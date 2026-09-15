import { sanitizeQuery } from "../utils/sanitize-query.js";
import { validateQuery } from "../utils/validate-query.js";

//#region src/middleware/sanitize-query.ts
const sanitizeQueryMiddleware = async (req, _res, next) => {
	req.sanitizedQuery = {};
	if (!req.query) return;
	if (Object.keys(req.query).length === 0) {
		Object.freeze(req.sanitizedQuery);
		return next();
	}
	try {
		req.sanitizedQuery = await sanitizeQuery({
			fields: req.query["fields"] || "*",
			...req.query
		}, req.schema, req.accountability || null);
		Object.freeze(req.sanitizedQuery);
		validateQuery(req.sanitizedQuery);
	} catch (error) {
		return next(error);
	}
	return next();
};
var sanitize_query_default = sanitizeQueryMiddleware;

//#endregion
export { sanitize_query_default as default };