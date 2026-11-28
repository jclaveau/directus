import { scopedCachePurgeEnabled } from "../scoped-cache/config.js";
import { format } from "../utils/date-fns-used.js";
import "../scoped-cache/index.js";
import { dumpCoverage, isCoverageInstrumented } from "../utils/dump-coverage.js";
import async_handler_default from "../utils/async-handler.js";
import { ServerService } from "../services/server.js";
import { SpecificationService } from "../services/specifications.js";
import { respond } from "../middleware/respond.js";
import { RouteNotFoundError, createError } from "@directus/errors";
import { Router } from "express";
import { getNodeEnv } from "@directus/utils/node";

//#region src/controllers/server.ts
const router = Router();
const NotInstrumentedError = createError("NOT_INSTRUMENTED", "Nothing this server loaded is instrumented for coverage: build an extension with coverage in its extension.config.js.", 404);
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
	if (scopedCachePurgeEnabled()) res.locals["cache"] = false;
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
/**
* Dump the coverage this process collected so far, for a test run to report
* while the server is still up. The route exists only in a build with something
* instrumented, never a deployed one, so it asks for no authentication. It
* dumps the process that receives it: a coverage run is a single process.
* Outside production, a build with nothing instrumented answers
* NOT_INSTRUMENTED rather than ROUTE_NOT_FOUND, for the test run to say why.
*/
router.post("/dump-coverage", async_handler_default(async (req, res, next) => {
	if (!isCoverageInstrumented()) {
		if ((getNodeEnv() || "production") === "production") throw new RouteNotFoundError({ path: req.path });
		throw new NotInstrumentedError();
	}
	res.locals["payload"] = { data: { written: await dumpCoverage() } };
	return next();
}), respond);
var server_default = router;

//#endregion
export { server_default as default };