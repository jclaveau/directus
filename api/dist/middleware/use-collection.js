import { readScopedCacheEpochs } from "../scoped-cache/fill-guard.js";
import "../scoped-cache.js";
import async_handler_default from "../utils/async-handler.js";

//#region src/middleware/use-collection.ts
const useCollection = (collection) => {
	return async_handler_default(async (req, res, next) => {
		req.collection = collection;
		if (req.method === "GET") res.locals["scopedCacheEpochsAtRequest"] = await readScopedCacheEpochs([collection]);
		next();
	});
};
var use_collection_default = useCollection;

//#endregion
export { use_collection_default as default };