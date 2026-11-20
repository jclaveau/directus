import { CapabilitiesHelperDefault } from "./default.js";

//#region src/database/helpers/capabilities/dialects/oracle.ts
var CapabilitiesHelperOracle = class extends CapabilitiesHelperDefault {
	async preservesInsertOrderInReturning() {
		return true;
	}
};

//#endregion
export { CapabilitiesHelperOracle };