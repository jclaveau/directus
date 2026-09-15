import { ContainsNullValuesError, DatabasePoolExhaustedError, InvalidForeignKeyError, NotNullViolationError, RecordNotUniqueError, ValueOutOfRangeError, ValueTooLongError } from "@directus/errors";
import { isObject } from "@directus/utils";

//#region src/database/errors/dialects/postgres.ts
var PostgresErrorCodes = /* @__PURE__ */ function(PostgresErrorCodes$1) {
	PostgresErrorCodes$1["FOREIGN_KEY_VIOLATION"] = "23503";
	PostgresErrorCodes$1["NOT_NULL_VIOLATION"] = "23502";
	PostgresErrorCodes$1["NUMERIC_VALUE_OUT_OF_RANGE"] = "22003";
	PostgresErrorCodes$1["UNIQUE_VIOLATION"] = "23505";
	PostgresErrorCodes$1["VALUE_LIMIT_VIOLATION"] = "22001";
	return PostgresErrorCodes$1;
}(PostgresErrorCodes || {});
function extractError(error, data, context) {
	switch (error.code) {
		case PostgresErrorCodes.UNIQUE_VIOLATION: return uniqueViolation();
		case PostgresErrorCodes.NUMERIC_VALUE_OUT_OF_RANGE: return numericValueOutOfRange();
		case PostgresErrorCodes.VALUE_LIMIT_VIOLATION: return valueLimitViolation();
		case PostgresErrorCodes.NOT_NULL_VIOLATION: return notNullViolation();
		case PostgresErrorCodes.FOREIGN_KEY_VIOLATION: return foreignKeyViolation(context);
		default: return getPoolExhaustedError(error) ?? error;
	}
	function uniqueViolation() {
		const { table, detail } = error;
		const matches = detail.match(/\(([^)]+)\)/g);
		if (!matches) return error;
		const collection = table;
		const field = matches[0].slice(1, -1);
		return new RecordNotUniqueError({
			collection,
			field,
			value: field ? data[field] : null
		});
	}
	function numericValueOutOfRange() {
		const matches = error.message.match(/"(.*?)"/g);
		if (!matches) return error;
		const collection = matches[0].slice(1, -1);
		const field = matches[1]?.slice(1, -1) ?? null;
		return new ValueOutOfRangeError({
			collection,
			field,
			value: field ? data[field] : null
		});
	}
	function valueLimitViolation() {
		const matches = error.message.match(/"(.*?)"/g);
		if (!matches) return error;
		const collection = matches[0].slice(1, -1);
		const field = matches[1]?.slice(1, -1) ?? null;
		return new ValueTooLongError({
			collection,
			field,
			value: field ? data[field] : null
		});
	}
	function notNullViolation() {
		const { table, column } = error;
		if (!column) return error;
		if (error.message.endsWith("contains null values")) return new ContainsNullValuesError({
			collection: table,
			field: column
		});
		return new NotNullViolationError({
			collection: table,
			field: column
		});
	}
	function foreignKeyViolation(context$1) {
		const { table, detail, constraint } = error;
		const matches = detail.match(/\(([^)]+)\)/g);
		if (!matches) return error;
		const field = matches[0].slice(1, -1);
		const detailValue = matches[1]?.slice(1, -1) ?? null;
		let stillReferenced;
		if (context$1?.operation === "delete") stillReferenced = true;
		else if (context$1?.operation === "create") stillReferenced = false;
		else stillReferenced = detail.includes("is still referenced");
		const reason = stillReferenced ? "still_referenced" : "invalid_reference";
		const relatedTable = detail.match(/(?:present in|referenced from) table "([^"]+)"/)?.[1] ?? null;
		const collection = stillReferenced ? context$1?.collection ?? null : context$1?.collection ?? table;
		const relatedCollection = stillReferenced ? table : relatedTable;
		return new InvalidForeignKeyError({
			collection,
			field,
			value: field && data[field] !== void 0 ? data[field] : detailValue,
			constraint: constraint ?? null,
			relatedCollection,
			reason,
			operation: context$1?.operation ?? null
		});
	}
}
/**
* Turn a raw pg/pgbouncer/tarn error into a DatabasePoolExhaustedError, or
* null if it isn't one. The tarn/pgbouncer cases carry no SQLSTATE, so they're
* matched on the message. The connection tier is left null here for the caller
* (the request) to tag on.
*/
function getPoolExhaustedError(error) {
	if (!isObject(error)) return null;
	const code = typeof error["code"] === "string" ? error["code"] : "";
	const message = (typeof error["message"] === "string" ? error["message"] : "").toLowerCase();
	const isAcquireTimeout = message.includes("timeout acquiring a connection") || message.includes("pool is probably full");
	let reason = null;
	if (code === "53300") reason = "too_many_connections";
	else if (message.includes("no more connections allowed")) reason = "max_client_connections";
	else if (message.includes("query_wait_timeout")) reason = "pool_queue_timeout";
	else if (isAcquireTimeout) reason = "client_pool_timeout";
	if (reason === null) return null;
	return new DatabasePoolExhaustedError({
		reason,
		connection: null
	});
}

//#endregion
export { extractError, getPoolExhaustedError };