import async_handler_default from "../utils/async-handler.js";
import { mergeVersionsRaw, mergeVersionsRecursive } from "../utils/merge-version-data.js";
import { VersionsService } from "../services/versions.js";
import { isObject } from "@directus/utils";

//#region src/middleware/merge-content-versions.ts
const mergeContentVersions = async_handler_default(async (req, res, next) => {
	if (req.sanitizedQuery.version && req.collection && (req.singleton || req.params["pk"]) && "data" in res.locals["payload"]) {
		const originalData = res.locals["payload"].data;
		if (!isObject(originalData)) return next();
		const versionData = await new VersionsService({
			accountability: req.accountability ?? null,
			schema: req.schema
		}).getVersionSaves(req.sanitizedQuery.version, req.collection, req.params["pk"]);
		if (!versionData || versionData.length === 0) return next();
		if (req.sanitizedQuery.versionRaw) res.locals["payload"].data = mergeVersionsRaw(originalData, versionData);
		else res.locals["payload"].data = mergeVersionsRecursive(originalData, versionData, req.collection, req.schema);
	}
	return next();
});

//#endregion
export { mergeContentVersions };