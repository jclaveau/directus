import { readMeta } from "../utils/read-meta.js";
import async_handler_default from "../utils/async-handler.js";
import { GraphQLService } from "../services/graphql/index.js";
import { respond } from "../middleware/respond.js";
import { parseGraphQL } from "../middleware/graphql.js";
import { Router } from "express";

//#region src/controllers/graphql.ts
const router = Router();
router.use("/system", parseGraphQL, async_handler_default(async (req, res, next) => {
	const service = new GraphQLService({
		accountability: req.accountability,
		schema: req.schema,
		scope: "system"
	});
	res.locals["payload"] = await service.execute(res.locals["graphqlParams"]);
	res.locals["scopedCacheTags"] = readMeta(res.locals["payload"])?.scopedCacheTags;
	if (res.locals["payload"]?.errors?.length > 0) res.locals["cache"] = false;
	return next();
}), respond);
router.use("/", parseGraphQL, async_handler_default(async (req, res, next) => {
	const service = new GraphQLService({
		accountability: req.accountability,
		schema: req.schema,
		scope: "items"
	});
	res.locals["payload"] = await service.execute(res.locals["graphqlParams"]);
	res.locals["scopedCacheTags"] = readMeta(res.locals["payload"])?.scopedCacheTags;
	if (res.locals["payload"]?.errors?.length > 0) res.locals["cache"] = false;
	return next();
}), respond);
var graphql_default = router;

//#endregion
export { graphql_default as default };