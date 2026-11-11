import { parseISO } from "../../../../utils/date-fns-used.js";
import { DateHelper } from "../types.js";

//#region src/database/helpers/date/dialects/mssql.ts
var DateHelperMSSQL = class extends DateHelper {
	writeTimestamp(date) {
		const parsedDate = parseISO(date);
		return new Date(parsedDate.getTime() + parsedDate.getTimezoneOffset() * 6e4);
	}
};

//#endregion
export { DateHelperMSSQL };