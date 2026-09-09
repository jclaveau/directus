import { CapabilitiesHelper } from "../types.js";

//#region src/database/helpers/capabilities/dialects/postgres.ts
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
};

//#endregion
export { CapabilitiesHelperPostgres };