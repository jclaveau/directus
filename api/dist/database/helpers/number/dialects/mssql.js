import { NumberDatabaseHelper } from "../types.js";
import { numberInRange } from "../utils/number-in-range.js";
import { maybeStringifyBigInt } from "../utils/maybe-stringify-big-int.js";

//#region src/database/helpers/number/dialects/mssql.ts
var NumberHelperMSSQL = class extends NumberDatabaseHelper {
	addSearchCondition(dbQuery, collection, name, value, logical) {
		return dbQuery[logical].where({ [`${collection}.${name}`]: maybeStringifyBigInt(value) });
	}
	isNumberValid(value, info) {
		return numberInRange(value, info);
	}
};

//#endregion
export { NumberHelperMSSQL };