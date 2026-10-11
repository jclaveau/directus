import { DatabaseHelper } from "../types.js";

//#region src/database/helpers/number/types.ts
var NumberDatabaseHelper = class extends DatabaseHelper {
	addSearchCondition(dbQuery, collection, name, value, logical) {
		return dbQuery[logical].where({ [`${collection}.${name}`]: value });
	}
	isNumberValid(_value, _info) {
		return true;
	}
};

//#endregion
export { NumberDatabaseHelper };