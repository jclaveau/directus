import { __export } from "../../../_virtual/rolldown_runtime.js";
import { GeometryHelperPostgres } from "./dialects/postgres.js";
import { GeometryHelperRedshift } from "./dialects/redshift.js";
import { GeometryHelperOracle } from "./dialects/oracle.js";
import { GeometryHelperSQLite } from "./dialects/sqlite.js";
import { GeometryHelperMySQL } from "./dialects/mysql.js";
import { GeometryHelperMSSQL } from "./dialects/mssql.js";

//#region src/database/helpers/geometry/index.ts
var geometry_exports = /* @__PURE__ */ __export({
	cockroachdb: () => GeometryHelperPostgres,
	mssql: () => GeometryHelperMSSQL,
	mysql: () => GeometryHelperMySQL,
	oracle: () => GeometryHelperOracle,
	postgres: () => GeometryHelperPostgres,
	redshift: () => GeometryHelperRedshift,
	sqlite: () => GeometryHelperSQLite
});

//#endregion
export { GeometryHelperPostgres as cockroachdb, geometry_exports, GeometryHelperMSSQL as mssql, GeometryHelperMySQL as mysql, GeometryHelperOracle as oracle, GeometryHelperPostgres as postgres, GeometryHelperRedshift as redshift, GeometryHelperSQLite as sqlite };