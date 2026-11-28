import { printableScopedCachePin } from "./printable-scoped-cache-pins.js";
import { useEnv } from "@directus/env";
import { parse } from "bytes";

//#region src/utils/scoped-cache-pins-header.ts
const SEPARATOR = ", ";
function setScopedCachePinsHeader(res, name, labels) {
	if (labels.length === 0) return;
	const env = useEnv();
	const maxSize = parse(String(env["CACHE_TAGS_HEADER_MAX_SIZE"]));
	const printablePins = labels.map(printableScopedCachePin);
	if (!maxSize) {
		res.setHeader(name, printablePins.join(SEPARATOR));
		return;
	}
	let kept = 0;
	let size = 0;
	for (const printablePin of printablePins) {
		let next = size + printablePin.length;
		if (kept > 0) next += 2;
		if (next > maxSize) break;
		size = next;
		kept += 1;
	}
	if (kept > 0) res.setHeader(name, printablePins.slice(0, kept).join(SEPARATOR));
	if (kept < printablePins.length) res.setHeader(`${name}-omitted`, String(printablePins.length - kept));
}

//#endregion
export { setScopedCachePinsHeader };