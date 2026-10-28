import { __export } from "../../../_virtual/rolldown_runtime.js";
import { SchemaHelperCockroachDb } from "./dialects/cockroachdb.js";
import { SchemaHelperDefault } from "./dialects/default.js";
import { SchemaHelperMSSQL } from "./dialects/mssql.js";
import { SchemaHelperMySQL } from "./dialects/mysql.js";
import { SchemaHelperOracle } from "./dialects/oracle.js";
import { SchemaHelperPostgres } from "./dialects/postgres.js";
import { SchemaHelperSQLite } from "./dialects/sqlite.js";

//#region src/database/helpers/schema/index.ts
var schema_exports = /* @__PURE__ */ __export({
	cockroachdb: () => SchemaHelperCockroachDb,
	mssql: () => SchemaHelperMSSQL,
	mysql: () => SchemaHelperMySQL,
	oracle: () => SchemaHelperOracle,
	postgres: () => SchemaHelperPostgres,
	redshift: () => SchemaHelperDefault,
	sqlite: () => SchemaHelperSQLite
});

//#endregion
export { SchemaHelperCockroachDb as cockroachdb, SchemaHelperMSSQL as mssql, SchemaHelperMySQL as mysql, SchemaHelperOracle as oracle, SchemaHelperPostgres as postgres, SchemaHelperDefault as redshift, schema_exports, SchemaHelperSQLite as sqlite };