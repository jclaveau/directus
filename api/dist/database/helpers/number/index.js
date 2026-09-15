import { __export } from "../../../_virtual/rolldown_runtime.js";
import { NumberHelperPostgres } from "./dialects/postgres.js";
import { NumberHelperDefault } from "./dialects/default.js";
import { NumberHelperOracle } from "./dialects/oracle.js";
import { NumberHelperSQLite } from "./dialects/sqlite.js";
import { NumberHelperMSSQL } from "./dialects/mssql.js";

//#region src/database/helpers/number/index.ts
var number_exports = /* @__PURE__ */ __export({
	cockroachdb: () => NumberHelperDefault,
	mssql: () => NumberHelperMSSQL,
	mysql: () => NumberHelperDefault,
	oracle: () => NumberHelperOracle,
	postgres: () => NumberHelperPostgres,
	redshift: () => NumberHelperPostgres,
	sqlite: () => NumberHelperSQLite
});

//#endregion
export { NumberHelperDefault as cockroachdb, NumberHelperMSSQL as mssql, NumberHelperDefault as mysql, number_exports, NumberHelperOracle as oracle, NumberHelperPostgres as postgres, NumberHelperPostgres as redshift, NumberHelperSQLite as sqlite };