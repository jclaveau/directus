import async_handler_default from "../utils/async-handler.js";
import { getSchema } from "../utils/get-schema.js";

//#region src/middleware/schema.ts
const schema = async_handler_default(async (req, _res, next) => {
	req.schema = await getSchema();
	return next();
});
var schema_default = schema;

//#endregion
export { schema_default as default };