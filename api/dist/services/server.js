import { useRedis } from "../redis/lib/use-redis.js";
import { redisConfigAvailable } from "../redis/utils/redis-config-available.js";
import "../redis/index.js";
import { useLogger } from "../logger/index.js";
import { getMilliseconds } from "../utils/get-milliseconds.js";
import { FILE_UPLOADS, RESUMABLE_UPLOADS } from "../constants.js";
import { getStorage } from "../storage/index.js";
import database_default, { hasDatabaseConnection } from "../database/index.js";
import { useStore } from "../utils/store.js";
import getMailer from "../mailer.js";
import { getEntitlementManager } from "../license/entitlements/manager.js";
import { SettingsService } from "./settings.js";
import { getAllowedLogLevels } from "../utils/get-allowed-log-levels.js";
import { SERVER_ONLINE } from "../server.js";
import { isUnauthenticated } from "../utils/is-unauthenticated.js";
import { getLicenseManager } from "../license/manager.js";
import "../license/index.js";
import { useEnv } from "@directus/env";
import { ForbiddenError } from "@directus/errors";
import { toArray, toBoolean } from "@directus/utils";
import { merge } from "lodash-es";
import { createKv } from "@directus/memory";
import { performance } from "perf_hooks";
import { Readable } from "node:stream";
import { version } from "directus/version";

//#region src/services/server.ts
const env = useEnv();
const logger = useLogger();
const HEALTHCHECK_CACHE_TTL = getMilliseconds(env["HEALTHCHECK_CACHE_TTL"], 3e5);
const store = useStore(env["HEALTHCHECK_NAMESPACE"] ?? "directus:healthcheck", { ttl: HEALTHCHECK_CACHE_TTL });
var ServerService = class {
	knex;
	accountability;
	settingsService;
	schema;
	constructor(options) {
		this.knex = options.knex || database_default();
		this.accountability = options.accountability || null;
		this.schema = options.schema;
		this.settingsService = new SettingsService({
			knex: this.knex,
			schema: this.schema
		});
	}
	async isSetupCompleted() {
		return Boolean(await this.knex("directus_users").first());
	}
	async serverInfo() {
		const info = {};
		const licenseManager = getLicenseManager();
		const isSetupCompleted = await this.isSetupCompleted();
		const { project_owner,...projectInfo } = await this.settingsService.readSingleton({ fields: [
			"project_name",
			"project_owner",
			"project_descriptor",
			"project_logo",
			"project_color",
			"default_appearance",
			"default_theme_light",
			"default_theme_dark",
			"theme_light_overrides",
			"theme_dark_overrides",
			"default_language",
			"public_foreground",
			"public_background.id",
			"public_background.type",
			"public_favicon",
			"public_note",
			"custom_css",
			"public_registration",
			"public_registration_verify_email"
		] });
		info["project"] = projectInfo;
		if (!isSetupCompleted) info["setup"] = {
			license_complete: licenseManager.getSource() !== null,
			owner_complete: Boolean(project_owner)
		};
		if (this.accountability?.user) {
			info["mcp_enabled"] = toBoolean(env["MCP_ENABLED"] ?? true);
			info["ai_enabled"] = toBoolean(env["AI_ENABLED"] ?? true);
			info["mcp_oauth_enabled"] = toBoolean(env["MCP_OAUTH_ENABLED"] ?? false);
			info["mcp_oauth_dcr_enabled"] = toBoolean(env["MCP_OAUTH_DCR_ENABLED"] ?? false);
			info["mcp_oauth_cimd_enabled"] = toBoolean(env["MCP_OAUTH_CIMD_ENABLED"] ?? false);
			info["autoSave"] = { revisionInterval: Number(env["AUTOSAVE_REVISION_INTERVAL"]) };
			info["files"] = { mimeTypeAllowList: toArray(env["FILES_MIME_TYPE_ALLOW_LIST"]) };
			if (env["RATE_LIMITER_ENABLED"]) info["rateLimit"] = {
				points: env["RATE_LIMITER_POINTS"],
				duration: env["RATE_LIMITER_DURATION"]
			};
			else info["rateLimit"] = false;
			if (env["RATE_LIMITER_GLOBAL_ENABLED"]) info["rateLimitGlobal"] = {
				points: env["RATE_LIMITER_GLOBAL_POINTS"],
				duration: env["RATE_LIMITER_GLOBAL_DURATION"]
			};
			else info["rateLimitGlobal"] = false;
			info["extensions"] = { limit: env["EXTENSIONS_LIMIT"] ?? null };
			info["queryLimit"] = {
				default: env["QUERY_LIMIT_DEFAULT"],
				max: Number.isFinite(env["QUERY_LIMIT_MAX"]) ? env["QUERY_LIMIT_MAX"] : -1
			};
			if (toBoolean(env["WEBSOCKETS_ENABLED"])) {
				info["websocket"] = {};
				info["websocket"].rest = toBoolean(env["WEBSOCKETS_REST_ENABLED"]) ? {
					authentication: env["WEBSOCKETS_REST_AUTH"],
					path: env["WEBSOCKETS_REST_PATH"]
				} : false;
				info["websocket"].graphql = toBoolean(env["WEBSOCKETS_GRAPHQL_ENABLED"]) ? {
					authentication: env["WEBSOCKETS_GRAPHQL_AUTH"],
					path: env["WEBSOCKETS_GRAPHQL_PATH"]
				} : false;
				info["websocket"].heartbeat = toBoolean(env["WEBSOCKETS_HEARTBEAT_ENABLED"]) ? env["WEBSOCKETS_HEARTBEAT_PERIOD"] : false;
				info["websocket"].collaborativeEditing = toBoolean(env["WEBSOCKETS_COLLAB_ENABLED"]);
				info["websocket"].logs = toBoolean(env["WEBSOCKETS_LOGS_ENABLED"]) && this.accountability.admin ? { allowedLogLevels: getAllowedLogLevels(env["WEBSOCKETS_LOGS_LEVEL"] || "info") } : false;
			} else info["websocket"] = false;
			if (FILE_UPLOADS.MAX_CONCURRENCY && FILE_UPLOADS.MAX_CONCURRENCY !== Infinity) info["uploads"] = { maxConcurrency: FILE_UPLOADS.MAX_CONCURRENCY };
			if (RESUMABLE_UPLOADS.ENABLED) info["uploads"] = {
				...info["uploads"],
				tus: true,
				chunkSize: RESUMABLE_UPLOADS.CHUNK_SIZE
			};
		}
		if (this.accountability?.user || !isSetupCompleted) info["version"] = version;
		info["license"] = {
			source: licenseManager.getSource(),
			entitlements: getEntitlementManager().getAppEntitlements()
		};
		return info;
	}
	async health() {
		if (isUnauthenticated(this.accountability)) throw new ForbiddenError();
		const healthResult = await store(async (store$1) => {
			try {
				return await store$1.get("health");
			} catch (err) {
				logger.warn(err, "Failed to read health check cache");
			}
		});
		if (healthResult) return this.accountability?.admin === true ? healthResult : { status: healthResult["status"] };
		const { nanoid } = await import("nanoid");
		const checkID = nanoid(5);
		const enabledServices = toArray(env["HEALTHCHECK_SERVICES"]);
		const data = {
			status: "ok",
			releaseId: version,
			serviceId: env["PUBLIC_URL"],
			checks: merge(...await Promise.all([
				testDatabase(),
				testRedis(),
				testStorage(),
				testEmail()
			]))
		};
		if (SERVER_ONLINE === false) data.status = "error";
		for (const [service, healthData] of Object.entries(data.checks)) {
			for (const healthCheck of healthData) {
				if (healthCheck.status === "warn" && data.status === "ok") {
					logger.warn(`${service} in WARN state, the observed value ${healthCheck.observedValue} is above the threshold of ${healthCheck.threshold}${healthCheck.observedUnit}`);
					data.status = "warn";
					continue;
				}
				if (healthCheck.status === "error" && (data.status === "ok" || data.status === "warn")) {
					logger.error(healthCheck.output, "%s in ERROR state", service);
					data.status = "error";
					break;
				}
			}
			if (data.status === "error") break;
		}
		await store(async (store$1) => {
			await store$1.set("health", data).catch((err) => {
				logger.warn(err, "Failed to write health check cache");
			});
		});
		return this.accountability?.admin === true ? data : { status: data.status };
		async function testDatabase() {
			if (enabledServices.includes("database") === false) return {};
			const database = database_default();
			const client = env["DB_CLIENT"];
			const checks = {};
			checks[`${client}:responseTime`] = [{
				status: "ok",
				componentType: "datastore",
				observedUnit: "ms",
				observedValue: 0,
				threshold: env["DB_HEALTHCHECK_THRESHOLD"] ? +env["DB_HEALTHCHECK_THRESHOLD"] : 150
			}];
			const startTime = performance.now();
			if (await hasDatabaseConnection()) checks[`${client}:responseTime`][0].status = "ok";
			else {
				checks[`${client}:responseTime`][0].status = "error";
				checks[`${client}:responseTime`][0].output = `Can't connect to the database.`;
			}
			const endTime = performance.now();
			checks[`${client}:responseTime`][0].observedValue = +(endTime - startTime).toFixed(3);
			if (Number(checks[`${client}:responseTime`][0].observedValue) > checks[`${client}:responseTime`][0].threshold && checks[`${client}:responseTime`][0].status !== "error") checks[`${client}:responseTime`][0].status = "warn";
			checks[`${client}:connectionsAvailable`] = [{
				status: "ok",
				componentType: "datastore",
				observedValue: database.client.pool.numFree()
			}];
			checks[`${client}:connectionsUsed`] = [{
				status: "ok",
				componentType: "datastore",
				observedValue: database.client.pool.numUsed()
			}];
			return checks;
		}
		async function testRedis() {
			if (enabledServices.includes("redis") === false || redisConfigAvailable() !== true) return {};
			const redis = createKv({
				type: "redis",
				redis: useRedis(),
				namespace: env["HEALTHCHECK_NAMESPACE"] ?? "directus:healthcheck",
				ttl: HEALTHCHECK_CACHE_TTL
			});
			const checks = { "redis:responseTime": [{
				status: "ok",
				componentType: "cache",
				observedValue: 0,
				observedUnit: "ms",
				threshold: env["CACHE_HEALTHCHECK_THRESHOLD"] ? +env["CACHE_HEALTHCHECK_THRESHOLD"] : 150
			}] };
			const startTime = performance.now();
			try {
				await redis.set(`directus-health-${checkID}`, 1);
				await redis.delete(`directus-health-${checkID}`);
			} catch (err) {
				checks["redis:responseTime"][0].status = "error";
				checks["redis:responseTime"][0].output = err;
			} finally {
				const endTime = performance.now();
				checks["redis:responseTime"][0].observedValue = +(endTime - startTime).toFixed(3);
				if (checks["redis:responseTime"][0].observedValue > checks["redis:responseTime"][0].threshold && checks["redis:responseTime"][0].status !== "error") checks["redis:responseTime"][0].status = "warn";
			}
			return checks;
		}
		async function testStorage() {
			if (enabledServices.includes("storage") === false) return {};
			const storage = await getStorage();
			const checks = {};
			for (const location of toArray(env["STORAGE_LOCATIONS"])) {
				const disk = storage.location(location);
				const envThresholdKey = `STORAGE_${location}_HEALTHCHECK_THRESHOLD`.toUpperCase();
				checks[`storage:${location}:responseTime`] = [{
					status: "ok",
					componentType: "objectstore",
					observedValue: 0,
					observedUnit: "ms",
					threshold: env[envThresholdKey] ? +env[envThresholdKey] : 750
				}];
				const startTime = performance.now();
				try {
					await disk.write("directus-health-file", Readable.from([checkID]));
				} catch (err) {
					checks[`storage:${location}:responseTime`][0].status = "error";
					checks[`storage:${location}:responseTime`][0].output = err;
				} finally {
					const endTime = performance.now();
					checks[`storage:${location}:responseTime`][0].observedValue = +(endTime - startTime).toFixed(3);
					if (Number(checks[`storage:${location}:responseTime`][0].observedValue) > checks[`storage:${location}:responseTime`][0].threshold && checks[`storage:${location}:responseTime`][0].status !== "error") checks[`storage:${location}:responseTime`][0].status = "warn";
				}
			}
			return checks;
		}
		async function testEmail() {
			if (enabledServices.includes("email") === false || toBoolean(env["EMAIL_VERIFY_SETUP"]) === false) return {};
			const checks = { "email:connection": [{
				status: "ok",
				componentType: "email"
			}] };
			const mailer = getMailer();
			try {
				await mailer.verify();
			} catch (err) {
				checks["email:connection"][0].status = "error";
				checks["email:connection"][0].output = err;
			}
			return checks;
		}
	}
};

//#endregion
export { ServerService };