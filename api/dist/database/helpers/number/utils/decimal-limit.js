import { DEFAULT_NUMERIC_PRECISION, DEFAULT_NUMERIC_SCALE } from "@directus/constants";

//#region src/database/helpers/number/utils/decimal-limit.ts
function calculateDecimalLimit(precision, scale) {
	if (precision === null || scale === null) {
		precision = DEFAULT_NUMERIC_PRECISION;
		scale = DEFAULT_NUMERIC_SCALE;
	}
	return {
		max: 10 ** (precision - scale) - 10 ** -scale,
		min: -(10 ** (precision - scale)) + 10 ** -scale
	};
}

//#endregion
export { calculateDecimalLimit };