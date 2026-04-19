import async_handler_default from "../utils/async-handler.js";
import { ServerService } from "../services/server.js";
import { SpecificationService } from "../services/specifications.js";
import { respond } from "../middleware/respond.js";
import { RouteNotFoundError } from "@directus/errors";
import { Router } from "express";
import { format } from "date-fns";

//#region src/controllers/server.ts
const router = Router();
router.get("/specs/oas", async_handler_default(async (req, res, next) => {
	const service = new SpecificationService({
		accountability: req.accountability,
		schema: req.schema
	});
	res.locals["payload"] = await service.oas.generate(req.headers.host);
	return next();
}), respond);
router.get("/specs/graphql/:scope?", async_handler_default(async (req, res) => {
	const service = new SpecificationService({
		accountability: req.accountability,
		schema: req.schema
	});
	const serverService = new ServerService({
		accountability: req.accountability,
		schema: req.schema
	});
	const scope = req.params["scope"] || "items";
	if (["items", "system"].includes(scope) === false) throw new RouteNotFoundError({ path: req.path });
	const info = await serverService.serverInfo();
	const result = await service.graphql.generate(scope);
	const filename = info["project"].project_name + "_" + format(/* @__PURE__ */ new Date(), "yyyy-MM-dd") + ".graphql";
	res.attachment(filename);
	res.send(result);
}));
router.get("/info", async_handler_default(async (req, res, next) => {
	const data = await new ServerService({
		accountability: req.accountability,
		schema: req.schema
	}).serverInfo();
	res.locals["payload"] = { data };
	return next();
}), respond);
router.get("/health", async_handler_default(async (req, res, next) => {
	const data = await new ServerService({
		accountability: req.accountability,
		schema: req.schema
	}).health();
	res.setHeader("Content-Type", "application/health+json");
	if (data["status"] === "error") res.status(503);
	res.locals["payload"] = data;
	res.locals["cache"] = false;
	return next();
}), respond);
var server_default = router;

//#endregion
export { server_default as default };