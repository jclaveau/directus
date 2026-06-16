//#region src/telemetry/utils/format-api-request-counts.ts
const TRACKED_METHODS = [
	"get",
	"search",
	"post",
	"put",
	"patch",
	"delete"
];
const TRACKED_KEYS = [...TRACKED_METHODS, "cached"];
function formatApiRequestCounts(counts) {
	const formatted = {};
	let total = 0;
	for (const key of TRACKED_KEYS) {
		const count = counts[key] ?? 0;
		formatted[`api_requests_${key}`] = count;
		if (key !== "cached") total += count;
	}
	formatted["api_requests"] = total;
	return formatted;
}

//#endregion
export { TRACKED_KEYS, TRACKED_METHODS, formatApiRequestCounts };