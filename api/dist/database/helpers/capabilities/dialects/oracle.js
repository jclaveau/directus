import { CapabilitiesHelper } from "../types.js";

//#region src/database/helpers/capabilities/dialects/oracle.ts
var CapabilitiesHelperOracle = class extends CapabilitiesHelper {
	async preservesInsertOrderInReturning() {
		return true;
	}
};

//#endregion
export { CapabilitiesHelperOracle };