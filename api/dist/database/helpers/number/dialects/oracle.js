import { NumberDatabaseHelper } from "../types.js";
import { maybeStringifyBigInt } from "../utils/maybe-stringify-big-int.js";

//#region src/database/helpers/number/dialects/oracle.ts
var NumberHelperOracle = class extends NumberDatabaseHelper {
	addSearchCondition(dbQuery, collection, name, value, logical) {
		return dbQuery[logical].where({ [`${collection}.${name}`]: maybeStringifyBigInt(value) });
	}
};

//#endregion
export { NumberHelperOracle };