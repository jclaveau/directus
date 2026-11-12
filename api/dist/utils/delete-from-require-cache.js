import { useLogger } from "../logger/index.js";
import { createRequire } from "node:module";

//#region src/utils/delete-from-require-cache.ts
const require = createRequire(import.meta.url);
function deleteFromRequireCache(modulePath) {
	const logger = useLogger();
	try {
		const moduleCachePath = require.resolve(modulePath);
		delete require.cache[moduleCachePath];
	} catch {
		logger.trace(`Module cache not found for ${modulePath}, skipped cache delete.`);
	}
}

//#endregion
export { deleteFromRequireCache };