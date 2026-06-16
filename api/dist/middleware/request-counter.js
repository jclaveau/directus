import { useLogger } from "../logger/index.js";
import { useBufferedCounter } from "../telemetry/counter/use-buffered-counter.js";
import { TRACKED_METHODS } from "../telemetry/utils/format-api-request-counts.js";
import { getEntitlementManager } from "../license/entitlements/manager.js";
import "../license/index.js";
import { useEnv } from "@directus/env";
import { toBoolean } from "@directus/utils";

//#region src/middleware/request-counter.ts
const TRACKED_METHODS_UPPER = new Set(TRACKED_METHODS.map((m) => m.toUpperCase()));
const env = useEnv();
const requestCounterMiddleware = (req, _res, next) => {
	if (!getEntitlementManager().isEntitled("telemetry_required") && toBoolean(env["TELEMETRY"]) === false) return next();
	if (TRACKED_METHODS_UPPER.has(req.method)) try {
		useBufferedCounter("api-requests").increment(req.method.toLowerCase());
	} catch (err) {
		useLogger().trace(err, "Failed to increment request counter");
	}
	next();
};
var request_counter_default = requestCounterMiddleware;

//#endregion
export { request_counter_default as default };