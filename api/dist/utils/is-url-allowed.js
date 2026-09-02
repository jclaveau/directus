import { useLogger } from "../logger/index.js";
import { toArray } from "@directus/utils";
import { URL } from "url";

//#region src/utils/is-url-allowed.ts
/**
* Check if URL matches allow list either exactly or by origin (protocol+domain+port) + pathname
*/
function isUrlAllowed(url$1, allowList) {
	const logger = useLogger();
	const urlAllowList = toArray(allowList);
	if (urlAllowList.includes(url$1)) return true;
	const parsedWhitelist = urlAllowList.map((allowedURL) => {
		try {
			const { origin, pathname } = new URL(allowedURL);
			return origin + pathname;
		} catch {
			logger.warn(`Invalid URL used "${allowedURL}"`);
		}
		return null;
	}).filter((f) => f);
	try {
		const { origin, pathname } = new URL(url$1);
		return parsedWhitelist.includes(origin + pathname);
	} catch {
		return false;
	}
}

//#endregion
export { isUrlAllowed as default };