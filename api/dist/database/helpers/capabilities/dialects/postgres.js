import { CapabilitiesHelper } from "../types.js";

//#region src/database/helpers/capabilities/dialects/postgres.ts
const JSON_BATCH_UPDATE_TYPES = new Set([
	"bigInteger",
	"boolean",
	"csv",
	"date",
	"dateTime",
	"decimal",
	"float",
	"hash",
	"integer",
	"string",
	"text",
	"time",
	"timestamp",
	"uuid"
]);
var CapabilitiesHelperPostgres = class extends CapabilitiesHelper {
	supportsColumnPositionInGroupBy() {
		return true;
	}
	supportsDeduplicationOfParameters() {
		return false;
	}
	async preservesInsertOrderInReturning() {
		return true;
	}
	supportsJsonBatchUpdate() {
		return true;
	}
	jsonBatchUpdateTypes() {
		return JSON_BATCH_UPDATE_TYPES;
	}
};

//#endregion
export { CapabilitiesHelperPostgres };