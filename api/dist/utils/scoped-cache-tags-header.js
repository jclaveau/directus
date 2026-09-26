import { printableScopedCacheTags } from "./printable-scoped-cache-tags.js";
import { useEnv } from "@directus/env";
import { parse } from "bytes";

//#region src/utils/scoped-cache-tags-header.ts
const SEPARATOR = ", ";
function setScopedCacheTagsHeader(res, name, labels) {
	if (labels.length === 0) return;
	const env = useEnv();
	const maxSize = parse(String(env["CACHE_TAGS_HEADER_MAX_SIZE"]));
	const tags = labels.map(printableScopedCacheTags);
	if (!maxSize) {
		res.setHeader(name, tags.join(SEPARATOR));
		return;
	}
	let kept = 0;
	let size = 0;
	for (const tag of tags) {
		let next = size + tag.length;
		if (kept > 0) next += 2;
		if (next > maxSize) break;
		size = next;
		kept += 1;
	}
	if (kept > 0) res.setHeader(name, tags.slice(0, kept).join(SEPARATOR));
	if (kept < tags.length) res.setHeader(`${name}-omitted`, String(tags.length - kept));
}

//#endregion
export { setScopedCacheTagsHeader };