import { __export } from "../../../_virtual/rolldown_runtime.js";
import { GeometryHelperPostgres } from "./dialects/postgres.js";
import { GeometryHelperRedshift } from "./dialects/redshift.js";
import { GeometryHelperSQLite } from "./dialects/sqlite.js";
import { GeometryHelperMySQL } from "./dialects/mysql.js";

//#region src/database/helpers/geometry/index.ts
var geometry_exports = /* @__PURE__ */ __export({
	cockroachdb: () => GeometryHelperPostgres,
	mysql: () => GeometryHelperMySQL,
	postgres: () => GeometryHelperPostgres,
	redshift: () => GeometryHelperRedshift,
	sqlite: () => GeometryHelperSQLite
});

//#endregion
export { GeometryHelperPostgres as cockroachdb, geometry_exports, GeometryHelperMySQL as mysql, GeometryHelperPostgres as postgres, GeometryHelperRedshift as redshift, GeometryHelperSQLite as sqlite };