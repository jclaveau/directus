import { DateHelper } from "../types.js";

//#region src/database/helpers/date/dialects/sqlite.ts
var DateHelperSQLite = class extends DateHelper {
	parse(date) {
		if (!date) return date;
		if (date instanceof Date) return String(date.getTime());
		if (date.length <= 8 && date.includes(":")) return date;
		return String(new Date(date).getTime());
	}
	fieldFlagForField(fieldType) {
		switch (fieldType) {
			case "json": return "cast-json";
			case "timestamp": return "cast-timestamp";
			default: return "";
		}
	}
};

//#endregion
export { DateHelperSQLite };