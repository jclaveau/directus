import { GeometryHelper } from "../types.js";

//#region src/database/helpers/geometry/dialects/sqlite.ts
var GeometryHelperSQLite = class extends GeometryHelper {
	async supported() {
		return (await this.knex.select("name").from("pragma_function_list").where({ name: "spatialite_version" })).length > 0;
	}
	asGeoJSON(table, column) {
		return this.knex.raw("asgeojson(??.??) as ??", [
			table,
			column,
			column
		]);
	}
};

//#endregion
export { GeometryHelperSQLite };