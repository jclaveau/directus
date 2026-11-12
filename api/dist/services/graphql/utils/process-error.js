import { useLogger } from "../../../logger/index.js";
import { isDirectusError } from "@directus/errors";

//#region src/services/graphql/utils/process-error.ts
const processError = (accountability, error) => {
	useLogger().error(error);
	let originalError = error.originalError;
	if (originalError && "originalError" in originalError) originalError = originalError.originalError;
	if (isDirectusError(originalError)) return {
		message: originalError.message,
		extensions: {
			code: originalError.code,
			...originalError.extensions ?? {}
		},
		...error.locations && { locations: error.locations },
		...error.path && { path: error.path }
	};
	else if (accountability?.admin === true) return {
		message: error.message,
		extensions: { code: "INTERNAL_SERVER_ERROR" },
		...error.locations && { locations: error.locations },
		...error.path && { path: error.path }
	};
	else return {
		message: "An unexpected error occurred.",
		extensions: { code: "INTERNAL_SERVER_ERROR" }
	};
};
var process_error_default = processError;

//#endregion
export { process_error_default as default };