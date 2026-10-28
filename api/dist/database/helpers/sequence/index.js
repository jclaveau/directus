import { __export } from "../../../_virtual/rolldown_runtime.js";
import { AutoIncrementHelperPostgres } from "./dialects/postgres.js";
import { AutoIncrementHelperDefault } from "./dialects/default.js";

//#region src/database/helpers/sequence/index.ts
var sequence_exports = /* @__PURE__ */ __export({
	cockroachdb: () => AutoIncrementHelperDefault,
	mssql: () => AutoIncrementHelperDefault,
	mysql: () => AutoIncrementHelperDefault,
	oracle: () => AutoIncrementHelperDefault,
	postgres: () => AutoIncrementHelperPostgres,
	redshift: () => AutoIncrementHelperDefault,
	sqlite: () => AutoIncrementHelperDefault
});

//#endregion
export { AutoIncrementHelperDefault as cockroachdb, AutoIncrementHelperDefault as mssql, AutoIncrementHelperDefault as mysql, AutoIncrementHelperDefault as oracle, AutoIncrementHelperPostgres as postgres, AutoIncrementHelperDefault as redshift, sequence_exports, AutoIncrementHelperDefault as sqlite };