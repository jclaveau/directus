import { DatabaseHelper } from "../types.js";
import { parseISO } from "date-fns";

//#region src/database/helpers/date/types.ts
var DateHelper = class extends DatabaseHelper {
	parse(date) {
		if (date instanceof Date) return date.toISOString();
		return date;
	}
	readTimestampString(date) {
		return date;
	}
	writeTimestamp(date) {
		return parseISO(date);
	}
	fieldFlagForField(_fieldType) {
		return "";
	}
};

//#endregion
export { DateHelper };