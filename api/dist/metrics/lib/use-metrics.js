import { createMetrics } from "./create-metrics.js";
import { _cache } from "./instance.js";
import { useEnv } from "@directus/env";
import { toBoolean } from "@directus/utils/values";

//#region src/metrics/lib/use-metrics.ts
const useMetrics = () => {
	if (!toBoolean(useEnv()["METRICS_ENABLED"])) return;
	if (_cache.metrics) return _cache.metrics;
	_cache.metrics = createMetrics();
	return _cache.metrics;
};

//#endregion
export { _cache, useMetrics };