import { CapabilitiesHelperPostgres } from "./postgres.js";

//#region src/database/helpers/capabilities/dialects/cockroachdb.ts
var CapabilitiesHelperCockroachDb = class extends CapabilitiesHelperPostgres {
	supportsJsonBatchUpdate() {
		return false;
	}
	jsonBatchUpdateTypes() {
		return /* @__PURE__ */ new Set();
	}
	supportsNoKeyUpdateLock() {
		return false;
	}
};

//#endregion
export { CapabilitiesHelperCockroachDb };