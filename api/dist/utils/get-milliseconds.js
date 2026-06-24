import ms from "ms";

//#region src/utils/get-milliseconds.ts
/**
* Safely parse human readable time format into milliseconds
*/
function getMilliseconds(value, fallback) {
	if (typeof value !== "string" && typeof value !== "number" || value === "") return fallback;
	return ms(String(value)) ?? fallback;
}

//#endregion
export { getMilliseconds };