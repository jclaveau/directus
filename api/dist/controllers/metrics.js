import { useMetrics } from "../metrics/lib/use-metrics.js";
import "../metrics/index.js";
import async_handler_default from "../utils/async-handler.js";
import { useEnv } from "@directus/env";
import { ForbiddenError } from "@directus/errors";
import { Router } from "express";

//#region src/controllers/metrics.ts
const env = useEnv();
const router = Router();
const metrics = useMetrics();
router.get("/", async_handler_default(async (req, _res, next) => {
	if (req.accountability?.admin === true) return next();
	const metricTokens = env["METRICS_TOKENS"];
	if (!req.headers || !req.headers.authorization || !metricTokens) throw new ForbiddenError({ reason: `Missing authorization header or missing METRICS_TOKENS env variable` });
	const parts = req.headers.authorization.split(" ");
	if (parts.length !== 2 || parts[0].toLowerCase() !== "metrics") throw new ForbiddenError({
		reason: `Invalid authorization header`,
		values: { header: req.headers.authorization }
	});
	if (metricTokens.find((mt) => mt.toString() === parts[1]) !== void 0) return next();
	throw new ForbiddenError({
		reason: `Invalid metrics authorization token`,
		values: { header: req.headers.authorization }
	});
}), async_handler_default(async (_req, res) => {
	res.set("Content-Type", "text/plain");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Vary", "Origin, Cache-Control");
	return res.send(await metrics?.readAll());
}));
var metrics_default = router;

//#endregion
export { metrics_default as default };