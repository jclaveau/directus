import { __export } from "../../../_virtual/rolldown_runtime.js";
import { NumberHelperPostgres } from "./dialects/postgres.js";
import { NumberHelperDefault } from "./dialects/default.js";
import { NumberHelperSQLite } from "./dialects/sqlite.js";

//#region src/database/helpers/number/index.ts
var number_exports = /* @__PURE__ */ __export({
	cockroachdb: () => NumberHelperDefault,
	mysql: () => NumberHelperDefault,
	postgres: () => NumberHelperPostgres,
	redshift: () => NumberHelperPostgres,
	sqlite: () => NumberHelperSQLite
});

//#endregion
export { NumberHelperDefault as cockroachdb, NumberHelperDefault as mysql, number_exports, NumberHelperPostgres as postgres, NumberHelperPostgres as redshift, NumberHelperSQLite as sqlite };