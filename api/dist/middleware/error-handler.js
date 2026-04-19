import { useLogger } from "../logger/index.js";
import database_default from "../database/index.js";
import emitter_default from "../emitter.js";
import { ErrorCode, InternalServerError, isDirectusError } from "@directus/errors";
import { isObject } from "@directus/utils";
import { getNodeEnv } from "@directus/utils/node";

//#region src/middleware/error-handler.ts
const FALLBACK_ERROR = new InternalServerError();
const errorHandler = asyncErrorHandler(async (err, req, res) => {
	const logger = useLogger();
	let errors = [];
	let status = null;
	const receivedErrors = Array.isArray(err) ? err : [err];
	for (const error of receivedErrors) {
		if (getNodeEnv() === "development" && error instanceof Error && error.stack) (error.extensions ??= {})["stack"] = error.stack;
		if (isDirectusError(error)) {
			logger.debug(error);
			if (status === null) status = error.status;
			else if (status !== error.status) status = FALLBACK_ERROR.status;
			errors.push({
				message: error.message,
				extensions: {
					...error.extensions ?? {},
					code: error.code
				}
			});
			if (isDirectusError(error, ErrorCode.MethodNotAllowed)) res.header("Allow", error.extensions.allowed.join(", "));
		} else {
			logger.error(error);
			status = FALLBACK_ERROR.status;
			if (req.accountability?.admin === true) {
				const localError = isObject(error) ? error : {};
				errors = [{
					message: ((typeof localError["message"] === "string" ? localError["message"] : null) ?? (typeof error === "string" ? error : null)) || FALLBACK_ERROR.message,
					extensions: {
						code: FALLBACK_ERROR.code,
						...localError["extensions"] ?? {}
					}
				}];
			} else errors = [{
				message: FALLBACK_ERROR.message,
				extensions: { code: FALLBACK_ERROR.code }
			}];
		}
	}
	res.status(status ?? FALLBACK_ERROR.status);
	const updatedErrors = await emitter_default.emitFilter("request.error", errors, {}, {
		database: database_default(),
		schema: req.schema,
		accountability: req.accountability ?? null
	});
	return res.json({ errors: updatedErrors });
});
function asyncErrorHandler(fn) {
	return (err, req, res, next) => fn(err, req, res, next).catch((error) => {
		try {
			useLogger().error(error, "Unexpected error in error handler");
		} catch {}
		if (res.headersSent) return next(err);
		res.status(FALLBACK_ERROR.status);
		return res.json({ errors: [{
			message: FALLBACK_ERROR.message,
			extensions: { code: FALLBACK_ERROR.code }
		}] });
	});
}

//#endregion
export { errorHandler };