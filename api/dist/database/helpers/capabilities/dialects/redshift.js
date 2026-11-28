import { CapabilitiesHelperPostgres } from "./postgres.js";

//#region src/database/helpers/capabilities/dialects/redshift.ts
var CapabilitiesHelperRedshift = class extends CapabilitiesHelperPostgres {
	supportsJsonBatchUpdate() {
		return false;
	}
	jsonBatchUpdateTypes() {
		return /* @__PURE__ */ new Set();
	}
};

//#endregion
export { CapabilitiesHelperRedshift };