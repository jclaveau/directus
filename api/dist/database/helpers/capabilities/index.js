import { __export } from "../../../_virtual/rolldown_runtime.js";
import { CapabilitiesHelperPostgres } from "./dialects/postgres.js";
import { CapabilitiesHelperDefault } from "./dialects/default.js";
import { CapabilitiesHelperMySQL } from "./dialects/mysql.js";

//#region src/database/helpers/capabilities/index.ts
var capabilities_exports = /* @__PURE__ */ __export({
	cockroachdb: () => CapabilitiesHelperPostgres,
	mssql: () => CapabilitiesHelperDefault,
	mysql: () => CapabilitiesHelperMySQL,
	oracle: () => CapabilitiesHelperDefault,
	postgres: () => CapabilitiesHelperPostgres,
	redshift: () => CapabilitiesHelperPostgres,
	sqlite: () => CapabilitiesHelperDefault
});

//#endregion
export { capabilities_exports, CapabilitiesHelperPostgres as cockroachdb, CapabilitiesHelperDefault as mssql, CapabilitiesHelperMySQL as mysql, CapabilitiesHelperDefault as oracle, CapabilitiesHelperPostgres as postgres, CapabilitiesHelperPostgres as redshift, CapabilitiesHelperDefault as sqlite };