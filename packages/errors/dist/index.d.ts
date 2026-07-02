import { DirectusError, Range } from "@directus/types";

//#region src/create-error.d.ts
interface DirectusErrorConstructor<Extensions = void> {
  new (extensions: Extensions, options?: ErrorOptions): DirectusError<Extensions>;
  readonly prototype: DirectusError<Extensions>;
}
declare const createError: <Extensions = void>(code: string, message: string | ((extensions: Extensions) => string), status?: number) => DirectusErrorConstructor<Extensions>;
//#endregion
//#region src/codes.d.ts
declare enum ErrorCode {
  ContainsNullValues = "CONTAINS_NULL_VALUES",
  ContentTooLarge = "CONTENT_TOO_LARGE",
  Forbidden = "FORBIDDEN",
  IllegalAssetTransformation = "ILLEGAL_ASSET_TRANSFORMATION",
  Internal = "INTERNAL_SERVER_ERROR",
  InvalidCredentials = "INVALID_CREDENTIALS",
  InvalidForeignKey = "INVALID_FOREIGN_KEY",
  InvalidIp = "INVALID_IP",
  InvalidOtp = "INVALID_OTP",
  InvalidPayload = "INVALID_PAYLOAD",
  InvalidProvider = "INVALID_PROVIDER",
  InvalidProviderConfig = "INVALID_PROVIDER_CONFIG",
  InvalidQuery = "INVALID_QUERY",
  InvalidToken = "INVALID_TOKEN",
  LimitExceeded = "LIMIT_EXCEEDED",
  MethodNotAllowed = "METHOD_NOT_ALLOWED",
  NotNullViolation = "NOT_NULL_VIOLATION",
  OutOfDate = "OUT_OF_DATE",
  RangeNotSatisfiable = "RANGE_NOT_SATISFIABLE",
  RecordNotUnique = "RECORD_NOT_UNIQUE",
  RequestsExceeded = "REQUESTS_EXCEEDED",
  RouteNotFound = "ROUTE_NOT_FOUND",
  ServiceUnavailable = "SERVICE_UNAVAILABLE",
  TokenExpired = "TOKEN_EXPIRED",
  UnexpectedResponse = "UNEXPECTED_RESPONSE",
  UnprocessableContent = "UNPROCESSABLE_CONTENT",
  UnsupportedMediaType = "UNSUPPORTED_MEDIA_TYPE",
  UserSuspended = "USER_SUSPENDED",
  ValueOutOfRange = "VALUE_OUT_OF_RANGE",
  ValueTooLong = "VALUE_TOO_LONG",
}
//#endregion
//#region src/errors/contains-null-values.d.ts
interface ContainsNullValuesErrorExtensions {
  collection: string;
  field: string;
}
declare const ContainsNullValuesError: DirectusErrorConstructor<ContainsNullValuesErrorExtensions>;
//#endregion
//#region src/errors/hit-rate-limit.d.ts
interface HitRateLimitErrorExtensions {
  limit: number;
  reset: Date;
}
declare const HitRateLimitError: DirectusErrorConstructor<HitRateLimitErrorExtensions>;
//#endregion
//#region src/errors/illegal-asset-transformation.d.ts
interface IllegalAssetTransformationErrorExtensions {
  invalidTransformations: string[];
}
declare const IllegalAssetTransformationError: DirectusErrorConstructor<IllegalAssetTransformationErrorExtensions>;
//#endregion
//#region src/errors/invalid-foreign-key.d.ts
interface InvalidForeignKeyErrorExtensions {
  collection: string | null;
  field: string | null;
  value: string | null;
}
declare const InvalidForeignKeyError: DirectusErrorConstructor<InvalidForeignKeyErrorExtensions>;
//#endregion
//#region src/errors/invalid-payload.d.ts
interface InvalidPayloadErrorExtensions {
  reason: string;
}
declare const InvalidPayloadError: DirectusErrorConstructor<InvalidPayloadErrorExtensions>;
//#endregion
//#region src/errors/invalid-provider-config.d.ts
interface InvalidProviderConfigErrorExtensions {
  provider: string;
  reason?: string;
}
declare const InvalidProviderConfigError: DirectusErrorConstructor<InvalidProviderConfigErrorExtensions>;
//#endregion
//#region src/errors/invalid-query.d.ts
interface InvalidQueryErrorExtensions {
  reason: string;
}
declare const InvalidQueryError: DirectusErrorConstructor<InvalidQueryErrorExtensions>;
//#endregion
//#region src/errors/method-not-allowed.d.ts
interface MethodNotAllowedErrorExtensions {
  allowed: string[];
  current: string;
}
declare const MethodNotAllowedError: DirectusErrorConstructor<MethodNotAllowedErrorExtensions>;
//#endregion
//#region src/errors/not-null-violation.d.ts
interface NotNullViolationErrorExtensions {
  collection: string | null;
  field: string | null;
}
declare const NotNullViolationError: DirectusErrorConstructor<NotNullViolationErrorExtensions>;
//#endregion
//#region src/errors/range-not-satisfiable.d.ts
interface RangeNotSatisfiableErrorExtensions {
  range: Range;
}
declare const RangeNotSatisfiableError: DirectusErrorConstructor<RangeNotSatisfiableErrorExtensions>;
//#endregion
//#region src/errors/record-not-unique.d.ts
interface RecordNotUniqueErrorExtensions {
  collection: string | null;
  field: string | null;
  value: string | null;
  primaryKey?: boolean;
}
declare const RecordNotUniqueError: DirectusErrorConstructor<RecordNotUniqueErrorExtensions>;
//#endregion
//#region src/errors/route-not-found.d.ts
interface RouteNotFoundErrorExtensions {
  path: string;
}
declare const RouteNotFoundError: DirectusErrorConstructor<RouteNotFoundErrorExtensions>;
//#endregion
//#region src/errors/service-unavailable.d.ts
interface ServiceUnavailableErrorExtensions {
  service: string;
  reason: string;
}
declare const ServiceUnavailableError: DirectusErrorConstructor<ServiceUnavailableErrorExtensions>;
//#endregion
//#region src/errors/unprocessable-content.d.ts
interface UnprocessableContentErrorExtensions {
  reason: string;
}
declare const UnprocessableContentError: DirectusErrorConstructor<UnprocessableContentErrorExtensions>;
//#endregion
//#region src/errors/unsupported-media-type.d.ts
interface UnsupportedMediaTypeErrorExtensions {
  mediaType: string;
  where: string;
}
declare const UnsupportedMediaTypeError: DirectusErrorConstructor<UnsupportedMediaTypeErrorExtensions>;
//#endregion
//#region src/errors/value-out-of-range.d.ts
interface ValueOutOfRangeErrorExtensions {
  collection: string | null;
  field: string | null;
  value: string | null;
}
declare const ValueOutOfRangeError: DirectusErrorConstructor<ValueOutOfRangeErrorExtensions>;
//#endregion
//#region src/errors/value-too-long.d.ts
interface ValueTooLongErrorExtensions {
  collection: string | null;
  field: string | null;
  value: string | null;
}
declare const ValueTooLongError: DirectusErrorConstructor<ValueTooLongErrorExtensions>;
//#endregion
//#region src/types.d.ts
type Map = {
  [ErrorCode.ContainsNullValues]: ContainsNullValuesErrorExtensions;
  [ErrorCode.IllegalAssetTransformation]: IllegalAssetTransformationErrorExtensions;
  [ErrorCode.InvalidForeignKey]: InvalidForeignKeyErrorExtensions;
  [ErrorCode.InvalidPayload]: InvalidPayloadErrorExtensions;
  [ErrorCode.InvalidProviderConfig]: InvalidProviderConfigErrorExtensions;
  [ErrorCode.InvalidQuery]: InvalidQueryErrorExtensions;
  [ErrorCode.MethodNotAllowed]: MethodNotAllowedErrorExtensions;
  [ErrorCode.NotNullViolation]: NotNullViolationErrorExtensions;
  [ErrorCode.RangeNotSatisfiable]: RangeNotSatisfiableErrorExtensions;
  [ErrorCode.RecordNotUnique]: RecordNotUniqueErrorExtensions;
  [ErrorCode.RequestsExceeded]: HitRateLimitErrorExtensions;
  [ErrorCode.RouteNotFound]: RouteNotFoundErrorExtensions;
  [ErrorCode.ServiceUnavailable]: ServiceUnavailableErrorExtensions;
  [ErrorCode.UnprocessableContent]: UnprocessableContentErrorExtensions;
  [ErrorCode.UnsupportedMediaType]: UnsupportedMediaTypeErrorExtensions;
  [ErrorCode.ValueOutOfRange]: ValueOutOfRangeErrorExtensions;
  [ErrorCode.ValueTooLong]: ValueTooLongErrorExtensions;
};
/** Map error codes to error extensions. */
type ExtensionsMap = { [code in ErrorCode]: code extends keyof Map ? Map[code] : never };
//#endregion
//#region src/is-directus-error.d.ts
/**
 * Check whether or not a passed value is a valid Directus error.
 *
 * @param value - Any value
 * @param code - Error code to check for
 */
declare const isDirectusError: <T = never, C extends string = string>(value: unknown, code?: C) => value is DirectusError<[T] extends [never] ? (C extends keyof ExtensionsMap ? ExtensionsMap[C] : unknown) : T>;
//#endregion
//#region src/errors/content-too-large.d.ts
declare const ContentTooLargeError: DirectusErrorConstructor<void>;
//#endregion
//#region src/errors/forbidden.d.ts
interface ForbiddenErrorExtensions {
  reason: string;
}
declare const ForbiddenError: DirectusErrorConstructor<void | ForbiddenErrorExtensions>;
//#endregion
//#region src/errors/internal.d.ts
declare const InternalServerError: DirectusErrorConstructor<void>;
//#endregion
//#region src/errors/invalid-credentials.d.ts
declare const InvalidCredentialsError: DirectusErrorConstructor<void>;
//#endregion
//#region src/errors/invalid-ip.d.ts
declare const InvalidIpError: DirectusErrorConstructor<void>;
//#endregion
//#region src/errors/invalid-otp.d.ts
declare const InvalidOtpError: DirectusErrorConstructor<void>;
//#endregion
//#region src/errors/invalid-provider.d.ts
declare const InvalidProviderError: DirectusErrorConstructor<void>;
//#endregion
//#region src/errors/invalid-token.d.ts
declare const InvalidTokenError: DirectusErrorConstructor<void>;
//#endregion
//#region src/errors/limit-exceeded.d.ts
interface LimitExceededErrorExtensions {
  category: string;
}
declare const LimitExceededError: DirectusErrorConstructor<LimitExceededErrorExtensions>;
//#endregion
//#region src/errors/out-of-date.d.ts
declare const OutOfDateError: DirectusErrorConstructor<void>;
//#endregion
//#region src/errors/token-expired.d.ts
declare const TokenExpiredError: DirectusErrorConstructor<void>;
//#endregion
//#region src/errors/unexpected-response.d.ts
declare const UnexpectedResponseError: DirectusErrorConstructor<void>;
//#endregion
//#region src/errors/user-suspended.d.ts
declare const UserSuspendedError: DirectusErrorConstructor<void>;
//#endregion
export { ContainsNullValuesError, ContentTooLargeError, type DirectusError, DirectusErrorConstructor, ErrorCode, ForbiddenError, HitRateLimitError, IllegalAssetTransformationError, InternalServerError, InvalidCredentialsError, InvalidForeignKeyError, InvalidIpError, InvalidOtpError, InvalidPayloadError, InvalidProviderConfigError, InvalidProviderError, InvalidQueryError, InvalidTokenError, LimitExceededError, MethodNotAllowedError, NotNullViolationError, OutOfDateError, RangeNotSatisfiableError, RecordNotUniqueError, RouteNotFoundError, ServiceUnavailableError, TokenExpiredError, UnexpectedResponseError, UnprocessableContentError, UnsupportedMediaTypeError, UserSuspendedError, ValueOutOfRangeError, ValueTooLongError, createError, isDirectusError };