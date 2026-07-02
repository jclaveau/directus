import { NumberDatabaseHelper } from "../types.js";
import { numberInRange } from "../utils/number-in-range.js";

//#region src/database/helpers/number/dialects/postgres.ts
var NumberHelperPostgres = class extends NumberDatabaseHelper {
	isNumberValid(value, info) {
		if (numberInRange(value, info)) {
			if (typeof value !== "bigint" && ["integer", "bigInteger"].includes(info.type)) return value % 1 === 0;
			return true;
		}
		return false;
	}
};

//#endregion
export { NumberHelperPostgres };