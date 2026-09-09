import { parseISO } from "../../../../utils/date-fns-used.js";
import { DateHelper } from "../types.js";

//#region src/database/helpers/date/dialects/mysql.ts
var DateHelperMySQL = class extends DateHelper {
	readTimestampString(date) {
		const parsedDate = new Date(date);
		return (/* @__PURE__ */ new Date(parsedDate.getTime() - parsedDate.getTimezoneOffset() * 6e4)).toISOString();
	}
	writeTimestamp(date) {
		const parsedDate = parseISO(date);
		return new Date(parsedDate.getTime() + parsedDate.getTimezoneOffset() * 6e4);
	}
};

//#endregion
export { DateHelperMySQL };