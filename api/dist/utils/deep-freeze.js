import { isPlainObject } from "lodash-es";

//#region src/utils/deep-freeze.ts
/**
* Recursively freezes arrays and plain objects so the entire structure is immutable.
*
* @example
* const frozen = deepFreeze({ a: { b: 1 } });
* frozen.a.b = 2; // throws in strict mode
*/
function deepFreeze(value) {
	if (Array.isArray(value)) {
		for (const item of value) deepFreeze(item);
		return Object.freeze(value);
	}
	if (isPlainObject(value)) {
		for (const item of Object.values(value)) deepFreeze(item);
		return Object.freeze(value);
	}
	return value;
}

//#endregion
export { deepFreeze };