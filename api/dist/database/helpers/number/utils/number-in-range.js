import { calculateDecimalLimit } from "./decimal-limit.js";
import { MAX_SAFE_INT32, MAX_SAFE_INT64, MIN_SAFE_INT32, MIN_SAFE_INT64 } from "@directus/constants";

//#region src/database/helpers/number/utils/number-in-range.ts
function numberInRange(value, info) {
	switch (info.type) {
		case "bigInteger": return value >= MIN_SAFE_INT64 && value <= MAX_SAFE_INT64;
		case "decimal": {
			const { min, max } = calculateDecimalLimit(info.precision, info.scale);
			return value >= min && value <= max;
		}
		case "integer": return value >= MIN_SAFE_INT32 && value <= MAX_SAFE_INT32;
		case "float": return true;
		default: return false;
	}
}

//#endregion
export { numberInRange };