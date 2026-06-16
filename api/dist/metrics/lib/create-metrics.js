import { useRedis } from "../../redis/lib/use-redis.js";
import { redisConfigAvailable } from "../../redis/utils/redis-config-available.js";
import "../../redis/index.js";
import { useLogger } from "../../logger/index.js";
import { getCache } from "../../cache.js";
import { getStorage } from "../../storage/index.js";
import { hasDatabaseConnection } from "../../database/index.js";
import { useEnv } from "@directus/env";
import { toArray } from "@directus/utils";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import pm2 from "pm2";
import { AggregatorRegistry, Counter, Histogram, register } from "prom-client";

//#region src/metrics/lib/create-metrics.ts
const isPM2 = "PM2_HOME" in process.env;
const METRICS_SYNC_PACKET = "directus:metrics---data-sync";
const listApps = promisify(pm2.list.bind(pm2));
const sendDataToProcessId = promisify(pm2.sendDataToProcessId.bind(pm2));
function createMetrics() {
	const env = useEnv();
	const logger = useLogger();
	const services = env["METRICS_SERVICES"] ?? [];
	const metricNamePrefix = env["METRICS_NAME_PREFIX"] ?? "directus_";
	const metricsHealthCheckPrefix = env["METRICS_HEALTH_CHECK_PREFIX"];
	const aggregates = /* @__PURE__ */ new Map();
	/**
	* Listen for PM2 metric data sync messages and add them to the aggregate
	*/
	if (isPM2) process.on("message", (packet) => {
		if (!packet.data || packet.topic !== METRICS_SYNC_PACKET) return;
		aggregate(packet.data);
	});
	async function generate() {
		const checkId = randomUUID();
		await Promise.all([
			trackDatabaseMetric(),
			trackCacheMetric(checkId),
			trackRedisMetric(checkId),
			trackStorageMetric(checkId)
		]);
		/**
		* Push generated metrics to all pm2 instances
		*/
		if (isPM2) try {
			const apps = await listApps();
			const data = await register.getMetricsAsJSON();
			const syncs = [];
			for (const app of apps) {
				if (app.pm_id === void 0 || app.pid === 0 || app.name !== "directus") continue;
				syncs.push(sendDataToProcessId(app.pm_id, {
					data: {
						pid: process.pid,
						metrics: data
					},
					topic: METRICS_SYNC_PACKET
				}));
			}
			await Promise.allSettled(syncs);
		} catch (error) {
			logger.error(error);
		}
	}
	/**
	* Add PM2 synced metric to the aggregate store.
	* Subsequent syncs for the given instance will override previous value.
	*/
	async function aggregate(data) {
		aggregates.set(data.pid, data.metrics);
	}
	async function readAll() {
		/**
		* In a PM2 context we must aggregate the metrics across instances ensuring
		* only currently active instances are added to the aggregate
		*/
		if (isPM2 && aggregates.size !== 0) {
			const apps = await listApps();
			const aggregate$1 = [];
			for (const app of apps) if (aggregates.has(app.pid)) aggregate$1.push(aggregates.get(app.pid));
			if (aggregate$1.length !== 0) return AggregatorRegistry.aggregate(aggregate$1).metrics();
		}
		return register.metrics();
	}
	function getDatabaseErrorMetric() {
		if (services.includes("database") === false) return null;
		const client = env["DB_CLIENT"];
		let metric = register.getSingleMetric(`${metricNamePrefix}db_${client}_connection_errors`);
		if (!metric) metric = new Counter({
			name: `${metricNamePrefix}db_${client}_connection_errors`,
			help: `${client} Database connection error count`
		});
		return metric;
	}
	function getDatabaseResponseMetric() {
		if (services.includes("database") === false) return null;
		const client = env["DB_CLIENT"];
		let metric = register.getSingleMetric(`${metricNamePrefix}db_${client}_response_time_ms`);
		if (!metric) metric = new Histogram({
			name: `${metricNamePrefix}db_${client}_response_time_ms`,
			help: `${client} Database connection response time`,
			buckets: [
				1,
				10,
				20,
				40,
				60,
				80,
				100,
				200,
				500,
				750,
				1e3
			]
		});
		return metric;
	}
	function getCacheErrorMetric() {
		if (services.includes("cache") === false || env["CACHE_ENABLED"] !== true) return null;
		if (env["CACHE_STORE"] === "redis" && redisConfigAvailable() !== true) return null;
		let metric = register.getSingleMetric(`${metricNamePrefix}cache_${env["CACHE_STORE"]}_connection_errors`);
		if (!metric) metric = new Counter({
			name: `${metricNamePrefix}cache_${env["CACHE_STORE"]}_connection_errors`,
			help: "Cache connection error count"
		});
		return metric;
	}
	function getRedisErrorMetric() {
		if (services.includes("redis") === false || redisConfigAvailable() !== true) return null;
		let metric = register.getSingleMetric(`${metricNamePrefix}redis_connection_errors`);
		if (!metric) metric = new Counter({
			name: `${metricNamePrefix}redis_connection_errors`,
			help: "Redis connection error count"
		});
		return metric;
	}
	function getStorageErrorMetric(location) {
		if (services.includes("storage") === false) return null;
		let metric = register.getSingleMetric(`${metricNamePrefix}storage_${location}_connection_errors`);
		if (!metric) metric = new Counter({
			name: `${metricNamePrefix}storage_${location}_connection_errors`,
			help: `${location} storage connection error count`
		});
		return metric;
	}
	async function trackDatabaseMetric() {
		const metric = getDatabaseErrorMetric();
		if (metric === null) return;
		try {
			if (!await hasDatabaseConnection()) metric.inc();
		} catch {
			metric.inc();
		}
	}
	async function trackCacheMetric(checkId) {
		const metric = getCacheErrorMetric();
		if (metric === null) return;
		const { cache } = getCache();
		if (!cache) return;
		try {
			await cache.set(`${metricsHealthCheckPrefix}${checkId}`, "1", 5);
			await cache.delete(`${metricsHealthCheckPrefix}${checkId}`);
		} catch {
			metric.inc();
		}
	}
	async function trackRedisMetric(checkId) {
		const metric = getRedisErrorMetric();
		if (metric === null) return;
		const redis = useRedis();
		try {
			await redis.set(`${metricsHealthCheckPrefix}${checkId}`, "1");
			await redis.del(`${metricsHealthCheckPrefix}${checkId}`);
		} catch {
			metric.inc();
		}
	}
	async function trackStorageMetric(checkId) {
		if (services.includes("storage") === false) return;
		const storage = await getStorage();
		for (const location of toArray(env["STORAGE_LOCATIONS"])) {
			const disk = storage.location(location);
			const metric = getStorageErrorMetric(location);
			if (metric === null) continue;
			try {
				await disk.write(`${metricsHealthCheckPrefix}file`, Readable.from([checkId]));
			} catch {
				metric.inc();
			}
		}
	}
	return {
		getDatabaseErrorMetric,
		getDatabaseResponseMetric,
		getCacheErrorMetric,
		getRedisErrorMetric,
		getStorageErrorMetric,
		aggregate,
		generate,
		readAll
	};
}

//#endregion
export { createMetrics };