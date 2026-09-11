import { __export } from "../../../_virtual/rolldown_runtime.js";
import { CapabilitiesHelperPostgres } from "./dialects/postgres.js";
import { CapabilitiesHelperOracle } from "./dialects/oracle.js";
import { CapabilitiesHelperMySQL } from "./dialects/mysql.js";
import { CapabilitiesHelperMSSQL } from "./dialects/mssql.js";
import { CapabilitiesHelperSqlite } from "./dialects/sqlite.js";

//#region src/database/helpers/capabilities/index.ts
var capabilities_exports = /* @__PURE__ */ __export({
	cockroachdb: () => CapabilitiesHelperPostgres,
	mssql: () => CapabilitiesHelperMSSQL,
	mysql: () => CapabilitiesHelperMySQL,
	oracle: () => CapabilitiesHelperOracle,
	postgres: () => CapabilitiesHelperPostgres,
	redshift: () => CapabilitiesHelperPostgres,
	sqlite: () => CapabilitiesHelperSqlite
});

//#endregion
export { capabilities_exports, CapabilitiesHelperPostgres as cockroachdb, CapabilitiesHelperMSSQL as mssql, CapabilitiesHelperMySQL as mysql, CapabilitiesHelperOracle as oracle, CapabilitiesHelperPostgres as postgres, CapabilitiesHelperPostgres as redshift, CapabilitiesHelperSqlite as sqlite };