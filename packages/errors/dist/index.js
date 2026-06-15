import ms from "ms";

//#region src/create-error.ts
const createError = (code, message, status = 500) => {
	return class extends Error {
		name = "DirectusError";
		extensions;
		code = code.toUpperCase();
		status = status;
		constructor(extensions, options) {
			const msg = typeof message === "string" ? message : message(extensions);
			super(msg, options);
			this.extensions = extensions;
		}
		toString() {
			return `${this.name} [${this.code}]: ${this.message}`;
		}
	};
};

//#endregion
//#region src/codes.ts
let ErrorCode = /* @__PURE__ */ function(ErrorCode$1) {
	ErrorCode$1["ContainsNullValues"] = "CONTAINS_NULL_VALUES";
	ErrorCode$1["ContentTooLarge"] = "CONTENT_TOO_LARGE";
	ErrorCode$1["Forbidden"] = "FORBIDDEN";
	ErrorCode$1["IllegalAssetTransformation"] = "ILLEGAL_ASSET_TRANSFORMATION";
	ErrorCode$1["Internal"] = "INTERNAL_SERVER_ERROR";
	ErrorCode$1["InvalidCredentials"] = "INVALID_CREDENTIALS";
	ErrorCode$1["InvalidForeignKey"] = "INVALID_FOREIGN_KEY";
	ErrorCode$1["InvalidIp"] = "INVALID_IP";
	ErrorCode$1["InvalidOtp"] = "INVALID_OTP";
	ErrorCode$1["InvalidPayload"] = "INVALID_PAYLOAD";
	ErrorCode$1["InvalidProvider"] = "INVALID_PROVIDER";
	ErrorCode$1["InvalidProviderConfig"] = "INVALID_PROVIDER_CONFIG";
	ErrorCode$1["InvalidQuery"] = "INVALID_QUERY";
	ErrorCode$1["InvalidToken"] = "INVALID_TOKEN";
	ErrorCode$1["LimitExceeded"] = "LIMIT_EXCEEDED";
	ErrorCode$1["MethodNotAllowed"] = "METHOD_NOT_ALLOWED";
	ErrorCode$1["NotNullViolation"] = "NOT_NULL_VIOLATION";
	ErrorCode$1["OutOfDate"] = "OUT_OF_DATE";
	ErrorCode$1["RangeNotSatisfiable"] = "RANGE_NOT_SATISFIABLE";
	ErrorCode$1["RecordNotUnique"] = "RECORD_NOT_UNIQUE";
	ErrorCode$1["RequestsExceeded"] = "REQUESTS_EXCEEDED";
	ErrorCode$1["RouteNotFound"] = "ROUTE_NOT_FOUND";
	ErrorCode$1["ServiceUnavailable"] = "SERVICE_UNAVAILABLE";
	ErrorCode$1["TokenExpired"] = "TOKEN_EXPIRED";
	ErrorCode$1["UnexpectedResponse"] = "UNEXPECTED_RESPONSE";
	ErrorCode$1["UnprocessableContent"] = "UNPROCESSABLE_CONTENT";
	ErrorCode$1["UnsupportedMediaType"] = "UNSUPPORTED_MEDIA_TYPE";
	ErrorCode$1["UserSuspended"] = "USER_SUSPENDED";
	ErrorCode$1["ValueOutOfRange"] = "VALUE_OUT_OF_RANGE";
	ErrorCode$1["ValueTooLong"] = "VALUE_TOO_LONG";
	return ErrorCode$1;
}({});

//#endregion
//#region src/is-directus-error.ts
/**
* Check whether or not a passed value is a valid Directus error.
*
* @param value - Any value
* @param code - Error code to check for
*/
const isDirectusError = (value, code) => {
	const isDirectusError$1 = typeof value === "object" && value !== null && Array.isArray(value) === false && "name" in value && value.name === "DirectusError";
	if (code) return isDirectusError$1 && "code" in value && value.code === code.toUpperCase();
	return isDirectusError$1;
};

//#endregion
//#region src/errors/contains-null-values.ts
const messageConstructor$16 = ({ collection, field }) => `Field "${field}" in collection "${collection}" contains null values.`;
const ContainsNullValuesError = createError(ErrorCode.ContainsNullValues, messageConstructor$16, 400);

//#endregion
//#region src/errors/content-too-large.ts
const ContentTooLargeError = createError(ErrorCode.ContentTooLarge, "Uploaded content is too large.", 413);

//#endregion
//#region src/injected-dependencies.ts
const injectedDependencies = {};
function injectErrorsDependencies(emitter, env) {
	injectedDependencies.emitter = emitter;
	injectedDependencies.env = env;
}
function useEmitter() {
	return injectedDependencies.emitter;
}
function useEnv() {
	return injectedDependencies.env;
}

//#endregion
//#region src/errors/forbidden.ts
const messageConstructor$15 = (ext) => {
	const defaultReason = `You don't have permission to access this.`;
	useEmitter()?.emitAction("permission.error", {
		defaultReason,
		values: ext && ext.values
	}, {
		database: null,
		schema: null,
		accountability: ext && ext.values && ("accountability" in ext.values ? ext.values.accountability : null)
	});
	if (ext?.reason) return ext.reason;
	return defaultReason;
};
const ForbiddenError = createError(ErrorCode.Forbidden, messageConstructor$15, 403);

//#endregion
//#region src/errors/hit-rate-limit.ts
const messageConstructor$14 = (extensions) => {
	return `Too many requests, retry after ${ms(extensions.reset.getTime() - Date.now())}.`;
};
const HitRateLimitError = createError(ErrorCode.RequestsExceeded, messageConstructor$14, 429);

//#endregion
//#region src/errors/illegal-asset-transformation.ts
const IllegalAssetTransformationError = createError(ErrorCode.IllegalAssetTransformation, "Illegal asset transformation.", 400);

//#endregion
//#region src/errors/internal.ts
const InternalServerError = createError(ErrorCode.Internal, `An unexpected error occurred.`);

//#endregion
//#region src/errors/invalid-credentials.ts
const InvalidCredentialsError = createError(ErrorCode.InvalidCredentials, "Invalid user credentials.", 401);

//#endregion
//#region src/errors/invalid-foreign-key.ts
const messageConstructor$13 = ({ collection, field, value }) => {
	let message = "Invalid foreign key";
	if (value) message += ` "${value}"`;
	if (field) message += ` for field "${field}"`;
	if (collection) message += ` in collection "${collection}"`;
	message += `.`;
	return message;
};
const InvalidForeignKeyError = createError(ErrorCode.InvalidForeignKey, messageConstructor$13, 400);

//#endregion
//#region src/errors/invalid-ip.ts
const InvalidIpError = createError(ErrorCode.InvalidIp, "Invalid IP address.", 401);

//#endregion
//#region src/errors/invalid-otp.ts
const InvalidOtpError = createError(ErrorCode.InvalidOtp, "Invalid user OTP.", 401);

//#endregion
//#region src/errors/invalid-payload.ts
const messageConstructor$12 = ({ reason }) => `Invalid payload. ${reason}.`;
const InvalidPayloadError = createError(ErrorCode.InvalidPayload, messageConstructor$12, 400);

//#endregion
//#region src/errors/invalid-provider-config.ts
const InvalidProviderConfigError = createError(ErrorCode.InvalidProviderConfig, "Invalid config.", 503);

//#endregion
//#region src/errors/invalid-provider.ts
const InvalidProviderError = createError(ErrorCode.InvalidProvider, "Invalid provider.", 403);

//#endregion
//#region src/errors/invalid-query.ts
const messageConstructor$11 = ({ reason }) => `Invalid query. ${reason}.`;
const InvalidQueryError = createError(ErrorCode.InvalidQuery, messageConstructor$11, 400);

//#endregion
//#region src/errors/invalid-token.ts
const InvalidTokenError = createError(ErrorCode.InvalidToken, "Invalid token.", 403);

//#endregion
//#region src/errors/limit-exceeded.ts
const messageConstructor$10 = ({ category }) => {
	return `${category} limit exceeded.`;
};
const LimitExceededError = createError(ErrorCode.LimitExceeded, messageConstructor$10, 403);

//#endregion
//#region src/errors/method-not-allowed.ts
const messageConstructor$9 = (extensions) => `Invalid method "${extensions.current}" used. Should be one of ${extensions.allowed.map((method) => `"${method}"`).join(", ")}.`;
const MethodNotAllowedError = createError(ErrorCode.MethodNotAllowed, messageConstructor$9, 405);

//#endregion
//#region src/errors/not-null-violation.ts
const messageConstructor$8 = ({ collection, field }) => {
	let message = "Value ";
	if (field) message += `for field "${field}" `;
	if (collection) message += `in collection "${collection}" `;
	message += `can't be null.`;
	return message;
};
const NotNullViolationError = createError(ErrorCode.NotNullViolation, messageConstructor$8, 400);

//#endregion
//#region src/errors/out-of-date.ts
const OutOfDateError = createError(ErrorCode.OutOfDate, "Operation could not be executed: Your current instance of Directus is out of date.", 503);

//#endregion
//#region src/errors/range-not-satisfiable.ts
const messageConstructor$7 = ({ range }) => {
	return `Range ${`"${range.start ?? ""}-${range.end ?? ""}"`} is invalid or the file's size doesn't match the requested range.`;
};
const RangeNotSatisfiableError = createError(ErrorCode.RangeNotSatisfiable, messageConstructor$7, 416);

//#endregion
//#region src/errors/record-not-unique.ts
const messageConstructor$6 = ({ collection, field, value }) => {
	let message = "Value ";
	if (value) message += `"${value}" `;
	if (field) message += `for field "${field}" `;
	if (collection) message += `in collection "${collection}" `;
	message += `has to be unique.`;
	return message;
};
const RecordNotUniqueError = createError(ErrorCode.RecordNotUnique, messageConstructor$6, 400);

//#endregion
//#region src/errors/route-not-found.ts
const messageConstructor$5 = ({ path }) => `Route ${path} doesn't exist.`;
const RouteNotFoundError = createError(ErrorCode.RouteNotFound, messageConstructor$5, 404);

//#endregion
//#region src/errors/service-unavailable.ts
const messageConstructor$4 = ({ service, reason }) => `Service "${service}" is unavailable. ${reason}.`;
const ServiceUnavailableError = createError(ErrorCode.ServiceUnavailable, messageConstructor$4, 503);

//#endregion
//#region src/errors/token-expired.ts
const TokenExpiredError = createError(ErrorCode.TokenExpired, "Token expired.", 401);

//#endregion
//#region src/errors/unexpected-response.ts
const UnexpectedResponseError = createError(ErrorCode.UnexpectedResponse, "Received an unexpected response.", 503);

//#endregion
//#region src/errors/unprocessable-content.ts
const messageConstructor$3 = (extensions) => `Can't process content. ${extensions.reason}.`;
const UnprocessableContentError = createError(ErrorCode.UnprocessableContent, messageConstructor$3, 422);

//#endregion
//#region src/errors/unsupported-media-type.ts
const messageConstructor$2 = (extensions) => `Unsupported media type "${extensions.mediaType}" in ${extensions.where}.`;
const UnsupportedMediaTypeError = createError(ErrorCode.UnsupportedMediaType, messageConstructor$2, 415);

//#endregion
//#region src/errors/user-suspended.ts
const UserSuspendedError = createError(ErrorCode.UserSuspended, "User suspended.", 401);

//#endregion
//#region src/errors/value-out-of-range.ts
const messageConstructor$1 = ({ collection, field, value }) => {
	let message = "Numeric value ";
	if (value) message += `"${value}" `;
	if (field) message += `for field "${field}" `;
	if (collection) message += `in collection "${collection}" `;
	message += `is out of range.`;
	return message;
};
const ValueOutOfRangeError = createError(ErrorCode.ValueOutOfRange, messageConstructor$1, 400);

//#endregion
//#region src/errors/value-too-long.ts
const messageConstructor = ({ collection, field, value }) => {
	let message = "Value ";
	if (value) message += `"${value}" `;
	if (field) message += `for field "${field}" `;
	if (collection) message += `in collection "${collection}" `;
	message += `is too long.`;
	return message;
};
const ValueTooLongError = createError(ErrorCode.ValueTooLong, messageConstructor, 400);

//#endregion
export { ContainsNullValuesError, ContentTooLargeError, ErrorCode, ForbiddenError, HitRateLimitError, IllegalAssetTransformationError, InternalServerError, InvalidCredentialsError, InvalidForeignKeyError, InvalidIpError, InvalidOtpError, InvalidPayloadError, InvalidProviderConfigError, InvalidProviderError, InvalidQueryError, InvalidTokenError, LimitExceededError, MethodNotAllowedError, NotNullViolationError, OutOfDateError, RangeNotSatisfiableError, RecordNotUniqueError, RouteNotFoundError, ServiceUnavailableError, TokenExpiredError, UnexpectedResponseError, UnprocessableContentError, UnsupportedMediaTypeError, UserSuspendedError, ValueOutOfRangeError, ValueTooLongError, createError, injectErrorsDependencies, injectedDependencies, isDirectusError, useEmitter, useEnv };