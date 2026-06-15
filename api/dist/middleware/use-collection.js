import async_handler_default from "../utils/async-handler.js";

//#region src/middleware/use-collection.ts
const useCollection = (collection) => async_handler_default(async (req, _res, next) => {
	req.collection = collection;
	next();
});
var use_collection_default = useCollection;

//#endregion
export { use_collection_default as default };