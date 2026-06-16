import async_handler_default from "../utils/async-handler.js";
import { createCollectionForbiddenError } from "../permissions/modules/process-ast/utils/validate-path/create-error.js";
import { systemCollectionRows } from "@directus/system-data";

//#region src/middleware/collection-exists.ts
const collectionExists = async_handler_default(async (req, _res, next) => {
	if (!req.params["collection"]) return next();
	if (req.params["collection"] in req.schema.collections === false) throw createCollectionForbiddenError("", req.params["collection"]);
	req.collection = req.params["collection"];
	const systemCollectionRow = systemCollectionRows.find((collection) => {
		return collection?.collection === req.collection;
	});
	if (systemCollectionRow !== void 0) req.singleton = !!systemCollectionRow?.singleton;
	else req.singleton = req.schema.collections[req.collection]?.singleton ?? false;
	return next();
});
var collection_exists_default = collectionExists;

//#endregion
export { collection_exists_default as default };