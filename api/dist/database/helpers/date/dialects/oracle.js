import { DateHelper } from "../types.js";

//#region src/database/helpers/date/dialects/oracle.ts
var DateHelperOracle = class extends DateHelper {
	parse(date) {
		if (!date) return date;
		if (date instanceof Date) return String(date.toISOString());
		if (date.length <= 10 && date.includes("-")) return date;
		return String(new Date(date).toISOString());
	}
	fieldFlagForField(fieldType) {
		switch (fieldType) {
			case "json": return "cast-json";
			case "dateTime": return "cast-datetime";
			default: return "";
		}
	}
};

//#endregion
export { DateHelperOracle };