import { GeometryHelper } from "../types.js";

//#region src/database/helpers/geometry/dialects/mysql.ts
var GeometryHelperMySQL = class extends GeometryHelper {
	collect(table, column) {
		return this.knex.raw(`concat('geometrycollection(', group_concat(? separator ', '), ')'`, this.asText(table, column, column));
	}
	fromText(text) {
		return this.knex.raw("st_geomfromtext(?)", text);
	}
	asGeoJSON(table, column) {
		return this.knex.raw("st_asgeojson(??.??) as ??", [
			table,
			column,
			column
		]);
	}
};

//#endregion
export { GeometryHelperMySQL };