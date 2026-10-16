import { GeometryHelper } from "../types.js";

//#region src/database/helpers/geometry/dialects/redshift.ts
var GeometryHelperRedshift = class extends GeometryHelper {
	createColumn(table, field) {
		if (field.type.split(".")[1]) field.meta.special = [field.type];
		return table.specificType(field.field, "geometry");
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
export { GeometryHelperRedshift };