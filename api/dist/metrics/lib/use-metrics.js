import { createMetrics } from "./create-metrics.js";
import { useEnv } from "@directus/env";
import { toBoolean } from "@directus/utils";

//#region src/metrics/lib/use-metrics.ts
const _cache = { metrics: void 0 };
const useMetrics = () => {
	if (!toBoolean(useEnv()["METRICS_ENABLED"])) return;
	if (_cache.metrics) return _cache.metrics;
	_cache.metrics = createMetrics();
	return _cache.metrics;
};

//#endregion
export { _cache, useMetrics };