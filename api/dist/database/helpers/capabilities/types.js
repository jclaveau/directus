import { DatabaseHelper } from "../types.js";

//#region src/database/helpers/capabilities/types.ts
var CapabilitiesHelper = class extends DatabaseHelper {
	supportsColumnPositionInGroupBy() {
		return false;
	}
	/**
	* Indicates if the values within the list of parameters can be safely deduplicated.
	* This is useful for databases that do not automatically cast the value for cases when a parameter is referenced multiple times in the query,
	* but the targeting type is different. For example when referencing a parameter which a UUID, postgres cannot use the same parameter reference
	* to compare it against column of type UUID and at the same time against a column of type a string.
	*/
	supportsDeduplicationOfParameters() {
		return true;
	}
	/**
	* Whether INSERT … RETURNING (or the dialect equivalent like MSSQL's OUTPUT clause)
	* yields rows in insertion order with a contractual guarantee. When true, ItemsService
	* can use a single multi-row INSERT and map the returned PKs back to the input array
	* positionally; when false, it must fall back to a per-row insert loop.
	*
	* Default: false (the conservative answer). Override in dialects where the underlying
	* RETURNING semantics — and the knex driver path emitting them — both preserve order.
	*/
	async preservesInsertOrderInReturning() {
		return false;
	}
};

//#endregion
export { CapabilitiesHelper };