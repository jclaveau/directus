import { CapabilitiesHelper } from "../types.js";

//#region src/database/helpers/capabilities/dialects/mysql.ts
var CapabilitiesHelperMySQL = class extends CapabilitiesHelper {
	supportsColumnPositionInGroupBy() {
		return true;
	}
};

//#endregion
export { CapabilitiesHelperMySQL };