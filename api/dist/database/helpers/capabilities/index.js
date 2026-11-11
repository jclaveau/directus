import { __export } from "../../../_virtual/rolldown_runtime.js";
import { CapabilitiesHelperPostgres } from "./dialects/postgres.js";
import { CapabilitiesHelperRedshift } from "./dialects/redshift.js";
import { CapabilitiesHelperCockroachDb } from "./dialects/cockroachdb.js";
import { CapabilitiesHelperOracle } from "./dialects/oracle.js";
import { CapabilitiesHelperMySQL } from "./dialects/mysql.js";
import { CapabilitiesHelperMSSQL } from "./dialects/mssql.js";
import { CapabilitiesHelperSqlite } from "./dialects/sqlite.js";

//#region src/database/helpers/capabilities/index.ts
var capabilities_exports = /* @__PURE__ */ __export({
	cockroachdb: () => CapabilitiesHelperCockroachDb,
	mssql: () => CapabilitiesHelperMSSQL,
	mysql: () => CapabilitiesHelperMySQL,
	oracle: () => CapabilitiesHelperOracle,
	postgres: () => CapabilitiesHelperPostgres,
	redshift: () => CapabilitiesHelperRedshift,
	sqlite: () => CapabilitiesHelperSqlite
});

//#endregion
export { capabilities_exports, CapabilitiesHelperCockroachDb as cockroachdb, CapabilitiesHelperMSSQL as mssql, CapabilitiesHelperMySQL as mysql, CapabilitiesHelperOracle as oracle, CapabilitiesHelperPostgres as postgres, CapabilitiesHelperRedshift as redshift, CapabilitiesHelperSqlite as sqlite };