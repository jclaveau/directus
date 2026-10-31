import { InternalServerError, createError } from "@directus/errors";
import { defineOperationApi } from "@directus/extensions";

//#region src/operations/throw-error/index.ts
const FALLBACK_ERROR = new InternalServerError();
var throw_error_default = defineOperationApi({
	id: "throw-error",
	handler: ({ code, status, message }) => {
		const statusCode = parseInt(status);
		throw new (createError(code ?? FALLBACK_ERROR.code, message ?? FALLBACK_ERROR.message, isNaN(statusCode) ? FALLBACK_ERROR.status : statusCode))();
	}
});

//#endregion
export { throw_error_default as default };